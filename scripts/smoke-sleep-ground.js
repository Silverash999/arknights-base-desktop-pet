const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const diagnostics = [];
const smokeState = process.env.SMOKE_STATE || 'Sleep';
const smokeSettleDelayMs = Number(process.env.SMOKE_SETTLE_DELAY_MS || 2400);
const smokeGroundedRest = process.env.SMOKE_GROUNDED_REST === '1';
const smokeHeadHit = process.env.SMOKE_HEAD_HIT === '1';
const smokeHeadClick = process.env.SMOKE_HEAD_CLICK === '1';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await delay(100);
  }
  return false;
}

ipcMain.on('pet:diagnostic', (_event, payload) => {
  diagnostics.push(payload);
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.env.SMOKE_SHOW === '1',
    width: 660,
    height: 470,
    transparent: true,
    frame: false,
    webPreferences: {
      preload: path.join(root, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  await window.loadFile(path.join(root, 'src', 'renderer', 'index.html'));
  if (process.env.SMOKE_SHOW === '1') window.showInactive();
  if (process.env.SMOKE_SCALE) {
    await window.webContents.executeJavaScript(
      `document.documentElement.style.setProperty('--pet-scale', ${JSON.stringify(process.env.SMOKE_SCALE)})`
    );
  }
  await waitFor(() => diagnostics.filter((entry) => entry.event === 'transparent-spine-load-success').length >= 2);

  await window.webContents.executeJavaScript(`render({
    sequence: 9001,
    sentAt: new Date().toISOString(),
    name: 'smoke ${smokeState}',
    states: { silverash: ${JSON.stringify(smokeState)}, gnosis: ${JSON.stringify(smokeState)} },
    facing: 'right',
    groundedRest: ${JSON.stringify(smokeGroundedRest)}
  })`);
  await delay(smokeSettleDelayMs);

  const pageState = await window.webContents.executeJavaScript(`({
    sleeping: document.querySelector('#pet-stage').classList.contains('sleeping'),
    groundedResting: document.querySelector('#pet-stage').classList.contains('grounded-resting'),
    stage: (() => {
      const stage = document.querySelector('#pet-stage');
      const bounds = stage.getBoundingClientRect();
      return { offsetHeight: stage.offsetHeight, visualHeight: bounds.height };
    })(),
    slots: [...document.querySelectorAll('.pet-slot')].map((slot) => ({
      className: slot.className,
      dataRenderer: slot.dataset.renderer || null,
      dataFacing: slot.dataset.facing || null,
      dataState: slot.dataset.state || null,
      groundShift: getComputedStyle(slot).getPropertyValue('--pet-ground-shift').trim(),
      inlineStyle: slot.getAttribute('style') || '',
      transitionProperty: getComputedStyle(slot).transitionProperty,
      slotTransform: getComputedStyle(slot).transform,
      slotBounds: (() => {
        const bounds = slot.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, height: bounds.height };
      })(),
      childTransform: slot.firstElementChild ? getComputedStyle(slot.firstElementChild).transform : null
    }))
  })`);

  const headHitState = smokeHeadHit
    ? await window.webContents.executeJavaScript(`(() => {
        const slot = document.querySelector('.gnosis');
        const child = slot?.firstElementChild;
        if (!slot || !child) return { skipped: 'missing-child' };
        const visibleBounds = getVisibleBounds('gnosis', slot, child);
        const sourceSize = sourceSizeForElement(child);
        const elementBounds = child.getBoundingClientRect();
        if (!visibleBounds || !sourceSize.width || !sourceSize.height || elementBounds.width <= 0 || elementBounds.height <= 0) {
          return { skipped: 'missing-bounds', visibleBounds, sourceSize };
        }
        const clientX = elementBounds.left + ((visibleBounds.left + visibleBounds.width / 2) / sourceSize.width) * elementBounds.width;
        const headY = elementBounds.top + ((visibleBounds.top + visibleBounds.height / 6) / sourceSize.height) * elementBounds.height;
        const bodyY = elementBounds.top + ((visibleBounds.top + visibleBounds.height * 0.75) / sourceSize.height) * elementBounds.height;
        return {
          visibleBounds,
          sourceSize,
          headPoint: { clientX, clientY: headY },
          headHit: headHitTestPet({ clientX, clientY: headY }),
          bodyHit: headHitTestPet({ clientX, clientY: bodyY })
        };
      })()`)
    : null;

  if (smokeHeadClick && headHitState?.headPoint) {
    await window.webContents.executeJavaScript(`(() => {
      const point = ${JSON.stringify(headHitState.headPoint)};
      const moveEvent = new MouseEvent('mousemove', {
        clientX: point.clientX,
        clientY: point.clientY,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(moveEvent);
      const hotspot = document.querySelector('#pet-pixel-drag-hotspot');
      const pointerEvent = new PointerEvent('pointerdown', {
        clientX: point.clientX,
        clientY: point.clientY,
        button: 0,
        bubbles: true,
        cancelable: true
      });
      hotspot.dispatchEvent(pointerEvent);
      return {
        hotspotActive: hotspot.classList.contains('is-active'),
        hotspotStyle: hotspot.getAttribute('style') || ''
      };
    })()`);
    await delay(120);
  }

  const sleepGroundDiagnostics = diagnostics.filter((entry) => (
    entry.event === 'sleep-ground-shift-applied'
    || entry.event === 'sleep-ground-shift-skipped'
    || entry.event === 'sleep-ground-shift-failed'
    || entry.event === 'ground-shift-preset-applied'
    || entry.event === 'head-click-interact-requested'
  ));

  const result = `${JSON.stringify({ pageState, headHitState, sleepGroundDiagnostics }, null, 2)}\n`;
  if (process.env.SMOKE_OUTPUT) fs.writeFileSync(process.env.SMOKE_OUTPUT, result, 'utf8');
  else process.stdout.write(result);
  app.quit();
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.exit(1);
});
