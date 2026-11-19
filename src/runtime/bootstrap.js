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
    provider: String(
      initCfg.provider ||
        storage.getItem(STORAGE_KEYS.provider) ||
        'google-translate'
    ).trim() || 'google-translate',
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
  let disposed = false;
  let lastError = null;

  const disposables = createDisposableRegistry();
  const catalog = createAntigravityDictionaryCatalog();
  const providerRegistry = createProviderRegistry();

  const googleProvider = createGoogleTranslateAdapter({ fetchFn: effectiveFetch });
  const localLlmProvider = createLocalLlmAdapter({
    fetchFn: effectiveFetch,
    llmConfigPort: {
      getLlmConfig: () => state.llmConfig,
    },
  });

  providerRegistry.registerProvider(googleProvider);
  providerRegistry.registerProvider(localLlmProvider);

  function syncDeclarativeCustomProviders(list) {
    if (!Array.isArray(list)) return;
    for (const spec of list) {
      if (!spec || typeof spec !== 'object' || !spec.id) continue;
      try {
        const provider = createCustomProviderAdapter(spec, { fetchFn: effectiveFetch });
        providerRegistry.registerProvider(provider);
      } catch (err) {
        lastError = `custom-provider(${spec.id}): ${err && err.message ? err.message : String(err)}`;
      }
    }
  }
  syncDeclarativeCustomProviders(state.customProviders);

  if (!providerRegistry.hasProvider(state.provider)) {
    state.provider = 'google-translate';
  }

  const translationService = createTranslationService({
    registry: providerRegistry,
    storage,
    defaultProviderId: 'google-translate',
    providerStorageKey: STORAGE_KEYS.provider,
    cacheStorageKey: STORAGE_KEYS.cache,
    setTimer: targetWin.setTimeout ? targetWin.setTimeout.bind(targetWin) : setTimeout,
    clearTimer: targetWin.clearTimeout ? targetWin.clearTimeout.bind(targetWin) : clearTimeout,
  });
  if (state.provider !== translationService.getEffectiveProviderId() && providerRegistry.hasProvider(state.provider)) {
    translationService.setProvider(state.provider, { persist: false });
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

  function scanAll() {
    if (disposed || !state.enabled) return;
    try {
      ensureStyleElement();
      triggerController.scanTriggerButtonsSync(false);
      if (state.translateThinking) {
        thinkingTranslator.scanThoughtBlocks();
        thinkingTranslator.scanSideQuestionAndBrowserThoughts();
      } else {
        thinkingTranslator.restoreOriginalCursorEdits();
      }
      if (state.translateStaticUi) {
        const root = targetDoc.body || targetDoc.documentElement;
        if (root) {
          uiLocalizer.localizeStaticUiDom(root);
        }
      } else {
        uiLocalizer.restoreAllMutatedNodes();
      }
      if (scheduler && typeof scheduler.takeRecords === 'function') {
        scheduler.takeRecords();
      }
      lastError = null;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      emitStatus();
    }
  }

  function start() {
    if (disposed) {
      throw new Error('Cannot start a disposed ko-thought-translator instance');
    }
    if (started) return getStatus();
    started = true;

    if (!state.enabled) {
      emitStatus();
      return getStatus();
    }

    ensureStyleElement();
    triggerController.attachListeners();
    disposables.register(() => triggerController.detachListeners());

    scheduler = createObserverScheduler({
      targetWin,
      targetDoc,
      onScanAll: scanAll,
      scanIntervalMs: 2500,
    });
    scheduler.start();
    disposables.register(() => {
      if (scheduler) {
        scheduler.stop();
        scheduler = null;
      }
    });

    scanAll();
    emitStatus();
    return getStatus();
  }

  function updateSettings(next = {}) {
    if (disposed || !next || typeof next !== 'object') return getStatus();

    const prevProvider = state.provider;
    const prevEnabled = state.enabled;
    const prevTranslateThinking = state.translateThinking;
    const prevTranslateStaticUi = state.translateStaticUi;

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
    if (Array.isArray(next.customProviders)) {
      state.customProviders = next.customProviders;
      storage.setJson(STORAGE_KEYS.customProviders, state.customProviders);
      syncDeclarativeCustomProviders(state.customProviders);
    }
    if (typeof next.provider === 'string' && next.provider.trim()) {
      const candidate = next.provider.trim();
      if (providerRegistry.hasProvider(candidate)) {
        state.provider = candidate;
        translationService.setProvider(candidate, { persist: true });
      }
    }

    if (next.clearCache === true) {
      translationService.clearCache();
    }

    if (!state.enabled && prevEnabled) {
      thinkingTranslator.restoreOriginalCursorEdits();
      uiLocalizer.restoreAllMutatedNodes();
      triggerController.restoreTriggerButtons();
    } else if (state.enabled && started) {
      if (state.provider !== prevProvider || next.clearCache === true) {
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
      lastError,
    };
  }

  return {
    start,
    updateSettings,
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
