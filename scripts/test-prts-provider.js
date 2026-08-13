const assert = require('node:assert/strict');
const { ASSET_HOSTS, STATIC_SPINE_DIRECTORIES, PritsProvider, PritsProviderError, extractOperatorId, extractOperatorIdFromMap } = require('../src/main/prts-provider');

const operatorId = 'char_172_svrash';
const pageUrl = 'https://prts.wiki/w/%E9%93%B6%E7%81%B0';
const spinePageUrl = `${pageUrl}/spine`;
const metaUrl = `https://torappu.prts.wiki/assets/char_spine/${operatorId}/meta.json`;
const page = `<script>const model = 'https://torappu.prts.wiki/assets/char_spine/${operatorId}/meta.json';</script>`;
const spinePageWithNavigation = `
  <nav>char_102_texas char_206_gnosis char_123_fang</nav>
  <pre>{ "skin": { "默认": { "基建": { "file": "char/${operatorId}/build_${operatorId}" } } } }</pre>
`;
const idMapUrl = 'https://prts.wiki/index.php?title=%E6%A8%A1%E5%9D%97%3AGetNpcKey&action=raw';
const idMap = `const t = {}; t['锏'] = 'char_1035_wisdel';`;
const meta = JSON.stringify({
  prefix: `https://torappu.prts.wiki/assets/char_spine/${operatorId}/`,
  name: '银灰',
  skin: {
    默认: { 基建: { file: 'defaultskin/build/build_char_172_svrash' } },
    不融冰: { 基建: { file: 'char_172_svrash_ambiencesynesthesia_4/build/build_char_172_svrash_ambienceSynesthesia_4' } }
  }
});
const currentSpinePage = JSON.stringify({
  prefix: 'https://static.prts.wiki/spine/',
  name: '银灰',
  skin: {
    默认: { 基建: { file: 'char/char_172_svrash/build_char_172_svrash/build_char_172_svrash' } },
    约克的寒风: { 基建: { file: 'skin/char_172_svrash/build_char_172_svrash_snow_1/build_char_172_svrash_snow_1' } }
  }
});

const provider = new PritsProvider({
  request: async (url) => {
    if (url === spinePageUrl) return page;
    if (url === metaUrl) return meta;
    throw new Error(`Unexpected URL: ${url}`);
  }
});

