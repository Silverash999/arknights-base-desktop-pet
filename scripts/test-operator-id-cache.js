const assert = require('node:assert/strict');
const { buildOfficialOperatorIdMap, parseOperatorIdCache, serializeOperatorIdCache } = require('../src/main/operator-id-cache');

const table = {};
for (let index = 0; index < 100; index += 1) table[`char_${index}_test`] = { name: `测试${index}` };
table.invalid = { name: '不应写入' };
const mapping = buildOfficialOperatorIdMap(table);
assert.equal(mapping.size, 100);
const cache = serializeOperatorIdCache(mapping, '2026-08-12T00:00:00.000Z');
const parsed = parseOperatorIdCache(cache);
assert.equal(parsed.mapping.get('测试42'), 'char_42_test');
assert.equal(parseOperatorIdCache({ version: 1, fetchedAt: 'not-a-date', entries: [] }), null);
process.stdout.write('Operator ID cache tests passed.\n');
