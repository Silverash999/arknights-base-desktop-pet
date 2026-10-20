const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildOperatorEntries,
  classifyAuditError,
  hasVisiblePixels,
  isFullCatalogRun,
  OFFICIAL_CHARACTER_TABLE_MAX_BYTES,
  electronDataPaths,
  parseArguments,
  prepareAuditSession,
  summarize
} = require('./audit-prts-catalog');

const entries = buildOperatorEntries({
  char_001_alpha: { name: '甲' },
  char_002_beta: { name: '乙' },
  char_003_duplicate: { name: '甲' },
  char_004_unobtainable: { name: '预备干员', isNotObtainable: true },
  char_invalid: { name: '无效' },
  char_004_empty: { name: '' },
  token_001: { name: '召唤物' }
});

assert.deepEqual(entries, [
  { id: 'char_001_alpha', name: '甲' },
  { id: 'char_002_beta', name: '乙' }
]);
assert.equal(classifyAuditError(new Error('该干员没有可用的“基建”模型。')), 'unsupported');
assert.equal(classifyAuditError(new Error('WebGL 不可用。')), 'environment');
assert.equal(classifyAuditError(new Error('下载超时。')), 'transient');
assert.equal(classifyAuditError(new Error('Spine renderer failed.')), 'failed');
assert.equal(hasVisiblePixels(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])), false);
assert.equal(hasVisiblePixels(new Uint8Array([0, 0, 0, 0, 10, 20, 30, 255])), true);
assert.ok(OFFICIAL_CHARACTER_TABLE_MAX_BYTES > 5 * 1024 * 1024, '官方干员表必须不受 PRTS HTML 的 5 MB 上限限制。');
assert.ok(OFFICIAL_CHARACTER_TABLE_MAX_BYTES <= 20 * 1024 * 1024, '官方干员表读取仍应保留合理大小上限。');
assert.deepEqual(parseArguments(['--max-duration-seconds', '20']), {
  auditRoot: require('node:path').join(require('node:path').resolve(__dirname, '..'), '.test-tmp', 'prts-catalog-audit'),
  limit: null,
  only: null,
  maxDurationMs: 20000,
  operatorId: null,
  retryFailed: false,
  force: false,
  concurrency: 1
});
assert.deepEqual(parseArguments(['--only', '银灰', '--operator-id', 'char_172_svrash']), {
  auditRoot: require('node:path').join(require('node:path').resolve(__dirname, '..'), '.test-tmp', 'prts-catalog-audit'),
  limit: null,
  only: '银灰',
  maxDurationMs: null,
  operatorId: 'char_172_svrash',
  retryFailed: false,
  force: false,
  concurrency: 1
});
assert.equal(parseArguments(['--retry-failed']).retryFailed, true);
assert.equal(parseArguments(['--force']).force, true);
assert.equal(parseArguments(['--concurrency', '3']).concurrency, 3);
assert.deepEqual(electronDataPaths('C:\\audit-root'), {
  userData: path.join('C:\\audit-root', 'electron-user-data'),
  sessionData: path.join('C:\\audit-root', 'electron-session-data')
});
const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arknights-pet-audit-'));
fs.writeFileSync(path.join(sessionRoot, 'stale-artifact.txt'), 'stale', 'utf8');
prepareAuditSession(sessionRoot);
assert.deepEqual(fs.readdirSync(sessionRoot), []);
fs.rmSync(sessionRoot, { recursive: true, force: true });
assert.equal(summarize({ one: { status: 'pass' } }, 3).pending, 2);
assert.equal(isFullCatalogRun(parseArguments([])), true);
assert.equal(isFullCatalogRun(parseArguments(['--max-duration-seconds', '20'])), true);
assert.equal(isFullCatalogRun(parseArguments(['--only', '银灰', '--operator-id', 'char_172_svrash'])), false);
assert.equal(isFullCatalogRun(parseArguments(['--limit', '5'])), false);

process.stdout.write('PRTS catalog audit helper tests passed.\n');
