'use strict';

/**
 * Clean-Slate Desktop-Only Pure Read-Only DOM Overlay Bootstrap.
 *
 * Exports `createKoTranslator({ win, doc, settings, onStatus }) -> { start(), updateSettings(next), dispose(), getStatus() }`.
 * - ZERO host `fetch` / `lsClient` / Protobuf interception
 * - ZERO React Fiber / Angular inspection
 * - ZERO `Worker` / `iframe` / TrustedTypes hijacking
 * - ZERO cross-plugin coupling (no sibling plugin files or shared host storage)
 * - ZERO native Settings modal DOM hacking (settings live in the official Sidecar AUX_PANE)
 */

const { createDisposableRegistry } = require('../core/disposable-registry');
const { createProviderRegistry } = require('../core/provider-registry');
const { createTranslationService } = require('../core/translation-service');
const { createGoogleTranslateAdapter } = require('../adapters/translators/google-translate');
const { createLocalLlmAdapter } = require('../adapters/translators/local-llm');
const { createCustomProviderAdapter } = require('../adapters/translators/custom-provider');
const { createAntigravityDictionaryCatalog } = require('../adapters/antigravity/dictionaries');
const { createStoragePort, STORAGE_KEYS } = require('../adapters/antigravity/storage-port');
const { createAntigravityUiLocalizer } = require('../adapters/antigravity/ui-localizer');
const { createAntigravityTriggerController } = require('../adapters/antigravity/trigger-controller');
const { createAntigravityThinkingTranslator } = require('../adapters/antigravity/thinking-translator');
const { createObserverScheduler } = require('./observer-scheduler');

const DEFAULT_LLM_CONFIG = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma3:4b',
  apiFormat: 'ollama',
  allowRemoteHttps: false,
  timeoutMs: 15000,
});

const STYLE_ID = 'agy-ko-thought-localizer-style';

function buildMinimalOverlayCss() {
  return `
.cursor-edit[data-agy-ko-ready="1"] > div:not(.agy-ko-thought-wrap),
[data-agy-ko-thought-host="1"][data-agy-ko-ready="1"] > div:not(.agy-ko-thought-wrap) {
  display: none !important;
}
.agy-ko-thought-wrap {
  display: block;
}
[data-agy-hide-thinking="1"] button[data-testid="thinking-collapsible-trigger"],
[data-agy-hide-thinking="1"] button[data-testid="thinking-collapsible-trigger"] + div {
  display: none !important;
}
`.trim();
}

function resolveBooleanOption(overrideVal, storedVal, fallback) {
  if (typeof overrideVal === 'boolean') return overrideVal;
  if (storedVal === '1' || storedVal === 'true' || storedVal === true) return true;
  if (storedVal === '0' || storedVal === 'false' || storedVal === false) return false;
  return Boolean(fallback);
}

const PROVIDER_ALIAS_MAP = Object.freeze({
  google: 'google-translate',
  gtx: 'google-translate',
  local: 'local-llm',
  llm: 'local-llm',
  ollama: 'local-llm',
});

function canonicalizeProviderId(rawId) {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim().toLowerCase();
  if (!trimmed || trimmed === '__proto__' || trimmed === 'constructor' || trimmed === 'prototype') return null;
  const mapped = Object.prototype.hasOwnProperty.call(PROVIDER_ALIAS_MAP, trimmed)
    ? PROVIDER_ALIAS_MAP[trimmed]
    : trimmed;
  return /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(mapped) ? mapped : null;
}

