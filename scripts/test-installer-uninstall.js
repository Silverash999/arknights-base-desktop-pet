const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const installerRoot = path.join(__dirname, '..', 'installer-script');
const installSource = fs.readFileSync(path.join(installerRoot, 'install.ps1'), 'utf8');
const uninstallScript = path.join(installerRoot, 'uninstall.ps1');
const uninstallCommand = path.join(installerRoot, 'Uninstall-ArknightsBasePet.cmd');

assert.ok(fs.existsSync(uninstallScript), 'installer package must provide an uninstall PowerShell script.');
assert.ok(fs.existsSync(uninstallCommand), 'installer package must provide an uninstall command entry point.');

const uninstallSource = fs.readFileSync(uninstallScript, 'utf8');
assert.match(installSource, /Uninstall-ArknightsBasePet\.cmd/, 'installation must copy and register the uninstall command.');
assert.match(installSource, /CurrentVersion\\Uninstall\\ArknightsBasePet/, 'installation must register a Windows uninstall entry.');
assert.match(installSource, /System32\\cmd\.exe/, 'Windows uninstall registration must launch the command file through cmd.exe.');
assert.match(installSource, /卸载明日方舟基建桌宠\.lnk/, 'installation must add a Start Menu uninstall shortcut.');
assert.match(uninstallSource, /CurrentVersion\\Uninstall\\ArknightsBasePet/, 'uninstall must remove its registry entry.');
assert.match(uninstallSource, /Remove-Item.*targetDir/, 'uninstall must remove the installed application directory.');
assert.doesNotMatch(uninstallSource, /arknights-base-desktop-pet/, 'uninstall must not delete user settings or downloaded assets.');

process.stdout.write('Installer uninstall integration test passed.\n');
