'use strict';

/**
 * Clean-Slate Composition Root for Antigravity Desktop Korean Thought & UI Translator.
 *
 * Wires the Antigravity HostUiAdapter and Default Provider Bundle into the
 * vendor-neutral `createTranslatorRuntime`, exposing `createKoTranslator` both
 * as CommonJS export and as `window.__agyKoTranslator` in top-frame Electron Hub windows.
 */

const { createTranslatorRuntime } = require('./runtime/bootstrap');
const {
  STYLE_ID,
  buildMinimalOverlayCss,
  createAntigravityHostAdapter,
} = require('./adapters/antigravity/host-adapter');
const { createDefaultProviderBundle } = require('./adapters/translators/default-providers');

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
    (hostCapabilityArg && typeof hostCapabilityArg === 'object' ? hostCapabilityArg : null) ||
    (win && win.__ADDON_HOST_API__ && typeof win.__ADDON_HOST_API__ === 'object' ? win.__ADDON_HOST_API__ : null);

  // Never run inside non-top frames (e.g. Sidecar AUX_PANE iframes) unless explicitly mounted by caller.
  if (win.__AGY_KO_TRANSLATOR_AUTO_MOUNT__ === false) {
    win.__agyCreateKoTranslator = createKoTranslator;
    return null;
  }

  try {
    if (win.top && win.top !== win) {
      win.__agyCreateKoTranslator = createKoTranslator;
      return null;
    }
  } catch (_err) {
    return null;
  }

  // Cleanly dispose any previous instance on hot reload.
  if (win.__agyKoTranslator && typeof win.__agyKoTranslator.dispose === 'function') {
    try {
      win.__agyKoTranslator.dispose();
    } catch (_err) {}
  }

  const initialSettings =
    win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ && typeof win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ === 'object'
      ? win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__
      : null;

  const instance = createKoTranslator({
    win,
    doc,
    settings: initialSettings,
    hostCapability: resolvedHostCap,
    version: '2.1.0',
  });
  win.__agyCreateKoTranslator = createKoTranslator;
  win.__agyKoTranslator = instance;

  if (resolvedHostCap && typeof resolvedHostCap.onDispose === 'function') {
    try {
      resolvedHostCap.onDispose(() => {
        instance.dispose();
        if (win.__agyKoTranslator === instance) {
          delete win.__agyKoTranslator;
        }
      });
    } catch (_err) {}
  }

  instance.start();
  return instance;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Capture the per-plugin scoped capability handle supplied by antigravity-native-addon-host's
  // `(function(addonHost){ ... })(__addonHandle)` wrapper when present.
  // eslint-disable-next-line no-undef
  const detectedHostCap = typeof addonHost !== 'undefined' ? addonHost : null;
  mountIfBrowser(window, detectedHostCap);
}

module.exports = {
  STYLE_ID,
  buildMinimalOverlayCss,
  createTranslatorRuntime,
  createKoTranslator,
  mountIfBrowser,
};
