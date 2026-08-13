const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const ACTIONS = Object.freeze(['Relax', 'Move', 'Sit', 'Sleep', 'Interact']);
const MAX_PROFILE_BYTES = 300 * 1024 * 1024;
const PROFILE_FILE_NAME = 'profile.json';
const ACTIVE_PAIR_FILE_NAME = 'active-pair.json';

class ProfileValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ProfileValidationError(`无法读取 ${path.basename(file)}：${error.message}`);
  }
}

function safeId(value, label = '素材包 ID') {
  const text = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(text)) {
    throw new ProfileValidationError(`${label}只能包含字母、数字、点、下划线或连字符，且长度为 1–80。`);
  }
  return text;
}

function nonEmptyText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new ProfileValidationError(`${label}不能为空。`);
  return text;
}

function safeRelativePath(value, label) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text || path.isAbsolute(text) || text.includes('../') || text === '..') {
    throw new ProfileValidationError(`${label}必须是素材包内的相对路径。`);
  }
  return text;
}

function fileUrl(file) {
  return pathToFileURL(file).href;
}

function existingFile(root, relativePath, label, required = false) {
  if (!relativePath) {
    if (required) throw new ProfileValidationError(`缺少${label}。`);
    return null;
  }
  const safePath = safeRelativePath(relativePath, label);
  const fullPath = path.resolve(root, safePath);
  if (!fullPath.startsWith(`${path.resolve(root)}${path.sep}`) && fullPath !== path.resolve(root)) {
    throw new ProfileValidationError(`${label}不在素材包目录内。`);
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    if (required) throw new ProfileValidationError(`找不到${label}：${safePath}`);
    return null;
  }
  return fullPath;
}

function assetUrlMap(root, entries, label) {
  const result = {};
  for (const action of ACTIONS) {
    const file = existingFile(root, entries?.[action], `${label}${action}`, false);
    if (file) result[action] = fileUrl(file);
  }
  return result;
}

function normalizeActionMap(source = {}) {
  const result = {};
  for (const action of ACTIONS) {
    const mapped = source[action];
    if (typeof mapped === 'string' && mapped.trim()) result[action] = mapped.trim();
  }
  return result;
}

function boundedNumber(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ProfileValidationError(`${label}必须在 ${min} 到 ${max} 之间。`);
  }
  return number;
}

function profileCapabilities(actions) {
  return {
    move: Boolean(actions.Move),
    relax: Boolean(actions.Relax),
    sit: Boolean(actions.Sit),
    sleep: Boolean(actions.Sleep),
    interact: Boolean(actions.Interact)
  };
}

function normalizeAnimationNames(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value) => typeof value === 'string' && value.length > 0 && value.length <= 160)
    .map((value) => value.trim())
    .filter(Boolean))].slice(0, 300);
}

function validateRuntimeCompatibility(profile) {
  if (!profile.capabilities.move || !profile.capabilities.relax) {
    throw new ProfileValidationError('素材包至少需要 Move 和 Relax 动作，才能用于桌宠。');
  }
}

function totalFileBytes(directory) {
  let bytes = 0;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) bytes += fs.statSync(fullPath).size;
      if (bytes > MAX_PROFILE_BYTES) {
        throw new ProfileValidationError(`素材包超过 ${Math.round(MAX_PROFILE_BYTES / 1024 / 1024)} MB 上限。`);
      }
    }
  };
  visit(directory);
  return bytes;
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
}

function createBundledProfile({ id, operatorId, name, root, modelDirectory, filePrefix }) {
  const assetRoot = path.join(root, 'assets');
  const processedRoot = path.join(root, 'processed-assets');
  const modelRoot = path.join(root, 'prts-assets', modelDirectory);
  const webm = (action) => `${filePrefix}-默认-基建-${action}-x1.webm`;
  const apng = (action) => `${filePrefix}-默认-基建-${action}-x1.apng`;
  if (!fs.existsSync(path.join(assetRoot, `${filePrefix}default.png`))
    || !fs.existsSync(path.join(modelRoot, 'model.skel'))
    || !fs.existsSync(path.join(modelRoot, 'model.atlas'))) {
    return null;
  }
  const actions = Object.fromEntries(ACTIONS.map((action) => [action, action]));
  return {
    id,
    source: 'bundled',
    operator: { id: operatorId, name, outfitId: 'default', outfitName: '默认' },
    actionMap: actions,
    capabilities: profileCapabilities(actions),
    runtime: null,
    calibration: { scale: 1, groundOffset: filePrefix === '银灰' ? 8 : 0, headHitRatio: 1 / 3 },
    renderer: {
      label: name,
      defaultAsset: fileUrl(path.join(assetRoot, `${filePrefix}default.png`)),
      model: {
        skeleton: fileUrl(path.join(modelRoot, 'model.skel')),
        atlas: fileUrl(path.join(modelRoot, 'model.atlas'))
      },
      fallbackActions: Object.fromEntries(ACTIONS.map((action) => [action, fileUrl(path.join(assetRoot, webm(action)))])),
      processedActions: Object.fromEntries(ACTIONS.map((action) => [action, fileUrl(path.join(processedRoot, apng(action)))]))
    }
  };
}

