const { app, net } = require('electron');

const target = process.argv[2] || 'https://prts.wiki/w/%E9%93%B6%E7%81%B0';

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async () => {
  try {
    const response = await net.fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8'
      }
    });
    const text = await response.text();
    const summary = {
      ok: response.ok,
      status: response.status,
      url: response.url,
      textLength: text.length,
      containsModelMarker: /干员模型|char_spine/.test(text)
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`PRTS browser probe failed: ${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
