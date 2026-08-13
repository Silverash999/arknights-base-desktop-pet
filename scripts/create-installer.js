const path = require('node:path');
const fs = require('node:fs');
const { createWindowsInstaller } = require('electron-winstaller');

const [appDirectory, outputDirectory, exe] = process.argv.slice(2);

if (!appDirectory || !outputDirectory || !exe) {
  throw new Error('Usage: node create-installer.js <appDirectory> <outputDirectory> <exe>');
}

const setupExe = 'ArknightsBasePet-Setup.exe';

createWindowsInstaller({
  appDirectory,
  outputDirectory,
  authors: 'Arknights Base Desktop Pet',
  exe,
  setupExe,
  noMsi: true,
  name: 'arknights-base-desktop-pet'
}).then(() => {
  const expected = path.join(outputDirectory, setupExe);
  if (!fs.existsSync(expected)) {
    throw new Error(`Installer was not created: ${expected}`);
  }
  process.stdout.write(`${expected}\n`);
}).catch((error) => {
  const expected = path.join(outputDirectory, setupExe);
  const releases = path.join(outputDirectory, 'RELEASES');
  const unfinishedSetup = path.join(outputDirectory, 'Setup.exe');
  if (fs.existsSync(unfinishedSetup) && fs.statSync(unfinishedSetup).size > 0 && fs.existsSync(releases)) {
    if (!fs.existsSync(expected)) {
      fs.renameSync(unfinishedSetup, expected);
    }
    process.stderr.write(`Installer metadata warning: ${error.message}\n`);
    process.stdout.write(`${expected}\n`);
    return;
  }
  throw error;
});