function parseProfileDocument(document, root, source = 'imported') {
  const id = safeId(document.id, '素材包 ID');
  const operator = document.operator || {};
  const name = nonEmptyText(operator.name, '干员名称');
  const actions = normalizeActionMap(document.actions);
  const capabilities = profileCapabilities(actions);
  const files = document.files || {};
  const model = files.model || {};
  const defaultAsset = existingFile(root, files.defaultAsset, '默认图片', true);
  const skeleton = existingFile(root, model.skeleton, 'Spine skeleton 文件', true);
  const atlas = existingFile(root, model.atlas, 'Spine atlas 文件', true);

  const profile = {
    id,
    source,
    provider: typeof document.provider === 'string' ? document.provider.slice(0, 64) : null,
    sourcePage: typeof document.sourcePage === 'string' ? document.sourcePage.slice(0, 2048) : null,
    operator: {
      id: nonEmptyText(operator.id, '干员 ID'),
      name,
      outfitId: nonEmptyText(operator.outfitId, '时装 ID'),
      outfitName: nonEmptyText(operator.outfitName, '时装名称')
    },
    actionMap: actions,
    capabilities,
    runtime: null,
    calibration: {
      scale: boundedNumber(document.calibration?.scale, 1, 0.1, 3, 'calibration.scale'),
      groundOffset: boundedNumber(document.calibration?.groundOffset, 0, -200, 200, 'calibration.groundOffset'),
      headHitRatio: boundedNumber(document.calibration?.headHitRatio, 1 / 3, 0.1, 0.7, 'calibration.headHitRatio')
    },
    renderer: {
      label: name,
      defaultAsset: fileUrl(defaultAsset),
      model: { skeleton: fileUrl(skeleton), atlas: fileUrl(atlas) },
      fallbackActions: assetUrlMap(root, files.fallbackActions, 'WebM 动作 '),
      processedActions: assetUrlMap(root, files.processedActions, 'APNG 动作 ')
    }
  };
  validateRuntimeCompatibility(profile);
  return profile;
}

class ProfileManager {
  constructor({ userDataPath, appPath }) {
    this.userDataPath = userDataPath;
    this.appPath = appPath;
    this.profilesPath = path.join(userDataPath, 'profiles');
    this.activePairPath = path.join(userDataPath, ACTIVE_PAIR_FILE_NAME);
    this.profiles = new Map();
    this.activePair = { slotA: null, slotB: null };
  }

  initialize() {
    fs.mkdirSync(this.profilesPath, { recursive: true });
    this.profiles.clear();
    const bundled = [
      createBundledProfile({
        id: 'bundled-gnosis-default', operatorId: 'char_206_gnosis', name: '灵知', root: this.appPath, modelDirectory: 'gnosis', filePrefix: '灵知'
      }),
      createBundledProfile({
        id: 'bundled-silverash-default', operatorId: 'char_172_svrash', name: '银灰', root: this.appPath, modelDirectory: 'silverash', filePrefix: '银灰'
      })
    ];
    for (const profile of bundled.filter(Boolean)) this.profiles.set(profile.id, profile);

    for (const entry of fs.readdirSync(this.profilesPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.profilesPath, entry.name);
      const manifest = path.join(directory, PROFILE_FILE_NAME);
      if (!fs.existsSync(manifest)) continue;
      try {
        const profile = parseProfileDocument(readJson(manifest), directory);
        this.profiles.set(profile.id, profile);
      } catch (error) {
        console.warn(`[profile-manager] skipped invalid profile ${entry.name}: ${error.message}`);
      }
    }

    let restoredActivePair = false;
    if (fs.existsSync(this.activePairPath)) {
      try {
        const saved = readJson(this.activePairPath);
        if (this.profiles.has(saved.slotA) && this.profiles.has(saved.slotB)) {
          this.activePair = { slotA: saved.slotA, slotB: saved.slotB };
          restoredActivePair = true;
        }
      } catch (error) {
        console.warn(`[profile-manager] unable to load active pair: ${error.message}`);
      }
    }
    if (!restoredActivePair) {
      const available = [...this.profiles.keys()];
      this.activePair = {
        slotA: available[0] || null,
        slotB: available[1] || available[0] || null
      };
    }
    this.saveActivePair();
    return this.getState();
  }

