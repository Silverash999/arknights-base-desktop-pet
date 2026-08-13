const { app, BrowserWindow, globalShortcut, ipcMain, Menu, net, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { ProfileManager } = require('./main/profile-manager');
const { AssetDownloadManager } = require('./main/asset-download-manager');
const { ASSET_HOSTS, PritsProvider } = require('./main/prts-provider');
const { redactDiagnosticJsonl, assertNoUnredactedUserPaths } = require('./main/diagnostic-export');
const { buildOfficialOperatorIdMap, parseOperatorIdCache, serializeOperatorIdCache } = require('./main/operator-id-cache');
const { getBundledOperatorIdMap } = require('./main/bundled-operator-id-map');

const WINDOW_SIZE = { width: 660, height: 470 };
const MOVE_STEP_PIXELS = 1;
// Keep native transparent-window relocation in step with the 30 FPS model
// renderer. Faster repositioning causes visible DWM composition flashes.
const MOVE_INTERVAL = 34;
const DEFAULT_MOVE_SPEED = 1.5;
const MIN_MOVE_SPEED = 0.25;
const MAX_MOVE_SPEED = 2;
const MOVE_SPEED_STEP = 0.25;
const MAX_VERTICAL_SLOPE = Math.tan(Math.PI / 6);
const MIN_AUTO_TRAVEL_X = 140;
const MAX_AUTO_TRAVEL_X = 360;
const UPHILL_TRAVEL_CHANCE = 0.18;
const DEFAULT_SCALE = 0.6;
const MIN_SCALE = 0.4;
const MAX_SCALE = 1.45;
const SCALE_STEP = 0.1;
const DEFAULT_CHARACTER_DISTANCE = 0.5;
const MIN_CHARACTER_DISTANCE = 0.1;
const MAX_CHARACTER_DISTANCE = 1.5;
const CHARACTER_DISTANCE_STEP = 0.1;
const CHARACTER_BASE_SLOT_GAP = 110;
const CHARACTER_SLOT_SPAN = 230;
const DEFAULT_BEHAVIOR_ACTIVITY = 0.5;
const MIN_BEHAVIOR_ACTIVITY = 0;
const MAX_BEHAVIOR_ACTIVITY = 1;
const CONTROL_TOP = 8;
const CONTROL_EXPANDED_WIDTH = 268;
const CONTROL_HORIZONTAL_MARGIN = 8;
const CONTROL_EXPANDED_HEIGHT = 366;
const MIN_WINDOW_SIZE = { width: 300, height: 366 };
const MANUAL_CLAMP_DEBOUNCE_MS = 160;
const BOTTOM_DOCK_TOLERANCE_PX = 1;
const FOCUS_EDGE_ZONE_MIN_WIDTH = 16;
const FOCUS_EDGE_ZONE_MAX_WIDTH = 64;
const FOCUS_EDGE_ZONE_RATIO = 0.04;
const DEFAULT_MOUSE_IDLE_SLEEP_THRESHOLD_MS = 10 * 60 * 1000;
const MOUSE_IDLE_SLEEP_THRESHOLD_MS = Math.max(
  10 * 1000,
  Number(process.env.PET_MOUSE_IDLE_SLEEP_MS) || DEFAULT_MOUSE_IDLE_SLEEP_THRESHOLD_MS
);
const MOUSE_IDLE_POLL_INTERVAL_MS = 1000;
const MOUSE_IDLE_WAKE_RELAX_MS = 1400;
const SETTINGS_FILE_NAME = 'settings.json';
const SETTINGS_VERSION = 3;
const FEEDBACK_FORM_URL = 'https://v.wjx.cn/vm/mnMSsjW.aspx';
const FEEDBACK_DIAGNOSTIC_LIMIT = 20;

let petWindow;
let behaviorController;
let profileManager;
let assetDownloadManager;
let prtsProvider;
let activePritsDownload;
let activePritsLookupTrace;
let lastPritsLookupDebugPath;
let officialOperatorIdMapPromise;
let localOperatorIdMap;
let petScale = DEFAULT_SCALE;
let petMoveSpeed = DEFAULT_MOVE_SPEED;
let petCharacterDistance = DEFAULT_CHARACTER_DISTANCE;
let petBehaviorActivity = DEFAULT_BEHAVIOR_ACTIVITY;
let focusModeEnabled = false;
let controlTop = CONTROL_TOP;
let controlLeft;

const LEGACY_USER_DATA_DIRECTORY_NAME = 'silverash-gnosis-desktop-pet';

function migrateLegacyUserData() {
  const target = app.getPath('userData');
  const legacy = path.join(app.getPath('appData'), LEGACY_USER_DATA_DIRECTORY_NAME);
  if (path.resolve(target) === path.resolve(legacy) || !fs.existsSync(legacy) || fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(legacy, target, { recursive: true, force: false, errorOnExist: true });
  console.info(`[migration] Copied existing desktop-pet data from ${legacy} to ${target}.`);
  return true;
}
let recoveryTimer;
let isQuitting = false;
let pointerOverControls = false;
let pointerOverPet = false;
let configurationModeActive = false;
let resumeAutoAfterConfiguration = false;
let controlsHidden = false;
let manualClampTimer;
let pixelDragState;
let mouseIdleMonitorTimer;
let lastCursorPoint;
let lastMouseActivityAt = Date.now();
let lastMouseIdleDeferredLogAt = 0;
let diagnosticLogPath;
let diagnosticLogFailureReported = false;
let behaviorSequence = 0;
let setPositionDiagnosticTimer;
const PIXEL_DRAG_MOVE_LOG_LIMIT = 4;
const PIXEL_DRAG_MOVE_LOG_INTERVAL = 30;
const setPositionStats = {
  count: 0,
  mismatchCount: 0,
  lastSample: null
};

const restPlans = [
  { name: '并肩放松', weight: 45, duration: [4000, 7000], states: { silverash: 'Relax', gnosis: 'Relax' } },
  { name: '并排坐下', weight: 30, duration: [10000, 18000], states: { silverash: 'Sit', gnosis: 'Sit' } },
  { name: '一起休眠', weight: 20, duration: [24000, 42000], states: { silverash: 'Sleep', gnosis: 'Sleep' } },
  { name: '双人互动', weight: 5, duration: [3200, 4600], states: { silverash: 'Interact', gnosis: 'Interact' }, isInteraction: true }
];
const REST_SETTLE_BEFORE_SIT_MS = [900, 1300];
const REST_SETTLE_BEFORE_SLEEP_MS = [1000, 1500];
const SLEEP_SIT_TRANSITION_MS = [1500, 10000];
const REST_GROUND_SETTLE_AFTER_MOVE_MS = 1200;
const HEAD_CLICK_INTERACT_RECOVERY_MS = [1200, 1800];
const REST_LOOKBACK_DELAY_MS = [900, 2200];
const REST_LOOKBACK_DURATION_MS = [5000, 15000];
const REST_LOOKBACK_RETURN_BUFFER_MS = 700;
const relaxStates = { silverash: 'Relax', gnosis: 'Relax' };
const interactStates = { silverash: 'Interact', gnosis: 'Interact' };
const sitStates = { silverash: 'Sit', gnosis: 'Sit' };

function randomBetween(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function weightedRandom(items) {
  const totalWeight = items.reduce((total, item) => total + Math.max(0, item.weight || 1), 0);
  if (totalWeight <= 0) return items[0] || null;

  let roll = Math.random() * totalWeight;
  for (const item of items) {
    roll -= Math.max(0, item.weight || 1);
    if (roll <= 0) return item;
  }
  return items[items.length - 1] || null;
}

function planUsesSingleState(plan, state) {
  const states = Object.values(plan?.states || {});
  return states.length > 0 && states.every((entry) => entry === state);
}

function roundHundredth(value) {
  return Math.round(value * 100) / 100;
}

function behaviorActivityShift() {
  return petBehaviorActivity - DEFAULT_BEHAVIOR_ACTIVITY;
}

function behaviorDurationMultiplier() {
  const quietBoost = Math.max(0, -behaviorActivityShift()) * 1.6;
  const activeTrim = Math.max(0, behaviorActivityShift()) * 0.2;
  return Math.max(0.9, Math.min(1.8, 1 + quietBoost - activeTrim));
}

function behaviorDurationRange(range) {
  const multiplier = behaviorDurationMultiplier();
  const min = Math.max(900, Math.round(range[0] * multiplier));
  const max = Math.max(min, Math.round(range[1] * multiplier));
  return [min, max];
}

function behaviorDelay(baseMs, quietExtraMs, activeReductionMs) {
  const shift = behaviorActivityShift();
  const delta = shift < 0
    ? -shift * 2 * quietExtraMs
    : -shift * 2 * activeReductionMs;
  return Math.max(500, Math.round(baseMs + delta));
}

function afterMoveRestDelay() {
  return behaviorDelay(REST_GROUND_SETTLE_AFTER_MOVE_MS, 1600, 500);
}

function automaticInteractionCooldownMs() {
  return behaviorDelay(60000, 45000, 12000);
}

function restPlanForActivity(plan) {
  let multiplier = 1;
  const shift = behaviorActivityShift();

  if (plan.isInteraction) multiplier = 1 + shift * 1.6;
  else if (planUsesSingleState(plan, 'Sleep')) multiplier = 1 - shift * 0.8;
  else if (planUsesSingleState(plan, 'Sit')) multiplier = 1 - shift * 0.5;
  else if (planUsesSingleState(plan, 'Relax')) multiplier = 1 - shift * 0.2;

  return {
    ...plan,
    baseWeight: plan.weight || 1,
    weight: roundHundredth(Math.max(0.1, (plan.weight || 1) * multiplier))
  };
}

function scaledWindowSize() {
  return {
    width: Math.max(MIN_WINDOW_SIZE.width, Math.round(WINDOW_SIZE.width * petScale)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.round(WINDOW_SIZE.height * petScale))
  };
}

function clampControlTop(top, windowHeight = scaledWindowSize().height) {
  const maxTop = Math.max(CONTROL_TOP, windowHeight - CONTROL_EXPANDED_HEIGHT);
  return Math.round(Math.max(CONTROL_TOP, Math.min(top, maxTop)));
}

function defaultControlLeft(windowWidth = scaledWindowSize().width) {
  return Math.round(windowWidth / 2);
}

function clampControlLeft(left, windowWidth = scaledWindowSize().width) {
  const panelHalfWidth = Math.round(CONTROL_EXPANDED_WIDTH / 2);
  const inset = Math.min(
    Math.max(CONTROL_HORIZONTAL_MARGIN, panelHalfWidth + CONTROL_HORIZONTAL_MARGIN),
    Math.round(windowWidth / 2)
  );
  const maxLeft = Math.max(inset, windowWidth - inset);
  return Math.round(Math.max(inset, Math.min(left, maxLeft)));
}

function clampPosition(area, width, height, x, y) {
  const maxX = Math.max(area.x, area.x + area.width - width);
  const maxY = Math.max(area.y, area.y + area.height - height);
  return {
    x: Math.round(Math.max(area.x, Math.min(x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(y, maxY)))
  };
}

function focusEdgeZoneWidth(area, windowWidth) {
  const availableWidth = Math.max(0, area.width - windowWidth);
  if (availableWidth <= 0) return 0;
  const preferredWidth = Math.max(
    FOCUS_EDGE_ZONE_MIN_WIDTH,
    Math.min(FOCUS_EDGE_ZONE_MAX_WIDTH, area.width * FOCUS_EDGE_ZONE_RATIO)
  );
  return Math.round(Math.min(availableWidth, preferredWidth));
}

function focusEdgeRanges(area, windowWidth) {
  const maxX = Math.max(area.x, area.x + area.width - windowWidth);
  const zoneWidth = focusEdgeZoneWidth(area, windowWidth);
  return {
    zoneWidth,
    left: {
      min: area.x,
      max: Math.min(maxX, area.x + zoneWidth)
    },
    right: {
      min: Math.max(area.x, maxX - zoneWidth),
      max: maxX
    }
  };
}

function clampToRange(value, range) {
  return Math.round(Math.max(range.min, Math.min(value, range.max)));
}

function focusEdgeTarget(area, bounds, destination = 'alternate') {
  const grounding = getGroundingMetrics(bounds, area);
  const ranges = focusEdgeRanges(area, bounds.width);
  const leftCenter = (ranges.left.min + ranges.left.max) / 2;
  const rightCenter = (ranges.right.min + ranges.right.max) / 2;
  const inLeft = bounds.x >= ranges.left.min && bounds.x <= ranges.left.max;
  const inRight = bounds.x >= ranges.right.min && bounds.x <= ranges.right.max;
  let range;

  if (destination === 'nearest' || destination === 'bottom') {
    range = Math.abs(bounds.x - leftCenter) <= Math.abs(bounds.x - rightCenter) ? ranges.left : ranges.right;
  } else if (inLeft) {
    range = ranges.left;
  } else if (inRight) {
    range = ranges.right;
  } else {
    range = Math.abs(bounds.x - leftCenter) <= Math.abs(bounds.x - rightCenter) ? ranges.left : ranges.right;
  }

  const jitter = range.max > range.min ? randomBetween(range.min, range.max) : range.min;
  return {
    x: clampToRange(jitter, range),
    y: grounding.bottomY,
    focusEdge: {
      range,
      ranges,
      inLeft,
      inRight,
      destination
    }
  };
}

function getGroundingMetrics(bounds, area, tolerance = BOTTOM_DOCK_TOLERANCE_PX) {
  const workBottom = area.y + area.height;
  const windowBottom = bounds.y + bounds.height;
  const bottomY = workBottom - bounds.height;
  const distanceToBottom = workBottom - windowBottom;
  const absDistanceToBottom = Math.abs(distanceToBottom);
  return {
    workBottom,
    windowBottom,
    bottomY,
    distanceToBottom,
    absDistanceToBottom,
    tolerance,
    isAtBottom: absDistanceToBottom <= tolerance
  };
}

function getDiagnosticLogPath() {
  if (diagnosticLogPath) return diagnosticLogPath;
  const diagnosticsDir = process.env.PET_DIAGNOSTICS_DIR || path.join(app.getPath('userData'), 'diagnostics');
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  diagnosticLogPath = path.join(diagnosticsDir, `render-diagnostics-${stamp}.jsonl`);
  return diagnosticLogPath;
}

function writeDiagnostic(event, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    pid: process.pid,
    source: 'main',
    event,
    details
  };
  const line = JSON.stringify(entry);
  console.log(`[pet-diagnostic] ${line}`);
  try {
    fs.appendFileSync(getDiagnosticLogPath(), `${line}\n`, 'utf8');
  } catch (error) {
    if (!diagnosticLogFailureReported) {
      diagnosticLogFailureReported = true;
      console.warn('[pet-diagnostic] unable to write diagnostic log', error);
    }
  }
}

function feedbackDiagnosticsDirectory() {
  return path.join(app.getPath('userData'), 'diagnostics');
}

function createFeedbackDiagnosticsPackage() {
  const directory = feedbackDiagnosticsDirectory();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirectory = path.join(directory, 'feedback-packages');
  const output = path.join(outputDirectory, `arknights-base-pet-diagnostics-${stamp}.zip`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const profiles = profileManager?.getState();
  const manifest = {
    format: 1,
    exportedAt: new Date().toISOString(),
    app: { name: app.getName(), version: app.getVersion(), platform: process.platform, arch: process.arch },
    settings: { scale: petScale, moveSpeed: petMoveSpeed, characterDistance: petCharacterDistance, behaviorActivity: petBehaviorActivity, focusModeEnabled },
    activePair: profiles?.activePair || null,
    activeProfiles: Object.fromEntries(Object.entries(profiles?.activeProfiles || {}).map(([slot, profile]) => [slot, profile ? {
      id: profile.id,
      operator: profile.operator,
      runtime: profile.runtime || null
    } : null]))
  };
  const logs = fs.existsSync(directory)
    ? fs.readdirSync(directory)
      .filter((name) => /^render-diagnostics-.*\.jsonl$/i.test(name))
      .map((name) => path.join(directory, name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
      .slice(0, FEEDBACK_DIAGNOSTIC_LIMIT)
      .map((file) => ({
        name: path.basename(file),
        content: redactDiagnosticJsonl(fs.readFileSync(file, 'utf8'), {
          userDataPath: app.getPath('userData'),
          appDataPath: app.getPath('appData')
        })
      }))
    : [];
  const packageContent = `${JSON.stringify(manifest, null, 2)}\n\n--- recent diagnostic logs ---\n\n${logs.map((log) => `### ${log.name}\n${log.content}`).join('\n')}`;
  assertNoUnredactedUserPaths(packageContent);
  // Electron already ships Chromium; writing a minimal store-only ZIP avoids a new dependency.
  const archive = createStoredZip('diagnostics.txt', Buffer.from(packageContent, 'utf8'));
  fs.writeFileSync(output, archive);
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(fileName, content) {
  const name = Buffer.from(fileName, 'utf8');
  const checksum = crc32(content);
  const local = Buffer.alloc(30 + name.length + content.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  content.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function settingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

function currentSettings() {
  return {
    version: SETTINGS_VERSION,
    scale: petScale,
    moveSpeed: petMoveSpeed,
    characterDistance: petCharacterDistance,
    behaviorActivity: petBehaviorActivity,
    focusModeEnabled,
    controlsHidden,
    controlTop,
    controlLeft: controlLeft ?? defaultControlLeft()
  };
}

function applySettings(settings = {}) {
  petScale = Math.round(clampNumber(settings.scale, MIN_SCALE, MAX_SCALE, DEFAULT_SCALE) * 100) / 100;
  petMoveSpeed = Math.round(clampNumber(settings.moveSpeed, MIN_MOVE_SPEED, MAX_MOVE_SPEED, DEFAULT_MOVE_SPEED) * 100) / 100;
  petCharacterDistance = Math.round(
    clampNumber(settings.characterDistance, MIN_CHARACTER_DISTANCE, MAX_CHARACTER_DISTANCE, DEFAULT_CHARACTER_DISTANCE) * 100
  ) / 100;
  petBehaviorActivity = roundHundredth(
    clampNumber(settings.behaviorActivity, MIN_BEHAVIOR_ACTIVITY, MAX_BEHAVIOR_ACTIVITY, DEFAULT_BEHAVIOR_ACTIVITY)
  );
  focusModeEnabled = Boolean(settings.focusModeEnabled);
  controlsHidden = Boolean(settings.controlsHidden);
  controlTop = clampControlTop(clampNumber(settings.controlTop, CONTROL_TOP, scaledWindowSize().height, CONTROL_TOP));
  controlLeft = clampControlLeft(
    clampNumber(settings.controlLeft, 0, scaledWindowSize().width, defaultControlLeft()),
    scaledWindowSize().width
  );
}

function loadUserSettings() {
  const file = settingsPath();
  if (!fs.existsSync(file)) {
    writeDiagnostic('settings-load-skipped', { reason: 'missing', file });
    return;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    applySettings(settings);
    writeDiagnostic('settings-loaded', {
      file,
      settings: currentSettings()
    });
  } catch (error) {
    writeDiagnostic('settings-load-failed', {
      file,
      error: String(error)
    });
  }
}

function saveUserSettings(reason = 'unknown') {
  if (!app.isReady()) return;
  const file = settingsPath();
  const tempFile = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tempFile, `${JSON.stringify(currentSettings(), null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, file);
    writeDiagnostic('settings-saved', {
      reason,
      file,
      settings: currentSettings()
    });
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {
      // Best effort cleanup only.
    }
    writeDiagnostic('settings-save-failed', {
      reason,
      file,
      error: String(error)
    });
  }
}

function recordSetPosition(controller, before, requested, after) {
  const delta = { x: after.x - before.x, y: after.y - before.y };
  const expectedFacing = delta.x < 0 ? 'left' : delta.x > 0 ? 'right' : controller.facing;
  const mismatch = controller.autoEnabled && delta.x !== 0 && controller.facing !== expectedFacing;
  setPositionStats.count += 1;
  if (mismatch) setPositionStats.mismatchCount += 1;
  setPositionStats.lastSample = {
    requested,
    before: { x: before.x, y: before.y, width: before.width, height: before.height },
    after: { x: after.x, y: after.y, width: after.width, height: after.height },
    delta,
    facing: controller.facing,
    expectedFacing,
    autoEnabled: controller.autoEnabled,
    movementId: controller.currentMovement?.id ?? null
  };
  if (mismatch) {
    writeDiagnostic('movement-facing-mismatch', setPositionStats.lastSample);
  }
  return { delta, expectedFacing, mismatch };
}

function startSetPositionDiagnostics() {
  if (setPositionDiagnosticTimer) clearInterval(setPositionDiagnosticTimer);
  setPositionDiagnosticTimer = setInterval(() => {
    const bounds = petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null;
    writeDiagnostic('set-position-rate', {
      callsPerSecond: setPositionStats.count,
      mismatchCount: setPositionStats.mismatchCount,
      lastSample: setPositionStats.lastSample,
      currentBounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
      autoEnabled: behaviorController?.autoEnabled ?? null,
      movementId: behaviorController?.currentMovement?.id ?? null,
      facing: behaviorController?.facing ?? null
    });
    setPositionStats.count = 0;
    setPositionStats.mismatchCount = 0;
    setPositionStats.lastSample = null;
  }, 1000);
  setPositionDiagnosticTimer.unref?.();
}

function samePoint(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function noteMouseActivity(source = 'unknown', details = {}) {
  lastMouseActivityAt = Date.now();
  if (behaviorController?.isIdleSleeping()) {
    writeDiagnostic('mouse-idle-wake-activity', {
      source,
      details,
      cursor: lastCursorPoint,
      thresholdMs: MOUSE_IDLE_SLEEP_THRESHOLD_MS
    });
    behaviorController.wakeFromIdleSleep(source, details);
  }
}

function checkMouseIdle() {
  if (isQuitting || !petWindow || petWindow.isDestroyed()) return;
  let point;
  try {
    point = screen.getCursorScreenPoint();
  } catch (error) {
    writeDiagnostic('mouse-idle-cursor-read-failed', { error: String(error) });
    return;
  }

  if (!samePoint(point, lastCursorPoint)) {
    lastCursorPoint = point;
    noteMouseActivity('global-cursor-move', { point });
    return;
  }

  const idleMs = Date.now() - lastMouseActivityAt;
  if (idleMs < MOUSE_IDLE_SLEEP_THRESHOLD_MS) return;
  if (pixelDragState || pointerOverControls) {
    if (Date.now() - lastMouseIdleDeferredLogAt > 60000) {
      lastMouseIdleDeferredLogAt = Date.now();
      writeDiagnostic('mouse-idle-sleep-deferred', {
        reason: pixelDragState ? 'pixel-drag-active' : 'pointer-over-controls',
        idleMs,
        thresholdMs: MOUSE_IDLE_SLEEP_THRESHOLD_MS
      });
    }
    return;
  }
  behaviorController?.triggerIdleSleep({
    idleMs,
    thresholdMs: MOUSE_IDLE_SLEEP_THRESHOLD_MS,
    cursor: point
  });
}

function startMouseIdleMonitor() {
  if (mouseIdleMonitorTimer) clearInterval(mouseIdleMonitorTimer);
  lastMouseActivityAt = Date.now();
  try {
    lastCursorPoint = screen.getCursorScreenPoint();
  } catch {
    lastCursorPoint = null;
  }
  writeDiagnostic('mouse-idle-monitor-started', {
    thresholdMs: MOUSE_IDLE_SLEEP_THRESHOLD_MS,
    pollIntervalMs: MOUSE_IDLE_POLL_INTERVAL_MS,
    cursor: lastCursorPoint
  });
  mouseIdleMonitorTimer = setInterval(checkMouseIdle, MOUSE_IDLE_POLL_INTERVAL_MS);
  mouseIdleMonitorTimer.unref?.();
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const size = scaledWindowSize();
  const start = clampPosition(workArea, size.width, size.height, workArea.x + workArea.width - size.width - 36, workArea.y + workArea.height - size.height);
  petWindow = new BrowserWindow({
    ...size,
    ...start,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  writeDiagnostic('window-created', {
    diagnosticLogPath: getDiagnosticLogPath(),
    bounds: petWindow.getBounds(),
    transparent: true,
    frame: false
  });
}

const PRTS_BROWSER_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8'
});
const OFFICIAL_CHARACTER_TABLE_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/character_table.json';
const OFFICIAL_CHARACTER_TABLE_HOST = 'raw.githubusercontent.com';
const OPERATOR_ID_CACHE_FILE_NAME = 'operator-id-cache.json';
const OPERATOR_ID_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function tracePritsLookup(event, details = {}) {
  if (!activePritsLookupTrace) return;
  activePritsLookupTrace.events.push({ at: new Date().toISOString(), event, details });
}

async function chromiumFetch(urlText, {
  signal,
  accept = PRTS_BROWSER_HEADERS.Accept,
  timeoutMs = 8000,
  maxAttempts = 2,
  method = 'GET'
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    tracePritsLookup('request-attempt', { url: urlText, attempt, maxAttempts, timeoutMs });
    const timeoutController = new AbortController();
    let timedOut = false;
    const abortForCaller = () => timeoutController.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    if (signal) signal.addEventListener('abort', abortForCaller, { once: true });
    try {
      const response = await net.fetch(urlText, {
        signal: timeoutController.signal,
        method,
        headers: { ...PRTS_BROWSER_HEADERS, Accept: accept }
      });
      if (!response.ok) {
        tracePritsLookup('request-http-error', { url: urlText, attempt, status: response.status });
        throw new Error(`HTTP 状态码：${response.status}`);
      }
      const finalUrl = new URL(response.url || urlText);
      if (finalUrl.protocol !== 'https:' || ![...ASSET_HOSTS, 'prts.wiki', OFFICIAL_CHARACTER_TABLE_HOST].includes(finalUrl.hostname)) {
        throw new Error(`请求被重定向到未允许的站点：${finalUrl.hostname}`);
      }
      tracePritsLookup('request-success', { url: urlText, attempt, finalUrl: finalUrl.href, status: response.status });
      return response;
    } catch (error) {
      lastError = timedOut ? new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`) : error;
      tracePritsLookup('request-failed', { url: urlText, attempt, error: lastError.message || String(lastError) });
      if (signal?.aborted) throw new Error('下载已取消。');
      if (attempt < maxAttempts) await delay(attempt * 500);
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abortForCaller);
    }
  }
  throw new Error(`PRTS 请求失败（已尝试 ${maxAttempts} 次）：${lastError?.message || lastError}`);
}

async function chromiumRequestText(urlText) {
  const isOperatorIdMap = urlText.includes('GetNpcKey');
  const response = await chromiumFetch(urlText, isOperatorIdMap
    ? { timeoutMs: 3000, maxAttempts: 1 }
    : undefined);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) throw new Error('PRTS 返回内容过大。');
  return text;
}

function operatorIdCachePath() {
  return path.join(app.getPath('userData'), OPERATOR_ID_CACHE_FILE_NAME);
}

function loadOperatorIdCache() {
  try {
    const source = fs.readFileSync(operatorIdCachePath(), 'utf8');
    return parseOperatorIdCache(JSON.parse(source));
  } catch {
    return null;
  }
}

function saveOperatorIdCache(mapping) {
  try {
    fs.writeFileSync(operatorIdCachePath(), `${JSON.stringify(serializeOperatorIdCache(mapping))}\n`, 'utf8');
  } catch (error) {
    writeDiagnostic('operator-id-cache-write-failed', { error: String(error) });
  }
}

function getLocalOperatorIdMap() {
  if (localOperatorIdMap) return localOperatorIdMap;
  localOperatorIdMap = getBundledOperatorIdMap();
  const cached = loadOperatorIdCache();
  if (cached) {
    for (const [name, id] of cached.mapping) localOperatorIdMap.set(name, id);
  }
  return localOperatorIdMap;
}

async function getOfficialOperatorIdMap() {
  if (officialOperatorIdMapPromise) return officialOperatorIdMapPromise;
  officialOperatorIdMapPromise = (async () => {
    const localMapping = getLocalOperatorIdMap();
    const cached = loadOperatorIdCache();
    const cacheAgeMs = cached ? Date.now() - cached.fetchedAt : null;
    if (cached && cacheAgeMs >= 0 && cacheAgeMs < OPERATOR_ID_CACHE_MAX_AGE_MS) {
      writeDiagnostic('operator-id-cache-hit', { entries: cached.mapping.size, ageHours: Math.round(cacheAgeMs / 3_600_000) });
      return localMapping;
    }
    try {
      const response = await chromiumFetch(OFFICIAL_CHARACTER_TABLE_URL, { timeoutMs: 45000, maxAttempts: 2 });
      const source = await response.text();
      if (Buffer.byteLength(source, 'utf8') > 20 * 1024 * 1024) throw new Error('干员编号表内容过大。');
      const mapping = buildOfficialOperatorIdMap(JSON.parse(source));
      if (mapping.size < 100) throw new Error('干员编号表格式异常。');
      saveOperatorIdCache(mapping);
      for (const [name, id] of mapping) localMapping.set(name, id);
      writeDiagnostic('operator-id-cache-refreshed', { entries: mapping.size });
      return localMapping;
    } catch (error) {
      if (cached) {
        writeDiagnostic('operator-id-cache-offline-fallback', {
          entries: cached.mapping.size,
          ageDays: Math.round(cacheAgeMs / 86_400_000),
          error: String(error)
        });
        return localMapping;
      }
      if (localMapping.size >= 100) return localMapping;
      throw error;
    }
  })().catch((error) => {
    officialOperatorIdMapPromise = undefined;
    throw error;
  });
  return officialOperatorIdMapPromise;
}

async function lookupOfficialOperatorId(name) {
  const requestedName = String(name || '').trim();
  const localId = getLocalOperatorIdMap().get(requestedName);
  if (localId) {
    // Refresh in the background; do not make ordinary existing-character
    // queries wait for a remote mirror.
    getOfficialOperatorIdMap().catch((error) => writeDiagnostic('operator-id-background-refresh-failed', { error: String(error) }));
    return localId;
  }
  const mapping = await getOfficialOperatorIdMap();
  return mapping.get(requestedName) || null;
}

async function chromiumDownloadFile(urlText, destination, options) {
  // A partially received asset may otherwise be retained by Chromium's cache.
  // Give each integrity retry a fresh URL while preserving the PRTS asset path.
  const downloadUrl = new URL(urlText);
  downloadUrl.searchParams.set('_petDownload', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const response = await chromiumFetch(downloadUrl.href, { signal: options.signal, accept: '*/*', timeoutMs: 30000, maxAttempts: 3 });
  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader.trim())
    ? Number(contentLengthHeader)
    : null;
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    throw new Error(`下载文件超过大小上限（${Math.round(options.maxBytes / 1024 / 1024)} MB）。`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const handle = fs.openSync(destination, 'wx');
  let receivedBytes = 0;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('PRTS 下载响应不包含文件内容。');
    while (true) {
      if (options.signal?.aborted) throw new Error('下载已取消。');
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      receivedBytes += chunk.length;
      if (receivedBytes > options.maxBytes) throw new Error(`下载文件超过大小上限（${Math.round(options.maxBytes / 1024 / 1024)} MB）。`);
      fs.writeSync(handle, chunk);
      options.onProgress?.({ receivedBytes, totalBytes: Number.isFinite(contentLength) ? contentLength : null });
    }
    if (Number.isFinite(contentLength) && receivedBytes !== contentLength) {
      throw new Error(`下载文件长度不完整：预期 ${contentLength} 字节，实际 ${receivedBytes} 字节。`);
    }
    return { bytes: receivedBytes, finalUrl: response.url || urlText };
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    fs.closeSync(handle);
  }
}

function discoverOperatorIdWithPritsPage(nameInput) {
  const name = String(nameInput || '').trim();
  const pageUrl = `https://prts.wiki/w/${encodeURIComponent(name)}`;
  const partition = `temp:pet-prts-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const discoverySession = session.fromPartition(partition);
  const modelUrlPattern = /\/assets\/char_spine\/(char_\d+_[a-z0-9_]+)\/meta\.json(?:[?#].*)?$/i;

  return new Promise((resolve, reject) => {
    let discoveryWindow;
    let settled = false;
    let timer;
    const finish = (error, operatorId) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      discoverySession.webRequest.onBeforeRequest(null);
      if (discoveryWindow && !discoveryWindow.isDestroyed()) discoveryWindow.destroy();
      tracePritsLookup(error ? 'browser-discovery-failed' : 'browser-discovery-success', {
        name,
        pageUrl,
        operatorId: operatorId || null,
        error: error?.message || null
      });
      if (error) reject(error);
      else resolve(operatorId);
    };

    discoverySession.webRequest.onBeforeRequest({ urls: ['https://torappu.prts.wiki/assets/char_spine/*/meta.json*'] }, (details) => {
      const match = details.url.match(modelUrlPattern);
      if (match) {
        tracePritsLookup('browser-model-request-seen', { url: details.url });
        finish(null, match[1]);
      }
    });
    timer = setTimeout(() => finish(new Error('PRTS 页面未在限定时间内请求干员模型。')), 35000);

    discoveryWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    discoveryWindow.webContents.once('did-finish-load', () => {
      tracePritsLookup('browser-page-loaded', { name, pageUrl });
      // The page lazy-loads the model viewer only after its "干员模型" heading
      // enters the viewport. It is not necessarily at the very bottom: the
      // navigation/footer sits after it. Locate the heading and scroll that
      // exact block into view, mirroring the user's browser operation.
      const scrollModelSection = `(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.nodeValue && node.nodeValue.trim() === '干员模型') {
            const element = node.parentElement;
            if (element) {
              element.scrollIntoView({ block: 'center', behavior: 'instant' });
              return { found: true, tag: element.tagName };
            }
          }
        }
        return { found: false };
      })()`;
      discoveryWindow.webContents.executeJavaScript(scrollModelSection)
        .then((result) => tracePritsLookup('browser-model-section-scrolled', result || {}))
        .catch((error) => tracePritsLookup('browser-model-section-scroll-failed', { error: error.message || String(error) }));
    });
    discoveryWindow.webContents.once('did-fail-load', (_event, code, description) => {
      finish(new Error(`PRTS 页面加载失败：${description || code}`));
    });
    tracePritsLookup('browser-discovery-started', { name, pageUrl });
    discoveryWindow.loadURL(pageUrl, { userAgent: PRTS_BROWSER_HEADERS['User-Agent'] }).catch((error) => finish(error));
  });
}

function sendBehavior(name, states, facing = 'right', context = {}) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const payload = {
    sequence: ++behaviorSequence,
    sentAt: new Date().toISOString(),
    name,
    states,
    facing,
    ...context
  };
  writeDiagnostic('behavior-ipc-send', payload);
  petWindow.webContents.send('pet:behavior', payload);
}

function sendScale() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:scale', petScale, {
    controlTop,
    controlLeft: controlLeft ?? defaultControlLeft()
  });
}

function sendAutoState(enabled) {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:auto-state', enabled);
}

function sendMoveSpeed() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:move-speed', petMoveSpeed);
}

function sendBehaviorActivity() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:behavior-activity', petBehaviorActivity);
}

function sendFocusMode() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:focus-mode', focusModeEnabled);
}

function sendControlsHiddenState() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:controls-hidden-state', controlsHidden);
}

function sendProfileState(state = profileManager?.getState()) {
  if (!petWindow || petWindow.isDestroyed() || !state) return;
  petWindow.webContents.send('pet:profiles-state', state);
}

function sendPritsDownloadProgress(progress) {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:prts-download-progress', progress);
}

function characterDistanceLayout() {
  const slotGap = CHARACTER_BASE_SLOT_GAP * petCharacterDistance;
  const inset = Math.round((CHARACTER_SLOT_SPAN - slotGap) / 2);
  return {
    distance: petCharacterDistance,
    inset: Math.max(0, Math.min(Math.round(CHARACTER_SLOT_SPAN / 2), inset))
  };
}

function sendCharacterDistance() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send('pet:character-distance', characterDistanceLayout());
}

function sendAllSettings() {
  sendScale();
  sendMoveSpeed();
  sendBehaviorActivity();
  sendCharacterDistance();
  sendFocusMode();
  sendControlsHiddenState();
  sendProfileState();
}

function toggleFocusMode() {
  focusModeEnabled = !focusModeEnabled;
  writeDiagnostic('focus-mode-changed', {
    enabled: focusModeEnabled,
    bounds: petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null
  });
  saveUserSettings('focus-mode');
  sendFocusMode();
  if (focusModeEnabled && behaviorController?.autoEnabled && !behaviorController.isIdleSleeping()) {
    behaviorController.startMove('nearest', { reason: 'focus-mode-enabled' });
  }
}

function showControls(source = 'unknown') {
  if (!petWindow || petWindow.isDestroyed()) return;
  controlsHidden = false;
  pointerOverControls = false;
  pointerOverPet = false;
  updateMouseInteractivity();
  saveUserSettings('show-controls');
  writeDiagnostic('controls-show-requested', { source });
  petWindow.webContents.send('pet:show-controls');
  petWindow.showInactive();
}

function updateMouseInteractivity() {
  if (!petWindow || petWindow.isDestroyed()) return;
  // A setup/change-character dialog is a normal application form, not part
  // of the click-through pet surface. Keep the whole window interactive so
  // text inputs can reliably receive focus and keyboard events.
  const shouldCaptureMouse = configurationModeActive || pointerOverControls || pointerOverPet;
  petWindow.setIgnoreMouseEvents(!shouldCaptureMouse, { forward: true });
  writeDiagnostic('mouse-interactivity-updated', {
    pointerOverControls,
    pointerOverPet,
    configurationModeActive,
    autoEnabled: behaviorController?.autoEnabled ?? null,
    captureMouse: shouldCaptureMouse
  });
}

function setConfigurationMode(active, reason = 'renderer') {
  const next = Boolean(active);
  if (configurationModeActive === next) {
    updateMouseInteractivity();
    return;
  }
  configurationModeActive = next;
  if (next) {
    resumeAutoAfterConfiguration = Boolean(behaviorController?.autoEnabled);
    if (resumeAutoAfterConfiguration) behaviorController.pause();
  } else if (resumeAutoAfterConfiguration) {
    resumeAutoAfterConfiguration = false;
    behaviorController?.start();
  }
  writeDiagnostic('configuration-mode-changed', {
    active: configurationModeActive,
    reason,
    resumeAutoAfterConfiguration
  });
  updateMouseInteractivity();
}

function setPointerOverControls(isOverControls) {
  pointerOverControls = isOverControls;
  updateMouseInteractivity();
}

function setPointerOverPet(isOverPet) {
  pointerOverPet = isOverPet;
  updateMouseInteractivity();
}

function pointFromDragDetails(details = {}) {
  const screenX = Number(details.screenX);
  const screenY = Number(details.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
  return { x: Math.round(screenX), y: Math.round(screenY) };
}

function beginPixelDrag(details = {}) {
  noteMouseActivity('pixel-drag-start', details);
  if (!petWindow || petWindow.isDestroyed()) return;
  const point = pointFromDragDetails(details);
  if (!point) {
    writeDiagnostic('pixel-drag-ignored', { reason: 'invalid-start-point', details });
    return;
  }
  const bounds = petWindow.getBounds();
  pixelDragState = {
    startPoint: point,
    startBounds: bounds,
    latestPoint: point,
    moveSamples: 0,
    details
  };
  writeDiagnostic('pixel-drag-started', {
    point,
    bounds,
    details,
    autoEnabled: behaviorController?.autoEnabled ?? null
  });
  if (behaviorController?.autoEnabled) behaviorController.pause();
  pointerOverPet = true;
  updateMouseInteractivity();
}

function updatePixelDrag(details = {}) {
  noteMouseActivity('pixel-drag-move', details);
  if (!pixelDragState || !petWindow || petWindow.isDestroyed()) return;
  const point = pointFromDragDetails(details);
  if (!point) return;
  pixelDragState.latestPoint = point;
  pixelDragState.moveSamples += 1;
  const size = scaledWindowSize();
  const targetX = pixelDragState.startBounds.x + (point.x - pixelDragState.startPoint.x);
  const targetY = pixelDragState.startBounds.y + (point.y - pixelDragState.startPoint.y);
  const position = {
    x: Math.round(targetX),
    y: Math.round(targetY)
  };
  if (behaviorController) {
    behaviorController.isProgrammaticMove = true;
    behaviorController.programmaticMoveUntil = Date.now() + 120;
  }
  try {
    petWindow.setBounds({ ...position, ...size }, false);
  } finally {
    if (behaviorController) behaviorController.isProgrammaticMove = false;
  }
  if (pixelDragState.moveSamples <= PIXEL_DRAG_MOVE_LOG_LIMIT || pixelDragState.moveSamples % PIXEL_DRAG_MOVE_LOG_INTERVAL === 0) {
    writeDiagnostic('pixel-drag-moved', {
      sample: pixelDragState.moveSamples,
      point,
      target: { x: Math.round(targetX), y: Math.round(targetY) },
      position,
      size,
      unclampedManualDrag: true,
      details
    });
  }
}

function endPixelDrag(details = {}) {
  noteMouseActivity('pixel-drag-end', details);
  if (!pixelDragState) return;
  const bounds = petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null;
  writeDiagnostic('pixel-drag-ended', {
    startPoint: pixelDragState.startPoint,
    latestPoint: pixelDragState.latestPoint,
    bounds,
    details
  });
  pixelDragState = undefined;
}

function applyScale(action) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const previousScale = petScale;
  if (action === 'up') petScale += SCALE_STEP;
  else if (action === 'down') petScale -= SCALE_STEP;
  else if (action === 'reset') petScale = DEFAULT_SCALE;
  else return;

  petScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(petScale * 100) / 100));
  if (petScale === previousScale) {
    writeDiagnostic('scale-unchanged', { action, scale: petScale });
    sendScale();
    return;
  }
  const oldBounds = petWindow.getBounds();
  const oldControlScreenY = oldBounds.y + controlTop;
  const oldControlScreenX = oldBounds.x + (controlLeft ?? defaultControlLeft(oldBounds.width));
  const size = scaledWindowSize();
  const display = screen.getDisplayNearestPoint({ x: oldBounds.x, y: oldBounds.y });
  const targetX = oldControlScreenX - defaultControlLeft(size.width);
  const position = clampPosition(display.workArea, size.width, size.height, targetX, oldBounds.y + oldBounds.height - size.height);
  controlTop = clampControlTop(oldControlScreenY - position.y, size.height);
  controlLeft = clampControlLeft(oldControlScreenX - position.x, size.width);
  const nextBounds = { ...position, ...size };
  const boundsChanged = oldBounds.x !== nextBounds.x
    || oldBounds.y !== nextBounds.y
    || oldBounds.width !== nextBounds.width
    || oldBounds.height !== nextBounds.height;
  writeDiagnostic('scale-applied', {
    action,
    scale: petScale,
    oldBounds: { x: oldBounds.x, y: oldBounds.y, width: oldBounds.width, height: oldBounds.height },
    newBounds: nextBounds,
    boundsChanged,
    controlTop,
    controlLeft,
    oldControlScreenX,
    oldControlScreenY
  });
  if (boundsChanged) {
    if (behaviorController) {
      behaviorController.isProgrammaticMove = true;
      behaviorController.programmaticMoveUntil = Date.now() + 120;
    }
    try {
      petWindow.setBounds(nextBounds, false);
    } finally {
      if (behaviorController) behaviorController.isProgrammaticMove = false;
    }
  }
  saveUserSettings('scale');
  sendScale();
}

function applyMoveSpeed(action) {
  if (action === 'up') petMoveSpeed += MOVE_SPEED_STEP;
  else if (action === 'down') petMoveSpeed -= MOVE_SPEED_STEP;
  else if (action === 'reset') petMoveSpeed = DEFAULT_MOVE_SPEED;
  else return;

  petMoveSpeed = Math.max(MIN_MOVE_SPEED, Math.min(MAX_MOVE_SPEED, Math.round(petMoveSpeed * 100) / 100));
  writeDiagnostic('move-speed-applied', { action, moveSpeed: petMoveSpeed });
  saveUserSettings('move-speed');
  sendMoveSpeed();
}

function applyBehaviorActivity(value) {
  const nextActivity = roundHundredth(
    clampNumber(value, MIN_BEHAVIOR_ACTIVITY, MAX_BEHAVIOR_ACTIVITY, DEFAULT_BEHAVIOR_ACTIVITY)
  );
  const previousActivity = petBehaviorActivity;
  petBehaviorActivity = nextActivity;
  writeDiagnostic('behavior-activity-applied', {
    previousActivity,
    behaviorActivity: petBehaviorActivity,
    durationMultiplier: behaviorDurationMultiplier(),
    afterMoveRestDelayMs: afterMoveRestDelay(),
    automaticInteractionCooldownMs: automaticInteractionCooldownMs()
  });
  saveUserSettings('behavior-activity');
  sendBehaviorActivity();
}

function applyCharacterDistance(action) {
  if (action === 'up') petCharacterDistance += CHARACTER_DISTANCE_STEP;
  else if (action === 'down') petCharacterDistance -= CHARACTER_DISTANCE_STEP;
  else if (action === 'reset') petCharacterDistance = DEFAULT_CHARACTER_DISTANCE;
  else return;

  petCharacterDistance = Math.max(
    MIN_CHARACTER_DISTANCE,
    Math.min(MAX_CHARACTER_DISTANCE, Math.round(petCharacterDistance * 100) / 100)
  );
  writeDiagnostic('character-distance-applied', characterDistanceLayout());
  saveUserSettings('character-distance');
  sendCharacterDistance();
}

function resetUserSettings() {
  const previousSettings = currentSettings();
  petScale = DEFAULT_SCALE;
  petMoveSpeed = DEFAULT_MOVE_SPEED;
  petCharacterDistance = DEFAULT_CHARACTER_DISTANCE;
  petBehaviorActivity = DEFAULT_BEHAVIOR_ACTIVITY;
  focusModeEnabled = false;
  controlsHidden = false;
  controlTop = CONTROL_TOP;
  controlLeft = defaultControlLeft();

  if (petWindow && !petWindow.isDestroyed()) {
    const oldBounds = petWindow.getBounds();
    const size = scaledWindowSize();
    controlLeft = defaultControlLeft(size.width);
    const display = screen.getDisplayNearestPoint({ x: oldBounds.x, y: oldBounds.y });
    const grounding = getGroundingMetrics({ ...oldBounds, ...size }, display.workArea);
    const targetX = oldBounds.x + Math.round((oldBounds.width - size.width) / 2);
    const position = clampPosition(display.workArea, size.width, size.height, targetX, grounding.bottomY);
    if (behaviorController) {
      behaviorController.isProgrammaticMove = true;
      behaviorController.programmaticMoveUntil = Date.now() + 120;
    }
    try {
      petWindow.setBounds({ ...position, ...size }, false);
    } finally {
      if (behaviorController) behaviorController.isProgrammaticMove = false;
    }
    pointerOverControls = true;
    pointerOverPet = false;
    updateMouseInteractivity();
  }

  writeDiagnostic('settings-reset', {
    previousSettings,
    settings: currentSettings(),
    bounds: petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null
  });
  saveUserSettings('reset-settings');
  sendAllSettings();
}

function scheduleManualClamp() {
  if (isQuitting || !petWindow || petWindow.isDestroyed()) return;
  if (manualClampTimer) clearTimeout(manualClampTimer);
  manualClampTimer = setTimeout(() => {
    manualClampTimer = undefined;
    if (behaviorController?.isProgrammaticMove || Date.now() < (behaviorController?.programmaticMoveUntil || 0)) return;
    if (!petWindow || petWindow.isDestroyed()) return;
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const expectedSize = scaledWindowSize();
    const position = clampPosition(display.workArea, expectedSize.width, expectedSize.height, bounds.x, bounds.y);
    if (position.x !== bounds.x || position.y !== bounds.y || bounds.width !== expectedSize.width || bounds.height !== expectedSize.height) {
      writeDiagnostic('manual-clamp-position', {
        before: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        requested: position,
        expectedSize,
        autoEnabled: behaviorController?.autoEnabled ?? null
      });
      petWindow.setBounds({ ...position, ...expectedSize }, false);
    }
  }, MANUAL_CLAMP_DEBOUNCE_MS);
  manualClampTimer.unref?.();
}

function recoverRenderer() {
  if (isQuitting || recoveryTimer || !petWindow || petWindow.isDestroyed()) return;
  writeDiagnostic('renderer-recovery-scheduled');
  behaviorController?.clearTimers();
  recoveryTimer = setTimeout(() => {
    recoveryTimer = undefined;
    if (isQuitting || !petWindow || petWindow.isDestroyed()) return;
    writeDiagnostic('renderer-reload-ignoring-cache');
    petWindow.webContents.reloadIgnoringCache();
    petWindow.showInactive();
  }, 800);
}

class BehaviorController {
  constructor(window) {
    this.window = window;
    this.autoEnabled = true;
    this.moveTimer = undefined;
    this.nextTimer = undefined;
    this.facing = 'right';
    this.nextInteractionAt = 0;
    this.isProgrammaticMove = false;
    this.programmaticMoveUntil = 0;
    this.nextMovementId = 0;
    this.currentMovement = null;
    this.lastRestPlanName = null;
    this.idleSleepActive = false;
    this.idleSleepPreparing = false;
  }

  clearTimers() {
    if (this.moveTimer) clearInterval(this.moveTimer);
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.moveTimer = undefined;
    this.nextTimer = undefined;
  }

  show(name, states, context = {}) {
    sendBehavior(name, states, this.facing, context);
  }

  isIdleSleeping() {
    return this.idleSleepActive || this.idleSleepPreparing;
  }

  updateFacingFromHorizontalDelta(deltaX, reason, sample = {}) {
    if (!this.autoEnabled || !this.currentMovement || deltaX === 0) return false;
    const expectedFacing = deltaX < 0 ? 'left' : 'right';
    if (this.facing === expectedFacing) return false;

    const previousFacing = this.facing;
    this.facing = expectedFacing;
    this.currentMovement.facing = expectedFacing;
    writeDiagnostic('movement-facing-corrected', {
      reason,
      previousFacing,
      facing: expectedFacing,
      movementId: this.currentMovement.id,
      deltaX,
      sample
    });
    this.show('结伴移动', { silverash: 'Move', gnosis: 'Move' }, {
      movementId: this.currentMovement.id,
      facingCorrection: reason
    });
    return true;
  }

  setPosition(x, y) {
    const before = this.window.getBounds();
    const requested = { x: Math.round(x), y: Math.round(y) };
    const size = scaledWindowSize();
    this.updateFacingFromHorizontalDelta(requested.x - before.x, 'requested-position', {
      before: { x: before.x, y: before.y, width: before.width, height: before.height },
      requested
    });
    this.isProgrammaticMove = true;
    this.programmaticMoveUntil = Date.now() + 120;
    try {
      this.window.setBounds({ ...requested, ...size }, false);
    } finally {
      this.isProgrammaticMove = false;
    }
    const sample = recordSetPosition(this, before, requested, this.window.getBounds());
    this.updateFacingFromHorizontalDelta(sample.delta.x, 'actual-position', {
      before: { x: before.x, y: before.y, width: before.width, height: before.height },
      requested,
      after: this.window.getBounds()
    });
  }

  start() {
    this.clearTimers();
    this.autoEnabled = true;
    this.idleSleepActive = false;
    this.idleSleepPreparing = false;
    this.currentMovement = null;
    writeDiagnostic('auto-started', { facing: this.facing });
    sendAutoState(true);
    updateMouseInteractivity();
    this.show('准备出发', { silverash: 'Relax', gnosis: 'Relax' });
    this.nextTimer = setTimeout(() => this.startMove(), 1800);
  }

  pause() {
    this.clearTimers();
    this.autoEnabled = false;
    this.idleSleepActive = false;
    this.idleSleepPreparing = false;
    writeDiagnostic('auto-paused', {
      facing: this.facing,
      movementId: this.currentMovement?.id ?? null
    });
    this.currentMovement = null;
    sendAutoState(false);
    updateMouseInteractivity();
    this.show('暂停', { silverash: 'Relax', gnosis: 'Relax' });
  }

  toggle() {
    if (this.autoEnabled) this.pause();
    else this.start();
  }

  selectTravelTarget(bounds, area, destination) {
    const leftEdge = area.x;
    const rightEdge = area.x + area.width - bounds.width;
    const topEdge = area.y;
    const grounding = getGroundingMetrics(bounds, area);
    const bottomEdge = grounding.bottomY;
    if (focusModeEnabled) return focusEdgeTarget(area, bounds, destination);
    if (destination === 'bottom') return clampPosition(area, bounds.width, bounds.height, bounds.x, bottomEdge);

    const availableLeft = Math.max(0, bounds.x - leftEdge);
    const availableRight = Math.max(0, rightEdge - bounds.x);
    let direction;

    if (availableLeft < MIN_AUTO_TRAVEL_X && availableRight > 0) direction = 1;
    else if (availableRight < MIN_AUTO_TRAVEL_X && availableLeft > 0) direction = -1;
    else if (destination === 'nearest') direction = availableRight >= availableLeft ? 1 : -1;
    else direction = Math.random() < 0.5 ? -1 : 1;

    const maxDistanceInDirection = direction > 0 ? availableRight : availableLeft;
    const fallbackDistance = direction > 0 ? availableLeft : availableRight;
    if (maxDistanceInDirection < 1 && fallbackDistance > 0) direction *= -1;

    const maxDistance = Math.max(0, direction > 0 ? availableRight : availableLeft);
    const verticalDistanceToBottom = grounding.absDistanceToBottom;
    const neededForShallowReturn = destination === 'nearest'
      ? Math.ceil(verticalDistanceToBottom / MAX_VERTICAL_SLOPE)
      : 0;
    const desiredDistance = randomBetween(MIN_AUTO_TRAVEL_X, MAX_AUTO_TRAVEL_X);
    const plannedHorizontalDistance = Math.min(maxDistance, Math.max(MIN_AUTO_TRAVEL_X, neededForShallowReturn, desiredDistance));
    const targetX = bounds.x + direction * plannedHorizontalDistance;

    const horizontalDistance = Math.abs(targetX - bounds.x);
    // A pet that is not on the bottom edge must walk back down before it can
    // sit, sleep, or interact. From the ground it may occasionally walk up
    // first, still using a shallow diagonal path.
    const desiredY = destination !== 'nearest' && grounding.isAtBottom && Math.random() < UPHILL_TRAVEL_CHANCE
      ? topEdge
      : bottomEdge;
    const maximumVerticalDistance = horizontalDistance * MAX_VERTICAL_SLOPE;
    const verticalDelta = Math.max(-maximumVerticalDistance, Math.min(desiredY - bounds.y, maximumVerticalDistance));
    const targetY = bounds.y + verticalDelta;

    return clampPosition(area, bounds.width, bounds.height, targetX, targetY);
  }

  startMove(destination = 'alternate', options = {}) {
    if (!this.autoEnabled || this.window.isDestroyed()) return;
    this.clearTimers();
    const bounds = this.window.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const area = display.workArea;
    const grounding = getGroundingMetrics(bounds, area);
    const target = this.selectTravelTarget(bounds, area, destination);
    const deltaX = target.x - bounds.x;
    const deltaY = target.y - bounds.y;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      this.currentMovement = null;
      writeDiagnostic('movement-skipped', {
        reason: 'target-equals-current-position',
        bounds,
        target,
        destination,
        afterArrive: options.afterArrive || null
      });
      if (options.afterArrive === 'idle-sleep') {
        this.enterIdleSleep({ reason: 'target-equals-current-position' });
        return;
      }
      this.show('原地放松', { silverash: 'Relax', gnosis: 'Relax' });
      this.nextTimer = setTimeout(() => this.startRest(), afterMoveRestDelay());
      return;
    }

    if (deltaX !== 0) this.facing = deltaX > 0 ? 'right' : 'left';
    this.currentMovement = {
      id: ++this.nextMovementId,
      startedAt: new Date().toISOString(),
      destination,
      start: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      target,
      delta: { x: deltaX, y: deltaY },
      facing: this.facing,
      moveIntervalMs: MOVE_INTERVAL,
      moveStepPixels: MOVE_STEP_PIXELS,
      moveSpeed: petMoveSpeed,
      groundingAtStart: grounding,
      reason: options.reason || null,
      afterArrive: options.afterArrive || null
    };
    writeDiagnostic('movement-plan', this.currentMovement);
    this.show('结伴移动', { silverash: 'Move', gnosis: 'Move' }, { movementId: this.currentMovement.id });

    const travelDistance = Math.hypot(deltaX, deltaY);
    let travelled = 0;
    let previousPosition = { x: bounds.x, y: bounds.y };

    this.moveTimer = setInterval(() => {
      if (!this.autoEnabled || this.window.isDestroyed()) return this.clearTimers();
      travelled = Math.min(travelDistance, travelled + MOVE_STEP_PIXELS * petMoveSpeed);
      const progress = travelled / travelDistance;
      const position = clampPosition(area, bounds.width, bounds.height, bounds.x + deltaX * progress, bounds.y + deltaY * progress);
      if (position.x !== previousPosition.x || position.y !== previousPosition.y) {
        this.updateFacingFromHorizontalDelta(position.x - previousPosition.x, 'planned-step', {
          movementId: this.currentMovement?.id ?? null,
          previousPosition,
          nextPosition: position
        });
        this.setPosition(position.x, position.y);
        previousPosition = position;
      }
      if (progress === 1) {
        const finalBounds = this.window.getBounds();
        const finalDisplay = screen.getDisplayNearestPoint({ x: finalBounds.x, y: finalBounds.y });
        const finalGrounding = getGroundingMetrics(finalBounds, finalDisplay.workArea);
        writeDiagnostic('movement-complete', {
          movementId: this.currentMovement?.id ?? null,
          finalBounds,
          facing: this.facing,
          grounding: finalGrounding
        });
        const afterArrive = this.currentMovement?.afterArrive || null;
        const movementId = this.currentMovement?.id ?? null;
        this.clearTimers();
        if (afterArrive === 'idle-sleep') {
          this.currentMovement = null;
          this.enterIdleSleep({
            reason: 'arrived-after-idle-move',
            movementId,
            grounding: finalGrounding
          });
          return;
        }
        this.show('到达边缘', relaxStates, {
          movementId,
          groundedRest: finalGrounding.isAtBottom,
          behaviorActivity: petBehaviorActivity
        });
        this.currentMovement = null;
        this.nextTimer = setTimeout(() => this.startRest(), afterMoveRestDelay());
      }
    }, MOVE_INTERVAL);
  }

  forceMove() {
    this.autoEnabled = true;
    this.idleSleepActive = false;
    this.idleSleepPreparing = false;
    sendAutoState(true);
    updateMouseInteractivity();
    this.startMove();
  }

  triggerIdleSleep(details = {}) {
    if (!this.autoEnabled || this.window.isDestroyed()) {
      writeDiagnostic('mouse-idle-sleep-ignored', {
        reason: !this.autoEnabled ? 'auto-disabled' : 'window-destroyed',
        details
      });
      return;
    }
    if (this.isIdleSleeping()) return;
    if (pixelDragState) {
      writeDiagnostic('mouse-idle-sleep-ignored', {
        reason: 'pixel-drag-active',
        details
      });
      return;
    }

    this.clearTimers();
    this.currentMovement = null;
    this.idleSleepPreparing = true;
    this.nextInteractionAt = Date.now() + 60000;
    const grounding = this.getGrounding();
    writeDiagnostic('mouse-idle-sleep-triggered', {
      details,
      bounds: grounding.bounds,
      grounding: grounding.metrics,
      facing: this.facing
    });

    if (grounding.metrics.isAtBottom) {
      this.enterIdleSleep({ reason: 'already-at-bottom', details, grounding: grounding.metrics });
      return;
    }

    this.startMove('bottom', {
      reason: 'mouse-idle-sleep',
      afterArrive: 'idle-sleep'
    });
  }

  enterIdleSleep(context = {}) {
    if (!this.autoEnabled || this.window.isDestroyed()) return;
    const grounding = this.getGrounding();
    if (!grounding.metrics.isAtBottom) {
      writeDiagnostic('mouse-idle-sleep-needs-bottom', {
        context,
        bounds: grounding.bounds,
        grounding: grounding.metrics
      });
      this.idleSleepPreparing = true;
      this.startMove('bottom', {
        reason: 'mouse-idle-sleep-retry',
        afterArrive: 'idle-sleep'
      });
      return;
    }

    this.clearTimers();
    this.currentMovement = null;
    this.idleSleepPreparing = false;
    this.idleSleepActive = true;
    writeDiagnostic('mouse-idle-sleep-entered', {
      context,
      bounds: grounding.bounds,
      grounding: grounding.metrics,
      facing: this.facing
    });
    this.show('mouse-idle-sleep', { silverash: 'Sleep', gnosis: 'Sleep' }, {
      triggeredBy: 'mouse-idle',
      groundedRest: true
    });
  }

  wakeFromIdleSleep(source = 'unknown', details = {}) {
    if (!this.isIdleSleeping()) return false;
    const wasActive = this.idleSleepActive;
    const wasPreparing = this.idleSleepPreparing;
    this.clearTimers();
    this.currentMovement = null;
    this.idleSleepActive = false;
    this.idleSleepPreparing = false;
    const grounding = this.getGrounding();
    writeDiagnostic('mouse-idle-sleep-woke', {
      source,
      details,
      wasActive,
      wasPreparing,
      bounds: grounding.bounds,
      grounding: grounding.metrics,
      facing: this.facing
    });
    if (!this.autoEnabled || this.window.isDestroyed()) return true;
    this.show('mouse-idle-wake', relaxStates, {
      triggeredBy: 'mouse-activity',
      groundedRest: grounding.metrics.isAtBottom
    });
    this.nextTimer = setTimeout(() => {
      if (!this.autoEnabled || this.window.isDestroyed()) return;
      this.startMove();
    }, MOUSE_IDLE_WAKE_RELAX_MS);
    return true;
  }

  triggerInteractFromHeadClick(details = {}) {
    if (!this.autoEnabled || this.window.isDestroyed()) {
      writeDiagnostic('head-click-interact-ignored', {
        reason: !this.autoEnabled ? 'auto-disabled' : 'window-destroyed',
        details
      });
      return;
    }
    this.clearTimers();
    this.currentMovement = null;
    this.nextInteractionAt = Date.now() + 60000;
    const grounding = this.getGrounding();
    writeDiagnostic('head-click-interact-triggered', {
      details,
      bounds: grounding.bounds,
      grounding: grounding.metrics,
      facing: this.facing
    });
    this.show('点击互动', interactStates, {
      triggeredBy: 'head-click',
      groundedRest: true,
      forceAnimationRestart: true,
      interactionId: `head-click-${Date.now()}`
    });
    const interactionPlan = restPlans.find((plan) => plan.isInteraction);
    const duration = interactionPlan?.duration || [3200, 4600];
    this.nextTimer = setTimeout(() => {
      if (!this.autoEnabled || this.window.isDestroyed()) return;
      this.show('互动后放松', relaxStates, {
        triggeredBy: 'head-click',
        groundedRest: true
      });
      this.nextTimer = setTimeout(() => this.startMove(), randomBetween(...HEAD_CLICK_INTERACT_RECOVERY_MS));
    }, randomBetween(...duration));
  }

  startRest() {
    if (!this.autoEnabled || this.window.isDestroyed()) return;
    const grounding = this.getGrounding();
    writeDiagnostic('rest-grounding-check', {
      bounds: grounding.bounds,
      grounding: grounding.metrics,
      facing: this.facing
    });
    if (!grounding.metrics.isAtBottom) {
      writeDiagnostic('rest-deferred-until-bottom', {
        bounds: grounding.bounds,
        grounding: grounding.metrics,
        facing: this.facing
      });
      this.startMove('nearest');
      return;
    }
    const selection = this.selectRestPlan();
    const plan = selection.plan;
    if (!plan) {
      writeDiagnostic('rest-plan-unavailable', {
        grounding: grounding.metrics,
        previousPlan: this.lastRestPlanName
      });
      this.nextTimer = setTimeout(() => this.startMove(), randomBetween(1200, 1800));
      return;
    }
    this.lastRestPlanName = plan.name;
    writeDiagnostic('rest-plan-selected', {
      name: plan.name,
      states: plan.states,
      weight: plan.weight || 1,
      baseWeight: plan.baseWeight || plan.weight || 1,
      isInteraction: Boolean(plan.isInteraction),
      previousPlan: selection.previousPlan,
      candidateNames: selection.candidates.map((candidate) => candidate.name),
      totalWeight: selection.totalWeight,
      interactionAvailable: selection.interactionAvailable,
      behaviorActivity: petBehaviorActivity,
      durationMultiplier: behaviorDurationMultiplier(),
      grounding: grounding.metrics
    });
    if (plan.isInteraction) this.playInteraction(plan);
    else this.playPlan(plan);
  }

  selectRestPlan() {
    const now = Date.now();
    const previousPlan = this.lastRestPlanName;
    const interactionAvailable = now >= this.nextInteractionAt;
    let candidates = restPlans
      .map(restPlanForActivity)
      .filter((plan) => !plan.isInteraction || interactionAvailable);

    if (previousPlan && candidates.length > 1) {
      const nonRepeatingCandidates = candidates.filter((plan) => plan.name !== previousPlan);
      if (nonRepeatingCandidates.length > 0) candidates = nonRepeatingCandidates;
    }

    if (candidates.length === 0) {
      candidates = restPlans.map(restPlanForActivity).filter((plan) => !plan.isInteraction);
    }

    const totalWeight = candidates.reduce((total, candidate) => total + Math.max(0, candidate.weight || 1), 0);
    return {
      plan: weightedRandom(candidates),
      candidates,
      previousPlan,
      totalWeight,
      interactionAvailable
    };
  }

  playPlan(plan) {
    const transitionStages = this.restEntryStages(plan);
    if (transitionStages.length > 0) {
      writeDiagnostic('rest-transition-start', {
        plan: plan.name,
        stages: transitionStages.map((stage) => ({
          name: stage.name,
          states: stage.states,
          duration: stage.duration
        }))
      });
      this.playPlanTransition(plan, transitionStages, 0);
      return;
    }
    this.playPlanFinal(plan);
  }

  restEntryStages(plan) {
    const states = Object.values(plan.states || {});
    const singleState = states.length > 0 && states.every((state) => state === states[0])
      ? states[0]
      : null;

    if (singleState === 'Sleep') {
      return [
        { name: '休眠前站稳', states: relaxStates, duration: REST_SETTLE_BEFORE_SLEEP_MS },
        { name: '休眠前坐下', states: sitStates, duration: SLEEP_SIT_TRANSITION_MS }
      ];
    }

    if (singleState === 'Sit') {
      return [
        { name: '坐下前站稳', states: relaxStates, duration: REST_SETTLE_BEFORE_SIT_MS }
      ];
    }

    return [];
  }

  playPlanTransition(plan, stages, index) {
    const stage = stages[index];
    this.show(stage.name, stage.states, {
      transitionTo: plan.name,
      transitionStep: index + 1,
      transitionSteps: stages.length,
      groundedRest: true
    });
    const [min, max] = stage.duration;
    this.nextTimer = setTimeout(() => {
      if (!this.autoEnabled || this.window.isDestroyed()) return;
      if (index + 1 < stages.length) this.playPlanTransition(plan, stages, index + 1);
      else this.playPlanFinal(plan);
    }, randomBetween(min, max));
  }

  playPlanFinal(plan) {
    if (planUsesSingleState(plan, 'Relax') || planUsesSingleState(plan, 'Sit')) {
      this.playLookbackRestPlan(plan);
      return;
    }
    this.show(plan.name, plan.states, { groundedRest: true });
    const [min, max] = behaviorDurationRange(plan.duration);
    this.nextTimer = setTimeout(() => this.startMove(), randomBetween(min, max));
  }

  playLookbackRestPlan(plan) {
    const [min, max] = behaviorDurationRange(plan.duration);
    const lookbackDelay = randomBetween(...REST_LOOKBACK_DELAY_MS);
    const lookbackDuration = randomBetween(...REST_LOOKBACK_DURATION_MS);
    const plannedDuration = randomBetween(min, max);
    const totalDuration = Math.max(
      plannedDuration,
      lookbackDelay + lookbackDuration + REST_LOOKBACK_RETURN_BUFFER_MS
    );

    this.show(plan.name, plan.states, {
      groundedRest: true,
      lookbackPhase: 'base'
    });
    writeDiagnostic('rest-lookback-scheduled', {
      plan: plan.name,
      states: plan.states,
      facing: this.facing,
      plannedDuration,
      totalDuration,
      lookbackDelay,
      lookbackDuration
    });

    this.nextTimer = setTimeout(() => {
      if (!this.autoEnabled || this.window.isDestroyed()) return;
      this.show('rest-lookback', plan.states, {
        groundedRest: true,
        lookback: {
          enabled: true,
          phase: 'front-turn-back',
          durationMs: lookbackDuration
        }
      });
      this.nextTimer = setTimeout(() => {
        if (!this.autoEnabled || this.window.isDestroyed()) return;
        this.show(plan.name, plan.states, {
          groundedRest: true,
          lookbackPhase: 'return'
        });
        const remaining = Math.max(
          REST_LOOKBACK_RETURN_BUFFER_MS,
          totalDuration - lookbackDelay - lookbackDuration
        );
        this.nextTimer = setTimeout(() => this.startMove(), remaining);
      }, lookbackDuration);
    }, lookbackDelay);
  }

  playInteraction(plan) {
    this.nextInteractionAt = Date.now() + automaticInteractionCooldownMs();
    this.show('互动前放松', relaxStates, { groundedRest: true });
    this.nextTimer = setTimeout(() => {
      this.show(plan.name, plan.states, { groundedRest: true });
      const [min, max] = plan.duration;
      this.nextTimer = setTimeout(() => {
        this.show('互动后放松', relaxStates, { groundedRest: true });
        this.nextTimer = setTimeout(() => this.startMove(), randomBetween(3600, 5600));
      }, randomBetween(min, max));
    }, randomBetween(2400, 3800));
  }

  isDockedAtBoundary() {
    return this.getGrounding().metrics.isAtBottom;
  }

  getGrounding() {
    const bounds = this.window.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const area = display.workArea;
    return {
      bounds,
      area,
      metrics: getGroundingMetrics(bounds, area)
    };
  }
}

function showContextMenu() {
  const menu = Menu.buildFromTemplate([
    { label: behaviorController.autoEnabled ? '暂停自动行动' : '恢复自动行动', click: () => behaviorController.toggle() },
    { label: '立刻出发', click: () => behaviorController.forceMove() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  menu.popup({ window: petWindow });
}

app.whenReady().then(() => {
  migrateLegacyUserData();
  loadUserSettings();
  profileManager = new ProfileManager({
    userDataPath: app.getPath('userData'),
    appPath: app.getAppPath()
  });
  const profileState = profileManager.initialize();
  prtsProvider = new PritsProvider({
    request: chromiumRequestText,
    discoverOperatorId: discoverOperatorIdWithPritsPage,
    lookupOfficialOperatorId
  });
  assetDownloadManager = new AssetDownloadManager({
    downloadsPath: path.join(app.getPath('userData'), 'downloads'),
    profileManager,
    allowedHosts: ASSET_HOSTS,
    downloadFile: chromiumDownloadFile
  });
  writeDiagnostic('profiles-initialized', {
    activePair: profileState.activePair,
    profileCount: profileState.profiles.length
  });
  createWindow();
  behaviorController = new BehaviorController(petWindow);
  startSetPositionDiagnostics();
  startMouseIdleMonitor();
  petWindow.webContents.on('did-start-loading', () => writeDiagnostic('renderer-load-started'));
  petWindow.webContents.on('did-finish-load', () => {
    writeDiagnostic('renderer-load-finished');
    sendAllSettings();
    setPointerOverControls(false);
    setPointerOverPet(false);
    if (profileState.isSetupRequired) {
      // Do not start even one automatic movement before the initial setup UI
      // becomes visible. The configuration page is a stationary form.
      setConfigurationMode(true, 'initial-setup-required');
    } else {
      behaviorController.start();
    }
    petWindow.showInactive();
  });
  petWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeDiagnostic('renderer-load-failed', { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  petWindow.webContents.on('render-process-gone', (_event, details) => {
    writeDiagnostic('render-process-gone', details);
    recoverRenderer();
  });
  petWindow.on('unresponsive', () => writeDiagnostic('window-unresponsive'));
  petWindow.on('responsive', () => writeDiagnostic('window-responsive'));
  petWindow.webContents.on('context-menu', (event) => {
    if (!controlsHidden) return;
    event.preventDefault();
    showControls('renderer-context-menu');
  });
  petWindow.on('will-move', (event, newBounds) => {
    if (isQuitting) return;
    if (behaviorController?.isProgrammaticMove || Date.now() < (behaviorController?.programmaticMoveUntil || 0)) return;
    if (behaviorController?.autoEnabled) {
      writeDiagnostic('manual-drag-pauses-auto', {
        newBounds: newBounds ? { x: newBounds.x, y: newBounds.y, width: newBounds.width, height: newBounds.height } : null
      });
      behaviorController.pause();
    }
  });
  petWindow.on('move', () => {
    if (isQuitting || !petWindow || petWindow.isDestroyed()) return;
    if (behaviorController?.isProgrammaticMove || Date.now() < (behaviorController?.programmaticMoveUntil || 0)) return;
    scheduleManualClamp();
  });
  petWindow.on('hide', () => {
    if (!isQuitting) setTimeout(() => petWindow?.showInactive(), 0);
  });
  ipcMain.on('pet:menu', () => {
    noteMouseActivity('menu');
    showContextMenu();
  });
  ipcMain.on('pet:scale', (_event, action) => {
    noteMouseActivity('control-scale', { action });
    applyScale(action);
  });
  ipcMain.on('pet:move-speed', (_event, action) => {
    noteMouseActivity('control-move-speed', { action });
    applyMoveSpeed(action);
  });
  ipcMain.on('pet:behavior-activity', (_event, value) => {
    noteMouseActivity('control-behavior-activity', { value });
    applyBehaviorActivity(value);
  });
  ipcMain.on('pet:character-distance', (_event, action) => {
    noteMouseActivity('control-character-distance', { action });
    applyCharacterDistance(action);
  });
  ipcMain.on('pet:toggle-auto', () => {
    noteMouseActivity('control-toggle-auto');
    behaviorController?.toggle();
  });
  ipcMain.on('pet:force-move', () => {
    noteMouseActivity('control-force-move');
    behaviorController?.forceMove();
  });
  ipcMain.on('pet:toggle-focus-mode', () => {
    noteMouseActivity('control-focus-mode');
    toggleFocusMode();
  });
  ipcMain.on('pet:reset-settings', () => {
    noteMouseActivity('control-reset-settings');
    resetUserSettings();
  });
  ipcMain.on('pet:trigger-interact', (_event, details) => {
    noteMouseActivity('head-click-interact', details);
    writeDiagnostic('head-click-interact-ipc-received', { details });
    behaviorController?.triggerInteractFromHeadClick(details);
  });
  ipcMain.on('pet:pixel-drag-start', (_event, details) => beginPixelDrag(details));
  ipcMain.on('pet:pixel-drag-move', (_event, details) => updatePixelDrag(details));
  ipcMain.on('pet:pixel-drag-end', (_event, details) => endPixelDrag(details));
  ipcMain.on('pet:quit', () => {
    noteMouseActivity('control-quit');
    app.quit();
  });
  ipcMain.on('pet:pointer-over-controls', (_event, isOverControls) => {
    if (isOverControls) noteMouseActivity('pointer-over-controls');
    setPointerOverControls(Boolean(isOverControls));
  });
  ipcMain.on('pet:pointer-over-pet', (_event, isOverPet) => {
    if (isOverPet) noteMouseActivity('pointer-over-pet');
    setPointerOverPet(Boolean(isOverPet));
  });
  ipcMain.on('pet:configuration-mode', (_event, active) => {
    noteMouseActivity('configuration-mode', { active: Boolean(active) });
    setConfigurationMode(active);
  });
  ipcMain.on('pet:controls-hidden', (_event, hidden) => {
    noteMouseActivity('controls-hidden', { hidden: Boolean(hidden) });
    controlsHidden = Boolean(hidden);
    writeDiagnostic('controls-hidden-state', { hidden: controlsHidden });
    saveUserSettings('controls-hidden');
    updateMouseInteractivity();
  });
  ipcMain.on('pet:diagnostic', (_event, payload) => {
    writeDiagnostic(payload?.event || 'renderer-diagnostic', {
      source: 'renderer',
      ...(payload?.details || {}),
      rendererAt: payload?.at,
      rendererSequence: payload?.sequence,
      rendererPerformanceNow: payload?.performanceNow
    });
  });
  ipcMain.handle('pet:profiles:get', () => profileManager?.getState() || null);
  ipcMain.handle('pet:profiles:select', (_event, pair) => {
    try {
      const state = profileManager.selectPair(pair || {});
      writeDiagnostic('profiles-selected', {
        activePair: state.activePair,
        profiles: Object.fromEntries(Object.entries(state.activeProfiles).map(([slot, profile]) => [slot, profile.id]))
      });
      sendProfileState(state);
      return { ok: true, state };
    } catch (error) {
      writeDiagnostic('profiles-select-failed', { error: String(error), pair: pair || null });
      return { ok: false, error: error.message || String(error) };
    }
  });
  ipcMain.handle('pet:prts:lookup', async (_event, name) => {
    const trace = { version: 1, startedAt: new Date().toISOString(), name: String(name || ''), events: [] };
    activePritsLookupTrace = trace;
    let result;
    try {
      const catalog = await prtsProvider.lookup(name);
      writeDiagnostic('prts-lookup-success', { name: catalog.name, operatorId: catalog.operatorId, outfitCount: catalog.outfits.length });
      result = { ok: true, catalog };
    } catch (error) {
      writeDiagnostic('prts-lookup-failed', { name: String(name || ''), error: String(error) });
      result = { ok: false, error: error.message || String(error), code: error.code || null };
    } finally {
      trace.finishedAt = new Date().toISOString();
      trace.success = Boolean(result?.ok);
      trace.error = result?.ok ? null : result?.error || 'unknown';
      const fileName = `prts-lookup-${Date.now()}.json`;
      lastPritsLookupDebugPath = path.join(path.dirname(getDiagnosticLogPath()), fileName);
      try {
        fs.writeFileSync(lastPritsLookupDebugPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
        result.debugAvailable = true;
      } catch (error) {
        writeDiagnostic('prts-lookup-debug-write-failed', { error: String(error) });
      }
      activePritsLookupTrace = undefined;
    }
    return result;
  });
  ipcMain.handle('pet:prts:open-last-debug', () => {
    if (!lastPritsLookupDebugPath || !fs.existsSync(lastPritsLookupDebugPath)) {
      return { ok: false, error: '尚未生成查询诊断文件。' };
    }
    shell.showItemInFolder(lastPritsLookupDebugPath);
    return { ok: true };
  });
  ipcMain.handle('pet:app-info', () => ({
    displayName: app.getName(),
    version: app.getVersion()
  }));
  ipcMain.handle('pet:feedback:open-form', async () => {
    try {
      await shell.openExternal(FEEDBACK_FORM_URL);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  });
  ipcMain.handle('pet:feedback:export-diagnostics', () => {
    try {
      writeDiagnostic('feedback-diagnostics-export-requested');
      const output = createFeedbackDiagnosticsPackage();
      shell.showItemInFolder(output);
      writeDiagnostic('feedback-diagnostics-exported', { fileName: path.basename(output) });
      return { ok: true, fileName: path.basename(output) };
    } catch (error) {
      writeDiagnostic('feedback-diagnostics-export-failed', { error: String(error) });
      return { ok: false, error: error.message || String(error) };
    }
  });
  ipcMain.handle('pet:prts:download', async (_event, request) => {
    if (activePritsDownload) return { ok: false, error: '已有素材正在下载，请等待完成或取消。' };
    const controller = new AbortController();
    activePritsDownload = { controller };
    try {
      sendPritsDownloadProgress({ phase: 'prepare', name: request?.name || null, outfitName: request?.outfitName || null });
      const plan = await prtsProvider.createDownloadPlan(request || {});
      const state = await assetDownloadManager.install(plan, {
        signal: controller.signal,
        onProgress: (progress) => sendPritsDownloadProgress({ ...progress, name: plan.profile.operator.name, outfitName: plan.profile.operator.outfitName })
      });
      sendProfileState(state);
      writeDiagnostic('prts-download-success', { profileId: plan.profile.id, operator: plan.profile.operator });
      return { ok: true, state, profileId: plan.profile.id };
    } catch (error) {
      if (error?.code === 'download-cancelled') {
        writeDiagnostic('prts-download-cancelled', { request: request || null });
        return { ok: false, cancelled: true, error: '下载已取消。' };
      }
      writeDiagnostic('prts-download-failed', { request: request || null, error: String(error) });
      return { ok: false, error: error.message || String(error) };
    } finally {
      activePritsDownload = undefined;
    }
  });
  ipcMain.on('pet:prts:cancel-download', () => activePritsDownload?.controller.abort());
  ipcMain.on('pet:profiles:runtime-report', (_event, payload) => {
    try {
      const state = profileManager.recordRuntimeAnimations(payload?.profileId, payload?.availableAnimations);
      const profile = profileManager.getProfile(payload.profileId);
      writeDiagnostic('profile-runtime-validated', {
        profileId: profile.id,
        compatibility: profile.runtime?.compatibility || null,
        missingRequired: profile.runtime?.missingRequired || [],
        missingOptional: profile.runtime?.missingOptional || []
      });
      sendProfileState(state);
    } catch (error) {
      writeDiagnostic('profile-runtime-validation-failed', { error: String(error), payload: payload || null });
    }
  });
  writeDiagnostic('global-shortcut-registered', {
    accelerator: 'CommandOrControl+Alt+P',
    registered: globalShortcut.register('CommandOrControl+Alt+P', () => behaviorController?.toggle())
  });
  writeDiagnostic('global-shortcut-registered', {
    accelerator: 'CommandOrControl+Alt+H',
    registered: globalShortcut.register('CommandOrControl+Alt+H', () => showControls('global-shortcut'))
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  saveUserSettings('before-quit');
  if (recoveryTimer) clearTimeout(recoveryTimer);
  if (manualClampTimer) clearTimeout(manualClampTimer);
  if (setPositionDiagnosticTimer) clearInterval(setPositionDiagnosticTimer);
  if (mouseIdleMonitorTimer) clearInterval(mouseIdleMonitorTimer);
  globalShortcut.unregisterAll();
  behaviorController?.clearTimers();
});
app.on('window-all-closed', (event) => event.preventDefault());
