let characters = {
  gnosis: {
    label: '灵知',
    source: 'bundled',
    actionMap: { Relax: 'Relax', Move: 'Move', Sit: 'Sit', Sleep: 'Sleep', Interact: 'Interact' },
    calibration: { headHitRatio: 1 / 3 },
    defaultAsset: '../../assets/灵知default.png',
    model: {
      skeleton: '../../prts-assets/gnosis/model.skel',
      atlas: '../../prts-assets/gnosis/model.atlas'
    },
    fallbackActions: {
      Interact: '../../assets/灵知-默认-基建-Interact-x1.webm',
      Move: '../../assets/灵知-默认-基建-Move-x1.webm',
      Relax: '../../assets/灵知-默认-基建-Relax-x1.webm',
      Sit: '../../assets/灵知-默认-基建-Sit-x1.webm',
      Sleep: '../../assets/灵知-默认-基建-Sleep-x1.webm'
    },
    processedActions: {
      Interact: '../../processed-assets/灵知-默认-基建-Interact-x1.apng',
      Move: '../../processed-assets/灵知-默认-基建-Move-x1.apng',
      Relax: '../../processed-assets/灵知-默认-基建-Relax-x1.apng',
      Sit: '../../processed-assets/灵知-默认-基建-Sit-x1.apng',
      Sleep: '../../processed-assets/灵知-默认-基建-Sleep-x1.apng'
    }
  },
  silverash: {
    label: '银灰',
    source: 'bundled',
    actionMap: { Relax: 'Relax', Move: 'Move', Sit: 'Sit', Sleep: 'Sleep', Interact: 'Interact' },
    calibration: { headHitRatio: 1 / 3 },
    defaultAsset: '../../assets/银灰default.png',
    model: {
      skeleton: '../../prts-assets/silverash/model.skel',
      atlas: '../../prts-assets/silverash/model.atlas'
    },
    fallbackActions: {
      Interact: '../../assets/银灰-默认-基建-Interact-x1.webm',
      Move: '../../assets/银灰-默认-基建-Move-x1.webm',
      Relax: '../../assets/银灰-默认-基建-Relax-x1.webm',
      Sit: '../../assets/银灰-默认-基建-Sit-x1.webm',
      Sleep: '../../assets/银灰-默认-基建-Sleep-x1.webm'
    },
    processedActions: {
      Interact: '../../processed-assets/银灰-默认-基建-Interact-x1.apng',
      Move: '../../processed-assets/银灰-默认-基建-Move-x1.apng',
      Relax: '../../processed-assets/银灰-默认-基建-Relax-x1.apng',
      Sit: '../../processed-assets/银灰-默认-基建-Sit-x1.apng',
      Sleep: '../../processed-assets/银灰-默认-基建-Sleep-x1.apng'
    }
  }
};

const players = new Map();
const blackKeyFallbacks = new Map();
let currentBehavior;
let rendererDiagnosticSequence = 0;
let currentProfileState = null;
let modelLoadGeneration = 0;

function diagnostic(event, details = {}) {
  const payload = {
    sequence: ++rendererDiagnosticSequence,
    at: new Date().toISOString(),
    performanceNow: Math.round(performance.now()),
    event,
    details
  };
  console.log('[pet-diagnostic]', payload);
  try {
    window.petHost.diagnostic({
      ...payload,
      details: {
        ...details,
        userAgent: navigator.userAgent
      }
    });
  } catch (error) {
    console.warn('[pet-diagnostic] unable to send renderer diagnostic', error);
  }
}

function characterFromProfile(profile, fallback) {
  const renderer = profile?.renderer || {};
  const operator = profile?.operator || {};
  return {
    ...fallback,
    label: operator.name || renderer.label || fallback.label,
    defaultAsset: renderer.defaultAsset || fallback.defaultAsset,
    model: renderer.model || fallback.model,
    fallbackActions: renderer.fallbackActions || fallback.fallbackActions,
    processedActions: renderer.processedActions || fallback.processedActions,
    actionMap: profile?.actionMap || fallback.actionMap,
    calibration: profile?.calibration || fallback.calibration,
    profileId: profile?.id || null,
    source: profile?.source || fallback.source,
    provider: profile?.provider || null,
    capabilities: profile?.capabilities || null
  };
}

function hasStandaloneFallbackAssets(character) {
  return [character.fallbackActions, character.processedActions]
    .some((actions) => actions && Object.values(actions).some((source) => typeof source === 'string' && source.length > 0));
}

function clearLoadedModels(reason) {
  modelLoadGeneration += 1;
  for (const [key, entry] of players) {
    try {
      entry.player?.dispose?.();
    } catch (error) {
      diagnostic('transparent-spine-dispose-failed', { key, reason, error: describeError(error) });
    }
    entry.canvas?.remove();
  }
  players.clear();
  for (const key of Object.keys(characters)) clearFallback(key);
}

function applyProfileState(state, source = 'ipc') {
  const slotA = state?.activeProfiles?.['slot-a'];
  const slotB = state?.activeProfiles?.['slot-b'];
  if (!slotA || !slotB) {
    currentProfileState = state || null;
    updateProfileDialog(state);
    diagnostic('profiles-state-setup-required', { source, reason: 'missing-active-slots' });
    if (state?.isSetupRequired && profileDialog) {
      profileDialogSummary.textContent = '尚未安装可用素材包。请输入干员名称，选择时装组后下载基建素材。';
      profileDialog.hidden = false;
      window.petHost.setConfigurationMode(true);
    }
    return;
  }

  const sameActivePair = currentProfileState?.activePair?.slotA === state.activePair?.slotA
    && currentProfileState?.activePair?.slotB === state.activePair?.slotB;
  if (sameActivePair) {
    currentProfileState = state;
    updateProfileDialog(state);
    diagnostic('profiles-state-metadata-refreshed', { source, activePair: state.activePair || null });
    return;
  }

  const previous = characters;
  currentProfileState = state;
  characters = {
    gnosis: characterFromProfile(slotA, previous.gnosis),
    silverash: characterFromProfile(slotB, previous.silverash)
  };
  for (const [key, character] of Object.entries(characters)) {
    const slot = document.querySelector(`.${key}`);
    if (slot) slot.setAttribute('aria-label', character.label);
  }
  diagnostic('profiles-state-applied', {
    source,
    activePair: state.activePair || null,
    slots: Object.fromEntries(Object.entries(characters).map(([key, character]) => [key, {
      profileId: character.profileId,
      label: character.label,
      capabilities: character.capabilities
    }]))
  });
  updateProfileDialog(state);
  clearLoadedModels('profile-change');
  if (currentBehavior) render(currentBehavior);
  initializeTransparentModels();
}

function describeError(error) {
  if (!error) {
    return { kind: typeof error, string: String(error) };
  }
  const target = error.target || error.currentTarget || null;
  const description = {
    kind: error.constructor?.name || typeof error,
    name: error.name || null,
    message: error.message || null,
    stack: error.stack || null,
    type: error.type || null,
    string: String(error)
  };
  if (target) {
    description.target = {
      tagName: target.tagName || null,
      src: target.src || null,
      currentSrc: target.currentSrc || null,
      href: target.href || null,
      responseURL: target.responseURL || null,
      status: typeof target.status === 'number' ? target.status : null,
      statusText: target.statusText || null,
      readyState: typeof target.readyState === 'number' ? target.readyState : null
    };
  }
  return description;
}

function childSummary(slot) {
  const child = slot.firstElementChild;
  if (!child) return null;
  const computedStyle = window.getComputedStyle(child);
  return {
    tag: child.tagName.toLowerCase(),
    className: child.className || '',
    width: child.width || null,
    height: child.height || null,
    inlineTransform: child.style.transform || '',
    computedTransform: computedStyle.transform || '',
    src: child.currentSrc || child.src || null
  };
}

function slotSnapshot(key) {
  const slot = document.querySelector(`.${key}`);
  return {
    key,
    dataRenderer: slot?.dataset.renderer || null,
    dataFacing: slot?.dataset.facing || null,
    dataState: slot?.dataset.state || null,
    child: slot ? childSummary(slot) : null
  };
}

function logSlotSnapshot(reason, key, extra = {}) {
  diagnostic('slot-state', {
    reason,
    ...slotSnapshot(key),
    ...extra
  });
}

function ensureModelCanvas(key, canvas) {
  const slot = document.querySelector(`.${key}`);
  if (!slot) return;
  if (canvas.parentElement === slot && slot.firstElementChild === canvas && slot.children.length === 1) return;
  slot.replaceChildren(canvas);
  diagnostic('transparent-spine-canvas-attached', {
    key,
    dataRenderer: slot.dataset.renderer,
    canvas: { width: canvas.width, height: canvas.height }
  });
}

function attachSlotDiagnostics() {
  for (const key of Object.keys(characters)) {
    const slot = document.querySelector(`.${key}`);
    if (!slot) continue;
    logSlotSnapshot('initial', key);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          logSlotSnapshot(`attribute:${mutation.attributeName}`, key, {
            oldValue: mutation.oldValue,
            newValue: slot.getAttribute(mutation.attributeName)
          });
        } else if (mutation.type === 'childList') {
          logSlotSnapshot('child-list', key);
        }
      }
    });
    observer.observe(slot, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['data-renderer', 'data-facing', 'data-state'],
      childList: true
    });
  }
}

window.addEventListener('error', (event) => {
  diagnostic('renderer-error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: describeError(event.error || event)
  });
});

