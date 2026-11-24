'use strict';

/**
 * Vendor-Neutral Pure Read-Only DOM Overlay Runtime Bootstrap (v2.1.0).
 *
 * Exports `createTranslatorRuntime({ win, doc, hostAdapter, providerBundle, hostCapability, settings, version, fetchFn, onStatus })`
 * -> `{ start(), updateSettings(next), registerCustomProvider(spec), unregisterCustomProvider(id), dispose(), getStatus(), scanAll() }`.
 *
 * Security & DIP Invariants:
 * - Zero concrete host/vendor or translator-provider imports.
 * - Zero `localStorage` authority over security-sensitive settings (`enabled`, toggles,
 *   `provider`, `llmConfig`, `customProviders`): `storage` is used strictly for the translation text cache.
 * - Under `hostCapability` with `settingsBridge` (`getSettings` / `onSettingsChange`), missing or
 *   corrupted host snapshots fail CLOSED (`enabled: false`, `provider: null`).
 * - Respects `hostCapability.isElementInsideIgnored(el)` across Shadow DOM boundaries.
 */

const { createDisposableRegistry } = require('../core/disposable-registry');
const { createProviderRegistry } = require('../core/provider-registry');
const { createTranslationService } = require('../core/translation-service');
const { createObserverScheduler } = require('./observer-scheduler');

function resolveBooleanOption(overrideVal, fallback) {
  if (typeof overrideVal === 'boolean') return overrideVal;
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

function unwrapHostSettingsSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      ok: false,
      enabled: false,
      settingsMissing: true,
      settingsCorrupted: false,
      reason: 'ERR_SETTINGS_FILE_MISSING',
      data: null,
    };
  }
  if (snapshot.status === 'ok' && snapshot.data && typeof snapshot.data === 'object' && !Array.isArray(snapshot.data)) {
    return {
      ok: true,
      enabled: snapshot.data.enabled !== false,
      settingsMissing: false,
      settingsCorrupted: false,
      reason: null,
      data: snapshot.data,
    };
  }
  if (snapshot.status === 'missing') {
    return {
      ok: false,
      enabled: false,
      settingsMissing: true,
      settingsCorrupted: false,
      reason: snapshot.reason || 'ERR_SETTINGS_FILE_MISSING',
      data: null,
    };
  }
  return {
    ok: false,
    enabled: false,
    settingsMissing: false,
    settingsCorrupted: true,
    reason: snapshot.reason || 'SETTINGS_FILE_CORRUPTED',
    data: null,
  };
}

