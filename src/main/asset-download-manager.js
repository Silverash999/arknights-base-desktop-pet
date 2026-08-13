const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const MAX_PROFILE_BYTES = 300 * 1024 * 1024;
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_REDIRECTS = 5;

class DownloadValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloadValidationError';
  }
}

class DownloadCancelledError extends DownloadValidationError {
  constructor() {
    super('下载已取消。');
    this.name = 'DownloadCancelledError';
    this.code = 'download-cancelled';
  }
}

function safeRelativePath(value) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text || path.isAbsolute(text) || text.includes('../') || text === '..') {
    throw new DownloadValidationError('下载文件路径必须是素材包内的相对路径。');
  }
  return text;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytesRead;
    let position = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function validateDownloadedProfileFiles(directory, profile) {
  if (profile?.provider !== 'prts') return;
  const files = profile?.files || {};
  const model = files.model || {};
  if (!model.skeleton || !model.atlas || !files.defaultAsset) return;

  const skeleton = path.join(directory, safeRelativePath(model.skeleton));
  const atlas = path.join(directory, safeRelativePath(model.atlas));
  const texture = path.join(directory, safeRelativePath(files.defaultAsset));
  if (fs.statSync(skeleton).size < 128) {
    throw new DownloadValidationError('Spine 骨骼文件不完整。');
  }

  const atlasText = fs.readFileSync(atlas, 'utf8');
  const atlasLines = atlasText.split(/\r?\n/);
  const pageName = atlasLines.find((line) => line.trim())?.trim();
  const lastLine = [...atlasLines].reverse().find((line) => line.trim())?.trim();
  const regionCount = atlasLines.filter((line) => /^\s*index:\s*-?\d+\s*$/.test(line)).length;
  if (!pageName || pageName !== path.basename(texture) || regionCount === 0 || !/^index:\s*-?\d+$/.test(lastLine || '')) {
    throw new DownloadValidationError('Spine 图集文件不完整，已拒绝安装。');
  }

  const png = fs.readFileSync(texture);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngEnd = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  if (png.length < 64 || !png.subarray(0, pngHeader.length).equals(pngHeader)
    || !png.subarray(-pngEnd.length).equals(pngEnd)) {
    throw new DownloadValidationError('Spine 纹理图片不完整，已拒绝安装。');
  }
}

function validatePlan(plan, allowedHosts = []) {
  if (!plan || typeof plan !== 'object') throw new DownloadValidationError('下载计划无效。');
  if (!plan.profile || typeof plan.profile !== 'object') throw new DownloadValidationError('下载计划缺少 profile。');
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(String(plan.profile.id || '').trim())) {
    throw new DownloadValidationError('下载计划的素材包 ID 无效。');
  }
  if (!Array.isArray(plan.files) || plan.files.length === 0) throw new DownloadValidationError('下载计划不包含文件。');
  const paths = new Set();
  const normalizedFiles = plan.files.map((file) => {
    const relativePath = safeRelativePath(file?.path);
    if (paths.has(relativePath.toLowerCase())) throw new DownloadValidationError(`下载计划含有重复路径：${relativePath}`);
    paths.add(relativePath.toLowerCase());
    let url;
    try {
      url = new URL(file?.url);
    } catch {
      throw new DownloadValidationError(`下载地址无效：${relativePath}`);
    }
    if (url.protocol !== 'https:') throw new DownloadValidationError(`只允许 HTTPS 下载：${relativePath}`);
    if (allowedHosts.length > 0 && !allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new DownloadValidationError(`下载地址不属于允许的素材站点：${url.hostname}`);
    }
    const expectedSha256 = file.sha256 ? String(file.sha256).toLowerCase() : null;
    if (expectedSha256 && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new DownloadValidationError(`SHA-256 格式无效：${relativePath}`);
    }
    const maxBytes = Number.isFinite(Number(file.maxBytes))
      ? Math.min(MAX_FILE_BYTES, Math.max(1, Number(file.maxBytes)))
      : MAX_FILE_BYTES;
    return { relativePath, url: url.href, expectedSha256, maxBytes };
  });
  return { profile: plan.profile, files: normalizedFiles };
}

