const MAX_OPERATOR_ID_ENTRIES = 5000;

function isOperatorId(value) {
  return /^char_\d+_[a-z0-9_]+$/i.test(String(value || ''));
}

function buildOfficialOperatorIdMap(table) {
  const mapping = new Map();
  for (const [id, entry] of Object.entries(table || {})) {
    const name = String(entry?.name || '').trim();
    if (name && isOperatorId(id) && !mapping.has(name)) mapping.set(name, id);
  }
  return mapping;
}

function serializeOperatorIdCache(mapping, fetchedAt = new Date().toISOString()) {
  const entries = [...mapping.entries()].slice(0, MAX_OPERATOR_ID_ENTRIES);
  return { version: 1, fetchedAt, entries };
}

function parseOperatorIdCache(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) return null;
  const fetchedAt = Date.parse(value.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return null;
  const mapping = new Map();
  for (const entry of value.entries.slice(0, MAX_OPERATOR_ID_ENTRIES)) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const name = String(entry[0] || '').trim();
    const id = String(entry[1] || '').trim();
    if (name && isOperatorId(id) && !mapping.has(name)) mapping.set(name, id);
  }
  return mapping.size >= 100 ? { mapping, fetchedAt } : null;
}

module.exports = { buildOfficialOperatorIdMap, parseOperatorIdCache, serializeOperatorIdCache };
