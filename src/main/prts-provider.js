const crypto = require('node:crypto');
const https = require('node:https');

const WIKI_HOST = 'prts.wiki';
// PRTS moved the public Spine catalogue to static.prts.wiki. Keep the
// former host as a narrowly-scoped compatibility fallback for older pages.
const ASSET_HOST = 'static.prts.wiki';
const ASSET_HOSTS = Object.freeze([ASSET_HOST, 'torappu.prts.wiki']);
// These are public PRTS Spine directory versions verified by contract tests.
// Do not accept arbitrary static.prts.wiki paths: the prefix is later used to
// construct download URLs.
const STATIC_SPINE_DIRECTORIES = Object.freeze(['spine', 'spine38']);
// Raw MediaWiki content is compact and contains the exact name -> char_ ID
// table. Fetching the rendered module page can be slow enough to time out.
const OPERATOR_ID_MAP_URL = `https://${WIKI_HOST}/index.php?title=%E6%A8%A1%E5%9D%97%3AGetNpcKey&action=raw`;
const ACTIONS = Object.freeze({ Relax: 'Relax', Move: 'Move', Sit: 'Sit', Sleep: 'Sleep', Interact: 'Interact' });
// PRTS 的 GetNpcKey 模块长期未更新，较新的干员不会出现在其中。这里仅
// 保存已核验的补充条目；素材本身依然完全从 PRTS 的公开资源服务器下载。
const VERIFIED_OPERATOR_IDS = Object.freeze({
  锏: 'char_4116_blkkgt'
});

class PritsProviderError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'PritsProviderError';
    this.code = code;
  }
}