window.addEventListener('unhandledrejection', (event) => {
  diagnostic('renderer-unhandled-rejection', {
    reason: describeError(event.reason)
  });
});

function applyFacing(element, facing) {
  // Facing is applied by the parent slot's data attribute. Keeping it there
  // prevents a newly inserted canvas/image from briefly using an old inline
  // transform while an IPC behavior update is arriving.
  element.style.removeProperty('transform');
}

function createStill(source, label, facing) {
  const image = document.createElement('img');
  image.src = source;
  image.alt = label;
  image.draggable = false;
  applyFacing(image, facing);
  return image;
}

function clearFallback(key) {
  const fallback = blackKeyFallbacks.get(key);
  if (fallback) diagnostic('fallback-cleared', { key, signature: fallback.signature });
  fallback?.dispose();
  blackKeyFallbacks.delete(key);
}

function showBlackKeyFallback(key, state, facing) {
  const character = characters[key];
  const slot = document.querySelector(`.${key}`);
  const signature = `${state}:${facing}`;
  const existing = blackKeyFallbacks.get(key);
  if (existing?.signature === signature) return;
  clearFallback(key);

  // A PRTS profile's PNG is a Spine texture atlas, not a standalone portrait.
  // Showing it after a model-load failure exposes a sheet full of body parts.
  // Keep the failure visible in diagnostics, but never render that atlas as a pet.
  if ((character.provider === 'prts' || character.source === 'imported') && !hasStandaloneFallbackAssets(character)) {
    slot.dataset.renderer = 'transparent-model-unavailable';
    slot.replaceChildren();
    diagnostic('profile-spine-unavailable', {
      key,
      state,
      facing,
      profileId: character.profileId,
      reason: 'spine-model-load-failed-no-standalone-fallback'
    });
    return;
  }

  if (state === 'default') {
    slot.dataset.renderer = 'static-fallback';
    slot.replaceChildren(createStill(character.defaultAsset, `${character.label}默认站立`, facing));
    diagnostic('fallback-renderer-selected', {
      key,
      state,
      facing,
      dataRenderer: slot.dataset.renderer,
      source: character.defaultAsset
    });
    return;
  }

  const processedSource = character.processedActions?.[state] || character.processedActions?.Relax;
  const webmSource = character.fallbackActions?.[state] || character.fallbackActions?.Relax;
  if (!processedSource && !webmSource) {
    slot.dataset.renderer = 'static-fallback';
    slot.replaceChildren(createStill(character.defaultAsset, `${character.label}（缺少${state}动作）`, facing));
    diagnostic('fallback-static-selected', { key, state, facing, reason: 'action-asset-missing' });
    return;
  }

  const image = createStill(processedSource || webmSource, `${character.label}${state}`, facing);
  let active = true;
  const fallback = {
    signature,
    dispose() {
      active = false;
      image.removeAttribute('src');
    }
  };
  image.addEventListener('error', () => {
    if (!active) return;
    // The original WebM black-key path remains as the final recovery option.
    diagnostic('transparent-apng-fallback-error', {
      key,
      state,
      facing,
      source: processedSource
    });
    if (!webmSource) {
      slot.dataset.renderer = 'static-fallback';
      slot.replaceChildren(createStill(character.defaultAsset, `${character.label}（缺少备用动画）`, facing));
      diagnostic('fallback-static-selected', { key, state, facing, reason: 'webm-action-missing' });
      return;
    }
    const blackKey = window.makeBlackKeyFallback(
      webmSource,
      `${character.label}${state}`,
      facing,
      applyFacing
    );
    fallback.dispose = blackKey.dispose;
    slot.dataset.renderer = 'black-key-fallback';
    slot.replaceChildren(blackKey.element);
    diagnostic('fallback-renderer-selected', {
      key,
      state,
      facing,
      dataRenderer: slot.dataset.renderer,
      source: webmSource
    });
  }, { once: true });
  blackKeyFallbacks.set(key, fallback);
  slot.dataset.renderer = 'transparent-apng-fallback';
  slot.replaceChildren(image);
  diagnostic('fallback-renderer-selected', {
    key,
    state,
    facing,
    dataRenderer: slot.dataset.renderer,
    source: processedSource
  });
}

function setModelAnimation(key, state, facing, options = {}) {
  const character = characters[key];
  const playerEntry = players.get(key);
  if (!playerEntry) return false;

  const { canvas, player, availableAnimations } = playerEntry;
  applyFacing(canvas, facing);
  const semanticAction = state === 'default' ? 'Relax' : state;
  const action = character.actionMap?.[semanticAction] || character.actionMap?.Relax || semanticAction;
  if (!availableAnimations.has(action)) {
    console.warn(`PRTS model for ${key} does not contain ${action}; falling back to WebM.`);
    diagnostic('spine-animation-unavailable', {
      key,
      action,
      semanticAction,
      facing,
      availableAnimations: [...availableAnimations]
    });
    return false;
  }

  const signature = `${semanticAction}:${action}:${facing}`;
  if (playerEntry.signature === signature) {
    if (options.forceRestart) {
      diagnostic('spine-animation-restarted', {
        key,
        action,
        facing,
        signature,
        interactionId: options.interactionId || null,
        reason: options.restartReason || 'forced'
      });
      player.setAnimation(action, semanticAction !== 'Interact' || action !== character.actionMap?.Interact);
      return true;
    }
    diagnostic('spine-animation-duplicate-skipped', { key, action, facing, signature });
    return true;
  }

  // Interact is deliberately non-looping. The main process inserts Relax
  // before and after it, and also enforces a one-minute cooldown.
  diagnostic('spine-animation-set', {
    key,
    action,
    semanticAction,
    facing,
    signature,
    previousSignature: playerEntry.signature || null,
    loop: semanticAction !== 'Interact' || action !== character.actionMap?.Interact
  });
  player.setAnimation(action, semanticAction !== 'Interact' || action !== character.actionMap?.Interact);
  playerEntry.signature = signature;
  return true;
}

function oppositeFacing(facing) {
  return facing === 'left' ? 'right' : 'left';
}

function slotCenterX(key) {
  const slot = document.querySelector(`.${key}`);
  if (!slot) return null;
  const bounds = slot.getBoundingClientRect();
  if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.width) || bounds.width <= 0) return null;
  return bounds.left + bounds.width / 2;
}

function frontCharacterForFacing(facing) {
  const positioned = Object.keys(characters)
    .map((key) => ({ key, centerX: slotCenterX(key) }))
    .filter((entry) => Number.isFinite(entry.centerX));

  if (positioned.length >= 2) {
    positioned.sort((a, b) => a.centerX - b.centerX);
    return facing === 'left' ? positioned[0].key : positioned[positioned.length - 1].key;
  }

  return facing === 'left' ? 'gnosis' : 'silverash';
}

function resolveFacingOverrides(behavior) {
  const overrides = { ...(behavior.facingOverrides || {}) };
  if (!behavior.lookback?.enabled) return overrides;

  const frontKey = behavior.lookback.frontKey || frontCharacterForFacing(behavior.facing);
  overrides[frontKey] = oppositeFacing(behavior.facing);
  diagnostic('rest-lookback-facing-resolved', {
    facing: behavior.facing,
    frontKey,
    frontFacing: overrides[frontKey],
    phase: behavior.lookback.phase || null,
    centers: Object.fromEntries(Object.keys(characters).map((key) => [key, slotCenterX(key)]))
  });
  return overrides;
}

function render(behavior) {
  currentBehavior = behavior;
  diagnostic('behavior-ipc-received', {
    sequence: behavior.sequence || null,
    sentAt: behavior.sentAt || null,
    receivedAt: new Date().toISOString(),
    name: behavior.name,
    states: behavior.states,
    facing: behavior.facing,
    facingOverrides: behavior.facingOverrides || null,
    lookback: behavior.lookback || null,
    lookbackPhase: behavior.lookbackPhase || null,
    triggeredBy: behavior.triggeredBy || null,
    forceAnimationRestart: Boolean(behavior.forceAnimationRestart),
    interactionId: behavior.interactionId || null,
    groundedRest: Boolean(behavior.groundedRest),
    movementId: behavior.movementId || null
  });
  const behaviorStates = Object.values(behavior.states || {});
  const isSleeping = behaviorStates.includes('Sleep');
  const needsGrounding = Boolean(behavior.groundedRest)
    || behaviorStates.includes('Move')
    || behaviorStates.includes('Relax')
    || behaviorStates.includes('Sleep')
    || behaviorStates.includes('Sit');
  petStageElement.classList.toggle('sleeping', isSleeping);
  petStageElement.classList.toggle('grounded-resting', needsGrounding);
  if (!needsGrounding) clearGroundShifts(behavior.name);
  const facingOverrides = resolveFacingOverrides(behavior);

  for (const key of Object.keys(characters)) {
    const state = behavior.states[key] || 'default';
    const slot = document.querySelector(`.${key}`);
    const facing = facingOverrides[key] || behavior.facing;
    slot.dataset.facing = facing;
    slot.dataset.state = state;
    if (needsGrounding) applyPresetGroundShift(slot, key, state, behavior.name);
    const usedModel = setModelAnimation(key, state, facing, {
      forceRestart: Boolean(behavior.forceAnimationRestart),
      restartReason: behavior.triggeredBy || null,
      interactionId: behavior.interactionId || null
    });
    if (usedModel) {
      clearFallback(key);
      ensureModelCanvas(key, players.get(key).canvas);
      logSlotSnapshot('render-transparent-spine', key, {
        behaviorSequence: behavior.sequence || null,
        state,
        facing,
        movementId: behavior.movementId || null
      });
      continue;
    }
    showBlackKeyFallback(key, state, facing);
    logSlotSnapshot('render-fallback', key, {
      behaviorSequence: behavior.sequence || null,
      state,
      facing,
      movementId: behavior.movementId || null
    });
  }

  if (needsGrounding) scheduleSleepGroundingAdjustment();
}

