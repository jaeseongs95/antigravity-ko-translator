'use strict';

function normalizeCatalogInput(exactEntries) {
  if (!Array.isArray(exactEntries)) {
    throw new TypeError('exactEntries must be an array of [key, value] tuples or { source, entries } groups');
  }
  const normalized = [];
  for (const item of exactEntries) {
    if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string') {
      normalized.push({ source: 'default', key: item[0], value: item[1] });
      continue;
    }
    if (item && typeof item === 'object' && Array.isArray(item.entries)) {
      const source = typeof item.source === 'string' && item.source ? item.source : 'group';
      for (const pair of item.entries) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {
          throw new TypeError(`Invalid dictionary entry in ${source}`);
        }
        normalized.push({ source, key: pair[0], value: pair[1] });
      }
      continue;
    }
    throw new TypeError('Invalid dictionary entry item');
  }
  return normalized;
}

function createDictionaryCatalog({ exactEntries = [], patternMatcher = null, maxCacheSize = 2000 } = {}) {
  if (patternMatcher !== null && typeof patternMatcher !== 'function') {
    throw new TypeError('patternMatcher must be a function or null');
  }
  const cap = Number.isInteger(maxCacheSize) && maxCacheSize > 0 ? maxCacheSize : 2000;
  const flatEntries = normalizeCatalogInput(exactEntries);
  const exactMap = new Map();
  const keyOriginMap = new Map();

  for (const { source, key, value } of flatEntries) {
    if (typeof value !== 'string') {
      throw new TypeError(`Dictionary value for "${key}" in ${source} must be a string`);
    }
    if (exactMap.has(key)) {
      const prevSource = keyOriginMap.get(key);
      throw new Error(`Duplicate dictionary key "${key}" between ${prevSource} and ${source}`);
    }
    exactMap.set(key, value);
    keyOriginMap.set(key, source);
  }

  const patternCache = new Map();

  function setPatternCache(key, value) {
    if (patternCache.has(key)) {
      patternCache.delete(key);
    }
    patternCache.set(key, value);
    while (patternCache.size > cap) {
      const oldest = patternCache.keys().next().value;
      if (oldest === undefined) break;
      patternCache.delete(oldest);
    }
  }

  function translateSync(rawText) {
    if (typeof rawText !== 'string' || !rawText) return null;
    const trimmed = rawText.trim();
    if (!trimmed) return null;
    if (exactMap.has(trimmed)) {
      return exactMap.get(trimmed);
    }
    if (!patternMatcher) return null;
    if (patternCache.has(trimmed)) {
      return patternCache.get(trimmed);
    }
    const matched = patternMatcher(trimmed);
    const resolved = typeof matched === 'string' && matched ? matched : null;
    setPatternCache(trimmed, resolved);
    return resolved;
  }

  return {
    get size() {
      return exactMap.size;
    },
    hasExact(key) {
      return exactMap.has(key);
    },
    getExact(key) {
      return exactMap.has(key) ? exactMap.get(key) : null;
    },
    translateSync,
    clearPatternCache() {
      patternCache.clear();
    },
    entries() {
      return Array.from(exactMap.entries());
    },
  };
}

module.exports = {
  createDictionaryCatalog,
};
