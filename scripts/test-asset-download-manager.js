const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AssetDownloadManager,
  DownloadCancelledError
} = require('../src/main/asset-download-manager');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arkpet-download-manager-test-'));
const png = fs.readFileSync(path.join(__dirname, '..', 'assets', '银灰default.png'));
const skeleton = (version) => Buffer.concat([
  Buffer.from(`\u001cabcdefghijklmnopqrstuvwxyz12\u0007${version}\u0000`, 'binary'),
  Buffer.alloc(128)
]);
const prtsProfile = {
  id: 'candidate-test',
  provider: 'prts',
  files: {
    defaultAsset: 'model.png',
    model: { skeleton: 'model.skel', atlas: 'model.atlas' }
  }
};
const prtsFiles = (host) => [
  { path: 'model.skel', url: `https://${host}/spine/model.skel` },
  { path: 'model.atlas', url: `https://${host}/spine/model.atlas` },
  { path: 'model.png', url: `https://${host}/spine/model.png` }
];
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
  const imports = [];
  const importOptions = [];
  const fallbackManager = new AssetDownloadManager({
    downloadsPath: downloads,
    allowedHosts: ['static.prts.wiki', 'torappu.prts.wiki'],
    profileManager: {
      importDirectory: (directory, options) => {
        imports.push(fs.readFileSync(path.join(directory, 'model.skel')));
        importOptions.push(options);
        return { imported: true };
      }
    },
    downloadFile: async (url, destination) => {
      if (destination.endsWith('.skel')) {
        fs.writeFileSync(destination, skeleton(url.includes('static.prts.wiki') ? '2.5.51D' : '3.8.99'));
      } else if (destination.endsWith('.atlas')) {
        fs.writeFileSync(destination, 'model.png\nsize: 1,1\n\nregion\n  rotate: false\n  index: 0\n');
      } else {
        fs.writeFileSync(destination, png);
      }
      return { bytes: fs.statSync(destination).size };
    }
  });
  const installed = await fallbackManager.installCandidates([
    { source: 'static', profile: prtsProfile, files: prtsFiles('static.prts.wiki') },
    { source: 'legacy', profile: prtsProfile, files: prtsFiles('torappu.prts.wiki') }
  ]);
  assert.deepEqual(installed, { imported: true });
  assert.equal(imports.length, 1);
  assert.deepEqual(importOptions, [{ replaceExisting: false }]);
  assert.match(imports[0].toString('ascii'), /3\.8\.99/);
  assert.equal(fs.readdirSync(downloads).some((name) => name.startsWith('.download-')), false);
  let activeDownloads = 0;
  let maximumConcurrentDownloads = 0;
  const parallelManager = new AssetDownloadManager({
    downloadsPath: downloads,
    allowedHosts: ['static.prts.wiki'],
    profileManager: { importDirectory: () => ({ imported: 'parallel' }) },
    downloadFile: async (_url, destination) => {
      activeDownloads += 1;
      maximumConcurrentDownloads = Math.max(maximumConcurrentDownloads, activeDownloads);
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (destination.endsWith('.skel')) {
        fs.writeFileSync(destination, skeleton('3.8.99'));
      } else if (destination.endsWith('.atlas')) {
        fs.writeFileSync(destination, 'model.png\nsize: 1,1\n\nregion\n  rotate: false\n  index: 0\n');
      } else {
        fs.writeFileSync(destination, png);
      }
      activeDownloads -= 1;
      return { bytes: fs.statSync(destination).size };
    }
  });
  const parallelResult = await parallelManager.install({
    profile: { ...prtsProfile, id: 'parallel-test' },
    files: prtsFiles('static.prts.wiki')
  });
  assert.deepEqual(parallelResult, { imported: 'parallel' });
  assert.ok(maximumConcurrentDownloads >= 2, '模型、图集与纹理应并行下载。');
  process.stdout.write('Asset download manager tests passed.\n');
})().finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true })).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