function attachWebGLDiagnostics(canvas, key) {
  canvas.addEventListener('webglcontextlost', (event) => {
    diagnostic('webgl-context-lost', {
      key,
      statusMessage: event.statusMessage || null,
      dataRenderer: document.querySelector(`.${key}`)?.dataset.renderer || null
    });
  }, true);
  canvas.addEventListener('webglcontextrestored', () => {
    diagnostic('webgl-context-restored', {
      key,
      dataRenderer: document.querySelector(`.${key}`)?.dataset.renderer || null
    });
  }, true);
}

async function initializeTransparentModels() {
  const generation = ++modelLoadGeneration;
  for (const [key, character] of Object.entries(characters)) {
    if (generation !== modelLoadGeneration) return;
    const slot = document.querySelector(`.${key}`);
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    canvas.className = 'spine-model';
    canvas.setAttribute('aria-label', `${character.label} PRTS 透明模型`);
    attachWebGLDiagnostics(canvas, key);
    slot.replaceChildren(canvas);

    try {
      diagnostic('transparent-spine-load-start', {
        key,
        skeleton: character.model.skeleton,
        atlas: character.model.atlas,
        calibration: character.calibration || null
      });
      const player = new window.PRTSSpinePlayer(canvas);
      const modelScale = Number(character.calibration?.scale);
      const loaded = await player.load(
        key,
        character.model.skeleton,
        character.model.atlas,
        { x: -500, y: -200, scale: Number.isFinite(modelScale) && modelScale > 0 ? modelScale : 1 },
        null,
        true
      );
      if (generation !== modelLoadGeneration) {
        try {
          player.dispose?.();
        } catch {
          // The stale canvas is about to be discarded; disposal is best effort only.
        }
        canvas.remove();
        return;
      }
      const availableAnimations = new Set(loaded.skeleton.data.animations.map((animation) => animation.name));
      slot.dataset.renderer = 'transparent-spine';
      players.set(key, { canvas, player, availableAnimations, signature: undefined });
      clearFallback(key);
      ensureModelCanvas(key, canvas);
      diagnostic('transparent-spine-load-success', {
        key,
        dataRenderer: slot.dataset.renderer,
        availableAnimations: [...availableAnimations],
        canvas: { width: canvas.width, height: canvas.height }
      });
      if (character.profileId) {
        window.petHost.reportProfileRuntime({
          profileId: character.profileId,
          availableAnimations: [...availableAnimations]
        });
      }
      player.play(key);
    } catch (error) {
      console.error(`Unable to load PRTS transparent model for ${key}`, error);
      slot.dataset.renderer = 'transparent-load-failed';
      diagnostic('transparent-spine-load-failed', {
        key,
        dataRenderer: slot.dataset.renderer,
        error: describeError(error)
      });
      canvas.remove();
    }
  }

  if (generation === modelLoadGeneration && currentBehavior) render(currentBehavior);
}

let pointerOverControls = false;
let pointerOverPet = false;
let controlsHidden = false;
let controlsPanelOpen = false;
let autoEnabled = true;
let focusModeEnabled = false;
const controlsElement = document.querySelector('#size-controls');
const controlsPanel = document.querySelector('#controls-panel');
const controlsToggleButton = document.querySelector('#pet-menu');
const panelToggleAutoButton = document.querySelector('#panel-toggle-auto');
const panelFocusModeButton = document.querySelector('#panel-focus-mode');
const activitySlider = document.querySelector('#activity-slider');
const activityValue = document.querySelector('#activity-value');
const profileDialog = document.querySelector('#profile-dialog');
const profileDialogSummary = document.querySelector('#profile-dialog-summary');
const profileDialogStatus = document.querySelector('#profile-dialog-status');
const profileDialogCloseButton = document.querySelector('#profile-dialog-close');
const profileDialogCancelButton = document.querySelector('#profile-dialog-cancel');
const profileSlotASelect = document.querySelector('#profile-slot-a');
const profileSlotBSelect = document.querySelector('#profile-slot-b');
const prtsOperatorNameInput = document.querySelector('#prts-operator-name');
const prtsOutfitSelect = document.querySelector('#prts-outfit');
const prtsLookupButton = document.querySelector('#prts-lookup');
const prtsDownloadButton = document.querySelector('#prts-download');
const prtsCancelDownloadButton = document.querySelector('#prts-cancel-download');
const prtsOpenDebugButton = document.querySelector('#prts-open-debug');
const feedbackDialog = document.querySelector('#feedback-dialog');
const feedbackDialogCloseButton = document.querySelector('#feedback-dialog-close');
const feedbackExportButton = document.querySelector('#feedback-export');
const feedbackOpenFormButton = document.querySelector('#feedback-open-form');
const feedbackVersion = document.querySelector('#feedback-version');
const feedbackCurrentProfile = document.querySelector('#feedback-current-profile');
const feedbackDialogStatus = document.querySelector('#feedback-dialog-status');
const petStageElement = document.querySelector('#pet-stage');
const petPixelDragHotspot = document.querySelector('#pet-pixel-drag-hotspot');
const FOCUS_MODE_TOOLTIP = '\u3010\u5f00\u542f\u4e13\u6ce8\u6a21\u5f0f\uff0c\u4eba\u7269\u79fb\u52a8\u8303\u56f4\u7f29\u5c0f\uff0c\u4e14\u70b9\u51fb\u5934\u90e8\u4e0d\u518d\u89e6\u53d1\u6233\u4e00\u6233\u52a8\u4f5c\u3011';
const alphaProbeCanvas = document.createElement('canvas');
const alphaProbeContext = alphaProbeCanvas.getContext('2d', { willReadFrequently: true });
const webglProbeContexts = new WeakMap();
let pixelHitReadFailureReported = false;
let sleepGroundAdjustmentTimer;
let sleepGroundAdjustmentAttempts = 0;
let lastAutoPetHit = null;
let lastAutoHeadHit = null;
let lastHeadInteractRequestAt = 0;
let activePetGesture = null;
let prtsCatalog;
const PIXEL_HIT_ALPHA_THRESHOLD = 3;
const PIXEL_HIT_RADIUS_CSS_PX = 14;
const PIXEL_HIT_MAX_SAMPLE_RADIUS = 38;
const HEAD_HIT_VISIBLE_RATIO = 1 / 3;
const HEAD_HIT_TOLERANCE_CSS_PX = 18;
const PET_DRAG_START_THRESHOLD_CSS_PX = 6;
const PET_GESTURE_MOVE_LOG_LIMIT = 4;
const SLEEP_GROUND_ALPHA_THRESHOLD = 24;
const SLEEP_GROUND_TARGET_GAP_CSS_PX = -4;
const SLEEP_GROUND_MAX_SHIFT_CSS_PX = 120;
const SLEEP_GROUND_MAX_MEASURE_ATTEMPTS = 6;
const SLEEP_GROUND_RETRY_DELAY_MS = 180;
const SLEEP_GROUND_EXTRA_SCREEN_SHIFT_CSS_PX = {
  silverash: 8,
  gnosis: 0
};
const GROUND_INSET_PRESET_CSS_PX = {
  Relax: {
    gnosis: 86.4,
    silverash: 81.3
  },
  Move: {
    gnosis: 85.6,
    silverash: 85.6
  },
  Sit: {
    gnosis: 33.5,
    silverash: 42.1
  },
  Sleep: {
    gnosis: 81.3,
    silverash: 68.4
  }
};
const visibleBoundsCache = new Map();

function setControlsPanelOpen(open) {
  const nextOpen = Boolean(open) && !controlsHidden;
  if (controlsPanelOpen === nextOpen) return;
  controlsPanelOpen = nextOpen;
  controlsPanel.hidden = !nextOpen;
  controlsToggleButton.setAttribute('aria-expanded', String(nextOpen));
  controlsToggleButton.title = nextOpen ? '收起设置' : '展开设置';
  controlsElement.classList.toggle('is-expanded', nextOpen);
  diagnostic('controls-panel-state', { open: nextOpen });
}

function behaviorActivityLabel(activity) {
  if (activity <= 0.25) return '安静';
  if (activity >= 0.75) return '活跃';
  return '普通';
}

function updateBehaviorActivityControl(activity) {
  const number = Number(activity);
  const clamped = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
  const percent = Math.round(clamped * 100);
  const label = behaviorActivityLabel(clamped);
  activitySlider.value = String(percent);
  activitySlider.title = `行为活跃度 ${percent}%（${label}）`;
  activityValue.textContent = label;
  activityValue.title = `${percent}%`;
}

function profileOptionText(profile) {
  const operator = profile.operator || {};
  return `${operator.name || profile.id} · ${operator.outfitName || '未知时装'}`;
}

function populateProfileSelect(select, profiles, selectedId) {
  select.replaceChildren();
  for (const profile of profiles || []) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profileOptionText(profile);
    option.selected = profile.id === selectedId;
    select.append(option);
  }
}

