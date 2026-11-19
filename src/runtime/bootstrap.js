'use strict';

/**
 * Vendor-Neutral Pure Read-Only DOM Overlay Runtime Bootstrap.
 *
 * Exports `createTranslatorRuntime({ win, doc, hostAdapter, providerBundle, settings, version, fetchFn, onStatus })`
 * -> `{ start(), updateSettings(next), registerCustomProvider(spec), unregisterCustomProvider(id), dispose(), getStatus(), scanAll() }`.
 *
 * Zero concrete host/vendor or translator-provider imports:
 * - Host DOM rules, selectors, CSS, dictionaries, and storage port are injected via `hostAdapter`.
 * - Built-in / custom translation providers and aliases are injected via `providerBundle`.
 */

const { createDisposableRegistry } = require('../core/disposable-registry');
const { createProviderRegistry } = require('../core/provider-registry');
const { createTranslationService } = require('../core/translation-service');
const { createObserverScheduler } = require('./observer-scheduler');

function resolveBooleanOption(overrideVal, storedVal, fallback) {
  if (typeof overrideVal === 'boolean') return overrideVal;
  if (storedVal === '1' || storedVal === 'true' || storedVal === true) return true;
  if (storedVal === '0' || storedVal === 'false' || storedVal === false) return false;
  return Boolean(fallback);
}

function canonicalizeProviderId(rawId, aliasMap = {}) {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim().toLowerCase();
  if (!trimmed || trimmed === '__proto__' || trimmed === 'constructor' || trimmed === 'prototype') return null;
  const mapped =
    aliasMap && Object.prototype.hasOwnProperty.call(aliasMap, trimmed)
      ? aliasMap[trimmed]
      : trimmed;
  return /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(mapped) ? mapped : null;
}

