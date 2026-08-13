function normalizePathSeparators(value) {
  const text = String(value || '');
  const isUnc = /^[\\/]{2,}/.test(text);
  const normalized = text.replace(/[\\/]+/g, '/');
  return isUnc ? `/${normalized}` : normalized;
}

function replaceAllInsensitive(value, search, replacement) {
  const normalizedSearch = normalizePathSeparators(search);
  if (!normalizedSearch) return value;
  const expression = new RegExp(normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return value.replace(expression, replacement);
}

function redactDiagnosticText(value, { userDataPath = '', appDataPath = '' } = {}) {
  let redacted = normalizePathSeparators(value);
  // Replace known application roots before the generic user-name rule, so a
  // feedback package reveals neither the account nor its data layout.
  redacted = replaceAllInsensitive(redacted, userDataPath, '%APPDATA%/arknights-base-desktop-pet');
  redacted = replaceAllInsensitive(redacted, appDataPath, '%APPDATA%');
  redacted = redacted.replace(/([A-Za-z]):\/Users\/[^/\r\n]+/g, '$1:/Users/<user>');
  redacted = redacted.replace(/\/\/[^/\r\n]+\/(?:Users|UserProfiles)\/[^/\r\n]+/gi, '//<host>/Users/<user>');
  return redacted;
}

function redactDiagnosticValue(value, paths) {
  if (typeof value === 'string') return redactDiagnosticText(value, paths);
  if (Array.isArray(value)) return value.map((entry) => redactDiagnosticValue(entry, paths));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactDiagnosticValue(entry, paths)]));
}

function redactDiagnosticJsonl(text, paths) {
  return String(text || '').split(/(\r?\n)/).map((part) => {
    if (/^\r?\n$/.test(part) || !part) return part;
    try {
      return JSON.stringify(redactDiagnosticValue(JSON.parse(part), paths));
    } catch {
      // Preserve malformed diagnostics for support, while applying the same
      // path policy rather than leaking text because it is not valid JSONL.
      return redactDiagnosticText(part, paths);
    }
  }).join('');
}

function assertNoUnredactedUserPaths(value) {
  const normalized = normalizePathSeparators(value);
  if (/[A-Za-z]:\/Users\/(?!<user>(?:\/|$))[^/\r\n]+/i.test(normalized)
    || /\/\/[^/\r\n]+\/(?:Users|UserProfiles)\/(?!<user>(?:\/|$))[^/\r\n]+/i.test(normalized)) {
    throw new Error('诊断包包含未脱敏的本地用户路径，已取消导出。');
  }
}

module.exports = {
  assertNoUnredactedUserPaths,
  redactDiagnosticJsonl,
  redactDiagnosticText,
  redactDiagnosticValue
};
