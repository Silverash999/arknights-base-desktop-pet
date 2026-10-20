(function exposeSpineCompatibility(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpineCompatibility = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const RUNTIME_MAJOR = 3;
  const RUNTIME_MINOR = 8;
  const REQUIRED_ACTIONS = Object.freeze(['Relax', 'Move']);

  function initialAscii(bytes, maximum = 256) {
    if (!bytes || typeof bytes.length !== 'number') return '';
    let text = '';
    for (let index = 0; index < Math.min(bytes.length, maximum); index += 1) {
      const code = bytes[index];
      text += code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    }
    return text;
  }

  function readSkeletonVersion(bytes) {
    const match = initialAscii(bytes).match(/\b(\d+)\.(\d+)(?:\.[0-9A-Za-z]+)?\b/);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      text: match[0]
    };
  }

  function isRuntimeCompatibleSkeleton(bytes) {
    const version = readSkeletonVersion(bytes);
    return Boolean(version && version.major === RUNTIME_MAJOR && version.minor === RUNTIME_MINOR);
  }

  function hasRequiredAnimations(actionMap = {}, availableAnimationNames = []) {
    const available = new Set(Array.isArray(availableAnimationNames) ? availableAnimationNames : []);
    return REQUIRED_ACTIONS.every((action) => {
      const mapped = typeof actionMap[action] === 'string' && actionMap[action].trim()
        ? actionMap[action].trim()
        : action;
      return available.has(mapped);
    });
  }

  function orderedSkinNames(skins = []) {
    const unique = [];
    const seen = new Set();
    for (const skin of Array.isArray(skins) ? skins : []) {
      const name = typeof skin?.name === 'string' ? skin.name.trim() : '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      unique.push(name);
    }
    const defaultIndex = unique.indexOf('default');
    if (defaultIndex > 0) {
      unique.splice(defaultIndex, 1);
      unique.unshift('default');
    }
    return unique;
  }

  function attachmentCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  function chooseRenderableSkin({ initialAttachmentCount = 0, skins = [], attachmentCountForSkin } = {}) {
    const candidates = orderedSkinNames(skins);
    const initial = attachmentCount(initialAttachmentCount);
    if (initial > 0) {
      return {
        decision: 'kept-current-skin',
        selectedSkin: null,
        candidates,
        initialAttachmentCount: initial,
        selectedAttachmentCount: initial
      };
    }
    for (const name of candidates) {
      let count = 0;
      try {
        count = attachmentCount(typeof attachmentCountForSkin === 'function' ? attachmentCountForSkin(name) : 0);
      } catch {
        count = 0;
      }
      if (count > 0) {
        return {
          decision: 'selected-skin',
          selectedSkin: name,
          candidates,
          initialAttachmentCount: initial,
          selectedAttachmentCount: count
        };
      }
    }
    return {
      decision: 'no-renderable-skin',
      selectedSkin: null,
      candidates,
      initialAttachmentCount: initial,
      selectedAttachmentCount: 0
    };
  }

  function countRenderableAttachments(skeleton) {
    return Array.isArray(skeleton?.drawOrder)
      ? skeleton.drawOrder.filter((slot) => Boolean(slot?.getAttachment?.())).length
      : 0;
  }

  function resolveRenderableSkin(skeleton) {
    if (!skeleton || typeof skeleton.setSkinByName !== 'function') {
      return chooseRenderableSkin();
    }
    const decision = chooseRenderableSkin({
      initialAttachmentCount: countRenderableAttachments(skeleton),
      skins: skeleton.data?.skins,
      attachmentCountForSkin: (name) => {
        skeleton.setSkinByName(name);
        skeleton.setSlotsToSetupPose?.();
        skeleton.updateWorldTransform?.();
        return countRenderableAttachments(skeleton);
      }
    });
    return decision;
  }

  return {
    RUNTIME_MAJOR,
    RUNTIME_MINOR,
    REQUIRED_ACTIONS,
    chooseRenderableSkin,
    resolveRenderableSkin,
    hasRequiredAnimations,
    isRuntimeCompatibleSkeleton,
    orderedSkinNames,
    readSkeletonVersion
  };
}));