function updateProfileDialog(state = currentProfileState) {
  if (!state || !profileDialog) return;
  populateProfileSelect(profileSlotASelect, state.profiles, state.activePair?.slotA);
  populateProfileSelect(profileSlotBSelect, state.profiles, state.activePair?.slotB);
  const slotA = state.activeProfiles?.['slot-a']?.operator;
  const slotB = state.activeProfiles?.['slot-b']?.operator;
  profileDialogSummary.textContent = slotA && slotB
    ? `当前组合：${slotA.name}（${slotA.outfitName}） × ${slotB.name}（${slotB.outfitName}）`
    : '尚未安装可用素材包。请输入干员名称，选择时装组后下载基建素材。';
  profileDialogCancelButton.textContent = state.isSetupRequired ? '退出桌宠' : '取消';
}

function setProfileDialogStatus(message = '', isError = false) {
  profileDialogStatus.textContent = message;
  profileDialogStatus.classList.toggle('is-error', isError);
}

async function openProfileDialog() {
  if (!currentProfileState) {
    try {
      const state = await window.petHost.getProfiles();
      if (state) applyProfileState(state, 'dialog-open');
    } catch (error) {
      setProfileDialogStatus(`读取素材包失败：${error.message || error}`, true);
    }
  }
  updateProfileDialog();
  setProfileDialogStatus('');
  profileDialog.hidden = false;
  window.petHost.setConfigurationMode(true);
  window.petHost.setPointerOverControls(true);
}

function closeProfileDialog() {
  if (currentProfileState?.isSetupRequired) {
    window.petHost.quit();
    return;
  }
  profileDialog.hidden = true;
  setProfileDialogStatus('');
  window.petHost.setConfigurationMode(false);
  window.petHost.setPointerOverControls(false);
}

function setFeedbackDialogStatus(message = '', isError = false) {
  feedbackDialogStatus.textContent = message;
  feedbackDialogStatus.classList.toggle('is-error', isError);
}

async function openFeedbackDialog() {
  try {
    const info = await window.petHost.getAppInfo();
    feedbackVersion.textContent = `版本：${info?.displayName || '明日方舟基建桌宠'} ${info?.version || '未知'}`;
  } catch {
    feedbackVersion.textContent = '版本：明日方舟基建桌宠（未知）';
  }
  const slotA = currentProfileState?.activeProfiles?.['slot-a']?.operator;
  const slotB = currentProfileState?.activeProfiles?.['slot-b']?.operator;
  feedbackCurrentProfile.textContent = slotA && slotB
    ? `当前组合：左侧 ${slotA.name}·${slotA.outfitName}；右侧 ${slotB.name}·${slotB.outfitName}`
    : '当前组合：尚未完成角色配置。';
  setFeedbackDialogStatus('');
  feedbackDialog.hidden = false;
  window.petHost.setConfigurationMode(true);
  window.petHost.setPointerOverControls(true);
}

function closeFeedbackDialog() {
  feedbackDialog.hidden = true;
  setFeedbackDialogStatus('');
  window.petHost.setConfigurationMode(false);
  window.petHost.setPointerOverControls(false);
}

async function applySelectedProfiles() {
  setProfileDialogStatus('正在切换素材包…');
  const result = await window.petHost.selectProfiles({
    slotA: profileSlotASelect.value,
    slotB: profileSlotBSelect.value
  });
  if (!result?.ok) {
    setProfileDialogStatus(result?.error || '切换素材包失败。', true);
    return;
  }
  applyProfileState(result.state, 'dialog-select');
  closeProfileDialog();
}

function setPritsDownloadBusy(busy) {
  prtsLookupButton.disabled = busy;
  prtsDownloadButton.disabled = busy || !prtsCatalog || !prtsOutfitSelect.value;
  prtsCancelDownloadButton.hidden = !busy;
  prtsOperatorNameInput.disabled = busy;
  prtsOutfitSelect.disabled = busy || !prtsCatalog;
}

function renderPritsOutfits(catalog) {
  prtsOutfitSelect.replaceChildren();
  for (const outfit of catalog.outfits || []) {
    const option = document.createElement('option');
    option.value = outfit.name;
    option.textContent = outfit.name;
    prtsOutfitSelect.append(option);
  }
  prtsOutfitSelect.disabled = !(catalog.outfits || []).length;
  prtsDownloadButton.disabled = !(catalog.outfits || []).length;
}

async function lookupPritsOperator() {
  const name = prtsOperatorNameInput.value.trim();
  if (!name) {
    setProfileDialogStatus('请输入想要下载的干员名称。', true);
    return;
  }
  prtsCatalog = undefined;
  prtsOutfitSelect.replaceChildren(new Option('正在查询时装组…', ''));
  setPritsDownloadBusy(true);
  setProfileDialogStatus(`正在查询“${name}”…`);
  const result = await window.petHost.lookupPritsOperator(name);
  if (!result?.ok) {
    const operatorNotFound = result?.code === 'operator-not-found';
    prtsOutfitSelect.replaceChildren(new Option(operatorNotFound ? '干员不存在' : '查询失败', ''));
    setProfileDialogStatus(result?.error || 'PRTS 查询失败，请稍后重试。', true);
    prtsOpenDebugButton.hidden = !result?.debugAvailable;
    setPritsDownloadBusy(false);
    return;
  }
  prtsCatalog = result.catalog;
  prtsOpenDebugButton.hidden = true;
  prtsOperatorNameInput.value = result.catalog.name;
  renderPritsOutfits(result.catalog);
  setPritsDownloadBusy(false);
  setProfileDialogStatus(`已找到“${result.catalog.name}”，请选择时装组并下载基建素材。`);
}

async function downloadPritsProfile() {
  if (!prtsCatalog || !prtsOutfitSelect.value) return;
  const request = { name: prtsCatalog.name, outfitName: prtsOutfitSelect.value };
  setPritsDownloadBusy(true);
  setProfileDialogStatus(`正在下载 ${request.name} · ${request.outfitName} 的基建素材…`);
  const result = await window.petHost.downloadPritsProfile(request);
  setPritsDownloadBusy(false);
  if (!result?.ok) {
    if (result?.cancelled) {
      setProfileDialogStatus('下载已取消。');
      return;
    }
    setProfileDialogStatus(`${result?.error || '下载失败。'} 请稍后重试。`, true);
    return;
  }
  applyProfileState(result.state, 'prts-download');
  setProfileDialogStatus('下载和校验完成。请在下方选择它作为左侧或右侧角色，再点击“应用组合”。');
}

function renderPritsProgress(progress) {
  if (!progress) return;
  if (progress.phase === 'prepare') {
    setProfileDialogStatus('正在准备 PRTS 下载…');
    return;
  }
  if (progress.phase === 'validate') {
    setProfileDialogStatus('文件下载完成，正在校验素材包…');
    return;
  }
  if (progress.phase === 'complete') return;
  const received = Number(progress.receivedBytes || 0);
  const total = Number(progress.totalBytes || 0);
  const size = total > 0
    ? `${Math.round(received / 1024)} / ${Math.round(total / 1024)} KB`
    : `${Math.round(received / 1024)} KB`;
  setProfileDialogStatus(`正在下载文件 ${Number(progress.fileIndex || 0) + 1}/${progress.fileCount || 3}：${progress.path || ''}（${size}）`);
}

function getElementSamplePoint(element, bounds, event) {
  let xRatio = (event.clientX - bounds.left) / bounds.width;
  const yRatio = (event.clientY - bounds.top) / bounds.height;
  const slot = element.closest('.pet-slot');
  if (slot?.dataset.facing === 'left') xRatio = 1 - xRatio;
  return {
    xRatio: Math.max(0, Math.min(1, xRatio)),
    yRatio: Math.max(0, Math.min(1, yRatio))
  };
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function maxAlphaFromImageData(data) {
  let maxAlpha = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > maxAlpha) maxAlpha = data[index];
    if (maxAlpha > PIXEL_HIT_ALPHA_THRESHOLD) break;
  }
  return maxAlpha;
}

function rowHasVisibleAlpha(data, row, width, threshold) {
  const rowStart = row * width * 4 + 3;
  const rowEnd = rowStart + width * 4;
  for (let index = rowStart; index < rowEnd; index += 4) {
    if (data[index] > threshold) return true;
  }
  return false;
}

function bottomInsetFromBottomOriginPixels(data, width, height, threshold) {
  for (let row = 0; row < height; row += 1) {
    if (rowHasVisibleAlpha(data, row, width, threshold)) return row;
  }
  return null;
}

function bottomInsetFromTopOriginPixels(data, width, height, threshold) {
  for (let row = height - 1; row >= 0; row -= 1) {
    if (rowHasVisibleAlpha(data, row, width, threshold)) return height - 1 - row;
  }
  return null;
}