function createTranslatorRuntime({
  win = typeof window !== 'undefined' ? window : null,
  doc = null,
  hostAdapter = null,
  providerBundle = null,
  hostCapability = null,
  settings = null,
  version = '2.3.0',
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

  const hasHostSettingsBridge = Boolean(
    hostCapability && typeof hostCapability.getSettings === 'function'
  );

  let effectiveInitialSettings = settings;
  let initialBridgeError = null;
  let initialSettingsFailClosed = false;

  if (effectiveInitialSettings === null && hasHostSettingsBridge) {
    let rawSnap = null;
    try {
      rawSnap = hostCapability.getSettings();
    } catch (_err) {
      rawSnap = { status: 'error', reason: 'ERR_SETTINGS_BRIDGE_READ_FAILED', data: null };
    }
    const unwrapped = unwrapHostSettingsSnapshot(rawSnap);
    if (unwrapped.ok) {
      effectiveInitialSettings = unwrapped.data;
    } else if (
      unwrapped.settingsMissing &&
      typeof hostAdapter.resolveUninitializedSettings === 'function'
    ) {
      const adapterDefaults = hostAdapter.resolveUninitializedSettings(hostCapability);
      if (adapterDefaults && typeof adapterDefaults === 'object' && !Array.isArray(adapterDefaults)) {
        effectiveInitialSettings = adapterDefaults;
      } else {
        effectiveInitialSettings = {
          enabled: false,
          settingsCorrupted: unwrapped.settingsCorrupted,
          settingsMissing: unwrapped.settingsMissing,
        };
        initialSettingsFailClosed = true;
        initialBridgeError = unwrapped.reason;
      }
    } else {
      effectiveInitialSettings = {
        enabled: false,
        settingsCorrupted: unwrapped.settingsCorrupted,
        settingsMissing: unwrapped.settingsMissing,
      };
      initialSettingsFailClosed = true;
      initialBridgeError = unwrapped.reason;
    }
  }

  const storage = hostAdapter.createStoragePort({ targetWin, initialSettings: effectiveInitialSettings });
  const initCfg = storage.getInitialSettings() || {};
  const settingsCorrupted = initCfg.settingsCorrupted === true;
  const settingsMissing = initCfg.settingsMissing === true;
  const rawInitialProvider =
    initCfg.provider !== undefined && initCfg.provider !== null ? initCfg.provider : null;
  const nonStringInitialProvider =
    rawInitialProvider !== null && typeof rawInitialProvider !== 'string';
  const trimmedInitialProvider = typeof rawInitialProvider === 'string' ? rawInitialProvider.trim() : '';
  const missingBridgeProvider =
    hasHostSettingsBridge &&
    settings === null &&
    !settingsCorrupted &&
    !settingsMissing &&
    !initialSettingsFailClosed &&
    !nonStringInitialProvider &&
    trimmedInitialProvider === '';
  const resolvedInitialProvider =
    !nonStringInitialProvider && trimmedInitialProvider !== ''
      ? canonicalizeProviderId(trimmedInitialProvider, aliasMap)
      : defaultProviderId;
  const invalidInitialProvider =
    !settingsCorrupted &&
    !settingsMissing &&
    !initialSettingsFailClosed &&
    !missingBridgeProvider &&
    (nonStringInitialProvider || (trimmedInitialProvider !== '' && !resolvedInitialProvider));
  const failClosed =
    settingsCorrupted ||
    settingsMissing ||
    initialSettingsFailClosed ||
    missingBridgeProvider ||
    invalidInitialProvider;

  let state = {
    enabled: failClosed ? false : initCfg.enabled !== false,
    translateThinking: resolveBooleanOption(initCfg.translateThinking, true),
    showThinking: resolveBooleanOption(initCfg.showThinking, true),
    translateStaticUi: resolveBooleanOption(initCfg.translateStaticUi, true),
    provider: failClosed ? null : resolvedInitialProvider,
    llmConfig: {
      ...defaultLlmConfig,
      ...(initCfg.llmConfig && typeof initCfg.llmConfig === 'object' ? initCfg.llmConfig : {}),
    },
    customProviders: Array.isArray(initCfg.customProviders) ? initCfg.customProviders.slice() : [],
  };

  let started = false;
  let runtimeActive = false;
  let disposed = false;
  let failClosedFlag = failClosed;
  let settingsCorruptedFlag = settingsCorrupted;
  let settingsMissingFlag = settingsMissing;
  let scanError = null;
  let customProviderError = null;
  let translationError = initialBridgeError
    ? initialBridgeError
    : settingsCorrupted
      ? 'SETTINGS_FILE_CORRUPTED'
      : settingsMissing
        ? 'ERR_SETTINGS_FILE_MISSING'
        : missingBridgeProvider
          ? 'MISSING_PROVIDER_ID'
          : invalidInitialProvider
            ? `INVALID_PROVIDER_ID:${String(rawInitialProvider)}`
            : null;

  const disposables = createDisposableRegistry();
  const statusListeners = new Set();
  const catalog = hostAdapter.createDictionaryCatalog();
  const providerRegistry = createProviderRegistry({ aliasMap });
  const customProviderSpecFingerprints = new Map();
  const imperativeCustomProviders = new Map();
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
    const mergedById = new Map();
    for (const [id, spec] of imperativeCustomProviders.entries()) {
      mergedById.set(id, spec);
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
    providerStorageKey: null, // Strictly forbid localStorage authority over provider selection
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

  const hostNoTranslateSelector =
    hostCapability && typeof hostCapability.getNoTranslateSelector === 'function'
      ? hostCapability.getNoTranslateSelector()
      : null;

  const isHostIgnoredElement =
    hostCapability && typeof hostCapability.isElementInsideIgnored === 'function'
      ? (el) => {
          try {
            return Boolean(hostCapability.isElementInsideIgnored(el));
          } catch (_err) {
            return false;
          }
        }
      : null;

  const uiLocalizer = hostAdapter.createUiLocalizer({
    targetDoc,
    catalog,
    translationService,
    extraExcludedSelector: hostNoTranslateSelector,
    isHostIgnoredElement,
    isDisposed: () => disposed,
  });

  const triggerController = hostAdapter.createTriggerController({
    targetDoc,
    targetWin,
    catalog,
    extraExcludedSelector: hostNoTranslateSelector,
    isHostIgnoredElement,
    getShowThinkingEnabled: () => state.showThinking,
    isDisposed: () => disposed,
  });

  const thinkingTranslator = hostAdapter.createThinkingTranslator({
    targetDoc,
    catalog,
    translationService,
    triggerController,
    extraExcludedSelector: hostNoTranslateSelector,
    isHostIgnoredElement,
    getTranslateThinkingEnabled: () => state.enabled && state.translateThinking,
    isDisposed: () => disposed,
    setTimer: targetWin.setTimeout ? targetWin.setTimeout.bind(targetWin) : setTimeout,
    clearTimer: targetWin.clearTimeout ? targetWin.clearTimeout.bind(targetWin) : clearTimeout,
  });

  let scheduler = null;

  function emitStatus() {
    if (typeof onStatus !== 'function' && statusListeners.size === 0) return;
    const snap = getStatus();
    if (typeof onStatus === 'function') {
      try {
        onStatus(snap);
      } catch (_err) {}
    }
    for (const fn of Array.from(statusListeners)) {
      try {
        fn(snap);
      } catch (_err) {}
    }
  }

  function subscribeStatus(fn) {
    if (typeof fn !== 'function') return () => {};
    statusListeners.add(fn);
    return () => {
      statusListeners.delete(fn);
    };
  }

  function ensureStyleElement() {
    if (disposed || !targetDoc || !hostAdapter.styleId) return;
    const cssText = typeof hostAdapter.buildOverlayCss === 'function' ? hostAdapter.buildOverlayCss() : '';
    if (!cssText) return;
    if (hostCapability && typeof hostCapability.injectStyle === 'function') {
      hostCapability.injectStyle(hostAdapter.styleId, cssText);
      return;
    }
    const existing = targetDoc.getElementById && targetDoc.getElementById(hostAdapter.styleId);
    if (existing) return;
    const parent = targetDoc.head || targetDoc.documentElement;
    if (!parent || typeof targetDoc.createElement !== 'function') return;
    const styleEl = targetDoc.createElement('style');
    styleEl.id = hostAdapter.styleId;
    styleEl.textContent = cssText;
    parent.appendChild(styleEl);
  }

  function restoreThoughtBlocks() {
    if (typeof thinkingTranslator.restoreAll === 'function') {
      thinkingTranslator.restoreAll();
    } else if (typeof thinkingTranslator.restoreOriginalBlocks === 'function') {
      thinkingTranslator.restoreOriginalBlocks();
    }
  }

  function scanAll(activeObserver = null) {
    if (disposed || !state.enabled) return;
    try {
      ensureStyleElement();
      triggerController.scanTriggerButtonsSync(false);
      if (state.translateThinking) {
        thinkingTranslator.scanThoughtBlocks();
      } else {
        restoreThoughtBlocks();
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
        isHostIgnoredElement,
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
    restoreThoughtBlocks();
    uiLocalizer.restoreAllMutatedNodes();
    triggerController.restoreTriggerButtons();
  }

  function applyFailClosed(reason, { corrupted = false, missing = false } = {}) {
    failClosedFlag = true;
    settingsCorruptedFlag = Boolean(corrupted);
    settingsMissingFlag = Boolean(missing);
    state.enabled = false;
    state.provider = null;
    translationError = reason || 'SETTINGS_FILE_CORRUPTED';
    deactivateRuntime();
    emitStatus();
  }

  function applyHostSettingsSnapshot(snapshot) {
    if (disposed) return;
    const unwrapped = unwrapHostSettingsSnapshot(snapshot);
    if (!unwrapped.ok) {
      applyFailClosed(unwrapped.reason, {
        corrupted: unwrapped.settingsCorrupted,
        missing: unwrapped.settingsMissing,
      });
      return;
    }
    const data = unwrapped.data;
    if (data.provider === undefined || data.provider === null) {
      applyFailClosed('MISSING_PROVIDER_ID', { corrupted: true });
      return;
    }
    if (typeof data.provider !== 'string') {
      applyFailClosed(`INVALID_PROVIDER_ID:${String(data.provider)}`, { corrupted: true });
      return;
    }
    const rawProv = data.provider.trim();
    if (!rawProv) {
      applyFailClosed('MISSING_PROVIDER_ID', { corrupted: true });
      return;
    }
    if (!canonicalizeProviderId(rawProv, aliasMap)) {
      applyFailClosed(`INVALID_PROVIDER_ID:${rawProv}`, { corrupted: true });
      return;
    }
    failClosedFlag = false;
    settingsCorruptedFlag = false;
    settingsMissingFlag = false;
    translationError = null;
    updateSettings({
      enabled: data.enabled !== false,
      translateThinking: resolveBooleanOption(data.translateThinking, true),
      showThinking: resolveBooleanOption(data.showThinking, true),
      translateStaticUi: resolveBooleanOption(data.translateStaticUi, true),
      llmConfig: {
        ...defaultLlmConfig,
        ...(data.llmConfig && typeof data.llmConfig === 'object' ? data.llmConfig : {}),
      },
      customProviders: Array.isArray(data.customProviders) ? data.customProviders : [],
      provider: rawProv,
    });
  }

  if (hostCapability && typeof hostCapability.onSettingsChange === 'function') {
    try {
      const unsubscribeSettings = hostCapability.onSettingsChange((snap) => {
        applyHostSettingsSnapshot(snap);
      });
      if (typeof unsubscribeSettings === 'function') {
        disposables.register(unsubscribeSettings);
      }
    } catch (_err) {}
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

    if (next.settingsCorrupted === true || next.settingsMissing === true) {
      applyFailClosed(next.settingsCorrupted ? 'SETTINGS_FILE_CORRUPTED' : 'ERR_SETTINGS_FILE_MISSING', {
        corrupted: next.settingsCorrupted === true,
        missing: next.settingsMissing === true,
      });
      return getStatus();
    }

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
    }
    if (typeof next.showThinking === 'boolean') {
      state.showThinking = next.showThinking;
    }
    if (typeof next.translateStaticUi === 'boolean') {
      state.translateStaticUi = next.translateStaticUi;
    }
    if (next.llmConfig && typeof next.llmConfig === 'object') {
      state.llmConfig = { ...state.llmConfig, ...next.llmConfig };
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
        failClosedFlag = false;
        settingsCorruptedFlag = false;
        settingsMissingFlag = false;
        translationError = null;
        if (providerRegistry.hasProvider(candidate)) {
          translationService.setProvider(candidate, { persist: false });
        } else {
          translationService.syncDesiredProviderFromExternal(candidate);
        }
      } else {
        applyFailClosed(`INVALID_PROVIDER_ID:${next.provider}`, { corrupted: true });
        return getStatus();
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
    restoreThoughtBlocks();
    uiLocalizer.restoreAllMutatedNodes();
    triggerController.restoreTriggerButtons();
    if (hostAdapter.styleId && hostCapability && typeof hostCapability.removeStyle === 'function') {
      try {
        hostCapability.removeStyle(hostAdapter.styleId);
      } catch (_err) {}
    }
    const styleEl = hostAdapter.styleId && targetDoc.getElementById && targetDoc.getElementById(hostAdapter.styleId);
    if (styleEl && typeof styleEl.remove === 'function') {
      styleEl.remove();
    }
    emitStatus();
    statusListeners.clear();
  }

  function getStatus() {
    return {
      version,
      hostId:
        (hostCapability && typeof hostCapability.hostProfileId === 'string' && hostCapability.hostProfileId) ||
        hostAdapter.id ||
        'unknown',
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

  function getConfigSnapshot() {
    return {
      schemaVersion: 1,
      enabled: state.enabled,
      translateThinking: state.translateThinking,
      showThinking: state.showThinking,
      translateStaticUi: state.translateStaticUi,
      provider: state.provider,
      defaultProviderId,
      builtinProviderIds: Array.from(builtinProviderIds),
      availableProviders: providerRegistry.listProviderIds(),
      llmConfig: { ...defaultLlmConfig, ...state.llmConfig },
      customProviders: state.customProviders.map((cp) => (cp && typeof cp === 'object' ? { ...cp } : cp)),
      cacheSize: translationService.getCacheSize(),
      failClosed: failClosedFlag,
      settingsCorrupted: settingsCorruptedFlag,
      settingsMissing: settingsMissingFlag,
      lastError: scanError || customProviderError || translationError,
      hasHostSettingsBridge,
      canSaveSettings: Boolean(
        !hasHostSettingsBridge || (hostCapability && typeof hostCapability.saveSettings === 'function')
      ),
    };
  }

  function retranslateNow(clearCache = false) {
    if (disposed) return getStatus();
    if (clearCache) {
      translationService.clearCache();
    }
    if (state.enabled && started) {
      if (!runtimeActive) {
        activateRuntime();
      } else {
        translationService.bumpEpoch();
        thinkingTranslator.retranslateVisibleThoughts(false);
        scanAll();
      }
    }
    emitStatus();
    return getStatus();
  }

  async function saveSettings(patch = {}) {
    if (disposed) {
      return { ok: false, persisted: false, reason: 'ERR_INSTANCE_DISPOSED', status: getStatus() };
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, persisted: false, reason: 'INVALID_SETTINGS_PATCH', status: getStatus() };
    }
    const candidateProviderRaw =
      patch.provider !== undefined ? patch.provider : state.provider || defaultProviderId;
    const resolvedProvider =
      typeof candidateProviderRaw === 'string' && candidateProviderRaw.trim()
        ? canonicalizeProviderId(candidateProviderRaw, aliasMap)
        : null;
    if (!resolvedProvider) {
      return {
        ok: false,
        persisted: false,
        reason: `INVALID_PROVIDER_ID:${String(candidateProviderRaw)}`,
        status: getStatus(),
      };
    }

    const nextLlmConfig =
      patch.llmConfig && typeof patch.llmConfig === 'object' && !Array.isArray(patch.llmConfig)
        ? { ...defaultLlmConfig, ...state.llmConfig, ...patch.llmConfig }
        : { ...defaultLlmConfig, ...state.llmConfig };

    const nextSettings = {
      schemaVersion: 1,
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : failClosedFlag ? true : state.enabled,
      translateThinking:
        typeof patch.translateThinking === 'boolean' ? patch.translateThinking : state.translateThinking,
      showThinking: typeof patch.showThinking === 'boolean' ? patch.showThinking : state.showThinking,
      translateStaticUi:
        typeof patch.translateStaticUi === 'boolean' ? patch.translateStaticUi : state.translateStaticUi,
      provider: resolvedProvider,
      llmConfig: nextLlmConfig,
      customProviders: Array.isArray(patch.customProviders)
        ? patch.customProviders.slice()
        : state.customProviders.slice(),
    };

    if (hasHostSettingsBridge) {
      if (!hostCapability || typeof hostCapability.saveSettings !== 'function') {
        return { ok: false, persisted: false, reason: 'ERR_HOST_SAVE_UNSUPPORTED', status: getStatus() };
      }
      let res;
      try {
        res = await hostCapability.saveSettings(nextSettings);
      } catch (err) {
        return {
          ok: false,
          persisted: false,
          reason: err && err.message ? err.message : 'ERR_SETTINGS_SAVE_FAILED',
          status: getStatus(),
        };
      }
      if (!res || res.ok !== true) {
        return {
          ok: false,
          persisted: false,
          reason: (res && res.reason) || 'ERR_SETTINGS_SAVE_FAILED',
          status: getStatus(),
        };
      }
      if (res.snapshot && typeof res.snapshot === 'object') {
        applyHostSettingsSnapshot(res.snapshot);
      } else {
        applyHostSettingsSnapshot({ status: 'ok', data: nextSettings });
      }
      return { ok: true, persisted: true, reason: null, status: getStatus() };
    }

    failClosedFlag = false;
    settingsCorruptedFlag = false;
    settingsMissingFlag = false;
    translationError = null;
    updateSettings(nextSettings);
    return { ok: true, persisted: false, reason: null, status: getStatus() };
  }

  function registerCustomProvider(spec) {
    if (disposed) throw new Error('Cannot register custom provider on disposed instance');
    if (typeof providerBundle.createCustomProvider !== 'function') {
      throw new Error('Active providerBundle does not support custom providers');
    }
    const provider = providerBundle.createCustomProvider(spec, { fetchFn: effectiveFetch });
    const normalizedSpec = provider.spec ? { ...provider.spec } : { ...spec, id: provider.id };
    imperativeCustomProviders.set(provider.id, normalizedSpec);
    providerRegistry.registerProvider(provider);
    customProviderSpecFingerprints.set(provider.id, buildCustomProviderFingerprint(normalizedSpec));
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
    imperativeCustomProviders.delete(normId);
    registeredDeclarativeIds.delete(normId);
    customProviderSpecFingerprints.delete(normId);
    if (removed) {
      translationService.bumpEpoch();
      if (state.provider === normId && started && runtimeActive && state.enabled) {
        restoreThoughtBlocks();
      }
    }
    emitStatus();
    return removed;
  }

  return {
    start,
    updateSettings,
    saveSettings,
    retranslateNow,
    subscribeStatus,
    getConfigSnapshot,
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
