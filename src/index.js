'use strict';

/**
 * Clean-Slate Composition Root for Antigravity Desktop Korean Thought & UI Translator (v2.1.0).
 *
 * Security Invariant (V2 — World 998 Isolation):
 * - When executed inside `antigravity-native-addon-host` (`addonHost` capability handle present),
 *   the runtime instance is strictly closure-scoped: ZERO mutable globals (`window.__agyKoTranslator`
 *   / `window.__agyCreateKoTranslator`) are exposed on shared World 998 `window`, and settings come
 *   exclusively from `addonHost.getSettings()` / `addonHost.onSettingsChange(...)`.
 * - Standalone browser/VM invocations without `addonHost` retain `window.__agyCreateKoTranslator`
 *   and `window.__agyKoTranslator` for isolated tests.
 */

const { createTranslatorRuntime } = require('./runtime/bootstrap');
const {
  STYLE_ID,
  STATUSBAR_ADDON_ID,
  QUICK_SETTINGS_MODAL_SLOT_ID,
  QUICK_SETTINGS_TAB_ID,
  HOST_ACTION_IDS,
  buildMinimalOverlayCss,
  createAntigravityHostAdapter,
  createQuickSettingsUi,
} = require('./adapters/antigravity/host-adapter');
const { createDefaultProviderBundle } = require('./adapters/translators/default-providers');

const PLUGIN_VERSION = '2.3.0';

function createKoTranslator(options = {}) {
  return createTranslatorRuntime({
    ...options,
    hostAdapter: options.hostAdapter || createAntigravityHostAdapter(),
    providerBundle: options.providerBundle || createDefaultProviderBundle(),
  });
}

function mountIfBrowser(globalScope, hostCapabilityArg = null) {
  const win = globalScope || (typeof window !== 'undefined' ? window : null);
  const doc = win && win.document ? win.document : typeof document !== 'undefined' ? document : null;
  if (!win || !doc) return null;

  const resolvedHostCap =
    hostCapabilityArg && typeof hostCapabilityArg === 'object' ? hostCapabilityArg : null;
  const isHostManaged = Boolean(resolvedHostCap);

  // Never run inside non-top frames (e.g. Sidecar AUX_PANE iframes) unless explicitly mounted by caller.
  if (win.__AGY_KO_TRANSLATOR_AUTO_MOUNT__ === false) {
    if (!isHostManaged) {
      win.__agyCreateKoTranslator = createKoTranslator;
    }
    return null;
  }

  try {
    if (win.top && win.top !== win) {
      if (!isHostManaged) {
        win.__agyCreateKoTranslator = createKoTranslator;
      }
      return null;
    }
  } catch (_err) {
    return null;
  }

  // In standalone (non-host) mode, cleanly dispose any previous instance on hot reload.
  if (!isHostManaged && win.__agyKoTranslator && typeof win.__agyKoTranslator.dispose === 'function') {
    try {
      win.__agyKoTranslator.dispose();
    } catch (_err) {}
  }

  // Under host v2.1.0+, ignore mutable window globals; settings come exclusively from addonHost.getSettings().
  const initialSettings =
    !isHostManaged &&
    win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ &&
    typeof win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ === 'object'
      ? win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__
      : null;

  const instance = createKoTranslator({
    win,
    doc,
    settings: initialSettings,
    hostCapability: resolvedHostCap,
    version: PLUGIN_VERSION,
  });

  const quickSettingsUi = createQuickSettingsUi({
    win,
    doc,
    translator: instance,
    hostCapability: resolvedHostCap,
  });

  const origDispose = instance.dispose.bind(instance);
  instance.dispose = function disposeWithQuickSettingsUi() {
    try {
      quickSettingsUi.dispose();
    } catch (_err) {}
    return origDispose();
  };
  instance.openQuickSettings = () => quickSettingsUi.openModal();
  instance.closeQuickSettings = () => quickSettingsUi.closeModal();

  if (!isHostManaged) {
    win.__agyCreateKoTranslator = createKoTranslator;
    win.__agyKoTranslator = instance;
  }

  if (resolvedHostCap && typeof resolvedHostCap.onDispose === 'function') {
    try {
      resolvedHostCap.onDispose(() => {
        instance.dispose();
      });
    } catch (_err) {}
  }

  instance.start();
  quickSettingsUi.start();
  return instance;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Capture the per-plugin scoped capability handle supplied by antigravity-native-addon-host's
  // `(function(addonHost){ ... })(__h)` wrapper when present.
  // eslint-disable-next-line no-undef
  const detectedHostCap = typeof addonHost !== 'undefined' ? addonHost : null;
  mountIfBrowser(window, detectedHostCap);
}

module.exports = {
  PLUGIN_VERSION,
  STYLE_ID,
  STATUSBAR_ADDON_ID,
  QUICK_SETTINGS_MODAL_SLOT_ID,
  QUICK_SETTINGS_TAB_ID,
  HOST_ACTION_IDS,
  buildMinimalOverlayCss,
  createTranslatorRuntime,
  createKoTranslator,
  createQuickSettingsUi,
  mountIfBrowser,
};