function visibleAlphaBoundsFromTopOriginPixels(data, width, height, threshold) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let row = 0; row < height; row += 1) {
    const rowStart = row * width * 4;
    for (let column = 0; column < width; column += 1) {
      const alpha = data[rowStart + column * 4 + 3];
      if (alpha <= threshold) continue;
      if (column < left) left = column;
      if (column > right) right = column;
      if (row < top) top = row;
      if (row > bottom) bottom = row;
    }
  }

  if (right < left || bottom < top) return null;
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function visibleAlphaBoundsFromBottomOriginPixels(data, width, height, threshold) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let row = 0; row < height; row += 1) {
    const topOriginRow = height - 1 - row;
    const rowStart = row * width * 4;
    for (let column = 0; column < width; column += 1) {
      const alpha = data[rowStart + column * 4 + 3];
      if (alpha <= threshold) continue;
      if (column < left) left = column;
      if (column > right) right = column;
      if (topOriginRow < top) top = topOriginRow;
      if (topOriginRow > bottom) bottom = topOriginRow;
    }
  }

  if (right < left || bottom < top) return null;
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function readCanvasBottomInsetPixels(canvas) {
  const gl = webglProbeContexts.get(canvas)
    || canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    || canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (gl) {
    webglProbeContexts.set(canvas, gl);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return bottomInsetFromBottomOriginPixels(pixels, canvas.width, canvas.height, SLEEP_GROUND_ALPHA_THRESHOLD);
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return bottomInsetFromTopOriginPixels(imageData.data, canvas.width, canvas.height, SLEEP_GROUND_ALPHA_THRESHOLD);
}

function readCanvasVisibleBounds(canvas) {
  const gl = webglProbeContexts.get(canvas)
    || canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    || canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (gl) {
    webglProbeContexts.set(canvas, gl);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return visibleAlphaBoundsFromBottomOriginPixels(pixels, canvas.width, canvas.height, PIXEL_HIT_ALPHA_THRESHOLD);
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return visibleAlphaBoundsFromTopOriginPixels(imageData.data, canvas.width, canvas.height, PIXEL_HIT_ALPHA_THRESHOLD);
}

function readMediaBottomInsetPixels(element) {
  if (!alphaProbeContext) return null;
  const sourceWidth = element.videoWidth || element.naturalWidth || element.width;
  const sourceHeight = element.videoHeight || element.naturalHeight || element.height;
  if (!sourceWidth || !sourceHeight) return null;
  alphaProbeCanvas.width = sourceWidth;
  alphaProbeCanvas.height = sourceHeight;
  alphaProbeContext.clearRect(0, 0, sourceWidth, sourceHeight);
  alphaProbeContext.drawImage(element, 0, 0, sourceWidth, sourceHeight);
  const imageData = alphaProbeContext.getImageData(0, 0, sourceWidth, sourceHeight);
  return bottomInsetFromTopOriginPixels(imageData.data, sourceWidth, sourceHeight, SLEEP_GROUND_ALPHA_THRESHOLD);
}

function readMediaVisibleBounds(element) {
  if (!alphaProbeContext) return null;
  const sourceWidth = element.videoWidth || element.naturalWidth || element.width;
  const sourceHeight = element.videoHeight || element.naturalHeight || element.height;
  if (!sourceWidth || !sourceHeight) return null;
  alphaProbeCanvas.width = sourceWidth;
  alphaProbeCanvas.height = sourceHeight;
  alphaProbeContext.clearRect(0, 0, sourceWidth, sourceHeight);
  alphaProbeContext.drawImage(element, 0, 0, sourceWidth, sourceHeight);
  const imageData = alphaProbeContext.getImageData(0, 0, sourceWidth, sourceHeight);
  return visibleAlphaBoundsFromTopOriginPixels(imageData.data, sourceWidth, sourceHeight, PIXEL_HIT_ALPHA_THRESHOLD);
}

function getStageScale() {
  const stage = document.querySelector('#pet-stage');
  if (!stage) return 1;
  const bounds = stage.getBoundingClientRect();
  const layoutHeight = stage.offsetHeight || bounds.height || 1;
  const scale = bounds.height / layoutHeight;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getElementBottomInsetCss(element) {
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const localHeight = element.offsetHeight || bounds.height;
  const stageScale = getStageScale();
  const sourceHeight = element instanceof HTMLCanvasElement
    ? element.height
    : element.videoHeight || element.naturalHeight || element.height;
  if (!sourceHeight) return null;
  const insetPixels = element instanceof HTMLCanvasElement
    ? readCanvasBottomInsetPixels(element)
    : readMediaBottomInsetPixels(element);
  if (insetPixels === null) return null;
  return {
    insetPixels,
    insetCss: (insetPixels / sourceHeight) * localHeight,
    sourceHeight,
    localHeight,
    displayHeight: bounds.height,
    stageScale
  };
}

function presetGroundShiftCss(key, state) {
  if (characters[key]?.source !== 'bundled') return null;
  const presetInsetCss = GROUND_INSET_PRESET_CSS_PX[state]?.[key];
  if (typeof presetInsetCss !== 'number') return null;
  const stageScale = getStageScale();
  const targetGapCss = SLEEP_GROUND_TARGET_GAP_CSS_PX / stageScale;
  const extraScreenShiftCss = state === 'Sleep'
    ? sleepGroundExtraShift(key)
    : 0;
  const extraShiftCss = extraScreenShiftCss / stageScale;
  return Math.max(
    0,
    Math.min(SLEEP_GROUND_MAX_SHIFT_CSS_PX, presetInsetCss - targetGapCss + extraShiftCss)
  );
}

function sleepGroundExtraShift(key) {
  const profileOffset = Number(characters[key]?.calibration?.groundOffset);
  if (Number.isFinite(profileOffset)) return profileOffset;
  return SLEEP_GROUND_EXTRA_SCREEN_SHIFT_CSS_PX[key] || 0;
}

function applyPresetGroundShift(slot, key, state, reason) {
  const shiftCss = presetGroundShiftCss(key, state);
  if (shiftCss === null) return;
  const roundedShiftCss = Math.round(shiftCss * 10) / 10;
  slot.style.setProperty('--pet-ground-shift', `${roundedShiftCss}px`);
  diagnostic('ground-shift-preset-applied', {
    key,
    state,
    reason,
    shiftCss: roundedShiftCss,
    stageScale: getStageScale()
  });
}

function clearGroundShifts(reason) {
  let cleared = 0;
  const hadTimer = Boolean(sleepGroundAdjustmentTimer);
  sleepGroundAdjustmentAttempts = 0;
  if (sleepGroundAdjustmentTimer) {
    clearTimeout(sleepGroundAdjustmentTimer);
    sleepGroundAdjustmentTimer = undefined;
  }
  for (const slot of document.querySelectorAll('.pet-slot')) {
    const currentShift = slot.style.getPropertyValue('--pet-ground-shift');
    if (currentShift && currentShift !== '0px') cleared += 1;
    slot.style.setProperty('--pet-ground-shift', '0px');
  }
  if (hadTimer || cleared > 0) diagnostic('sleep-ground-shift-cleared', { reason, cleared });
}

function applySleepGroundingAdjustment() {
  sleepGroundAdjustmentTimer = undefined;
  if (!petStageElement?.classList.contains('grounded-resting')) return;

  let skipped = 0;
  for (const key of Object.keys(characters)) {
    const slot = document.querySelector(`.${key}`);
    const child = slot?.firstElementChild;
    if (!slot || !child) continue;
    const state = slot.dataset.state || null;
    try {
      const measurement = getElementBottomInsetCss(child);
      if (!measurement) {
        skipped += 1;
        diagnostic('sleep-ground-shift-skipped', {
          key,
          state,
          reason: 'no-alpha-measurement',
          attempt: sleepGroundAdjustmentAttempts + 1,
          dataRenderer: slot.dataset.renderer || null
        });
        continue;
      }
      const targetGapCss = SLEEP_GROUND_TARGET_GAP_CSS_PX / measurement.stageScale;
      const extraScreenShiftCss = state === 'Sleep'
        ? sleepGroundExtraShift(key)
        : 0;
      const extraShiftCss = extraScreenShiftCss / measurement.stageScale;
      const shiftCss = Math.max(
        0,
        Math.min(SLEEP_GROUND_MAX_SHIFT_CSS_PX, measurement.insetCss - targetGapCss + extraShiftCss)
      );
      slot.style.setProperty('--pet-ground-shift', `${Math.round(shiftCss * 10) / 10}px`);
      diagnostic('sleep-ground-shift-applied', {
        key,
        state,
        dataRenderer: slot.dataset.renderer || null,
        dataFacing: slot.dataset.facing || null,
        tagName: child.tagName,
        attempt: sleepGroundAdjustmentAttempts + 1,
        ...measurement,
        alphaThreshold: SLEEP_GROUND_ALPHA_THRESHOLD,
        targetGapScreenCss: SLEEP_GROUND_TARGET_GAP_CSS_PX,
        targetGapCss,
        extraScreenShiftCss,
        extraShiftCss,
        shiftCss,
        shiftScreenCss: shiftCss * measurement.stageScale
      });
    } catch (error) {
      diagnostic('sleep-ground-shift-failed', {
        key,
        state,
        dataRenderer: slot.dataset.renderer || null,
        error: describeError(error)
      });
    }
  }

  if (skipped > 0 && sleepGroundAdjustmentAttempts < SLEEP_GROUND_MAX_MEASURE_ATTEMPTS - 1) {
    sleepGroundAdjustmentAttempts += 1;
    diagnostic('sleep-ground-shift-retry-scheduled', {
      attempt: sleepGroundAdjustmentAttempts + 1,
      delayMs: SLEEP_GROUND_RETRY_DELAY_MS,
      skipped
    });
    sleepGroundAdjustmentTimer = setTimeout(applySleepGroundingAdjustment, SLEEP_GROUND_RETRY_DELAY_MS);
  }
}

function scheduleSleepGroundingAdjustment() {
  if (sleepGroundAdjustmentTimer) clearTimeout(sleepGroundAdjustmentTimer);
  sleepGroundAdjustmentAttempts = 0;
  sleepGroundAdjustmentTimer = setTimeout(applySleepGroundingAdjustment, 120);
}

function sourceSizeForElement(element) {
  if (element instanceof HTMLCanvasElement) {
    return { width: element.width, height: element.height };
  }
  return {
    width: element.videoWidth || element.naturalWidth || element.width,
    height: element.videoHeight || element.naturalHeight || element.height
  };
}

function visibleBoundsCacheKey(key, slot, element) {
  const sourceSize = sourceSizeForElement(element);
  return [
    key,
    slot.dataset.renderer || '',
    slot.dataset.state || '',
    element.tagName,
    sourceSize.width || 0,
    sourceSize.height || 0
  ].join(':');
}

function getVisibleBounds(key, slot, element) {
  const cacheKey = visibleBoundsCacheKey(key, slot, element);
  if (visibleBoundsCache.has(cacheKey)) return visibleBoundsCache.get(cacheKey);

  let bounds = null;
  try {
    if (element instanceof HTMLCanvasElement) bounds = readCanvasVisibleBounds(element);
    else if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement) bounds = readMediaVisibleBounds(element);
  } catch (error) {
    if (!pixelHitReadFailureReported) {
      pixelHitReadFailureReported = true;
      diagnostic('visible-bounds-read-failed', {
        key,
        tagName: element.tagName,
        error: describeError(error)
      });
    }
  }

  visibleBoundsCache.set(cacheKey, bounds);
  if (bounds) {
    diagnostic('visible-bounds-measured', {
      key,
      state: slot.dataset.state || null,
      dataRenderer: slot.dataset.renderer || null,
      tagName: element.tagName,
      bounds
    });
  }
  return bounds;
}

function sampleRegion(element, sourceWidth, sourceHeight, bounds, event) {
  const point = getElementSamplePoint(element, bounds, event);
  const x = clampInteger(point.xRatio * sourceWidth, 0, sourceWidth - 1);
  const y = clampInteger(point.yRatio * sourceHeight, 0, sourceHeight - 1);
  const radiusX = clampInteger((PIXEL_HIT_RADIUS_CSS_PX / bounds.width) * sourceWidth, 1, PIXEL_HIT_MAX_SAMPLE_RADIUS);
  const radiusY = clampInteger((PIXEL_HIT_RADIUS_CSS_PX / bounds.height) * sourceHeight, 1, PIXEL_HIT_MAX_SAMPLE_RADIUS);
  const left = Math.max(0, x - radiusX);
  const top = Math.max(0, y - radiusY);
  const right = Math.min(sourceWidth - 1, x + radiusX);
  const bottom = Math.min(sourceHeight - 1, y + radiusY);
  return {
    x,
    y,
    left,
    top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1)
  };
}

function sampleCanvasAlpha(canvas, bounds, event) {
  const region = sampleRegion(canvas, canvas.width, canvas.height, bounds, event);
  const gl = webglProbeContexts.get(canvas)
    || canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    || canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (gl) {
    webglProbeContexts.set(canvas, gl);
    const pixels = new Uint8Array(region.width * region.height * 4);
    const glY = canvas.height - region.top - region.height;
    gl.readPixels(region.left, glY, region.width, region.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return maxAlphaFromImageData(pixels);
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return context ? maxAlphaFromImageData(context.getImageData(region.left, region.top, region.width, region.height).data) : 0;
}

function sampleMediaAlpha(element, bounds, event) {
  if (!alphaProbeContext) return 0;
  const sourceWidth = element.videoWidth || element.naturalWidth || element.width;
  const sourceHeight = element.videoHeight || element.naturalHeight || element.height;
  if (!sourceWidth || !sourceHeight) return 0;
  const region = sampleRegion(element, sourceWidth, sourceHeight, bounds, event);
  alphaProbeCanvas.width = sourceWidth;
  alphaProbeCanvas.height = sourceHeight;
  alphaProbeContext.clearRect(0, 0, sourceWidth, sourceHeight);
  alphaProbeContext.drawImage(element, 0, 0, sourceWidth, sourceHeight);
  return maxAlphaFromImageData(alphaProbeContext.getImageData(region.left, region.top, region.width, region.height).data);
}

function sampleElementAlpha(element, bounds, event) {
  try {
    if (element instanceof HTMLCanvasElement) return sampleCanvasAlpha(element, bounds, event);
    if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement) return sampleMediaAlpha(element, bounds, event);
  } catch (error) {
    if (!pixelHitReadFailureReported) {
      pixelHitReadFailureReported = true;
      diagnostic('pixel-hit-alpha-read-failed', {
        tagName: element.tagName,
        error: describeError(error)
      });
    }
  }
  return 0;
}

function headHitMetricsForHit(hit) {
  if (!hit) return null;
  const sourceY = Number(hit.sourceY);
  if (!Number.isFinite(sourceY)) return null;

  const sourceHeight = Number(hit.sourceSize?.height);
  const elementHeight = Number(hit.elementBounds?.height);
  const visibleBounds = hit.visibleBounds;
  const configuredRatio = Number(characters[hit.key]?.calibration?.headHitRatio);
  const headRatio = Number.isFinite(configuredRatio)
    ? Math.max(0.1, Math.min(0.7, configuredRatio))
    : HEAD_HIT_VISIBLE_RATIO;
  let headBottomBase = null;
  if (visibleBounds && Number.isFinite(visibleBounds.top) && Number.isFinite(visibleBounds.height)) {
    headBottomBase = visibleBounds.top + visibleBounds.height * headRatio;
  } else if (Number.isFinite(sourceHeight) && sourceHeight > 0) {
    headBottomBase = sourceHeight * headRatio;
  }
  if (!Number.isFinite(headBottomBase)) return null;

  const headTolerance = Number.isFinite(sourceHeight) && sourceHeight > 0 && Number.isFinite(elementHeight) && elementHeight > 0
    ? (HEAD_HIT_TOLERANCE_CSS_PX / elementHeight) * sourceHeight
    : HEAD_HIT_TOLERANCE_CSS_PX;
  const headBottom = headBottomBase + headTolerance;
  return {
    sourceY: Math.round(sourceY),
    headBottomBase: Math.round(headBottomBase),
    headRatio,
    headTolerance: Math.round(headTolerance),
    headBottom: Math.round(headBottom),
    inHead: sourceY <= headBottom
  };
}

function headHitFromPetHit(hit, source = null) {
  const metrics = headHitMetricsForHit(hit);
  const headHit = metrics?.inHead ? { ...hit, headOnly: true, headMetrics: metrics } : null;
  if (source) {
    diagnostic(headHit ? 'head-hit-derived' : 'head-hit-missed', {
      source,
      hit,
      metrics
    });
  }
  return headHit;
}

function resolveHeadHitForPointerDown(hit, source) {
  if (!hit) return null;
  if (focusModeEnabled) {
    const possibleHeadHit = headHitFromPetHit(hit);
    diagnostic(possibleHeadHit ? 'head-click-suppressed-focus-mode' : 'head-click-not-head-focus-mode', {
      source,
      hit,
      metrics: possibleHeadHit?.headMetrics || headHitMetricsForHit(hit)
    });
    return null;
  }
  return headHitFromPetHit(hit, source);
}

function hitTestPetPixels(event, options = {}) {
  if (!event) return null;
  const headOnly = Boolean(options.headOnly);

  for (const slot of document.querySelectorAll('.pet-slot')) {
    const child = slot.firstElementChild;
    if (!child) continue;
    const bounds = child.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) continue;

    const maxAlpha = sampleElementAlpha(child, bounds, event);
    if (maxAlpha <= PIXEL_HIT_ALPHA_THRESHOLD) continue;

    const key = slot.classList.contains('silverash') ? 'silverash' : 'gnosis';
    const sourceSize = sourceSizeForElement(child);
    if (!sourceSize.width || !sourceSize.height) continue;
    const point = getElementSamplePoint(child, bounds, event);
    const sourceY = point.yRatio * sourceSize.height;
    const visibleBounds = getVisibleBounds(key, slot, child);
    const hit = {
      key,
      state: slot.dataset.state || null,
      dataRenderer: slot.dataset.renderer || null,
      dataFacing: slot.dataset.facing || null,
      maxAlpha,
      headOnly: false,
      sourceY: Math.round(sourceY),
      sourceSize: {
        width: Math.round(sourceSize.width),
        height: Math.round(sourceSize.height)
      },
      elementBounds: {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      },
      visibleBounds
    };

    if (headOnly) {
      const headHit = headHitFromPetHit(hit);
      if (!headHit) continue;
      return headHit;
    }

    return hit;
  }

  return null;
}

function pixelHitTestPet(event) {
  if (autoEnabled || !event) return null;
  return hitTestPetPixels(event, { headOnly: false });
}

function headHitTestPet(event) {
  if (!autoEnabled || !event) return null;
  return hitTestPetPixels(event, { headOnly: true });
}

function requestHeadInteract(hit, event, source) {
  if (!autoEnabled || !hit) return false;
  const now = performance.now();
  if (now - lastHeadInteractRequestAt < 450) return true;
  lastHeadInteractRequestAt = now;

  event?.preventDefault?.();
  event?.stopPropagation?.();
  diagnostic('head-click-interact-requested', {
    source,
    hit,
    x: event ? Math.round(event.clientX) : null,
    y: event ? Math.round(event.clientY) : null
  });
  window.petHost.triggerInteract({
    key: hit.key,
    state: hit.state,
    dataRenderer: hit.dataRenderer,
    dataFacing: hit.dataFacing,
    sourceY: hit.sourceY,
    maxAlpha: hit.maxAlpha,
    source
  });
  return true;
}

function pointerScreenPoint(event) {
  return {
    clientX: Math.round(event.clientX),
    clientY: Math.round(event.clientY),
    screenX: Math.round(event.screenX),
    screenY: Math.round(event.screenY)
  };
}

function pointerCaptureCandidates(event) {
  const candidates = [];
  if (event?.target instanceof Element) candidates.push(event.target);
  candidates.push(petPixelDragHotspot, document.documentElement);
  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index);
}

