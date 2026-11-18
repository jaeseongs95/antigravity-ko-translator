'use strict';

const { validateTranslationEndpointUrl } = require('../translators/endpoint-validator');
const {
  validateCustomProviderSpec,
  createCustomProviderAdapter,
} = require('../translators/custom-provider');
const { DEFAULT_ANTIGRAVITY_LLM_CONFIG } = require('./host-config-preset');

const STORAGE_KEYS = Object.freeze({
  PROVIDER: 'agy-ko-thought-provider',
  PRETRANSLATE: 'agy-ko-thought-pretranslate',
  SHOW_THINKING: 'agy-ko-thought-show-thinking',
  TRANSLATE_THINKING: 'agy-ko-thought-translate-thinking',
  CACHE: 'agy-ko-thought-cache-v5',
  LLM_CONFIG: 'agy-ko-llm-config',
  CUSTOM_PROVIDERS_LOCAL_ONLY: 'agy-ko-custom-providers-v2',
});

function createAntigravityStorageAdapter(targetWin) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const memoryFallback = new Map();
  let fallbackActive = false;

  function resolveLocalStorage() {
    if (!win) {
      fallbackActive = true;
      return null;
    }
    try {
      const ls = win.localStorage;
      if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
        return ls;
      }
    } catch (_err) {
      fallbackActive = true;
    }
    fallbackActive = true;
    return null;
  }

  function getItem(key) {
    const k = String(key);
    const ls = resolveLocalStorage();
    if (ls) {
      try {
        const val = ls.getItem(k);
        if (val !== null && val !== undefined) return String(val);
        return memoryFallback.has(k) ? memoryFallback.get(k) : null;
      } catch (_err) {
        fallbackActive = true;
      }
    }
    return memoryFallback.has(k) ? memoryFallback.get(k) : null;
  }

  function setItem(key, value) {
    const k = String(key);
    const v = String(value);
    memoryFallback.set(k, v);
    const ls = resolveLocalStorage();
    if (ls) {
      try {
        ls.setItem(k, v);
        return true;
      } catch (_err) {
        fallbackActive = true;
      }
    }
    return false;
  }

  function removeItem(key) {
    const k = String(key);
    memoryFallback.delete(k);
    const ls = resolveLocalStorage();
    if (ls) {
      try {
        ls.removeItem(k);
        return true;
      } catch (_err) {
        fallbackActive = true;
      }
    }
    return false;
  }

  return {
    getItem,
    setItem,
    removeItem,
    isUsingFallback: () => fallbackActive,
  };
}

