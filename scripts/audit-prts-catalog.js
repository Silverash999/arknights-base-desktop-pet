const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, net } = require('electron');
const { PritsProvider, requestText } = require('../src/main/prts-provider');
const { AssetDownloadManager } = require('../src/main/asset-download-manager');
const { ProfileManager } = require('../src/main/profile-manager');
const { buildOfficialOperatorIdMap } = require('../src/main/operator-id-cache');
const { readSkeletonVersion } = require('../src/shared/spine-compatibility');

const OFFICIAL_CHARACTER_TABLE_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/character_table.json';
const OFFICIAL_CHARACTER_TABLE_MAX_BYTES = 20 * 1024 * 1024;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_AUDIT_ROOT = path.join(PROJECT_ROOT, '.test-tmp', 'prts-catalog-audit');
const RENDERER_RUNTIME = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'renderer', 'prts-spine-runtime.js'), 'utf8');
const SPINE_COMPATIBILITY_RUNTIME = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'shared', 'spine-compatibility.js'), 'utf8');
const RENDER_BATCH_SIZE = 8;

function buildOperatorEntries(table) {
  const mapping = buildOfficialOperatorIdMap(Object.fromEntries(
    Object.entries(table || {}).filter(([, entry]) => entry?.isNotObtainable !== true)
  ));
  return [...mapping.entries()]
    .map(([name, id]) => ({ id, name }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function classifyAuditError(error) {
  const message = String(error?.message || error || '');
  if (/没有可用的[“"]基建[”"]模型|尚未.*可下载的基建模型|HTTP 状态码：404|operator-not-found/i.test(message)) return 'unsupported';
  if (/WebGL|GPU process|context.*lost|ANGLE|硬件加速/i.test(message)) return 'environment';
  if (/超时|timed out|连接.*失败|ECONN|ERR_CONNECTION|socket hang up|fetch failed/i.test(message)) return 'transient';
  return 'failed';
}

function hasVisiblePixels(pixels) {
  if (!pixels || typeof pixels.length !== 'number') return false;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 5) return true;
  }
  return false;
}

async function requestOfficialCharacterTable() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await net.fetch(OFFICIAL_CHARACTER_TABLE_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        Accept: 'application/json;q=1,*/*;q=0.1'
      }
    });
    if (!response.ok) throw new Error(`官方干员表请求失败，HTTP 状态码：${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > OFFICIAL_CHARACTER_TABLE_MAX_BYTES) {
      throw new Error('官方干员表内容超过 20 MB 上限。');
    }
    return JSON.parse(text);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('官方干员表请求超时。');
    throw new Error(`无法读取官方干员表：${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseArguments(argv) {
  // The desktop pet initializes transparent Spine models in sequence. Keep
  // the audit's default the same: simultaneous WebGL contexts created false
  // all-transparent results for otherwise valid models.
  const settings = { auditRoot: DEFAULT_AUDIT_ROOT, limit: null, only: null, maxDurationMs: null, operatorId: null, retryFailed: false, force: false, concurrency: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--audit-root' && value) {
      settings.auditRoot = path.resolve(value);
      index += 1;
    } else if (argument === '--limit' && value && /^\d+$/.test(value)) {
      settings.limit = Number(value);
      index += 1;
    } else if (argument === '--only' && value) {
      settings.only = value;
      index += 1;
    } else if (argument === '--operator-id' && value && /^char_\d+_[a-z0-9_]+$/i.test(value)) {
      settings.operatorId = value;
      index += 1;
    } else if (argument === '--max-duration-seconds' && value && /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0) {
      settings.maxDurationMs = Math.round(Number(value) * 1000);
      index += 1;
    } else if (argument === '--retry-failed') {
      settings.retryFailed = true;
    } else if (argument === '--force') {
      settings.force = true;
    } else if (argument === '--concurrency' && value && /^[1-3]$/.test(value)) {
      settings.concurrency = Number(value);
      index += 1;
    } else if (argument === '--help') {
      process.stdout.write('Usage: electron scripts/audit-prts-catalog.js [--audit-root <path>] [--limit <count>] [--only <operator name>] [--operator-id <char_id>] [--max-duration-seconds <seconds>] [--concurrency 1-3] [--retry-failed] [--force]\n');
      process.exit(0);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  return settings;
}

function electronDataPaths(auditRoot) {
  return {
    userData: path.join(auditRoot, 'electron-user-data'),
    sessionData: path.join(auditRoot, 'electron-session-data')
  };
}

function prepareAuditSession(sessionRoot) {
  // Session roots are created exclusively under the caller-provided audit
  // root. Clean an interrupted prior attempt before beginning this operator,
  // so a retry cannot confuse stale audit artifacts with user-installed packs.
  fs.rmSync(sessionRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  fs.mkdirSync(sessionRoot, { recursive: true });
}

function isFullCatalogRun(settings) {
  return !settings?.only && settings?.limit === null;
}

function readJsonIfPresent(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function summarize(results, expectedCount = null) {
  const totals = { pass: 0, unsupported: 0, transient: 0, environment: 0, failed: 0, pending: 0 };
  for (const result of Object.values(results)) totals[result.status] = (totals[result.status] || 0) + 1;
  if (Number.isInteger(expectedCount) && expectedCount >= 0) {
    totals.pending = Math.max(0, expectedCount - Object.keys(results).length);
  }
  return totals;
}

function writeMarkdownReport(file, state) {
  const totals = summarize(state.results || {}, state.operatorCount);
  const rows = Object.values(state.results || {}).sort((left, right) => left.id.localeCompare(right.id));
  const details = rows.filter((row) => row.status !== 'pass');
  const lines = [
    '# PRTS 全量干员隔离验收报告',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 官方干员表获取时间：${state.catalogFetchedAt || '未知'}`,
    `- 候选干员数：${state.operatorCount || 0}`,
    `- 已完成：${rows.length}`,
    `- 通过：${totals.pass || 0}`,
    `- 无可用基建模型：${totals.unsupported || 0}`,
    `- 网络待复测：${totals.transient || 0}`,
    `- 本机渲染环境问题：${totals.environment || 0}`,
    `- 失败：${totals.failed || 0}`,
    '',
    '通过项均已在隔离目录完成：PRTS 查询、默认基建模型下载与完整性校验、临时导入、左右组合启用、Spine 3.8 解析、Relax/Move 动作和非透明帧渲染。',
    ''
  ];
  if (details.length === 0) {
    lines.push('所有已完成项均通过。');
  } else {
    lines.push('## 未通过或不适用项', '', '| 干员 | 状态 | 阶段 | 原因 |', '| --- | --- | --- | --- |');
    for (const item of details) {
      lines.push(`| ${item.name} | ${item.status} | ${item.stage || '未知'} | ${String(item.error || '').replace(/[|\r\n]/g, ' ').slice(0, 240)} |`);
    }
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

class RendererAuditor {
  constructor(auditRoot) {
    this.auditRoot = auditRoot;
    this.window = null;
    this.itemsInWindow = 0;
  }

  async ensureWindow() {
    if (this.window && !this.window.isDestroyed() && this.itemsInWindow < RENDER_BATCH_SIZE) return this.window;
    await this.closeWindow();
    this.window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: false }
    });
    await this.window.loadURL('about:blank');
    // The runtime assigns a class in its final expression. Ask Electron to
    // return only undefined, otherwise it attempts to structured-clone that
    // class across the process boundary before any model is tested.
    await this.window.webContents.executeJavaScript(`${RENDERER_RUNTIME}\n${SPINE_COMPATIBILITY_RUNTIME}\n;undefined;`);
    this.itemsInWindow = 0;
    return this.window;
  }

  async audit({ id, skeleton, atlas }) {
    const window = await this.ensureWindow();
    const key = `${id}-${this.itemsInWindow}`;
    const serialized = await window.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 1000;
      document.body.replaceChildren(canvas);
      const player = new window.PRTSSpinePlayer(canvas);
      const loaded = await player.load(
        ${JSON.stringify(key)},
        ${JSON.stringify(pathToFileURL(skeleton).href)},
        ${JSON.stringify(pathToFileURL(atlas).href)},
        { x: -500, y: -200, scale: 1 },
        null,
        true
      );
      const animations = loaded.skeleton.data.animations.map((animation) => animation.name);
      const originalSkin = loaded.skeleton.skin?.name || null;
      const skinDecision = window.SpineCompatibility.resolveRenderableSkin(loaded.skeleton);
      const bounds = {
        offset: { x: loaded.bounds.offset.x, y: loaded.bounds.offset.y },
        size: { x: loaded.bounds.size.x, y: loaded.bounds.size.y }
      };
      if (!animations.includes('Relax') || !animations.includes('Move')) {
        return JSON.stringify({ animations, bounds, originalSkin, skinDecision, missingRequired: ['Relax', 'Move'].filter((name) => !animations.includes(name)), visible: false });
      }
      player.play(${JSON.stringify(key)});
      const sampleVisible = () => {
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        player.context.gl.readPixels(0, 0, canvas.width, canvas.height, player.context.gl.RGBA, player.context.gl.UNSIGNED_BYTE, pixels);
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 5) return true;
        }
        return false;
      };
      const sampleAnimation = async (name) => {
        player.setAnimation(name, true);
        const samples = [];
        for (const delayMs of [90, 180, 360]) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          const visible = sampleVisible();
          samples.push({ delayMs, visible });
          if (visible) return { visible, samples };
        }
        return { visible: false, samples };
      };
      const relax = await sampleAnimation('Relax');
      const move = await sampleAnimation('Move');
      const alternateIdleSamples = {};
      if (!relax.visible) {
        for (const name of ['Default', 'Sit']) {
          if (!animations.includes(name)) continue;
          alternateIdleSamples[name] = await sampleAnimation(name);
        }
      }
      const webglError = player.context.gl.getError();
      // PRTSSpinePlayer has no public disposal method. Stop its self-scheduling
      // render loop before this BrowserWindow tests the next model.
      player.activeSkeleton = null;
      player.assetManager?.dispose?.();
      return JSON.stringify({ animations, bounds, originalSkin, skinDecision, missingRequired: [], visible: relax.visible, visibleRelax: relax.visible, visibleMove: move.visible, relaxSamples: relax.samples, moveSamples: move.samples, alternateIdleSamples, webglError });
    })()`);
    const result = JSON.parse(serialized);
    this.itemsInWindow += 1;
    if (!result.visible) {
      const error = new Error('Spine 渲染结果全透明。');
      error.details = result;
      throw error;
    }
    return result;
  }

  async closeWindow() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.itemsInWindow = 0;
  }
}

function selectedOutfit(catalog) {
  const defaultOutfit = catalog.outfits.find((outfit) => outfit.name === '默认');
  return defaultOutfit || catalog.outfits[0] || null;
}

async function auditOperator({ entry, provider, auditor, auditRoot }) {
  const startedAt = Date.now();
  const sessionRoot = path.join(auditRoot, 'sessions', entry.id);
  let stage = 'query';
  try {
    prepareAuditSession(sessionRoot);
    const catalog = await provider.lookup(entry.name);
    const outfit = selectedOutfit(catalog);
    if (!outfit) throw new Error('PRTS 查询成功但没有可下载的基建时装组。');
    const plans = await provider.createDownloadPlans({ name: entry.name, outfitName: outfit.name });
    const profileManager = new ProfileManager({ userDataPath: sessionRoot, appPath: PROJECT_ROOT });
    profileManager.initialize();
    const fallbackSources = [];
    const downloadManager = new AssetDownloadManager({
      downloadsPath: path.join(sessionRoot, 'downloads'),
      profileManager,
      allowedHosts: ['static.prts.wiki', 'torappu.prts.wiki']
    });
    stage = 'download-and-import';
    let state;
    state = await downloadManager.installCandidates(plans, {
      onProgress: (event) => {
        if (event.phase === 'candidate-fallback') fallbackSources.push(event.source || 'unknown');
      }
    });
    const profileId = plans[0].profile.id;
    stage = 'activate-pair';
    profileManager.selectPair({ slotA: profileId, slotB: profileId });
    const importedRoot = path.join(sessionRoot, 'profiles', profileId);
    const skeleton = path.join(importedRoot, plans[0].profile.files.model.skeleton);
    const atlas = path.join(importedRoot, plans[0].profile.files.model.atlas);
    stage = 'renderer';
    let renderer;
    try {
      renderer = await auditor.audit({ id: profileId, skeleton, atlas });
    } catch (error) {
      // A freshly-created Chromium WebGL context can occasionally yield an
      // all-transparent first sample although the same model is valid. Retry
      // once in a new hidden window; a second failure remains diagnostic.
      if (!/渲染结果全透明/.test(String(error?.message || ''))) throw error;
      await auditor.closeWindow();
      renderer = await auditor.audit({ id: profileId, skeleton, atlas });
    }
    if (renderer.missingRequired.length > 0) throw new Error(`Spine 缺少必需动作：${renderer.missingRequired.join('、')}。`);
    const version = readSkeletonVersion(fs.readFileSync(skeleton));
    return {
      id: entry.id,
      name: entry.name,
      status: 'pass',
      stage: 'renderer',
      operatorId: catalog.operatorId,
      outfitName: outfit.name,
      outfitCount: catalog.outfits.length,
      sourceCandidates: plans.map((plan) => plan.source),
      fallbackSources,
      skeletonVersion: version?.text || null,
      animations: renderer.animations,
      originalSkin: renderer.originalSkin,
      skinDecision: renderer.skinDecision,
      rendererBounds: renderer.bounds,
      visibleRelax: renderer.visibleRelax,
      visibleMove: renderer.visibleMove,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    error.stage = stage;
    throw error;
  } finally {
    // This is an audit-owned directory created above, not user data. Removing
    // it keeps a full sweep from retaining a second copy of every texture.
    fs.rmSync(sessionRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function run() {
  const settings = parseArguments(process.argv.slice(2));
  fs.mkdirSync(settings.auditRoot, { recursive: true });
  const resultsFile = path.join(settings.auditRoot, 'results.json');
  const reportFile = path.join(settings.auditRoot, 'report.md');
  const state = readJsonIfPresent(resultsFile, { version: 1, results: {} });
  state.results = state.results || {};

  let entries;
  if (settings.only && settings.operatorId) {
    entries = [{ id: settings.operatorId, name: settings.only }];
    state.catalogSource = 'explicit-audit-argument';
  } else {
    const tableFile = path.join(settings.auditRoot, 'official-character-table.json');
    let table = readJsonIfPresent(tableFile, null);
    if (!table) {
      table = await requestOfficialCharacterTable();
      writeJsonAtomic(tableFile, table);
    }
    entries = buildOperatorEntries(table);
    if (settings.only) entries = entries.filter((entry) => entry.name === settings.only);
    state.catalogSource = OFFICIAL_CHARACTER_TABLE_URL;
  }
  if (settings.limit !== null) entries = entries.slice(0, settings.limit);
  if (entries.length === 0) throw new Error('没有匹配的干员可供审计。');
  state.catalogFetchedAt = new Date().toISOString();
  if (isFullCatalogRun(settings)) state.operatorCount = entries.length;
  state.lastRunOperatorCount = entries.length;
  writeJsonAtomic(resultsFile, state);

  const operatorIds = new Map(entries.map((entry) => [entry.name, entry.id]));
  const provider = new PritsProvider({ lookupOfficialOperatorId: async (name) => operatorIds.get(name) || null });
  const originalResolveCatalog = provider.resolveCatalog.bind(provider);
  const catalogCache = new Map();
  provider.resolveCatalog = async (name) => {
    if (!catalogCache.has(name)) catalogCache.set(name, originalResolveCatalog(name));
    return catalogCache.get(name);
  };
  const auditors = Array.from({ length: settings.concurrency }, () => new RendererAuditor(settings.auditRoot));
  const auditStartedAt = Date.now();
  try {
    let index = 0;
    while (index < entries.length) {
      if (index > 0 && settings.maxDurationMs !== null && Date.now() - auditStartedAt >= settings.maxDurationMs) {
        process.stdout.write(`Audit batch time budget reached after ${index} candidates.\n`);
        break;
      }
      const batch = [];
      while (index < entries.length && batch.length < settings.concurrency) {
        const entry = entries[index];
        const entryIndex = index;
        index += 1;
        const earlier = state.results[entry.id];
        if (earlier && !settings.force && earlier.status !== 'transient' && !(settings.retryFailed && earlier.status === 'failed')) {
          process.stdout.write(`[${entryIndex + 1}/${entries.length}] skip ${entry.name}: ${earlier.status}\n`);
          continue;
        }
        batch.push({ entry, entryIndex });
      }
      if (batch.length === 0) continue;
      const completed = await Promise.all(batch.map(async ({ entry, entryIndex }, batchIndex) => {
        let result;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            result = await auditOperator({ entry, provider, auditor: auditors[batchIndex], auditRoot: settings.auditRoot });
            break;
          } catch (error) {
            const status = classifyAuditError(error);
            result = {
              id: entry.id,
              name: entry.name,
              status,
              stage: error?.stage || 'query-download-or-renderer',
              error: String(error?.message || error),
              attempt,
              details: error?.details || null
            };
            if (status !== 'transient' || attempt === 2) break;
          }
        }
        return { entry, entryIndex, result };
      }));
      for (const { entry, entryIndex, result } of completed) {
        state.results[entry.id] = result;
        process.stdout.write(`[${entryIndex + 1}/${entries.length}] ${entry.name}: ${result.status}${result.error ? ` — ${result.error}` : ''}\n`);
      }
      state.updatedAt = new Date().toISOString();
      writeJsonAtomic(resultsFile, state);
      writeMarkdownReport(reportFile, state);
    }
  } finally {
    await Promise.all(auditors.map((auditor) => auditor.closeWindow()));
    writeJsonAtomic(resultsFile, state);
    writeMarkdownReport(reportFile, state);
  }
  const totals = summarize(state.results, state.operatorCount);
  process.stdout.write(`Audit complete: ${JSON.stringify(totals)}\nResults: ${resultsFile}\n`);
  if ((totals.failed || 0) > 0 || (totals.environment || 0) > 0) process.exitCode = 2;
}

// Electron can set require.main to the package entry point even when this
// script is passed on its command line. Node unit tests do not expose this
// version marker, so it is the reliable boundary between test import and run.
if (process.versions.electron) {
  const bootstrapSettings = parseArguments(process.argv.slice(2));
  const dataPaths = electronDataPaths(bootstrapSettings.auditRoot);
  const bootstrapLog = process.env.PET_AUDIT_BOOTSTRAP_LOG;
  const traceBootstrap = (message) => {
    if (bootstrapLog) fs.appendFileSync(bootstrapLog, `${new Date().toISOString()} ${message}\n`, 'utf8');
  };
  traceBootstrap('electron-entry');
  app.setPath('userData', dataPaths.userData);
  app.setPath('sessionData', dataPaths.sessionData);
  let keepAliveWindow;
  app.whenReady().then(() => {
    traceBootstrap('electron-ready');
    // Electron exits when no BrowserWindow exists. The first network request
    // precedes the renderer auditor's own window, so keep this hidden window
    // alive until the audit has begun and completed.
    keepAliveWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    return run();
  }).catch((error) => {
    traceBootstrap(`electron-error ${error.stack || error}`);
    console.error(`PRTS catalog audit failed: ${error.stack || error}`);
    process.exitCode = 1;
  }).finally(() => {
    traceBootstrap('electron-quit');
    if (keepAliveWindow && !keepAliveWindow.isDestroyed()) keepAliveWindow.destroy();
    app.quit();
  });
}

module.exports = {
  buildOperatorEntries,
  classifyAuditError,
  electronDataPaths,
  hasVisiblePixels,
  isFullCatalogRun,
  OFFICIAL_CHARACTER_TABLE_MAX_BYTES,
  parseArguments,
  prepareAuditSession,
  summarize
};