function describeCaptureElement(element) {
  if (!element) return null;
  return {
    tagName: element.tagName,
    id: element.id || null,
    className: typeof element.className === 'string' ? element.className : null
  };
}

function captureGesturePointer(event) {
  const failures = [];
  for (const element of pointerCaptureCandidates(event)) {
    try {
      element.setPointerCapture(event.pointerId);
      diagnostic('pet-gesture-pointer-captured', {
        pointerId: event.pointerId,
        element: describeCaptureElement(element)
      });
      return element;
    } catch (error) {
      failures.push({
        element: describeCaptureElement(element),
        error: describeError(error)
      });
    }
  }
  diagnostic('pet-gesture-pointer-capture-failed', {
    pointerId: event.pointerId,
    failures
  });
  return null;
}

function releaseGesturePointer(gesture) {
  const pointerId = gesture.pointerId;
  const element = gesture.captureElement;
  try {
    if (element?.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
      diagnostic('pet-gesture-pointer-released', {
        pointerId,
        element: describeCaptureElement(element)
      });
    }
  } catch (error) {
    diagnostic('pet-gesture-pointer-release-failed', {
      pointerId,
      element: describeCaptureElement(element),
      error: describeError(error)
    });
  }
}

function beginPetGesture(hit, headHit, event, source) {
  if (!hit || event.button !== 0) return false;
  if (activePetGesture?.pointerId === event.pointerId) return true;

  activePetGesture = {
    pointerId: event.pointerId,
    source,
    hit,
    headHit,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    dragging: false,
    moveSamples: 0,
    captureElement: null
  };
  event.preventDefault();
  event.stopPropagation();
  activePetGesture.captureElement = captureGesturePointer(event);
  pointerOverPet = true;
  window.petHost.setPointerOverPet(true);
  setPixelDragHotspot(true, event);
  diagnostic('pet-gesture-started', {
    source,
    hit,
    headHit: headHit || null,
    autoEnabled,
    captureElement: describeCaptureElement(activePetGesture.captureElement),
    ...pointerScreenPoint(event)
  });
  return true;
}