  saveActivePair() {
    const temporary = `${this.activePairPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.activePair, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.activePairPath);
  }

  getProfile(id) {
    const profile = this.profiles.get(id);
    if (!profile) throw new ProfileValidationError(`素材包不存在：${id}`);
    return profile;
  }

  profileSummary(profile) {
    return {
      id: profile.id,
      source: profile.source,
      provider: profile.provider,
      sourcePage: profile.sourcePage,
      operator: profile.operator,
      capabilities: profile.capabilities,
      calibration: profile.calibration,
      runtime: profile.runtime
    };
  }

  getState() {
    const slotA = this.activePair.slotA ? this.getProfile(this.activePair.slotA) : null;
    const slotB = this.activePair.slotB ? this.getProfile(this.activePair.slotB) : null;
    return {
      activePair: { ...this.activePair },
      isSetupRequired: !slotA || !slotB,
      activeProfiles: {
        'slot-a': slotA,
        'slot-b': slotB
      },
      profiles: [...this.profiles.values()].map((profile) => this.profileSummary(profile))
    };
  }

  selectPair({ slotA, slotB }) {
    const nextA = safeId(slotA, '左侧素材包 ID');
    const nextB = safeId(slotB, '右侧素材包 ID');
    const profileA = this.getProfile(nextA);
    const profileB = this.getProfile(nextB);
    for (const profile of [profileA, profileB]) {
      if (profile.runtime?.compatibility === 'incompatible') {
        throw new ProfileValidationError(`素材包“${profile.operator.name}（${profile.operator.outfitName}）”缺少必需动作：${profile.runtime.missingRequired.join('、')}。`);
      }
    }
    this.activePair = { slotA: nextA, slotB: nextB };
    this.saveActivePair();
    return this.getState();
  }

  recordRuntimeAnimations(profileId, animationNames) {
    const profile = this.getProfile(safeId(profileId, '素材包 ID'));
    const availableAnimations = normalizeAnimationNames(animationNames);
    const available = new Set(availableAnimations);
    const actions = Object.fromEntries(ACTIONS.map((action) => {
      const mapped = profile.actionMap[action] || null;
      return [action, { mapped, available: Boolean(mapped && available.has(mapped)) }];
    }));
    const missingRequired = ['Move', 'Relax'].filter((action) => !actions[action].available);
    const missingOptional = ['Sit', 'Sleep', 'Interact'].filter((action) => !actions[action].available);
    profile.runtime = {
      checkedAt: new Date().toISOString(),
      availableAnimations,
      actions,
      compatibility: missingRequired.length > 0
        ? 'incompatible'
        : missingOptional.length > 0 ? 'basic' : 'full',
      missingRequired,
      missingOptional
    };
    return this.getState();
  }

  importDirectory(sourceDirectory, { replaceExisting = false } = {}) {
    const source = path.resolve(nonEmptyText(sourceDirectory, '导入目录'));
    const manifest = path.join(source, PROFILE_FILE_NAME);
    if (!fs.existsSync(manifest)) throw new ProfileValidationError('所选目录中没有 profile.json。');
    totalFileBytes(source);
    const document = readJson(manifest);
    const parsed = parseProfileDocument(document, source, 'imported');
    const destination = path.join(this.profilesPath, parsed.id);
    const temporary = path.join(this.profilesPath, `.import-${parsed.id}-${crypto.randomUUID()}`);
    if (fs.existsSync(destination) && !replaceExisting) {
      throw new ProfileValidationError(`已存在同 ID 的素材包：${parsed.id}。请先删除旧包或修改 profile.json 的 id。`);
    }
    try {
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      copyDirectory(source, temporary);
      fs.renameSync(temporary, destination);
      const persisted = parseProfileDocument(readJson(path.join(destination, PROFILE_FILE_NAME)), destination);
      this.profiles.set(persisted.id, persisted);
      return this.getState();
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }
}

module.exports = {
  ACTIONS,
  ProfileManager,
  ProfileValidationError,
  parseProfileDocument
};
