'use strict';

const { createRuntimeBootstrapper } = require('./runtime/bootstrap');

function bootDefaultBrowserRuntime(globalScope) {
  const win =
    (globalScope && globalScope.window) ||
    (typeof window !== 'undefined' ? window : null);
  const doc = (win && win.document) || (typeof document !== 'undefined' ? document : null);

  const version =
    typeof KO_LOCALIZER_VERSION === 'string' ? KO_LOCALIZER_VERSION : 'v2.0.0';
  const defaultPretranslateEnabled =
    typeof DEFAULT_PRETRANSLATE_ENABLED === 'boolean' ? DEFAULT_PRETRANSLATE_ENABLED : false;
  const defaultTranslationProvider =
    typeof DEFAULT_TRANSLATION_PROVIDER === 'string'
      ? DEFAULT_TRANSLATION_PROVIDER
      : 'google-translate';
  const defaultLlmConfig =
    typeof DEFAULT_LLM_CONFIG === 'object' && DEFAULT_LLM_CONFIG !== null
      ? DEFAULT_LLM_CONFIG
      : undefined;

  const bootstrapper = createRuntimeBootstrapper({
    version,
    defaultPretranslateEnabled,
    defaultTranslationProvider,
    defaultLlmConfig,
  });

  if (win && doc) {
    bootstrapper.mount(win, doc);
  }
  return bootstrapper;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  bootDefaultBrowserRuntime(typeof globalThis !== 'undefined' ? globalThis : window);
}

module.exports = {
  createRuntimeBootstrapper,
  bootDefaultBrowserRuntime,
};
