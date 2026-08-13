const assert = require('node:assert/strict');
const {
  assertNoUnredactedUserPaths,
  redactDiagnosticJsonl,
  redactDiagnosticText
} = require('../src/main/diagnostic-export');

const paths = {
  userDataPath: 'D:\\Users\\qa-user\\AppData\\Roaming\\arknights-base-desktop-pet',
  appDataPath: 'D:\\Users\\qa-user\\AppData\\Roaming'
};
const jsonl = `${JSON.stringify({
  source: 'D:\\Users\\qa-user\\Documents\\private.txt',
  nested: { cache: 'D:/Users/qa-user/AppData/Roaming/arknights-base-desktop-pet/downloads/model.png' },
  unc: '\\\\workstation\\Users\\qa-user\\Desktop\\note.txt'
})}\nnot-json D:\\Users\\qa-user\\Downloads\\bad.log\n`;

const redacted = redactDiagnosticJsonl(jsonl, paths);
assert.match(redacted, /D:\/Users\/<user>\/Documents\/private\.txt/);
assert.match(redacted, /%APPDATA%\/arknights-base-desktop-pet\/downloads\/model\.png/);
assert.match(redacted, /\/\/<host>\/Users\/<user>\/Desktop\/note\.txt/);
assert.doesNotMatch(redacted, /qa-user/i);
assert.doesNotThrow(() => assertNoUnredactedUserPaths(redacted));
assert.throws(() => assertNoUnredactedUserPaths('D:/Users/qa-user/Documents/private.txt'));
assert.equal(redactDiagnosticText('D:\\\\Users\\\\qa-user\\\\Desktop', paths), 'D:/Users/<user>/Desktop');
process.stdout.write('Diagnostic export redaction tests passed.\n');
