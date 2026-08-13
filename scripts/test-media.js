const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const assetDir = path.join(root, 'assets');
const imagePath = path.join(assetDir, '灵知default.png');
const videoPath = path.join(assetDir, '灵知-默认-基建-Move-x1.webm');

function probe(kind, url) {
  return `new Promise((resolve) => {
    const element = document.createElement(${JSON.stringify(kind === 'image' ? 'img' : 'video')});
    const finish = (result) => resolve(result);
    element.addEventListener('error', () => finish({ ok: false, code: element.error ? element.error.code : null }));
    ${kind === 'image'
      ? "element.addEventListener('load', () => finish({ ok: true, width: element.naturalWidth, height: element.naturalHeight }));"
      : "element.muted = true; element.addEventListener('loadeddata', () => finish({ ok: true, width: element.videoWidth, height: element.videoHeight, canPlay: element.canPlayType('video/webm; codecs=\"vp9\"') }));"}
    element.src = ${JSON.stringify(url)};
    if (${JSON.stringify(kind)} === 'video') element.load();
    setTimeout(() => finish({ ok: false, code: 'timeout' }), 7000);
  })`;
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(root, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await window.loadFile(path.join(root, 'src', 'renderer', 'index.html'));
  const image = await window.webContents.executeJavaScript(`({
    count: document.querySelectorAll('img').length,
    loaded: [...document.querySelectorAll('img')].map((element) => ({
      complete: element.complete,
      width: element.naturalWidth,
      height: element.naturalHeight,
      source: element.currentSrc
    }))
  })`);
  const video = await window.webContents.executeJavaScript(probe('video', pathToFileURL(videoPath).href));
  const canvas = await window.webContents.executeJavaScript(`(async () => {
    render({ name: 'test', states: { silverash: 'Move', gnosis: 'Move' } });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return [...document.querySelectorAll('canvas')].map((element) => ({
      width: element.width,
      height: element.height,
      corner: [...element.getContext('2d').getImageData(0, 0, 1, 1).data]
    }));
  })()`);
  process.stdout.write(JSON.stringify({ image, video, canvas }) + '\n');
  app.quit();
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  // Electron's graceful quit path may otherwise report a successful exit
  // after a rejected load/evaluate promise. This is a release-gate script,
  // so force the non-zero status after reporting the underlying error.
  app.exit(1);
});
