const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const harPath = process.argv[2];
if (!harPath) throw new Error('Usage: electron scripts/test-prts-har-spine.js <har-file>');

const targetStem = 'build_char_172_svrash_ambienceSynesthesia_4';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-prts-spine-test-'));
const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'prts-spine-runtime.js'), 'utf8');

app.setPath('userData', path.join(temporary, 'user-data'));
app.setPath('sessionData', path.join(temporary, 'session-data'));
app.on('quit', () => {
  try {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows can retain a transient cache lock; the OS temp cleaner can remove it later.
  }
});

function extractFixture() {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  for (const entry of har.log.entries || []) {
    const source = entry.request?.url || '';
    const fileName = source.split('/').pop();
    if (!fileName?.startsWith(`${targetStem}.`)) continue;
    const content = entry.response?.content || {};
    if (!content.text) continue;
    const extension = fileName.split('.').pop();
    const destination = extension === 'png' ? fileName : `model.${extension}`;
    fs.writeFileSync(path.join(temporary, destination), Buffer.from(content.text, content.encoding === 'base64' ? 'base64' : 'utf8'));
  }
  for (const required of ['model.skel', 'model.atlas', `${targetStem}.png`]) {
    if (!fs.existsSync(path.join(temporary, required))) throw new Error(`HAR does not contain ${required}`);
  }
}

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  extractFixture();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: false }
  });
  try {
    await window.loadURL('about:blank');
    await window.webContents.executeJavaScript(runtime);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 1000;
      document.body.append(canvas);
      const player = new window.PRTSSpinePlayer(canvas);
      const loaded = await player.load('fixture', ${JSON.stringify(pathToFileURL(path.join(temporary, 'model.skel')).href)}, ${JSON.stringify(pathToFileURL(path.join(temporary, 'model.atlas')).href)}, { x: -500, y: -200, scale: 1 }, null, true);
      return loaded.skeleton.data.animations.map((animation) => animation.name);
    })()`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