function createTranslatorRuntime({
  win = typeof window !== 'undefined' ? window : null,
  doc = null,
  hostAdapter = null,
  providerBundle = null,
  settings = null,
  version = '2.0.0',
  fetchFn = null,
  onStatus = null,
} = {}) {
  const targetWin = win;
  const targetDoc = doc || (targetWin && targetWin.document) || null;
  if (!targetWin || !targetDoc) {
    throw new Error('createTranslatorRuntime requires valid window and document objects');
  }
  if (!hostAdapter || typeof hostAdapter !== 'object') {
    throw new Error('createTranslatorRuntime requires a hostAdapter port');
  }
  if (!providerBundle || typeof providerBundle !== 'object') {
    throw new Error('createTranslatorRuntime requires a providerBundle port');
  }

  const effectiveFetch =
    typeof fetchFn === 'function'
      ? fetchFn
      : typeof targetWin.fetch === 'function'
        ? targetWin.fetch.bind(targetWin)
        : typeof fetch === 'function'
          ? fetch.bind(globalThis)
          : null;

  const storageKeys = hostAdapter.storageKeys || {};
  const defaultProviderId = providerBundle.defaultProviderId || 'default';
  const defaultLlmConfig = providerBundle.defaultLlmConfig || {};
  const aliasMap = providerBundle.aliasMap || {};
  const builtinProviderIds = new Set(
    Array.isArray(providerBundle.builtinProviderIds) ? providerBundle.builtinProviderIds : [defaultProviderId]
  );

  const storage = hostAdapter.createStoragePort({ targetWin, initialSettings: settings });
  const initCfg = storage.getInitialSettings() || {};
  const settingsCorrupted = initCfg.settingsCorrupted === true;
  const rawInitialProvider =
    initCfg.provider !== undefined && initCfg.provider !== null
      ? initCfg.provider
      : storage.getItem(storageKeys.provider);
  const resolvedInitialProvider =
    rawInitialProvider !== undefined && rawInitialProvider !== null && String(rawInitialProvider).trim() !== ''
      ? canonicalizeProviderId(String(rawInitialProvider), aliasMap)
      : defaultProviderId;
  const invalidInitialProvider =
    !settingsCorrupted &&
    rawInitialProvider !== undefined &&
    rawInitialProvider !== null &&
    String(rawInitialProvider).trim() !== '' &&
    !resolvedInitialProvider;

  let state = {
    enabled: settingsCorrupted || invalidInitialProvider ? false : initCfg.enabled !== false,
    translateThinking: resolveBooleanOption(
      initCfg.translateThinking,
      storage.getItem(storageKeys.translateThinking),
      true
    ),
    showThinking: resolveBooleanOption(
      initCfg.showThinking,
      storage.getItem(storageKeys.showThinking),
      true
    ),
    translateStaticUi: resolveBooleanOption(
      initCfg.translateStaticUi,
      storage.getItem(storageKeys.translateStaticUi),
      true
    ),
    provider: settingsCorrupted || invalidInitialProvider ? null : resolvedInitialProvider,
    llmConfig: {
      ...defaultLlmConfig,
      ...(storage.getJson(storageKeys.llmConfig, {}) || {}),
      ...(initCfg.llmConfig && typeof initCfg.llmConfig === 'object' ? initCfg.llmConfig : {}),
    },
    customProviders: Array.isArray(initCfg.customProviders)
      ? initCfg.customProviders
      : storage.getJson(storageKeys.customProviders, []) || [],
  };

  let started = false;
  let runtimeActive = false;
  let disposed = false;
  let scanError = null;
  let customProviderError = null;
  let translationError = settingsCorrupted
    ? 'SETTINGS_FILE_CORRUPTED'
    : invalidInitialProvider
      ? `INVALID_PROVIDER_ID:${String(rawInitialProvider)}`
      : null;

  const disposables = createDisposableRegistry();
  const catalog = hostAdapter.createDictionaryCatalog();
  const providerRegistry = createProviderRegistry({ aliasMap });
  const customProviderSpecFingerprints = new Map();
  const llmConfigSubscribers = new Set();

  function notifyLlmConfigSubscribers() {
    for (const fn of Array.from(llmConfigSubscribers)) {
      try {
        fn(state.llmConfig);
      } catch (_err) {}
    }
  }

  const llmConfigPort = {
    getLlmConfig: () => state.llmConfig,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      llmConfigSubscribers.add(fn);
      return () => llmConfigSubscribers.delete(fn);
    },
  };

  const builtinProviders =
    typeof providerBundle.createBuiltinProviders === 'function'
      ? providerBundle.createBuiltinProviders({ fetchFn: effectiveFetch, llmConfigPort })
      : [];
  for (const provider of builtinProviders) {
    providerRegistry.registerProvider(provider);
  }

  const registeredDeclarativeIds = new Set();

  function buildCustomProviderFingerprint(spec) {
    if (!spec || typeof spec !== 'object') return '';
    return `${spec.endpointUrl || ''}|${spec.responsePath || ''}|${spec.timeoutMs || ''}|${JSON.stringify(spec.headers || null)}|${JSON.stringify(spec.bodyTemplate || null)}`;
  }

  function syncDeclarativeCustomProviders(hostList) {
    customProviderError = null;
    if (typeof providerBundle.createCustomProvider !== 'function') return;
    const nextIds = new Set();
    const localRuntimeList = Array.isArray(storage.getJson(storageKeys.customProviders, []))
      ? storage.getJson(storageKeys.customProviders, [])
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
        const provider = providerBundle.createCustomProvider(spec, { fetchFn: effectiveFetch });
        providerRegistry.registerProvider(provider);
        customProviderSpecFingerprints.set(provider.id, buildCustomProviderFingerprint(provider.spec || spec));
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
    defaultProviderId,
    providerStorageKey: storageKeys.provider,
    cacheStorageKey: storageKeys.cache,
    setTimer: targetWin.setTimeout ? targetWin.setTimeout.bind(targetWin) : setTimeout,
    clearTimer: targetWin.clearTimeout ? targetWin.clearTimeout.bind(targetWin) : clearTimeout,
    getProviderCacheVariant: (pid) => {
      if (typeof providerBundle.getProviderCacheVariant === 'function') {
        const builtinVariant = providerBundle.getProviderCacheVariant(pid, state.llmConfig);
        if (builtinVariant) return builtinVariant;
      }
      return customProviderSpecFingerprints.get(pid) || '';
    },
    onTranslationError: (err, pid) => {
      translationError = `${pid}: ${err && err.message ? err.message : String(err)}`;
      emitStatus();
    },
  });
  if (state.provider) {
    translationService.syncDesiredProviderFromExternal(state.provider);
  }
  disposables.register(() => translationService.dispose());

  const uiLocalizer = hostAdapter.createUiLocalizer({
    targetDoc,
    catalog,
    translationService,
    isDisposed: () => disposed,
  });

  const triggerController = hostAdapter.createTriggerController({
    targetDoc,
    targetWin,
    catalog,
    getShowThinkingEnabled: () => state.showThinking,
    isDisposed: () => disposed,
  });

  const thinkingTranslator = hostAdapter.createThinkingTranslator({
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
    if (disposed || !targetDoc || !hostAdapter.styleId) return;
    const existing = targetDoc.getElementById && targetDoc.getElementById(hostAdapter.styleId);
    if (existing) return;
    const parent = targetDoc.head || targetDoc.documentElement;
    if (!parent || typeof targetDoc.createElement !== 'function') return;
    const cssText = typeof hostAdapter.buildOverlayCss === 'function' ? hostAdapter.buildOverlayCss() : '';
    if (!cssText) return;
    const styleEl = targetDoc.createElement('style');
    styleEl.id = hostAdapter.styleId;
    styleEl.textContent = cssText;
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
        selectors: hostAdapter.selectors || null,
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
      throw new Error('Cannot start a disposed translator runtime instance');
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
    const getConfigSig = (cfg) =>
      typeof providerBundle.getRuntimeConfigSignature === 'function'
        ? providerBundle.getRuntimeConfigSignature(cfg)
        : JSON.stringify(cfg || null);
    const prevLlmSig = getConfigSig(state.llmConfig);

    if (typeof next.enabled === 'boolean') state.enabled = next.enabled;
    if (typeof next.translateThinking === 'boolean') {
      state.translateThinking = next.translateThinking;
      storage.setItem(storageKeys.translateThinking, state.translateThinking ? '1' : '0');
    }
    if (typeof next.showThinking === 'boolean') {
      state.showThinking = next.showThinking;
      storage.setItem(storageKeys.showThinking, state.showThinking ? '1' : '0');
    }
    if (typeof next.translateStaticUi === 'boolean') {
      state.translateStaticUi = next.translateStaticUi;
      storage.setItem(storageKeys.translateStaticUi, state.translateStaticUi ? '1' : '0');
    }
    if (next.llmConfig && typeof next.llmConfig === 'object') {
      state.llmConfig = { ...state.llmConfig, ...next.llmConfig };
      storage.setJson(storageKeys.llmConfig, state.llmConfig);
    }
    const nextLlmSig = getConfigSig(state.llmConfig);
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
      const candidate = canonicalizeProviderId(next.provider, aliasMap);
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
        (llmConfigChanged &&
          (typeof providerBundle.shouldRetranslateOnConfigChange === 'function'
            ? providerBundle.shouldRetranslateOnConfigChange(state.provider)
            : true))
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
    const styleEl = hostAdapter.styleId && targetDoc.getElementById && targetDoc.getElementById(hostAdapter.styleId);
    if (styleEl && typeof styleEl.remove === 'function') {
      styleEl.remove();
    }
    emitStatus();
  }

  function getStatus() {
    return {
      version,
      hostId: hostAdapter.id || 'unknown',
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
    if (typeof providerBundle.createCustomProvider !== 'function') {
      throw new Error('Active providerBundle does not support custom providers');
    }
    const provider = providerBundle.createCustomProvider(spec, { fetchFn: effectiveFetch });
    const normalizedSpec = provider.spec ? { ...provider.spec } : { ...spec, id: provider.id };
    providerRegistry.registerProvider(provider);
    customProviderSpecFingerprints.set(provider.id, buildCustomProviderFingerprint(normalizedSpec));
    const localList = storage.getJson(storageKeys.customProviders, []) || [];
    const filtered = Array.isArray(localList)
      ? localList.filter((p) => p && providerRegistry.normalizeId(p.id) !== provider.id)
      : [];
    filtered.push(normalizedSpec);
    storage.setJson(storageKeys.customProviders, filtered);
    translationService.bumpEpoch();
    if (started && runtimeActive && state.enabled && state.provider === provider.id) {
      thinkingTranslator.retranslateVisibleThoughts(false);
    }
    emitStatus();
    return provider.id;
  }

  function unregisterCustomProvider(rawId) {
    const normId = providerRegistry.normalizeId(rawId);
    if (!normId || builtinProviderIds.has(normId)) return false;
    const removed = providerRegistry.unregisterProvider(normId);
    registeredDeclarativeIds.delete(normId);
    customProviderSpecFingerprints.delete(normId);
    const localList = storage.getJson(storageKeys.customProviders, []) || [];
    if (Array.isArray(localList)) {
      storage.setJson(
        storageKeys.customProviders,
        localList.filter((p) => p && providerRegistry.normalizeId(p.id) !== normId)
      );
    }
    if (removed) {
      translationService.bumpEpoch();
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
  canonicalizeProviderId,
  createTranslatorRuntime,
};
