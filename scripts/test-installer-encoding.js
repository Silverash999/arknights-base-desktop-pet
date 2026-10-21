const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const installer = path.join(__dirname, '..', 'installer-script', 'install.ps1');
const bytes = fs.readFileSync(installer);

assert.deepEqual(
  [...bytes.subarray(0, 3)],
  [0xef, 0xbb, 0xbf],
  'install.ps1 must use UTF-8 with BOM so Windows PowerShell 5.1 preserves Chinese shortcut names.'
);

process.stdout.write('Installer encoding test passed.\n');