function createKoTranslator({
  win = typeof window !== 'undefined' ? window : null,
  doc = null,
  settings = null,
  version = '2.0.0',
  fetchFn = null,
  onStatus = null,
} = {}) {
  const targetWin = win;
  const targetDoc = doc || (targetWin && targetWin.document) || null;
  if (!targetWin || !targetDoc) {
    throw new Error('createKoTranslator requires valid window and document objects');
  }

  const effectiveFetch =
    typeof fetchFn === 'function'
      ? fetchFn
      : typeof targetWin.fetch === 'function'
        ? targetWin.fetch.bind(targetWin)
        : typeof fetch === 'function'
          ? fetch.bind(globalThis)
          : null;

  const storage = createStoragePort({ targetWin, initialSettings: settings });
  const initCfg = storage.getInitialSettings() || {};

  let state = {
    enabled: initCfg.enabled !== false,
    translateThinking: resolveBooleanOption(
      initCfg.translateThinking,
      storage.getItem(STORAGE_KEYS.translateThinking),
      true
    ),
    showThinking: resolveBooleanOption(
      initCfg.showThinking,
      storage.getItem(STORAGE_KEYS.showThinking),
      true
    ),
    translateStaticUi: resolveBooleanOption(
      initCfg.translateStaticUi,
      storage.getItem(STORAGE_KEYS.translateStaticUi),
      true
    ),
    provider:
      canonicalizeProviderId(initCfg.provider || storage.getItem(STORAGE_KEYS.provider) || 'google-translate') ||
      'google-translate',
    llmConfig: {
      ...DEFAULT_LLM_CONFIG,
      ...(storage.getJson(STORAGE_KEYS.llmConfig, {}) || {}),
      ...(initCfg.llmConfig && typeof initCfg.llmConfig === 'object' ? initCfg.llmConfig : {}),
    },
    customProviders: Array.isArray(initCfg.customProviders)
      ? initCfg.customProviders
      : storage.getJson(STORAGE_KEYS.customProviders, []) || [],
  };

  let started = false;
  let runtimeActive = false;
  let disposed = false;
  let scanError = null;
  let customProviderError = null;
  let translationError = null;

  const disposables = createDisposableRegistry();
  const catalog = createAntigravityDictionaryCatalog();
  const providerRegistry = createProviderRegistry({ aliasMap: PROVIDER_ALIAS_MAP });
  const customProviderSpecFingerprints = new Map();
  const llmConfigSubscribers = new Set();

  function notifyLlmConfigSubscribers() {
    for (const fn of Array.from(llmConfigSubscribers)) {
      try {
        fn(state.llmConfig);
      } catch (_err) {}
    }
  }

  const googleProvider = createGoogleTranslateAdapter({ fetchFn: effectiveFetch });
  const localLlmProvider = createLocalLlmAdapter({
    fetchFn: effectiveFetch,
    llmConfigPort: {
      getLlmConfig: () => state.llmConfig,
      subscribe(fn) {
        if (typeof fn !== 'function') return () => {};
        llmConfigSubscribers.add(fn);
        return () => llmConfigSubscribers.delete(fn);
      },
    },
  });

  providerRegistry.registerProvider(googleProvider);
  providerRegistry.registerProvider(localLlmProvider);

  const registeredDeclarativeIds = new Set();

  function syncDeclarativeCustomProviders(hostList) {
    customProviderError = null;
    const nextIds = new Set();
    const localRuntimeList = Array.isArray(storage.getJson(STORAGE_KEYS.customProviders, []))
      ? storage.getJson(STORAGE_KEYS.customProviders, [])
      : [];
    // Host declarative customProviders ALWAYS take precedence over stale localStorage entries with the same id.
    const mergedById = new Map();
    for (const spec of localRuntimeList) {
      if (spec && typeof spec === 'object' && spec.id) {
        mergedById.set(String(spec.id).trim().toLowerCase(), spec);
      }
    }
    for (const spec of Array.isArray(hostList) ? hostList : []) {
      if (spec && typeof spec === 'object' && spec.id) {
        mergedById.set(String(spec.id).trim().toLowerCase(), spec);
      }
    }
    for (const spec of mergedById.values()) {
      try {
        const provider = createCustomProviderAdapter(spec, { fetchFn: effectiveFetch });
        providerRegistry.registerProvider(provider);
        customProviderSpecFingerprints.set(
          provider.id,
          `${spec.endpointUrl || ''}|${spec.responsePath || ''}|${JSON.stringify(spec.bodyTemplate || null)}`
        );
        nextIds.add(provider.id);
      } catch (err) {
        customProviderError = `custom-provider(${spec.id}): ${err && err.message ? err.message : String(err)}`;
      }
    }
    for (const oldId of Array.from(registeredDeclarativeIds)) {
      if (!nextIds.has(oldId)) {
        providerRegistry.unregisterProvider(oldId);
        customProviderSpecFingerprints.delete(oldId);
        registeredDeclarativeIds.delete(oldId);
      }
    }
    for (const id of nextIds) {
      registeredDeclarativeIds.add(id);
    }
  }
  syncDeclarativeCustomProviders(state.customProviders);

  const translationService = createTranslationService({
    registry: providerRegistry,
    storage,
    defaultProviderId: 'google-translate',
    providerStorageKey: STORAGE_KEYS.provider,
    cacheStorageKey: STORAGE_KEYS.cache,
    setTimer: targetWin.setTimeout ? targetWin.setTimeout.bind(targetWin) : setTimeout,
    clearTimer: targetWin.clearTimeout ? targetWin.clearTimeout.bind(targetWin) : clearTimeout,
    getProviderCacheVariant: (pid) => {
      if (pid === 'local-llm') {
        return `${state.llmConfig.apiFormat}|${state.llmConfig.baseUrl}|${state.llmConfig.model}`;
      }
      return customProviderSpecFingerprints.get(pid) || '';
    },
    onTranslationError: (err, pid) => {
      translationError = `${pid}: ${err && err.message ? err.message : String(err)}`;
      emitStatus();
    },
  });
  // Sync configured provider without ever silently overwriting a missing/unregistered non-default provider to google-translate.
  if (state.provider) {
    translationService.syncDesiredProviderFromExternal(state.provider);
  }
  disposables.register(() => translationService.dispose());

  const uiLocalizer = createAntigravityUiLocalizer({
    targetDoc,
    catalog,
    translationService,
    isDisposed: () => disposed,
  });

  const triggerController = createAntigravityTriggerController({
    targetDoc,
    targetWin,
    catalog,
    getShowThinkingEnabled: () => state.showThinking,
    isDisposed: () => disposed,
  });

  const thinkingTranslator = createAntigravityThinkingTranslator({
    targetDoc,
    catalog,
    translationService,
    triggerController,
    getTranslateThinkingEnabled: () => state.enabled && state.translateThinking,
    isDisposed: () => disposed,
    setTimer: targetWin.setTimeout ? targetWin.setTimeout.bind(targetWin) : setTimeout,
    clearTimer: targetWin.clearTimeout ? targetWin.clearTimeout.bind(targetWin) : clearTimeout,
  });

  let scheduler = null;

  function emitStatus() {
    if (typeof onStatus !== 'function') return;
    try {
      onStatus(getStatus());
    } catch (_err) {}
  }

  function ensureStyleElement() {
    if (disposed || !targetDoc) return;
    const existing = targetDoc.getElementById && targetDoc.getElementById(STYLE_ID);
    if (existing) return;
    const parent = targetDoc.head || targetDoc.documentElement;
    if (!parent || typeof targetDoc.createElement !== 'function') return;
    const styleEl = targetDoc.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = buildMinimalOverlayCss();
    parent.appendChild(styleEl);
  }

  function scanAll(activeObserver = null) {
    if (disposed || !state.enabled) return;
    try {
      ensureStyleElement();
      triggerController.scanTriggerButtonsSync(false);
      if (state.translateThinking) {
        thinkingTranslator.scanThoughtBlocks();
      } else {
        thinkingTranslator.restoreOriginalCursorEdits();
      }
      if (state.translateStaticUi) {
        const root = targetDoc.body || targetDoc.documentElement;
        if (root) {
          uiLocalizer.localizeStaticUiInRoot(root, activeObserver || (scheduler ? scheduler.getObserver() : null));
        }
      } else {
        uiLocalizer.restoreAllMutatedNodes();
      }
      if (scheduler && typeof scheduler.takeRecords === 'function') {
        scheduler.takeRecords();
      }
      scanError = null;
    } catch (err) {
      scanError = err && err.message ? err.message : String(err);
      emitStatus();
    }
  }

  function activateRuntime() {
    if (disposed || runtimeActive || !state.enabled) return;
    runtimeActive = true;
    ensureStyleElement();
    triggerController.attachListeners();
    if (!scheduler) {
      scheduler = createObserverScheduler({
        targetWin,
        targetDoc,
        disposables,
        uiLocalizer,
        triggerController,
        thinkingTranslator,
        isEnabled: () => !disposed && state.enabled,
        isTranslateThinkingEnabled: () => state.translateThinking,
        isTranslateStaticUiEnabled: () => state.translateStaticUi,
        onEnsureStyle: ensureStyleElement,
        onScanAll: scanAll,
        onError: (err) => {
          scanError = err && err.message ? err.message : String(err);
          emitStatus();
        },
        periodicIntervalMs: 2500,
      });
      disposables.register(() => {
        if (scheduler) {
          scheduler.dispose();
          scheduler = null;
        }
      });
    }
    scheduler.start();
  }

  function deactivateRuntime() {
    if (!runtimeActive) return;
    runtimeActive = false;
    if (scheduler) {
      scheduler.stop();
    }
    triggerController.detachListeners();
    thinkingTranslator.restoreOriginalCursorEdits();
    uiLocalizer.restoreAllMutatedNodes();
    triggerController.restoreTriggerButtons();
  }

  function start() {
    if (disposed) {
      throw new Error('Cannot start a disposed ko-thought-translator instance');
    }
    if (started) return getStatus();
    started = true;
    disposables.register(() => triggerController.detachListeners());

    if (state.enabled) {
      activateRuntime();
    }
    emitStatus();
    return getStatus();
  }

  function updateSettings(next = {}) {
    if (disposed || !next || typeof next !== 'object') return getStatus();

    const prevProvider = state.provider;
    const prevEnabled = state.enabled;
    const prevTranslateThinking = state.translateThinking;
    const prevTranslateStaticUi = state.translateStaticUi;
    const prevLlmSig = `${state.llmConfig.apiFormat}|${state.llmConfig.baseUrl}|${state.llmConfig.model}|${state.llmConfig.allowRemoteHttps}`;

    if (typeof next.enabled === 'boolean') state.enabled = next.enabled;
    if (typeof next.translateThinking === 'boolean') {
      state.translateThinking = next.translateThinking;
      storage.setItem(STORAGE_KEYS.translateThinking, state.translateThinking ? '1' : '0');
    }
    if (typeof next.showThinking === 'boolean') {
      state.showThinking = next.showThinking;
      storage.setItem(STORAGE_KEYS.showThinking, state.showThinking ? '1' : '0');
    }
    if (typeof next.translateStaticUi === 'boolean') {
      state.translateStaticUi = next.translateStaticUi;
      storage.setItem(STORAGE_KEYS.translateStaticUi, state.translateStaticUi ? '1' : '0');
    }
    if (next.llmConfig && typeof next.llmConfig === 'object') {
      state.llmConfig = { ...state.llmConfig, ...next.llmConfig };
      storage.setJson(STORAGE_KEYS.llmConfig, state.llmConfig);
    }
    const nextLlmSig = `${state.llmConfig.apiFormat}|${state.llmConfig.baseUrl}|${state.llmConfig.model}|${state.llmConfig.allowRemoteHttps}`;
    const llmConfigChanged = nextLlmSig !== prevLlmSig;
    if (llmConfigChanged) {
      notifyLlmConfigSubscribers();
    }
    let customProvidersChanged = false;
    if (Array.isArray(next.customProviders)) {
      customProvidersChanged = true;
      state.customProviders = next.customProviders;
      syncDeclarativeCustomProviders(state.customProviders);
      if (state.provider && !providerRegistry.hasProvider(state.provider)) {
        translationService.syncDesiredProviderFromExternal(state.provider);
      }
    }
    if (typeof next.provider === 'string' && next.provider.trim()) {
      const candidate = canonicalizeProviderId(next.provider);
      if (candidate) {
        state.provider = candidate;
        translationError = null;
        if (providerRegistry.hasProvider(candidate)) {
          translationService.setProvider(candidate, { persist: true });
        } else {
          translationService.syncDesiredProviderFromExternal(candidate);
        }
      }
    }

    if (next.clearCache === true) {
      translationService.clearCache();
    }

    if (!state.enabled && prevEnabled) {
      deactivateRuntime();
    } else if (state.enabled && started) {
      if (!runtimeActive) {
        activateRuntime();
      } else if (
        state.provider !== prevProvider ||
        next.clearCache === true ||
        customProvidersChanged ||
        (llmConfigChanged && state.provider === 'local-llm')
      ) {
        translationService.bumpEpoch();
        thinkingTranslator.retranslateVisibleThoughts(false);
      } else if (state.translateThinking !== prevTranslateThinking || state.translateStaticUi !== prevTranslateStaticUi) {
        scanAll();
      } else {
        triggerController.scanTriggerButtonsSync(false);
      }
    }

    emitStatus();
    return getStatus();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    started = false;
    disposables.disposeAll(true);
    thinkingTranslator.restoreOriginalCursorEdits();
    uiLocalizer.restoreAllMutatedNodes();
    triggerController.restoreTriggerButtons();
    const styleEl = targetDoc.getElementById && targetDoc.getElementById(STYLE_ID);
    if (styleEl && typeof styleEl.remove === 'function') {
      styleEl.remove();
    }
    emitStatus();
  }

  function getStatus() {
    return {
      version,
      started,
      disposed,
      enabled: state.enabled,
      translateThinking: state.translateThinking,
      showThinking: state.showThinking,
      translateStaticUi: state.translateStaticUi,
      provider: state.provider,
      availableProviders: providerRegistry.listProviderIds(),
      cacheSize: translationService.getCacheSize(),
      lastError: scanError || customProviderError || translationError,
    };
  }

  function registerCustomProvider(spec) {
    if (disposed) throw new Error('Cannot register custom provider on disposed instance');
    const provider = createCustomProviderAdapter(spec, { fetchFn: effectiveFetch });
    providerRegistry.registerProvider(provider);
    registeredDeclarativeIds.add(provider.id);
    const localList = storage.getJson(STORAGE_KEYS.customProviders, []) || [];
    const filtered = Array.isArray(localList) ? localList.filter((p) => p && p.id !== provider.id) : [];
    filtered.push(spec);
    storage.setJson(STORAGE_KEYS.customProviders, filtered);
    emitStatus();
    return provider.id;
  }

  function unregisterCustomProvider(rawId) {
    const normId = providerRegistry.normalizeId(rawId);
    if (!normId || normId === 'google-translate' || normId === 'local-llm') return false;
    const removed = providerRegistry.unregisterProvider(normId);
    registeredDeclarativeIds.delete(normId);
    const localList = storage.getJson(STORAGE_KEYS.customProviders, []) || [];
    if (Array.isArray(localList)) {
      storage.setJson(
        STORAGE_KEYS.customProviders,
        localList.filter((p) => p && providerRegistry.normalizeId(p.id) !== normId)
      );
    }
    emitStatus();
    return removed;
  }

  return {
    start,
    updateSettings,
    registerCustomProvider,
    unregisterCustomProvider,
    dispose,
    getStatus,
    scanAll,
  };
}

module.exports = {
  STYLE_ID,
  buildMinimalOverlayCss,
  createKoTranslator,
};