function requestText(urlText) {
  return new Promise((resolve, reject) => {
    const request = https.get(urlText, {
      headers: {
        'User-Agent': 'ArknightsBasePet/0.2 (desktop-pet material downloader)',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8'
      },
      timeout: 30000
    }, (response) => {
      const status = response.statusCode || 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new PritsProviderError(`PRTS 请求失败，HTTP 状态码：${status}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          response.destroy(new PritsProviderError('PRTS 返回内容过大。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('timeout', () => request.destroy(new PritsProviderError('连接 PRTS 超时。')));
    request.on('error', (error) => reject(new PritsProviderError(`无法连接 PRTS：${error.message}`)));
  });
}

function operatorName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 64 || /[\\/\r\n]/.test(name)) {
    throw new PritsProviderError('请输入有效的干员名称。');
  }
  return name;
}

function extractOperatorId(page) {
  const assetUrl = /https:\/\/torappu\.prts\.wiki\/assets\/char_spine\/(char_\d+_[a-z0-9_]+)\/meta\.json/ig;
  const matchedUrl = assetUrl.exec(page);
  if (matchedUrl) return matchedUrl[1];

  // `/spine` is a MediaWiki page. Its surrounding navigation can mention
  // many unrelated character IDs, but the base-building record itself has a
  // stable `基建` -> `file` -> `char_...` sequence.
  const buildModel = page.match(/基建[\s\S]{0,800}?(char_\d+_[a-z0-9_]+)/i);
  if (buildModel) return buildModel[1];

  const aroundModel = page.match(/.{0,3000}(?:干员模型|char_spine).{0,3000}/is)?.[0] || page;
  const ids = [...aroundModel.matchAll(/\b(char_\d+_[a-z0-9_]+)\b/ig)].map((match) => match[1]);
  if (ids.length === 1) return ids[0];
  throw new PritsProviderError('无法从该干员页面识别模型 ID。请检查名称是否正确，或改用手动导入。');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractOperatorIdFromMap(page, name) {
  const quotedName = escapeRegExp(name);
  const match = page.match(new RegExp(`(?:\\[\\s*)?['\"]${quotedName}['\"]\\s*\\]?\\s*[:=]\\s*['\"](char_\\d+_[a-z0-9_]+)['\"]`, 'i'));
  return match?.[1] || null;
}

function parseMeta(text, expectedOperatorId) {
  let meta;
  try {
    meta = JSON.parse(text);
  } catch {
    throw new PritsProviderError('PRTS 返回的模型清单不是有效 JSON。');
  }
  if (!meta || typeof meta !== 'object' || typeof meta.prefix !== 'string' || !meta.skin || typeof meta.skin !== 'object') {
    throw new PritsProviderError('PRTS 模型清单缺少必要字段。');
  }
  const prefix = new URL(meta.prefix);
  const staticDirectory = prefix.pathname.match(/^\/([^/]+)\/$/)?.[1]?.toLowerCase();
  const isCurrentStaticPrefix = prefix.hostname === ASSET_HOST && STATIC_SPINE_DIRECTORIES.includes(staticDirectory);
  const isLegacyOperatorPrefix = prefix.hostname === 'torappu.prts.wiki' && prefix.pathname.includes(`/${expectedOperatorId}/`);
  if (prefix.protocol !== 'https:' || !ASSET_HOSTS.includes(prefix.hostname) || (!isCurrentStaticPrefix && !isLegacyOperatorPrefix)) {
    throw new PritsProviderError('PRTS 模型清单中的素材地址不符合预期。');
  }
  const outfits = Object.entries(meta.skin)
    .map(([name, groups]) => ({
      name,
      build: groups?.['基建']?.file || null
    }))
    .filter((outfit) => typeof outfit.build === 'string' && outfit.build.length > 0)
    .map((outfit) => ({ ...outfit, build: outfit.build.replace(/^\/+/, '') }));
  if (outfits.length === 0) throw new PritsProviderError('该干员没有可用的“基建”模型。');
  return { prefix: prefix.href, name: typeof meta.name === 'string' ? meta.name : null, outfits };
}

function extractJsonObjectContaining(text, propertyName) {
  const property = `"${propertyName}"`;
  const propertyIndex = text.indexOf(property);
  if (propertyIndex < 0) return null;
  const start = text.lastIndexOf('{', propertyIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseMetaFromSpinePage(page, expectedOperatorId) {
  const candidates = [];
  let offset = 0;
  while (offset < page.length) {
    const json = extractJsonObjectContaining(page.slice(offset), 'prefix');
    if (!json) break;
    candidates.push(json);
    offset += page.slice(offset).indexOf(json) + json.length;
  }
  if (candidates.length === 0) throw new PritsProviderError('PRTS Spine 页面未包含模型清单。');

  let lastError;
  for (const candidate of candidates) {
    try {
      return parseMeta(candidate, expectedOperatorId);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new PritsProviderError('PRTS Spine 页面模型清单无效。');
}

function mergeMetaOutfits(primary, legacy) {
  const outfits = new Map();
  for (const outfit of primary.outfits) {
    outfits.set(outfit.name, { ...outfit, prefix: primary.prefix });
  }
  for (const outfit of legacy.outfits) {
    // A current static entry wins if both catalogues use the same group name.
    if (!outfits.has(outfit.name)) outfits.set(outfit.name, { ...outfit, prefix: legacy.prefix });
  }
  return {
    prefix: primary.prefix,
    name: primary.name || legacy.name,
    outfits: [...outfits.values()]
  };
}

function spineRawPageUrl(name) {
  return `https://${WIKI_HOST}/index.php?title=${encodeURIComponent(`${name}/spine`)}&action=raw`;
}

function profileId(operatorId, outfitName) {
  const hash = crypto.createHash('sha256').update(`${operatorId}\0${outfitName}`, 'utf8').digest('hex').slice(0, 12);
  return `prts-${operatorId}-${hash}`;
}

class PritsProvider {
  constructor({ request = requestText, discoverOperatorId = null, lookupOfficialOperatorId = null } = {}) {
    this.request = request;
    this.discoverOperatorId = discoverOperatorId;
    this.lookupOfficialOperatorId = lookupOfficialOperatorId;
    this.operatorIdMapPromise = null;
  }

  async lookupOperatorIdFromMap(name) {
    if (!this.operatorIdMapPromise) this.operatorIdMapPromise = this.request(OPERATOR_ID_MAP_URL);
    const operatorId = extractOperatorIdFromMap(await this.operatorIdMapPromise, name);
    if (!operatorId) throw new PritsProviderError(`PRTS 未找到“${name}”的干员资源 ID。`);
    return operatorId;
  }

  lookupVerifiedOperatorId(name) {
    return VERIFIED_OPERATOR_IDS[name] || null;
  }

  async resolveCatalog(nameInput) {
    const requestedName = operatorName(nameInput);
    const pageUrl = `https://${WIKI_HOST}/w/${encodeURIComponent(requestedName)}`;
    const spinePageUrl = `${pageUrl}/spine`;
    const rawSpinePageUrl = spineRawPageUrl(requestedName);
    let spinePage = null;
    let spinePageError = null;
    try {
      spinePage = await this.request(spinePageUrl);
    } catch (error) {
      spinePageError = error;
    }

    const resolveMeta = async (operatorId) => {
      let currentMeta = null;
      if (spinePage) {
        try {
          currentMeta = parseMetaFromSpinePage(spinePage, operatorId);
        } catch (error) {
          // A page without an inline catalogue uses the established asset-meta
          // fallback below. Fetch raw wikitext only when the rendered page
          // contained a misleading, non-JSON `prefix` fragment.
          if (!/未包含模型清单/.test(String(error.message || ''))) {
            try {
              currentMeta = parseMetaFromSpinePage(await this.request(rawSpinePageUrl), operatorId);
            } catch (rawError) {
              if (!/未包含模型清单/.test(String(rawError.message || ''))) throw rawError;
              throw error;
            }
          }
        }
      }
      const metaUrl = `https://torappu.prts.wiki/assets/char_spine/${operatorId}/meta.json`;
      if (!currentMeta) return parseMeta(await this.request(metaUrl), operatorId);

      // The current static catalogue and the legacy asset metadata sometimes
      // carry complementary costume groups. Combine them so an existing
      // base-building model does not disappear during a PRTS migration.
      if (new URL(currentMeta.prefix).hostname !== ASSET_HOST) return currentMeta;
      try {
        const legacyMeta = parseMeta(await this.request(metaUrl), operatorId);
        return mergeMetaOutfits(currentMeta, legacyMeta);
      } catch {
        // The static catalogue is independently usable; do not make a
        // temporarily unavailable compatibility source block a download.
        return currentMeta;
      }
    };
    // Prefer a verified local correction when PRTS's old GetNpcKey module
    // has not caught up with a newer operator. This also avoids making the
    // user wait on a slow rendered wiki page for that known case.
    let operatorId = this.lookupVerifiedOperatorId(requestedName);
    if (operatorId) {
      try {
        const meta = await resolveMeta(operatorId);
        return { requestedName, pageUrl, operatorId, meta };
      } catch {
        // Do not make the embedded correction authoritative if PRTS changes
        // the asset. Continue with normal live discovery below.
        operatorId = null;
      }
    }
    // The wiki's legacy name table is not updated for every newer operator.
    // Consult the official game-data ID table first, then use PRTS only for
    // the actual public model catalog and material download.
    try {
      if (typeof this.lookupOfficialOperatorId === 'function') {
        operatorId = await this.lookupOfficialOperatorId(requestedName);
        if (operatorId) {
          const meta = await resolveMeta(operatorId);
          return { requestedName, pageUrl, operatorId, meta };
        }
      }
    } catch {
      // The live wiki/page discovery below remains available when the public
      // game-data mirror is temporarily unreachable or an ID has no model.
      operatorId = null;
    }
    // PRTS exposes a compact `<operator>/spine` page specifically for its
    // model viewer. Unlike the normal operator page it includes the stable
    // char_... resource ID in server-rendered content.
    try {
      if (!spinePage) throw spinePageError || new Error('PRTS Spine 页面不可用。');
      operatorId = extractOperatorId(spinePage);
    } catch (error) {
      const spineError = error;
      // Keep the older normal-page parser as a fallback for pages whose
      // dedicated spine subpage has not been created yet.
      try {
        operatorId = extractOperatorId(await this.request(pageUrl));
      } catch {
        try {
          if (typeof this.discoverOperatorId !== 'function') throw new Error('浏览器资源发现不可用。');
          operatorId = await this.discoverOperatorId(requestedName);
        } catch (discoveryError) {
          try {
            operatorId = await this.lookupOperatorIdFromMap(requestedName);
          } catch (mapError) {
            if (/未找到.*资源 ID/.test(String(mapError?.message || ''))) {
              throw new PritsProviderError(`干员不存在：未找到“${requestedName}”。请检查名称是否正确。`, 'operator-not-found');
            }
            throw new PritsProviderError(`无法识别“${requestedName}”的模型 ID。${mapError.message || discoveryError.message || spineError.message}`);
          }
        }
      }
    }
    let meta;
    try {
      meta = await resolveMeta(operatorId);
    } catch (error) {
      if (/404/.test(String(error.message || error))) {
        throw new PritsProviderError(`PRTS 尚未为“${requestedName}”提供可下载的基建模型。`);
      }
      throw error;
    }
    return { requestedName, pageUrl: spinePageUrl, operatorId, meta };
  }

  async lookup(nameInput) {
    const { requestedName, operatorId, meta } = await this.resolveCatalog(nameInput);
    return {
      requestedName,
      operatorId,
      name: meta.name || requestedName,
      outfits: meta.outfits.map((outfit) => ({ name: outfit.name }))
    };
  }

  async createDownloadPlan({ name, outfitName }) {
    const requestedName = operatorName(name);
    const { pageUrl, operatorId, meta } = await this.resolveCatalog(requestedName);
    const selected = meta.outfits.find((outfit) => outfit.name === outfitName);
    if (!selected) throw new PritsProviderError('请选择该干员提供的时装组。');

    const build = selected.build;
    if (!build) throw new PritsProviderError('所选时装组没有基建模型。');
    const base = new URL(build, selected.prefix || meta.prefix).href;
    const textureFileName = new URL(`${base}.png`).pathname.split('/').pop();
    if (!textureFileName || !/^[a-z0-9_.-]+$/i.test(textureFileName)) {
      throw new PritsProviderError('PRTS 模型纹理文件名无效。');
    }
    const id = profileId(operatorId, outfitName);
    return {
      profile: {
        id,
        provider: 'prts',
        sourcePage: pageUrl,
        operator: { id: operatorId, name: meta.name || requestedName, outfitId: build, outfitName },
        actions: ACTIONS,
        files: {
          // Spine atlas records the original texture filename. Keep that
          // filename instead of renaming it to model.png, otherwise the
          // runtime cannot resolve the atlas texture after import.
          defaultAsset: textureFileName,
          model: { skeleton: 'model.skel', atlas: 'model.atlas' }
        }
      },
      files: [
        { path: 'model.skel', url: `${base}.skel` },
        { path: 'model.atlas', url: `${base}.atlas` },
        { path: textureFileName, url: `${base}.png` }
      ]
    };
  }
}

module.exports = {
  ASSET_HOST,
  ASSET_HOSTS,
  STATIC_SPINE_DIRECTORIES,
  PritsProvider,
  PritsProviderError,
  extractOperatorId,
  extractOperatorIdFromMap,
  parseMeta,
  parseMetaFromSpinePage,
  mergeMetaOutfits,
  spineRawPageUrl
};