(async () => {
  assert.equal(extractOperatorId(spinePageWithNavigation), operatorId);
  assert.equal(extractOperatorIdFromMap(idMap, '锏'), 'char_1035_wisdel');
  const catalog = await provider.lookup('银灰');
  assert.equal(catalog.operatorId, operatorId);
  assert.deepEqual(catalog.outfits, [{ name: '默认' }, { name: '不融冰' }]);

  const plan = await provider.createDownloadPlan({ name: '银灰', outfitName: '不融冰' });
  assert.equal(plan.profile.operator.name, '银灰');
  assert.equal(plan.files.length, 3);
  assert.equal(plan.files[0].url, 'https://torappu.prts.wiki/assets/char_spine/char_172_svrash/char_172_svrash_ambiencesynesthesia_4/build/build_char_172_svrash_ambienceSynesthesia_4.skel');
  assert.equal(plan.profile.files.defaultAsset, 'build_char_172_svrash_ambienceSynesthesia_4.png');
  assert.equal(plan.files[2].path, 'build_char_172_svrash_ambienceSynesthesia_4.png');
  assert.deepEqual(ASSET_HOSTS, ['static.prts.wiki', 'torappu.prts.wiki']);
  assert.deepEqual(STATIC_SPINE_DIRECTORIES, ['spine', 'spine38']);
  const currentProvider = new PritsProvider({
    request: async (url) => {
      assert.equal(url, spinePageUrl);
      return currentSpinePage;
    }
  });
  const currentPlan = await currentProvider.createDownloadPlan({ name: '银灰', outfitName: '约克的寒风' });
  assert.equal(currentPlan.files[0].url, 'https://static.prts.wiki/spine/skin/char_172_svrash/build_char_172_svrash_snow_1/build_char_172_svrash_snow_1.skel');
  assert.equal(currentPlan.files[2].url, 'https://static.prts.wiki/spine/skin/char_172_svrash/build_char_172_svrash_snow_1/build_char_172_svrash_snow_1.png');
  const spine38Page = JSON.stringify({
    prefix: 'https://static.prts.wiki/spine38/',
    name: '缪尔赛思',
    skin: { 默认: { 基建: { file: 'char/char_249_mlyss/build_char_249_mlyss/build_char_249_mlyss' } } }
  });
  const spine38Provider = new PritsProvider({
    request: async (url) => {
      assert.equal(url, 'https://prts.wiki/w/%E7%BC%AA%E5%B0%94%E8%B5%9B%E6%80%9D/spine');
      return spine38Page;
    }
  });
  const spine38Plan = await spine38Provider.createDownloadPlan({ name: '缪尔赛思', outfitName: '默认' });
  assert.equal(spine38Plan.files[0].url, 'https://static.prts.wiki/spine38/char/char_249_mlyss/build_char_249_mlyss/build_char_249_mlyss.skel');
  await assert.rejects(() => provider.createDownloadPlan({ name: '银灰', outfitName: '不存在' }), PritsProviderError);
  const fallbackProvider = new PritsProvider({
    request: async (url) => {
      if (url === 'https://prts.wiki/w/%E9%94%8F/spine' || url === 'https://prts.wiki/w/%E9%94%8F') throw new Error('HTTP 状态码：404');
      if (url === idMapUrl) return idMap;
      if (url === 'https://torappu.prts.wiki/assets/char_spine/char_1035_wisdel/meta.json') return JSON.stringify({
        prefix: 'https://torappu.prts.wiki/assets/char_spine/char_1035_wisdel/', name: '锏', skin: { 默认: { 基建: { file: 'default/build_char_1035_wisdel' } } }
      });
      throw new Error(`Unexpected fallback URL: ${url}`);
    }
  });
  assert.equal((await fallbackProvider.lookup('锏')).operatorId, 'char_1035_wisdel');
  const browserDiscoveryProvider = new PritsProvider({
    request: async (url) => {
      if (url.endsWith('/spine') || url === 'https://prts.wiki/w/%E9%94%8F') throw new Error('HTTP 状态码：404');
      if (url === 'https://torappu.prts.wiki/assets/char_spine/char_9999_jian/meta.json') return JSON.stringify({
        prefix: 'https://torappu.prts.wiki/assets/char_spine/char_9999_jian/', name: '锏', skin: { 默认: { 基建: { file: 'default/build_char_9999_jian' } } }
      });
      throw new Error(`Unexpected browser-discovery URL: ${url}`);
    },
    discoverOperatorId: async (name) => {
      assert.equal(name, '锏');
      return 'char_9999_jian';
    }
  });
  assert.equal((await browserDiscoveryProvider.lookup('锏')).operatorId, 'char_9999_jian');
  const verifiedFallbackProvider = new PritsProvider({
    request: async (url) => {
      assert.equal(url, 'https://torappu.prts.wiki/assets/char_spine/char_4116_blkkgt/meta.json');
      return JSON.stringify({
        prefix: 'https://torappu.prts.wiki/assets/char_spine/char_4116_blkkgt/', name: '锏', skin: { 默认: { 基建: { file: 'default/build_char_4116_blkkgt' } } }
      });
    }
  });
  assert.equal((await verifiedFallbackProvider.lookup('锏')).operatorId, 'char_4116_blkkgt');
  const officialDataProvider = new PritsProvider({
    request: async (url) => {
      assert.equal(url, 'https://torappu.prts.wiki/assets/char_spine/char_4116_blkkgt/meta.json');
      return JSON.stringify({
        prefix: 'https://torappu.prts.wiki/assets/char_spine/char_4116_blkkgt/', name: '锏', skin: { 默认: { 基建: { file: 'default/build_char_4116_blkkgt' } } }
      });
    },
    lookupOfficialOperatorId: async (name) => {
      assert.equal(name, '新干员');
      return 'char_4116_blkkgt';
    }
  });
  assert.equal((await officialDataProvider.lookup('新干员')).operatorId, 'char_4116_blkkgt');
  const missingOperatorProvider = new PritsProvider({
    request: async (url) => {
      if (url.endsWith('/spine') || url === 'https://prts.wiki/w/%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E5%B9%B2%E5%91%98') throw new Error('HTTP 状态码：404');
      if (url === idMapUrl) return idMap;
      throw new Error(`Unexpected missing-operator URL: ${url}`);
    },
    discoverOperatorId: async () => { throw new Error('页面没有模型'); }
  });
  await assert.rejects(
    () => missingOperatorProvider.lookup('不存在的干员'),
    (error) => error instanceof PritsProviderError && error.code === 'operator-not-found'
  );
  process.stdout.write('PRTS provider tests passed.\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
