'use strict';

const { createDisposableRegistry } = require('../core/disposable-registry');
const { createProviderRegistry } = require('../core/provider-registry');
const { createTranslationService } = require('../core/translation-service');

const { createStatusbarAdapterPort } = require('../adapters/statusbar-port');
const { createGoogleTranslateAdapter } = require('../adapters/translators/google-translate');
const { createLocalLlmAdapter } = require('../adapters/translators/local-llm');

const {
  ANTIGRAVITY_PROVIDER_ALIASES,
  DEFAULT_ANTIGRAVITY_LLM_CONFIG,
  resolveAntigravityHostConfig,
} = require('../adapters/antigravity/host-config-preset');
const {
  STORAGE_KEYS,
  createAntigravityStorageAdapter,
  createNativeStorageBridge,
  createAntigravityLlmConfigAdapter,
  createOriginLocalCustomProviderStore,
} = require('../adapters/antigravity/storage-port');
const { createAntigravityDictionaryCatalog } = require('../adapters/antigravity/dictionaries/index');
const { createAntigravityUiLocalizer } = require('../adapters/antigravity/ui-localizer');
const { createAntigravityTriggerController } = require('../adapters/antigravity/trigger-controller');
const { createAntigravityThinkingTranslator } = require('../adapters/antigravity/thinking-translator');
const { createAntigravityPretranslator } = require('../adapters/antigravity/pretranslator');
const { createAntigravitySettingsUi } = require('../adapters/antigravity/settings-ui');
const { createAntigravityRemoteCompanionSync } = require('../adapters/antigravity/remote-companion-sync');

const { createCspSecurityPort } = require('../remote/csp-security-policy');
const { createWorkbenchPromoter } = require('../remote/workbench-promoter');
const { createObserverScheduler } = require('./observer-scheduler');

function normalizeAntigravityProviderAlias(rawId, registry) {
  const trimmed = String(rawId || '')
    .trim()
    .toLowerCase();
  if (!trimmed) return '';
  if (Object.prototype.hasOwnProperty.call(ANTIGRAVITY_PROVIDER_ALIASES, trimmed)) {
    return ANTIGRAVITY_PROVIDER_ALIASES[trimmed];
  }
  return registry ? registry.normalizeId(trimmed) : trimmed;
}

function isUnsupportedDocumentEnvironment(targetWin, targetDoc) {
  if (!targetWin || !targetDoc) return true;
  // D-0034: Skip data:, devtools:, chrome-extension:, blob:, file:, and non-HTML (XML/SVG) documents!
  try {
    const proto = String((targetWin.location && targetWin.location.protocol) || '').toLowerCase();
    if (
      proto &&
      proto !== 'https:' &&
      proto !== 'http:' &&
      proto !== 'about:'
    ) {
      return true;
    }
  } catch (_err) {
    return true;
  }
  try {
    const contentType = String(targetDoc.contentType || '').toLowerCase();
    if (contentType && !contentType.includes('html')) {
      return true;
    }
    const rootTag = String((targetDoc.documentElement && targetDoc.documentElement.tagName) || '').toUpperCase();
    if (rootTag && rootTag !== 'HTML') {
      return true;
    }
  } catch (_err) {}
  return false;
}

function isRemoteControlRuntimeEnvironment(targetWin, targetDoc, hostCfg) {
  try {
    if (targetWin && targetWin.__APP_CONFIG__ && targetWin.__APP_CONFIG__.isRemoteControl === true) {
      return true;
    }
  } catch (_err) {}
  try {
    const sel = (hostCfg && hostCfg.remoteControlSelector) || 'ga-remote-control';
    if (targetDoc && typeof targetDoc.querySelector === 'function' && targetDoc.querySelector(sel)) {
      return true;
    }
  } catch (_err) {}
  try {
    const pathname = String((targetWin && targetWin.location && targetWin.location.pathname) || '');
    if (pathname.startsWith('/r/') || pathname.startsWith('/web/')) {
      return true;
    }
  } catch (_err) {}
  return false;
}

