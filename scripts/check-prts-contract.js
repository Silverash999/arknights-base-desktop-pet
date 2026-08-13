const assert = require('node:assert/strict');
const { PritsProvider } = require('../src/main/prts-provider');

// Read-only release gate for the public PRTS /spine contract. Run before a
// public build so an upstream host or metadata shape change is caught early.
(async () => {
  const provider = new PritsProvider();
  const catalog = await provider.lookup('银灰');
  assert.equal(catalog.operatorId, 'char_172_svrash');
  assert.ok(catalog.outfits.length >= 2, '银灰应至少提供两个基建时装组。');
  const plan = await provider.createDownloadPlan({ name: '银灰', outfitName: catalog.outfits[0].name });
  assert.equal(plan.files.length, 3);
  assert.ok(plan.files.every((file) => file.url.startsWith('https://static.prts.wiki/spine/')));
  process.stdout.write(`PRTS contract passed: ${catalog.outfits.map((outfit) => outfit.name).join('、')}\n`);
})().catch((error) => {
  console.error(`PRTS contract failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
