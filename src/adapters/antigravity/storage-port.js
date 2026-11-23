'use strict';

/**
 * Isolated Renderer Storage Port (Cache-Only `localStorage` Boundary — v2.1.0).
 *
 * Security Invariant (V1 / V2):
 * - `window.localStorage` is strictly confined to the ephemeral translation text cache
 *   (`STORAGE_KEYS.cache`).
 * - Security-sensitive settings (`enabled`, `provider`, `llmConfig`, `customProviders`,
 *   toggles) MUST NEVER be read from or written to `window.localStorage`, because World 998
 *   shares origin `localStorage` with Page World 0 and restricted peer plugins, and dynamic
 *   loopback port rotations wipe origin `localStorage`.
 * - Authoritative settings arrive exclusively via host `settingsBridge` (`addonHost.getSettings()`
 *   / `addonHost.onSettingsChange()`) or explicit `initialSettings` in standalone tests.
 */

const STORAGE_KEYS = Object.freeze({
  cache: 'agy-ko-thought-cache-v15',
  provider: 'agy-ko-thought-provider',
  showThinking: 'agy-ko-thought-show-thinking',
  translateThinking: 'agy-ko-thought-translate-thinking',
  translateStaticUi: 'agy-ko-thought-translate-static-ui',
  llmConfig: 'agy-ko-llm-config-v2',
  customProviders: 'agy-ko-custom-providers-v2',
});

function createSafeLocalStorage(targetWin) {
  try {
    const ls = targetWin && targetWin.localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
      return ls;
    }
  } catch (_err) {}

  const map = new Map();
  return {
    getItem(k) {
      const key = String(k);
      return map.has(key) ? map.get(key) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
  };
}

function createStoragePort({ targetWin, initialSettings = null } = {}) {
  const ls = createSafeLocalStorage(targetWin);

  function isAllowedCacheKey(key) {
    return key === STORAGE_KEYS.cache;
  }

  function getItem(key) {
    if (!isAllowedCacheKey(key)) return null;
    try {
      return ls.getItem(key);
    } catch (_err) {
      return null;
    }
  }

  function setItem(key, value) {
    if (!isAllowedCacheKey(key)) return false;
    try {
      ls.setItem(key, String(value));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function removeItem(key) {
    if (!isAllowedCacheKey(key)) return false;
    try {
      ls.removeItem(key);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function getJson(key, fallback = null) {
    if (!isAllowedCacheKey(key)) return fallback;
    const raw = getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return fallback;
    }
  }

  function setJson(key, value) {
    if (!isAllowedCacheKey(key)) return false;
    try {
      return setItem(key, JSON.stringify(value));
    } catch (_err) {
      return false;
    }
  }

  function getInitialSettings() {
    return initialSettings && typeof initialSettings === 'object' ? { ...initialSettings } : null;
  }

  return {
    keys: STORAGE_KEYS,
    getItem,
    setItem,
    removeItem,
    getJson,
    setJson,
    getInitialSettings,
  };
}

module.exports = {
  STORAGE_KEYS,
  createSafeLocalStorage,
  createStoragePort,
};