function propagateToAccessibleSameOriginFrames(targetWin, targetDoc, fn) {
  // D-0017: Cross-frame propagation wrapped in try/catch per frame!
  if (!targetDoc || typeof targetDoc.querySelectorAll !== 'function') return;
  try {
    const iframes = targetDoc.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
      try {
        const cw = iframes[i] && iframes[i].contentWindow;
        if (cw && cw !== targetWin) {
          fn(cw);
        }
      } catch (_err) {}
    }
  } catch (_err) {}
}

function createRuntimeBootstrapper(defaults = {}) {
  const version = String(defaults.version || 'v2.0.0');
  const defaultPretranslateEnabled = Boolean(defaults.defaultPretranslateEnabled);
  const defaultProviderRaw = String(defaults.defaultTranslationProvider || 'google-translate');
  const defaultLlmConfig = defaults.defaultLlmConfig || DEFAULT_ANTIGRAVITY_LLM_CONFIG;

  // Rev7-F3: Parameterized `mount(targetWin, targetDoc)` wiring ALL adapters against `(targetWin, targetDoc)`!
  function mount(rawWin, rawDoc) {
    const targetWin = rawWin || (typeof window !== 'undefined' ? window : null);
    const targetDoc = rawDoc || (targetWin && targetWin.document) || (typeof document !== 'undefined' ? document : null);
    if (isUnsupportedDocumentEnvironment(targetWin, targetDoc)) {
      return { mounted: false, reason: 'UNSUPPORTED_DOCUMENT' };
    }

    // If same version is already mounted, sync host defaults if changed and force rescan
    if (targetWin.__agyKoLocalizerActive === version && typeof targetWin.__agyForceRescanAll === 'function') {
      if (targetWin.__agyLastDefaultProvider !== defaultProviderRaw && typeof targetWin.__agySetTranslationProvider === 'function') {
        targetWin.__agyLastDefaultProvider = defaultProviderRaw;
        try {
          targetWin.__agySetTranslationProvider(defaultProviderRaw);
        } catch (_err) {}
      }
      if (targetWin.__agyLastDefaultPretranslate !== defaultPretranslateEnabled && typeof targetWin.__agySetPretranslate === 'function') {
        targetWin.__agyLastDefaultPretranslate = defaultPretranslateEnabled;
        try {
          targetWin.__agySetPretranslate(defaultPretranslateEnabled);
        } catch (_err) {}
      }
      if (typeof targetWin.__agySyncPersistentSettings === 'function') {
        Promise.resolve(targetWin.__agySyncPersistentSettings()).catch(() => {});
      }
      targetWin.__agyForceRescanAll();
      return { mounted: true, reused: true, version };
    }

    // Hot-swap cleanup of any prior version in this window
    if (typeof targetWin.__agyKoThoughtCleanup === 'function') {
      try {
        targetWin.__agyKoThoughtCleanup(false);
      } catch (_err) {}
    }

    let disposed = false;
    const isDisposed = () => disposed;
    const disposables = createDisposableRegistry();
    const hostCfg = resolveAntigravityHostConfig(targetWin);
    const allowLoopbackForTest = Boolean(
      targetWin.__AGY_HOST_ADAPTER_CONFIG__ && targetWin.__AGY_HOST_ADAPTER_CONFIG__.__allowLoopbackForTest
    );

    const setTimer =
      targetWin && typeof targetWin.setTimeout === 'function'
        ? targetWin.setTimeout.bind(targetWin)
        : setTimeout;
    const clearTimer =
      targetWin && typeof targetWin.clearTimeout === 'function'
        ? targetWin.clearTimeout.bind(targetWin)
        : clearTimeout;
    const fetchFn =
      targetWin && typeof targetWin.fetch === 'function'
        ? targetWin.fetch.bind(targetWin)
        : typeof fetch === 'function'
          ? fetch.bind(globalThis)
          : null;

    const storage = createAntigravityStorageAdapter(targetWin);
    const nativeBridge = createNativeStorageBridge(targetWin);
    const llmConfigPort = createAntigravityLlmConfigAdapter({
      storage,
      nativeBridge,
      defaultConfig: defaultLlmConfig,
    });

    const registry = createProviderRegistry();
    if (typeof fetchFn === 'function') {
      registry.registerProvider(
        createGoogleTranslateAdapter({
          fetchFn,
          setTimer,
          clearTimer,
        })
      );
      registry.registerProvider(
        createLocalLlmAdapter({
          llmConfigPort,
          fetchFn,
          setTimer,
          clearTimer,
        })
      );
    }

    const customProviderStore = createOriginLocalCustomProviderStore({
      storage,
      registry,
      fetchFn,
      setTimer,
      clearTimer,
    });
    customProviderStore.hydrateIntoRegistry();

    const sharedMemCache = (() => {
      try {
        if (targetWin.parent && targetWin.parent !== targetWin && targetWin.parent.__agySharedKoMemCache instanceof Map) {
          return targetWin.parent.__agySharedKoMemCache;
        }
      } catch (_err) {}
      if (!(targetWin.__agySharedKoMemCache instanceof Map)) {
        targetWin.__agySharedKoMemCache = new Map();
      }
      return targetWin.__agySharedKoMemCache;
    })();

    const defaultProviderId =
      normalizeAntigravityProviderAlias(defaultProviderRaw, registry) || 'google-translate';
    const isRemoteEnv = isRemoteControlRuntimeEnvironment(targetWin, targetDoc, hostCfg);

    // Normalize any legacy stored alias ('google', 'local', 'ollama') before creating TranslationService
    const existingRawProv = storage.getItem(STORAGE_KEYS.PROVIDER);
    if (existingRawProv) {
      const normalizedStored = normalizeAntigravityProviderAlias(existingRawProv, registry);
      if (normalizedStored && normalizedStored !== existingRawProv) {
        storage.setItem(STORAGE_KEYS.PROVIDER, normalizedStored);
      }
    }

    const translationService = createTranslationService({
      registry,
      storage,
      defaultProviderId,
      isRemoteEnv,
      providerStorageKey: STORAGE_KEYS.PROVIDER,
      cacheStorageKey: STORAGE_KEYS.CACHE,
      setTimer,
      clearTimer,
      sharedMemCache,
    });

    let showThinkingEnabled = true;
    const savedShow = storage.getItem(STORAGE_KEYS.SHOW_THINKING);
    if (savedShow === '0' || savedShow === 'false') showThinkingEnabled = false;

    let translateThinkingEnabled = true;
    const savedTrans = storage.getItem(STORAGE_KEYS.TRANSLATE_THINKING);
    if (savedTrans === '0' || savedTrans === 'false') translateThinkingEnabled = false;

    const catalog = createAntigravityDictionaryCatalog();
    const cspSecurityPort = createCspSecurityPort(hostCfg, targetWin, disposables, {
      allowLoopbackForTest,
    });

    let settingsUi = null;
    let statusbarPort = null;
    let scheduler = null;

    const uiLocalizer = createAntigravityUiLocalizer({
      targetDoc,
      catalog,
      translationService,
      isDisposed,
    });

    const triggerController = createAntigravityTriggerController({
      targetDoc,
      catalog,
      disposables,
      getShowThinkingEnabled: () => showThinkingEnabled,
      onEnsureStyle: () => {
        if (settingsUi) settingsUi.ensureStyle();
      },
    });

    const pretranslator = createAntigravityPretranslator({
      targetWin,
      targetDoc,
      storage,
      nativeBridge,
      translationService,
      defaultPretranslateEnabled,
      getTranslateThinkingEnabled: () => translateThinkingEnabled,
      isDisposed,
      onRefreshUi: () => {
        if (settingsUi) settingsUi.refreshUi();
      },
      onBroadcastPretranslate: (nextVal) => {
        propagateToAccessibleSameOriginFrames(targetWin, targetDoc, (cw) => {
          if (typeof cw.__agySetPretranslate === 'function') {
            cw.__agySetPretranslate(nextVal, { persistHost: false, broadcast: false });
          }
        });
      },
    });

    const thinkingTranslator = createAntigravityThinkingTranslator({
      targetDoc,
      catalog,
      translationService,
      triggerController,
      getTranslateThinkingEnabled: () => translateThinkingEnabled,
      onTriggerPretranslate: () => {
        if (scheduler) scheduler.schedulePretranslateDebounce();
      },
      isDisposed,
      setTimer,
      clearTimer,
    });

    function setShowThinkingEnabled(enabled, { broadcast = true } = {}) {
      showThinkingEnabled = Boolean(enabled);
      storage.setItem(STORAGE_KEYS.SHOW_THINKING, showThinkingEnabled ? '1' : '0');
      triggerController.syncShowThinkingDomAttribute();
      triggerController.scanTriggerButtonsSync(!showThinkingEnabled);
      if (settingsUi) settingsUi.refreshUi();
      if (broadcast) {
        propagateToAccessibleSameOriginFrames(targetWin, targetDoc, (cw) => {
          if (typeof cw.__agySetShowThinking === 'function') {
            cw.__agySetShowThinking(showThinkingEnabled, { broadcast: false });
          }
        });
      }
      return { showThinkingEnabled };
    }

    function setTranslateThinkingEnabled(enabled, { broadcast = true } = {}) {
      translateThinkingEnabled = Boolean(enabled);
      storage.setItem(STORAGE_KEYS.TRANSLATE_THINKING, translateThinkingEnabled ? '1' : '0');
      if (!translateThinkingEnabled) {
        thinkingTranslator.restoreOriginalCursorEdits();
      } else {
        thinkingTranslator.scanThoughtBlocks();
      }
      if (settingsUi) settingsUi.refreshUi();
      if (broadcast) {
        propagateToAccessibleSameOriginFrames(targetWin, targetDoc, (cw) => {
          if (typeof cw.__agySetTranslateThinking === 'function') {
            cw.__agySetTranslateThinking(translateThinkingEnabled, { broadcast: false });
          }
        });
      }
      return { translateThinkingEnabled };
    }

    function selectTranslationProvider(rawId, { persistHost = true, broadcast = true } = {}) {
      const normalized = normalizeAntigravityProviderAlias(rawId, registry);
      const res = translationService.setProvider(normalized, { persist: true });
      if (persistHost && nativeBridge && typeof nativeBridge.writeItems === 'function') {
        nativeBridge.writeItems({ [STORAGE_KEYS.PROVIDER]: res.desiredProviderId });
      }
      if (statusbarPort) statusbarPort.refresh();
      if (settingsUi) settingsUi.refreshUi();
      if (broadcast) {
        propagateToAccessibleSameOriginFrames(targetWin, targetDoc, (cw) => {
          if (typeof cw.__agySetTranslationProvider === 'function') {
            try {
              cw.__agySetTranslationProvider(res.desiredProviderId, {
                persistHost: false,
                broadcast: false,
              });
            } catch (_err) {}
          }
        });
      }
      return {
        provider: res.effectiveProviderId,
        desiredProvider: res.desiredProviderId,
        availableProviders: res.availableProviders,
      };
    }

    settingsUi = createAntigravitySettingsUi({
      targetWin,
      targetDoc,
      version,
      registry,
      translationService,
      llmConfigPort,
      customProviderStore,
      resolveCspNonce: () => cspSecurityPort.resolveHostCspNonce(targetDoc),
      getShowThinkingEnabled: () => showThinkingEnabled,
      onToggleShowThinking: (val) => setShowThinkingEnabled(val),
      getTranslateThinkingEnabled: () => translateThinkingEnabled,
      onToggleTranslateThinking: (val) => setTranslateThinkingEnabled(val),
      getPretranslateEnabled: () => pretranslator.getRawFlag(),
      onTogglePretranslate: (val) => pretranslator.setPretranslateEnabled(val),
      onSelectProvider: (id) => selectTranslationProvider(id),
      onRetranslate: (clearCache) =>
        thinkingTranslator.retranslateVisibleThoughts(clearCache, () => pretranslator.resetHistory()),
      onRefreshStatusbar: () => {
        if (statusbarPort) statusbarPort.refresh();
      },
      setTimer,
      clearTimer,
    });

    statusbarPort = createStatusbarAdapterPort({
      targetWin,
      version,
      translationService,
      registry,
      getCompactTag: (effId) => settingsUi.getProviderDisplayMeta(effId).compactTag,
      getProviderTitle: (effId) => settingsUi.getProviderDisplayMeta(effId).title,
      onToggleSettings: () => settingsUi.openOrToggleModal(),
      onCloseSettings: () => settingsUi.closeModal(),
      onCycleProvider: () => {
        const ids = registry.listProviderIds();
        if (ids.length > 0) {
          const cur = translationService.getDesiredProviderId();
          const idx = ids.indexOf(cur);
          const next = ids[(idx + 1) % ids.length];
          selectTranslationProvider(next);
          thinkingTranslator.retranslateVisibleThoughts(false);
        }
      },
    });

    translationService.subscribe(() => {
      if (statusbarPort) statusbarPort.refresh();
    });
    llmConfigPort.subscribe((cfg) => {
      if (statusbarPort) statusbarPort.refresh();
      if (settingsUi) settingsUi.refreshUi();
      propagateToAccessibleSameOriginFrames(targetWin, targetDoc, (cw) => {
        if (typeof cw.__agySyncLlmConfigFromParent === 'function') {
          cw.__agySyncLlmConfigFromParent(cfg);
        }
      });
    });

    const remoteHostPort = createAntigravityRemoteCompanionSync({
      targetWin,
      targetDoc,
      hostCfg,
      version,
      disposables,
      onRefreshStatusbar: () => {
        if (statusbarPort) statusbarPort.refresh();
      },
      onMountChildLocalizer: (cw, cd) => {
        mount(cw, cd);
      },
      fetchFn,
    });

    const workbenchPromoter = createWorkbenchPromoter({
      hostCfg,
      cspSecurityPort,
      remoteHostPort,
      rootWin: targetWin,
      rootDoc: targetDoc,
      disposables,
    });

    async function syncPersistentTranslatorSettings() {
      await llmConfigPort.syncFromNativeStorage();
      if (nativeBridge && typeof nativeBridge.readItems === 'function') {
        const items = await nativeBridge.readItems();
        if (items && typeof items === 'object') {
          if (items[STORAGE_KEYS.PROVIDER]) {
            const normP = normalizeAntigravityProviderAlias(items[STORAGE_KEYS.PROVIDER], registry);
            if (normP) {
              translationService.syncDesiredProviderFromExternal(normP);
            }
          }
          if (items[STORAGE_KEYS.PRETRANSLATE] !== undefined) {
            const rawPre = String(items[STORAGE_KEYS.PRETRANSLATE]);
            const nextPre = rawPre === '1' || rawPre === 'true';
            if (nextPre !== pretranslator.getRawFlag()) {
              pretranslator.setPretranslateEnabled(nextPre, { persistHost: false, broadcast: true });
            }
          }
        }
      }
      if (statusbarPort) statusbarPort.refresh();
      if (settingsUi) settingsUi.refreshUi();
      return {
        provider: translationService.getEffectiveProviderId(),
        desiredProvider: translationService.getDesiredProviderId(),
        pretranslateEnabled: pretranslator.getRawFlag(),
        llmConfig: llmConfigPort.getLlmConfig(),
      };
    }

    scheduler = createObserverScheduler({
      targetWin,
      targetDoc,
      disposables,
      uiLocalizer,
      triggerController,
      thinkingTranslator,
      pretranslator,
      settingsUi,
      statusbarPort,
      workbenchPromoter,
      onSyncPersistentSettings: syncPersistentTranslatorSettings,
    });

    // Expose public & diagnostic globals on `targetWin` via `disposables.registerPropertyValue` for clean fullRestore!
    const registerGlobal = (key, value) => {
      disposables.registerPropertyValue(targetWin, key, value);
    };

    registerGlobal('__agyMountKoThoughtLocalizer', mount);
    registerGlobal('__agyKoLocalizerActive', version);
    registerGlobal('__agyLastDefaultPretranslate', defaultPretranslateEnabled);
    registerGlobal('__agyLastDefaultProvider', defaultProviderRaw);
    registerGlobal('__agyTranslateStaticUiSync', (raw) => catalog.translateSync(raw));
    registerGlobal('__agyGetTranslationProvider', () => translationService.getEffectiveProviderId());
    registerGlobal('__agyGetDesiredTranslationProvider', () => translationService.getDesiredProviderId());
    registerGlobal('__agyListTranslationProviders', () => registry.listProviderIds());
    registerGlobal('__agyRegisterTranslationAdapter', (adapter) => registry.registerProvider(adapter));
    registerGlobal('__agySetTranslationProvider', selectTranslationProvider);
    registerGlobal('__agySyncPersistentSettings', syncPersistentTranslatorSettings);
    registerGlobal('__agySyncLlmConfigFromParent', (cfg) =>
      llmConfigPort.setLlmConfig(cfg, { persistHost: false })
    );
    registerGlobal('__agyGetLlmConfig', () => llmConfigPort.getLlmConfig());
    registerGlobal('__agySetLlmConfig', (partial, opts) => llmConfigPort.setLlmConfig(partial, opts));
    registerGlobal('__agyUpsertCustomProvider', (spec) => customProviderStore.upsertSpec(spec));
    registerGlobal('__agyRemoveCustomProvider', (id) => customProviderStore.removeSpec(id));
    registerGlobal('__agyListCustomProviders', () => customProviderStore.listSpecs());
    registerGlobal('__agyGetShowThinking', () => showThinkingEnabled);
    registerGlobal('__agySetShowThinking', setShowThinkingEnabled);
    registerGlobal('__agyGetTranslateThinking', () => translateThinkingEnabled);
    registerGlobal('__agySetTranslateThinking', setTranslateThinkingEnabled);
    registerGlobal('__agyGetPretranslate', () => pretranslator.getRawFlag());
    registerGlobal('__agySetPretranslate', (val, opts) => pretranslator.setPretranslateEnabled(val, opts));
    registerGlobal('__agyOpenTranslatorSettingsModal', () => settingsUi.openOrToggleModal());
    registerGlobal('__agyRetranslateVisibleThoughts', (clearCache) =>
      thinkingTranslator.retranslateVisibleThoughts(clearCache, () => pretranslator.resetHistory())
    );
    registerGlobal('__agyForceRescanAll', () => scheduler.scanAll());

    const cleanup = (fullRestore = false) => {
      if (disposed) return;
      disposed = true;
      propagateToAccessibleSameOriginFrames(targetWin, targetDoc, (cw) => {
        if (typeof cw.__agyKoThoughtCleanup === 'function') {
          try {
            cw.__agyKoThoughtCleanup(fullRestore);
          } catch (_err) {}
        }
      });
      scheduler.stop();
      translationService.dispose();
      statusbarPort.dispose();
      settingsUi.dispose(fullRestore);
      if (fullRestore) {
        thinkingTranslator.restoreOriginalCursorEdits();
        triggerController.restoreTriggerButtons();
        uiLocalizer.restoreAllMutatedNodes();
        try {
          delete targetWin.__agyPretranslateStats;
          if (!targetWin.agyStatusBar && !targetWin.__agyMountMcpManager) {
            delete targetWin.__agyCapturedLsClient;
          }
          delete targetWin.__agySharedKoMemCache;
        } catch (_err) {}
      }
      try {
        delete targetWin.__agyKoLocalizerActive;
      } catch (_err) {}
      disposables.disposeAll(fullRestore);
    };

    registerGlobal('__agyKoThoughtCleanup', cleanup);

    scheduler.start();

    return {
      mounted: true,
      reused: false,
      version,
      cleanup,
    };
  }

  return {
    mount,
  };
}

module.exports = {
  normalizeAntigravityProviderAlias,
  isUnsupportedDocumentEnvironment,
  isRemoteControlRuntimeEnvironment,
  createRuntimeBootstrapper,
};