function updatePetGesture(event) {
  if (!activePetGesture || event.pointerId !== activePetGesture.pointerId) return false;
  event.preventDefault();
  event.stopPropagation();
  const distance = Math.hypot(
    event.clientX - activePetGesture.startClientX,
    event.clientY - activePetGesture.startClientY
  );
  activePetGesture.moveSamples += 1;
  if (activePetGesture.moveSamples <= PET_GESTURE_MOVE_LOG_LIMIT) {
    diagnostic('pet-gesture-move-sample', {
      source: activePetGesture.source,
      sample: activePetGesture.moveSamples,
      distance: Math.round(distance * 10) / 10,
      threshold: PET_DRAG_START_THRESHOLD_CSS_PX,
      dragging: activePetGesture.dragging,
      ...pointerScreenPoint(event)
    });
  }

  if (!activePetGesture.dragging && distance >= PET_DRAG_START_THRESHOLD_CSS_PX) {
    activePetGesture.dragging = true;
    diagnostic('pet-gesture-drag-threshold-met', {
      source: activePetGesture.source,
      distance: Math.round(distance * 10) / 10,
      threshold: PET_DRAG_START_THRESHOLD_CSS_PX,
      hit: activePetGesture.hit,
      headHit: activePetGesture.headHit || null,
      startScreenX: Math.round(activePetGesture.startScreenX),
      startScreenY: Math.round(activePetGesture.startScreenY),
      ...pointerScreenPoint(event)
    });
    window.petHost.beginPixelDrag({
      source: activePetGesture.source,
      hit: activePetGesture.hit,
      headHit: activePetGesture.headHit || null,
      screenX: activePetGesture.startScreenX,
      screenY: activePetGesture.startScreenY,
      clientX: activePetGesture.startClientX,
      clientY: activePetGesture.startClientY
    });
  }

  if (activePetGesture.dragging) {
    window.petHost.movePixelDrag({
      source: activePetGesture.source,
      ...pointerScreenPoint(event)
    });
    return true;
  }

  return true;
}

function finishPetGesture(event, cancelled = false) {
  if (!activePetGesture || event.pointerId !== activePetGesture.pointerId) return false;
  const gesture = activePetGesture;
  activePetGesture = null;
  releaseGesturePointer(gesture);
  event.preventDefault();
  event.stopPropagation();

  if (gesture.dragging) {
    window.petHost.endPixelDrag({
      source: gesture.source,
      cancelled,
      ...pointerScreenPoint(event)
    });
    diagnostic('pet-gesture-drag-ended', {
      source: gesture.source,
      cancelled,
      ...pointerScreenPoint(event)
    });
    pointerOverPet = false;
    window.petHost.setPointerOverPet(false);
    setPixelDragHotspot(false, null);
    return true;
  }

  if (!cancelled && gesture.headHit) {
    requestHeadInteract(gesture.headHit, event, `${gesture.source}-pointerup`);
  } else {
    diagnostic('pet-gesture-click-ignored', {
      source: gesture.source,
      cancelled,
      reason: gesture.headHit ? 'cancelled' : 'not-head',
      hit: gesture.hit,
      ...pointerScreenPoint(event)
    });
  }
  pointerOverPet = false;
  window.petHost.setPointerOverPet(false);
  setPixelDragHotspot(false, null);
  return true;
}

function setPixelDragHotspot(active, event) {
  petPixelDragHotspot.classList.toggle('is-active', active);
  if (active && event) {
    petPixelDragHotspot.style.left = `${event.clientX}px`;
    petPixelDragHotspot.style.top = `${event.clientY}px`;
  }
}

function isPointerOverPet(event) {
  if (autoEnabled) {
    lastAutoPetHit = hitTestPetPixels(event, { headOnly: false });
    lastAutoHeadHit = !focusModeEnabled && lastAutoPetHit ? headHitFromPetHit(lastAutoPetHit) : null;
    setPixelDragHotspot(Boolean(lastAutoPetHit), event);
    return Boolean(lastAutoPetHit);
  }

  const hit = pixelHitTestPet(event);
  setPixelDragHotspot(Boolean(hit), event);
  return Boolean(hit);
}

function updatePointerMode(target, event) {
  if (activePetGesture) {
    if (!pointerOverPet) {
      pointerOverPet = true;
      window.petHost.setPointerOverPet(true);
    }
    return;
  }

  const overControls = !controlsHidden && Boolean(target && target.closest && target.closest('#size-controls'));
  if (overControls !== pointerOverControls) {
    pointerOverControls = overControls;
    window.petHost.setPointerOverControls(overControls);
  }

  if (overControls || !event) {
    setPixelDragHotspot(false, null);
    lastAutoPetHit = null;
    lastAutoHeadHit = null;
  }
  const overPet = overControls ? false : (event ? isPointerOverPet(event) : false);
  if (overPet !== pointerOverPet) {
    pointerOverPet = overPet;
    window.petHost.setPointerOverPet(overPet);
  }
}

function setControlsHidden(hidden, options = {}) {
  controlsHidden = hidden;
  if (hidden) setControlsPanelOpen(false);
  controlsElement.classList.toggle('is-hidden', hidden);
  document.body.classList.toggle('controls-hidden', hidden);
  if (options.notifyHost !== false) window.petHost.setControlsHidden(hidden);
  updatePointerMode(null, null);
}

document.addEventListener('mousemove', (event) => updatePointerMode(event.target, event));
document.addEventListener('mouseleave', () => {
  lastAutoPetHit = null;
  lastAutoHeadHit = null;
  updatePointerMode(null, null);
});
controlsElement.addEventListener('pointerenter', () => {
  setPixelDragHotspot(false, null);
  pointerOverControls = true;
  window.petHost.setPointerOverControls(true);
});
controlsElement.addEventListener('pointerleave', () => {
  pointerOverControls = false;
  window.petHost.setPointerOverControls(false);
});
controlsElement.addEventListener('pointerdown', () => {
  setPixelDragHotspot(false, null);
  pointerOverControls = true;
  window.petHost.setPointerOverControls(true);
});
document.addEventListener('pointerdown', (event) => {
  if (!autoEnabled || event.button !== 0) return;
  if (!controlsHidden && event.target?.closest?.('#size-controls')) return;

  const hit = hitTestPetPixels(event, { headOnly: false });
  const headHit = resolveHeadHitForPointerDown(hit, 'document-pointerdown');
  beginPetGesture(hit, headHit, event, 'document-pointerdown');
}, true);
petPixelDragHotspot.addEventListener('pointerdown', (event) => {
  if (!autoEnabled || event.button !== 0) return;
  const hit = hitTestPetPixels(event, { headOnly: false }) || lastAutoPetHit;
  const headHit = resolveHeadHitForPointerDown(hit, 'hotspot-pointerdown');
  beginPetGesture(hit, headHit, event, 'hotspot-pointerdown');
});
petPixelDragHotspot.addEventListener('click', (event) => {
  if (!autoEnabled || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
});
document.addEventListener('pointermove', updatePetGesture, true);
document.addEventListener('pointerup', (event) => finishPetGesture(event, false), true);
document.addEventListener('pointercancel', (event) => finishPetGesture(event, true), true);
petPixelDragHotspot.addEventListener('pointerdown', (event) => {
  if (autoEnabled || event.button !== 0 || !pointerOverPet) return;
  const hit = pixelHitTestPet(event);
  diagnostic('manual-pixel-drag-pointerdown', {
    hit: hit || null,
    x: Math.round(event.clientX),
    y: Math.round(event.clientY)
  });
  beginPetGesture(hit, null, event, 'manual-hotspot-pointerdown');
});
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (controlsHidden) setControlsHidden(false);
  else window.petHost.showMenu();
});
document.addEventListener('click', (event) => {
  if (!controlsPanelOpen) return;
  if (event.target?.closest?.('#size-controls')) return;
  setControlsPanelOpen(false);
});

