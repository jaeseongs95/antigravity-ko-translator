'use strict';

/**
 * Isolated Renderer Storage Port.
 *
 * Uses ONLY renderer `localStorage` (plus optional read-only initial settings injected by
 * the host drop-in loader from `~/.gemini/antigravity/ko_translator_settings.json`).
 * NEVER writes to Antigravity host internal storage (`window.nativeStorage`).
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

  function getItem(key) {
    try {
      return ls.getItem(key);
    } catch (_err) {
      return null;
    }
  }

  function setItem(key, value) {
    try {
      ls.setItem(key, String(value));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function removeItem(key) {
    try {
      ls.removeItem(key);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function getJson(key, fallback = null) {
    const raw = getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return fallback;
    }
  }

  function setJson(key, value) {
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
