const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileManager, ProfileValidationError } = require('../src/main/profile-manager');
const { DownloadValidationError, validatePlan, validateDownloadedProfileFiles } = require('../src/main/asset-download-manager');

const root = path.resolve(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silverash-gnosis-profile-test-'));

function copy(source, destination) {
  fs.copyFileSync(path.join(root, source), destination);
}

try {
  const source = path.join(temporaryRoot, 'source-profile');
  const userData = path.join(temporaryRoot, 'user-data');
  fs.mkdirSync(source, { recursive: true });
  copy('assets/银灰default.png', path.join(source, 'default.png'));
  copy('prts-assets/silverash/model.skel', path.join(source, 'model.skel'));
  copy('prts-assets/silverash/model.atlas', path.join(source, 'model.atlas'));
  copy('prts-assets/silverash/model.png', path.join(source, 'model.png'));
  const manifest = {
    id: 'test-profile',
    provider: 'test-provider',
    sourcePage: 'https://example.test/source',
    operator: {
      id: 'test-operator',
      name: '测试干员',
      outfitId: 'test-outfit',
      outfitName: '测试时装'
    },
    actions: { Relax: 'Relax', Move: 'Move' },
    files: {
      defaultAsset: 'default.png',
      model: { skeleton: 'model.skel', atlas: 'model.atlas' }
    }
  };
  fs.writeFileSync(path.join(source, 'profile.json'), JSON.stringify(manifest, null, 2));

  const manager = new ProfileManager({ userDataPath: userData, appPath: root });
  const initial = manager.initialize();
  assert.equal(initial.isSetupRequired, false);
  assert.equal(initial.profiles.length, 2);

  const imported = manager.importDirectory(source);
  assert.equal(imported.profiles.length, 3);
  assert.equal(imported.profiles.find((profile) => profile.id === 'test-profile').provider, 'test-provider');
  const selected = manager.selectPair({ slotA: 'test-profile', slotB: 'bundled-silverash-default' });
  assert.equal(selected.activeProfiles['slot-a'].operator.name, '测试干员');
  assert.equal(selected.activeProfiles['slot-a'].capabilities.sleep, false);
  const runtime = manager.recordRuntimeAnimations('test-profile', ['Relax', 'Move']);
  assert.equal(runtime.activeProfiles['slot-a'].runtime.compatibility, 'basic');
  assert.deepEqual(runtime.activeProfiles['slot-a'].runtime.missingOptional, ['Sit', 'Sleep', 'Interact']);
  const invalidRuntime = manager.recordRuntimeAnimations('test-profile', ['Relax']);
  assert.equal(invalidRuntime.activeProfiles['slot-a'].runtime.compatibility, 'incompatible');
  assert.deepEqual(invalidRuntime.activeProfiles['slot-a'].runtime.missingRequired, ['Move']);
  assert.throws(() => manager.selectPair({ slotA: 'test-profile', slotB: 'bundled-silverash-default' }), ProfileValidationError);

  manifest.files.defaultAsset = '../outside.png';
  fs.writeFileSync(path.join(source, 'profile.json'), JSON.stringify(manifest, null, 2));
  assert.throws(() => manager.importDirectory(source), ProfileValidationError);

  const downloadPlan = validatePlan({
    profile: manifest,
    files: [{ path: 'model.skel', url: 'https://assets.example.test/model.skel', maxBytes: 1024 }]
  }, ['assets.example.test']);
  assert.equal(downloadPlan.files[0].relativePath, 'model.skel');
  assert.throws(() => validatePlan({
    profile: { id: '../unsafe' },
    files: [{ path: '../unsafe', url: 'https://assets.example.test/a' }]
  }, ['assets.example.test']), DownloadValidationError);

  const prtsDownloadManifest = {
    ...manifest,
    provider: 'prts',
    files: { ...manifest.files, defaultAsset: 'model.png' }
  };
  const completeAtlas = fs.readFileSync(path.join(source, 'model.atlas'), 'utf8')
    .replace(/^build_char_172_svrash\.png/m, 'model.png');
  fs.writeFileSync(path.join(source, 'model.atlas'), completeAtlas);
  validateDownloadedProfileFiles(source, prtsDownloadManifest);
  fs.writeFileSync(path.join(source, 'model.atlas'), 'build_char_172_svrash.png\nsize: 688,688\n');
  assert.throws(() => validateDownloadedProfileFiles(source, prtsDownloadManifest), DownloadValidationError);

  const emptyManager = new ProfileManager({ userDataPath: path.join(temporaryRoot, 'empty-user-data'), appPath: path.join(temporaryRoot, 'empty-app') });
  const emptyState = emptyManager.initialize();
  assert.equal(emptyState.isSetupRequired, true);
  assert.equal(emptyState.profiles.length, 0);

  process.stdout.write('Profile manager tests passed.\n');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