function createNativeStorageBridge(targetWin) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);

  function getNative() {
    if (!win) return null;
    try {
      const ns = win.nativeStorage;
      if (ns && typeof ns === 'object') return ns;
    } catch (_err) {}
    return null;
  }

  function hasNativeStorage() {
    const ns = getNative();
    return Boolean(
      ns && (typeof ns.getItems === 'function' || typeof ns.updateItems === 'function')
    );
  }

  async function readItems() {
    const ns = getNative();
    if (!ns || typeof ns.getItems !== 'function') return null;
    try {
      const items = await ns.getItems();
      return items && typeof items === 'object' ? items : null;
    } catch (_err) {
      return null;
    }
  }

  function writeItems(entries) {
    if (!entries || typeof entries !== 'object') return false;
    // Security invariant (Rev5-F8): NEVER forward custom provider headers/specs to nativeStorage!
    if (Object.prototype.hasOwnProperty.call(entries, STORAGE_KEYS.CUSTOM_PROVIDERS_LOCAL_ONLY)) {
      throw new Error('Security violation: custom provider credentials must never enter nativeStorage');
    }
    const ns = getNative();
    if (!ns || typeof ns.updateItems !== 'function') return false;
    try {
      const res = ns.updateItems(entries);
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  return {
    hasNativeStorage,
    readItems,
    writeItems,
  };
}

function sanitizeAndValidateLlmConfig(candidate, baseFallback = DEFAULT_ANTIGRAVITY_LLM_CONFIG) {
  const merged = {
    ...baseFallback,
    ...(candidate && typeof candidate === 'object' ? candidate : {}),
  };
  const allowRemoteHttps = Boolean(merged.allowRemoteHttps);
  const parsedUrl = validateTranslationEndpointUrl(String(merged.baseUrl || ''), {
    allowRemoteHttps,
  });
  const cleanBaseUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, '')}`;
  const model =
    typeof merged.model === 'string' && merged.model.trim()
      ? merged.model.replace(/[\u0000-\u001F\u007F]/g, '').trim()
      : baseFallback.model;
  const apiFormat = merged.apiFormat === 'openai' ? 'openai' : 'ollama';
  const timeoutRaw = Number(merged.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.min(60000, Math.max(1000, Math.trunc(timeoutRaw)))
    : baseFallback.timeoutMs;

  return Object.freeze({
    baseUrl: cleanBaseUrl,
    model,
    apiFormat,
    allowRemoteHttps,
    timeoutMs,
  });
}

function createAntigravityLlmConfigAdapter({
  targetWin,
  storage,
  nativeBridge,
  defaultConfig = DEFAULT_ANTIGRAVITY_LLM_CONFIG,
  onBroadcastLlmConfig = null,
} = {}) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const safeDefault = (() => {
    try {
      return sanitizeAndValidateLlmConfig(defaultConfig, DEFAULT_ANTIGRAVITY_LLM_CONFIG);
    } catch (_err) {
      return DEFAULT_ANTIGRAVITY_LLM_CONFIG;
    }
  })();

  let currentConfig = safeDefault;
  const listeners = new Set();

  function tryHydrateRaw(rawValue) {
    if (!rawValue) return null;
    try {
      const obj = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      return sanitizeAndValidateLlmConfig(obj, safeDefault);
    } catch (_err) {
      return null;
    }
  }

  if (win && win.__agyLocalLlmConfig && typeof win.__agyLocalLlmConfig === 'object') {
    const fromGlobal = tryHydrateRaw(win.__agyLocalLlmConfig);
    if (fromGlobal) currentConfig = fromGlobal;
  }

  if (storage && typeof storage.getItem === 'function') {
    const fromStorage = tryHydrateRaw(storage.getItem(STORAGE_KEYS.LLM_CONFIG));
    if (fromStorage) {
      currentConfig = fromStorage;
    }
  }

  function notifyListeners() {
    for (const fn of Array.from(listeners)) {
      try {
        fn(currentConfig);
      } catch (_err) {}
    }
  }

  function getLlmConfig() {
    return currentConfig;
  }

  function setLlmConfig(partial, { persistHost = true, broadcast = true } = {}) {
    const nextCfg = sanitizeAndValidateLlmConfig(
      { ...currentConfig, ...(partial || {}) },
      currentConfig
    );
    const changed = JSON.stringify(nextCfg) !== JSON.stringify(currentConfig);
    currentConfig = nextCfg;
    const serialized = JSON.stringify(currentConfig);
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(STORAGE_KEYS.LLM_CONFIG, serialized);
    }
    if (persistHost && nativeBridge && typeof nativeBridge.writeItems === 'function') {
      nativeBridge.writeItems({ [STORAGE_KEYS.LLM_CONFIG]: serialized });
    }
    if (changed) {
      notifyListeners();
    }
    if (broadcast && typeof onBroadcastLlmConfig === 'function') {
      try {
        onBroadcastLlmConfig(currentConfig);
      } catch (_err) {}
    }
    return currentConfig;
  }

  async function syncFromNativeStorage() {
    if (!nativeBridge || typeof nativeBridge.readItems !== 'function') return currentConfig;
    const items = await nativeBridge.readItems();
    if (!items || items[STORAGE_KEYS.LLM_CONFIG] === undefined) return currentConfig;
    const hydrated = tryHydrateRaw(items[STORAGE_KEYS.LLM_CONFIG]);
    if (hydrated && JSON.stringify(hydrated) !== JSON.stringify(currentConfig)) {
      currentConfig = hydrated;
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(STORAGE_KEYS.LLM_CONFIG, JSON.stringify(currentConfig));
      }
      notifyListeners();
    }
    return currentConfig;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    getLlmConfig,
    setLlmConfig,
    syncFromNativeStorage,
    subscribe,
  };
}

function createOriginLocalCustomProviderStore({
  storage,
  registry,
  fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('Origin-local storage port is required for CustomProviderStore');
  }

  const specsById = Object.create(null);

  function persistOriginLocalOnly() {
    const list = Object.keys(specsById).map((id) => specsById[id]);
    storage.setItem(STORAGE_KEYS.CUSTOM_PROVIDERS_LOCAL_ONLY, JSON.stringify(list));
  }

  function hydrateIntoRegistry() {
    const raw = storage.getItem(STORAGE_KEYS.CUSTOM_PROVIDERS_LOCAL_ONLY);
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const loaded = [];
    for (const item of parsed) {
      try {
        const validSpec = validateCustomProviderSpec(item);
        specsById[validSpec.id] = validSpec;
        if (registry && typeof registry.registerProvider === 'function' && typeof fetchFn === 'function') {
          const adapter = createCustomProviderAdapter(validSpec, { fetchFn, setTimer, clearTimer });
          registry.registerProvider(adapter);
        }
        loaded.push(validSpec);
      } catch (_err) {}
    }
    return loaded;
  }

  function upsertSpec(rawSpec) {
    const validSpec = validateCustomProviderSpec(rawSpec);
    specsById[validSpec.id] = validSpec;
    if (registry && typeof registry.registerProvider === 'function' && typeof fetchFn === 'function') {
      const adapter = createCustomProviderAdapter(validSpec, { fetchFn, setTimer, clearTimer });
      registry.registerProvider(adapter);
    }
    persistOriginLocalOnly();
    return validSpec;
  }

  function removeSpec(rawId) {
    const normId =
      registry && typeof registry.normalizeId === 'function'
        ? registry.normalizeId(rawId)
        : String(rawId || '').trim().toLowerCase();
    if (!normId || !Object.prototype.hasOwnProperty.call(specsById, normId)) {
      return false;
    }
    delete specsById[normId];
    if (registry && typeof registry.unregisterProvider === 'function') {
      registry.unregisterProvider(normId);
    }
    persistOriginLocalOnly();
    return true;
  }

  function listSpecs() {
    return Object.keys(specsById).map((id) => specsById[id]);
  }

  return {
    hydrateIntoRegistry,
    upsertSpec,
    removeSpec,
    listSpecs,
  };
}

module.exports = {
  STORAGE_KEYS,
  createAntigravityStorageAdapter,
  createNativeStorageBridge,
  sanitizeAndValidateLlmConfig,
  createAntigravityLlmConfigAdapter,
  createOriginLocalCustomProviderStore,
};
