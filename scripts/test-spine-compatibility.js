const assert = require('node:assert/strict');
const {
  chooseRenderableSkin,
  hasRequiredAnimations,
  isRuntimeCompatibleSkeleton,
  orderedSkinNames,
  readSkeletonVersion,
  resolveRenderableSkin
} = require('../src/shared/spine-compatibility');

const spine38 = Buffer.from('\u001cabcdefghijklmnopqrstuvwxyz12\u00073.8.99\u0000', 'binary');
const spine25 = Buffer.from('\u001cabcdefghijklmnopqrstuvwxyz12\u00072.5.51D\u0000', 'binary');

assert.deepEqual(readSkeletonVersion(spine38), { major: 3, minor: 8, text: '3.8.99' });
assert.deepEqual(readSkeletonVersion(spine25), { major: 2, minor: 5, text: '2.5.51D' });
assert.equal(isRuntimeCompatibleSkeleton(spine38), true);
assert.equal(isRuntimeCompatibleSkeleton(spine25), false);
assert.equal(hasRequiredAnimations({ Relax: 'Idle', Move: 'Run' }, ['Idle', 'Run', 'Sit']), true);
assert.equal(hasRequiredAnimations({ Relax: 'Idle', Move: 'Run' }, ['Idle']), false);
assert.equal(hasRequiredAnimations({ Relax: 'Relax', Move: 'Move' }, []), false);

assert.deepEqual(
  orderedSkinNames([{ name: 'costume' }, { name: 'default' }, { name: 'costume' }, { name: '' }, null]),
  ['default', 'costume']
);
assert.deepEqual(
  chooseRenderableSkin({
    initialAttachmentCount: 3,
    skins: [{ name: 'default' }],
    attachmentCountForSkin: () => 0
  }),
  { decision: 'kept-current-skin', selectedSkin: null, candidates: ['default'], initialAttachmentCount: 3, selectedAttachmentCount: 3 }
);
assert.deepEqual(
  chooseRenderableSkin({
    initialAttachmentCount: 0,
    skins: [{ name: 'alt' }, { name: 'default' }],
    attachmentCountForSkin: (name) => (name === 'default' ? 2 : 0)
  }),
  { decision: 'selected-skin', selectedSkin: 'default', candidates: ['default', 'alt'], initialAttachmentCount: 0, selectedAttachmentCount: 2 }
);
assert.deepEqual(
  chooseRenderableSkin({
    initialAttachmentCount: 0,
    skins: [{ name: 'default' }, { name: 'alt' }],
    attachmentCountForSkin: (name) => (name === 'alt' ? 1 : 0)
  }),
  { decision: 'selected-skin', selectedSkin: 'alt', candidates: ['default', 'alt'], initialAttachmentCount: 0, selectedAttachmentCount: 1 }
);
assert.deepEqual(
  chooseRenderableSkin({
    initialAttachmentCount: 0,
    skins: [],
    attachmentCountForSkin: () => 0
  }),
  { decision: 'no-renderable-skin', selectedSkin: null, candidates: [], initialAttachmentCount: 0, selectedAttachmentCount: 0 }
);

const skinCalls = [];
const skinSkeleton = {
  skin: null,
  data: { skins: [{ name: 'default' }, { name: 'alt' }] },
  drawOrder: [{ getAttachment: () => null }],
  setSkinByName(name) {
    skinCalls.push(name);
    this.skin = { name };
    this.drawOrder = [{ getAttachment: () => (name === 'default' ? { name: 'body' } : null) }];
  },
  setSlotsToSetupPose() {},
  updateWorldTransform() {}
};
assert.deepEqual(
  resolveRenderableSkin(skinSkeleton),
  { decision: 'selected-skin', selectedSkin: 'default', candidates: ['default', 'alt'], initialAttachmentCount: 0, selectedAttachmentCount: 1 }
);
assert.deepEqual(skinCalls, ['default']);

process.stdout.write('Spine compatibility tests passed.\n');