window.petHost.onBehavior(render);
window.petHost.onScale((scale, layout = {}) => {
  petStageElement.style.setProperty('--pet-scale', scale);
  if (typeof layout.controlTop === 'number') {
    const controlTop = `${layout.controlTop}px`;
    if (controlsElement.style.getPropertyValue('--control-top') !== controlTop) {
      controlsElement.style.setProperty('--control-top', controlTop);
    }
  }
  if (typeof layout.controlLeft === 'number') {
    const controlLeft = `${layout.controlLeft}px`;
    if (controlsElement.style.getPropertyValue('--control-left') !== controlLeft) {
      controlsElement.style.setProperty('--control-left', controlLeft);
    }
  }
  const sizeLabel = `${Math.round(scale * 100)}%`;
  const sizeReset = document.querySelector('#size-reset');
  if (sizeReset.textContent !== sizeLabel) sizeReset.textContent = sizeLabel;
});
window.petHost.onCharacterDistance((layout) => {
  if (!layout || typeof layout.inset !== 'number' || typeof layout.distance !== 'number') return;
  petStageElement.style.setProperty('--pet-slot-inset', `${layout.inset}px`);
  document.querySelector('#distance-reset').textContent = `${Math.round(layout.distance * 100)}%`;
  diagnostic('character-distance-rendered', layout);
});

document.querySelector('#size-down').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'size-down', action: 'scale-down' });
  window.petHost.adjustScale('down');
});
document.querySelector('#size-reset').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'size-reset', action: 'scale-reset' });
  window.petHost.adjustScale('reset');
});
document.querySelector('#size-up').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'size-up', action: 'scale-up' });
  window.petHost.adjustScale('up');
});
document.querySelector('#distance-down').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'distance-down', action: 'distance-down' });
  window.petHost.adjustCharacterDistance('down');
});
document.querySelector('#distance-reset').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'distance-reset', action: 'distance-reset' });
  window.petHost.adjustCharacterDistance('reset');
});
document.querySelector('#distance-up').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'distance-up', action: 'distance-up' });
  window.petHost.adjustCharacterDistance('up');
});
document.querySelector('#speed-down').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'speed-down', action: 'speed-down' });
  window.petHost.adjustMoveSpeed('down');
});
document.querySelector('#speed-reset').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'speed-reset', action: 'speed-reset' });
  window.petHost.adjustMoveSpeed('reset');
});
document.querySelector('#speed-up').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'speed-up', action: 'speed-up' });
  window.petHost.adjustMoveSpeed('up');
});
activitySlider.addEventListener('input', () => {
  updateBehaviorActivityControl(Number(activitySlider.value) / 100);
});
activitySlider.addEventListener('change', () => {
  const activity = Number(activitySlider.value) / 100;
  diagnostic('control-slider-change', {
    id: 'activity-slider',
    behaviorActivity: activity
  });
  window.petHost.setBehaviorActivity(activity);
});
document.querySelector('#controls-hide').addEventListener('click', () => setControlsHidden(true));
controlsToggleButton.addEventListener('click', (event) => {
  event.stopPropagation();
  setControlsPanelOpen(!controlsPanelOpen);
});
panelFocusModeButton.title = FOCUS_MODE_TOOLTIP;
panelFocusModeButton.addEventListener('click', () => window.petHost.toggleFocusMode());
panelToggleAutoButton.addEventListener('click', () => window.petHost.toggleAuto());
document.querySelector('#panel-change-characters').addEventListener('click', () => openProfileDialog());
document.querySelector('#panel-feedback').addEventListener('click', () => openFeedbackDialog());
document.querySelector('#panel-quit').addEventListener('click', () => window.petHost.quit());
document.querySelector('#panel-reset-settings').addEventListener('click', () => {
  diagnostic('control-button-click', { id: 'panel-reset-settings', action: 'reset-settings' });
  window.petHost.resetSettings();
});
document.querySelector('#pet-pause').addEventListener('click', () => window.petHost.toggleAuto());
profileDialogCancelButton.addEventListener('click', closeProfileDialog);
profileDialogCloseButton.addEventListener('click', () => window.petHost.quit());
document.querySelector('#profile-dialog-apply').addEventListener('click', () => applySelectedProfiles());
prtsLookupButton.addEventListener('click', () => lookupPritsOperator());
prtsOperatorNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') lookupPritsOperator();
});
prtsOutfitSelect.addEventListener('change', () => setPritsDownloadBusy(false));
prtsDownloadButton.addEventListener('click', () => downloadPritsProfile());
prtsCancelDownloadButton.addEventListener('click', () => window.petHost.cancelPritsDownload());
prtsOpenDebugButton.addEventListener('click', async () => {
  const result = await window.petHost.openLastPritsDebug();
  setProfileDialogStatus(result?.ok
    ? '已在资源管理器中定位查询诊断文件，请将该 JSON 文件发给我。'
    : (result?.error || '无法打开查询诊断文件。'), !result?.ok);
});
feedbackDialogCloseButton.addEventListener('click', closeFeedbackDialog);
feedbackExportButton.addEventListener('click', async () => {
  feedbackExportButton.disabled = true;
  setFeedbackDialogStatus('正在生成诊断包…');
  const result = await window.petHost.exportFeedbackDiagnostics();
  feedbackExportButton.disabled = false;
  setFeedbackDialogStatus(result?.ok
    ? `诊断包已生成，并已在资源管理器中定位：${result.fileName}`
    : (result?.error || '无法导出诊断包。'), !result?.ok);
});
feedbackOpenFormButton.addEventListener('click', async () => {
  const result = await window.petHost.openFeedbackForm();
  if (!result?.ok) setFeedbackDialogStatus(result?.error || '无法打开问卷星。', true);
});
window.petHost.onAutoState((enabled) => {
  autoEnabled = enabled;
  const pauseButton = document.querySelector('#pet-pause');
  pauseButton.textContent = enabled ? 'Ⅱ' : '▶';
  pauseButton.title = enabled ? '暂停（Ctrl+Alt+P）' : '继续（Ctrl+Alt+P）';
  panelToggleAutoButton.textContent = enabled ? '暂停自动行动' : '恢复自动行动';
  document.body.classList.toggle('manual-mode', !enabled);
  lastAutoHeadHit = null;
  if (enabled) setPixelDragHotspot(false, null);
  if (enabled && pointerOverPet) {
    pointerOverPet = false;
    window.petHost.setPointerOverPet(false);
  }
  if (!enabled && controlsHidden) setControlsHidden(false);
  diagnostic('auto-state-rendered', {
    enabled,
    controlsHidden
  });
});
window.petHost.onMoveSpeed((speed) => {
  document.querySelector('#speed-reset').textContent = `${speed.toFixed(2).replace(/0$/, '')}×`;
});
window.petHost.onBehaviorActivity((activity) => {
  updateBehaviorActivityControl(activity);
  diagnostic('behavior-activity-rendered', { activity });
});
window.petHost.onFocusMode((enabled) => {
  focusModeEnabled = Boolean(enabled);
  panelFocusModeButton.textContent = focusModeEnabled ? '关闭专注模式' : '开启专注模式';
  panelFocusModeButton.title = FOCUS_MODE_TOOLTIP;
  panelFocusModeButton.classList.toggle('is-active', focusModeEnabled);
  lastAutoHeadHit = null;
  diagnostic('focus-mode-rendered', { enabled: focusModeEnabled });
});
window.petHost.onControlsHiddenState((hidden) => {
  setControlsHidden(Boolean(hidden), { notifyHost: false });
  diagnostic('controls-hidden-rendered', { hidden: Boolean(hidden) });
});
window.petHost.onProfilesState((state) => applyProfileState(state, 'ipc'));
window.petHost.onPritsDownloadProgress((progress) => renderPritsProgress(progress));
window.petHost.onShowControls(() => setControlsHidden(false));

diagnostic('renderer-script-start', {
  location: window.location.href
});
attachSlotDiagnostics();
window.petHost.setPointerOverControls(false);
window.petHost.setPointerOverPet(false);
render({ name: '默认站立', states: { silverash: 'default', gnosis: 'default' }, facing: 'right' });
(async () => {
  try {
    const state = await window.petHost.getProfiles();
    if (state) applyProfileState(state, 'initial-request');
    else initializeTransparentModels();
  } catch (error) {
    diagnostic('profiles-initial-load-failed', { error: describeError(error) });
    initializeTransparentModels();
  }
})();
