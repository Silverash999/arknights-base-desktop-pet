const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AssetDownloadManager,
  DownloadCancelledError
} = require('../src/main/asset-download-manager');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arkpet-download-manager-test-'));
const controller = new AbortController();
let calls = 0;
const manager = new AssetDownloadManager({
  downloadsPath: path.join(temporaryRoot, 'downloads'),
  allowedHosts: ['static.prts.wiki'],
  profileManager: { importDirectory: () => { throw new Error('取消的下载不应被导入。'); } },
  downloadFile: async () => {
    calls += 1;
    controller.abort();
    throw new Error('download cancelled');
  }
});

(async () => {
  await assert.rejects(
    () => manager.install({
      profile: { id: 'cancel-test', provider: 'prts' },
      files: [{ path: 'model.skel', url: 'https://static.prts.wiki/spine/model.skel' }]
    }, { signal: controller.signal }),
    (error) => error instanceof DownloadCancelledError && error.code === 'download-cancelled' && error.message === '下载已取消。'
  );
  assert.equal(calls, 1);
  const downloads = path.join(temporaryRoot, 'downloads');
  assert.equal(fs.existsSync(downloads) ? fs.readdirSync(downloads).some((name) => name.startsWith('.download-')) : false, false);
  process.stdout.write('Asset download manager cancellation tests passed.\n');
})().finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true })).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