function requestFile(urlText, destination, options) {
  const { allowedHosts, maxBytes, onProgress, signal } = options;
  const visit = (currentUrl, redirectsLeft) => new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(currentUrl);
    } catch {
      reject(new DownloadValidationError('重定向地址无效。'));
      return;
    }
    if (url.protocol !== 'https:' || (allowedHosts.length > 0 && !allowedHosts.includes(url.hostname.toLowerCase()))) {
      reject(new DownloadValidationError(`重定向到了未允许的站点：${url.hostname}`));
      return;
    }
    const request = https.get(url, {
      headers: { 'User-Agent': 'ArknightsBasePet/0.2 (profile downloader)', Accept: '*/*' },
      timeout: 30000
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new DownloadValidationError('下载重定向次数超过上限。'));
          return;
        }
        const next = new URL(response.headers.location, url).href;
        visit(next, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new DownloadValidationError(`下载失败，HTTP 状态码：${status}`));
        return;
      }
      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.resume();
        reject(new DownloadValidationError(`下载文件超过大小上限（${Math.round(maxBytes / 1024 / 1024)} MB）。`));
        return;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const output = fs.createWriteStream(destination, { flags: 'wx' });
      let bytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        output.destroy();
        fs.rmSync(destination, { force: true });
        reject(error);
      };
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new DownloadValidationError(`下载文件超过大小上限（${Math.round(maxBytes / 1024 / 1024)} MB）。`));
          return;
        }
        onProgress?.({ receivedBytes: bytes, totalBytes: Number.isFinite(contentLength) ? contentLength : null });
      });
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        settled = true;
        resolve({ bytes, finalUrl: url.href });
      });
      if (signal) {
        const abort = () => request.destroy(new DownloadValidationError('下载已取消。'));
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
      }
      response.pipe(output);
    });
    request.on('timeout', () => request.destroy(new DownloadValidationError('下载超时。')));
    request.on('error', reject);
  });
  return visit(urlText, MAX_REDIRECTS);
}

class AssetDownloadManager {
  constructor({ downloadsPath, profileManager, allowedHosts, downloadFile = requestFile }) {
    this.downloadsPath = downloadsPath;
    this.profileManager = profileManager;
    this.allowedHosts = [...new Set((allowedHosts || []).map((host) => String(host).toLowerCase()))];
    this.downloadFile = downloadFile;
    this.activeDownloads = new Map();
  }

  async install(plan, { onProgress, signal } = {}) {
    const normalized = validatePlan(plan, this.allowedHosts);
    const profileId = String(normalized.profile.id || '').trim();
    if (this.activeDownloads.has(profileId)) throw new DownloadValidationError('该素材包正在下载。');
    const temporary = path.join(this.downloadsPath, `.download-${profileId}-${crypto.randomUUID()}`);
    this.activeDownloads.set(profileId, temporary);
    try {
      if (signal?.aborted) throw new DownloadCancelledError();
      let downloadedBytes = 0;
      let lastValidationError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        fs.rmSync(temporary, { recursive: true, force: true });
        fs.mkdirSync(temporary, { recursive: true });
        fs.writeFileSync(path.join(temporary, 'profile.json'), `${JSON.stringify(normalized.profile, null, 2)}\n`, 'utf8');
        downloadedBytes = 0;
        try {
          for (let index = 0; index < normalized.files.length; index += 1) {
            const file = normalized.files[index];
            const destination = path.join(temporary, file.relativePath);
            const result = await this.downloadFile(file.url, destination, {
              allowedHosts: this.allowedHosts,
              maxBytes: file.maxBytes,
              signal,
              onProgress: (progress) => onProgress?.({
                phase: 'download',
                fileIndex: index,
                fileCount: normalized.files.length,
                path: file.relativePath,
                downloadedBytes: downloadedBytes + progress.receivedBytes,
                receivedBytes: progress.receivedBytes,
                totalBytes: progress.totalBytes
              })
            });
            downloadedBytes += result.bytes;
            if (downloadedBytes > MAX_PROFILE_BYTES) throw new DownloadValidationError('素材包总大小超过 300 MB 上限。');
            if (file.expectedSha256 && sha256(destination) !== file.expectedSha256) {
              throw new DownloadValidationError(`文件校验失败：${file.relativePath}`);
            }
          }
          validateDownloadedProfileFiles(temporary, normalized.profile);
          lastValidationError = undefined;
          break;
        } catch (error) {
          lastValidationError = error;
          if (signal?.aborted || error?.code === 'download-cancelled') throw new DownloadCancelledError();
          if (attempt === 3) break;
          onProgress?.({ phase: 'retry', attempt, maxAttempts: 3, message: '素材文件不完整，正在重新下载。' });
        }
      }
      if (lastValidationError) {
        throw new DownloadValidationError(`素材下载不完整，已自动重试 3 次：${lastValidationError.message || lastValidationError}`);
      }
      onProgress?.({ phase: 'validate', fileCount: normalized.files.length, downloadedBytes });
      const state = this.profileManager.importDirectory(temporary, {
        replaceExisting: normalized.profile.provider === 'prts'
      });
      onProgress?.({ phase: 'complete', fileCount: normalized.files.length, downloadedBytes });
      return state;
    } finally {
      this.activeDownloads.delete(profileId);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

module.exports = {
  AssetDownloadManager,
  DownloadCancelledError,
  DownloadValidationError,
  validatePlan,
  validateDownloadedProfileFiles
};
