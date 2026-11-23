'use strict';

/**
 * Default Translation Provider Bundle.
 *
 * Isolates concrete translator vendor wiring (Google Translate, Local LLM/Ollama,
 * and declarative Custom Provider) as well as vendor-specific config signatures
 * and cache variants outside the vendor-neutral runtime bootstrap.
 */

const { createGoogleTranslateAdapter } = require('./google-translate');
const { createLocalLlmAdapter } = require('./local-llm');
const { createCustomProviderAdapter } = require('./custom-provider');

const DEFAULT_PROVIDER_ID = 'google-translate';

const DEFAULT_LLM_CONFIG = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma3:4b',
  apiFormat: 'ollama',
  allowRemoteHttps: false,
  timeoutMs: 15000,
});

const PROVIDER_ALIAS_MAP = Object.freeze({
  google: 'google-translate',
  gtx: 'google-translate',
  local: 'local-llm',
  llm: 'local-llm',
  ollama: 'local-llm',
});

const BUILTIN_PROVIDER_IDS = Object.freeze(['google-translate', 'local-llm']);

function createDefaultProviderBundle() {
  return {
    defaultProviderId: DEFAULT_PROVIDER_ID,
    defaultLlmConfig: DEFAULT_LLM_CONFIG,
    aliasMap: PROVIDER_ALIAS_MAP,
    builtinProviderIds: BUILTIN_PROVIDER_IDS,
    createBuiltinProviders({ fetchFn, llmConfigPort }) {
      return [
        createGoogleTranslateAdapter({ fetchFn }),
        createLocalLlmAdapter({ fetchFn, llmConfigPort }),
      ];
    },
    createCustomProvider(spec, { fetchFn }) {
      return createCustomProviderAdapter(spec, { fetchFn });
    },
    getRuntimeConfigSignature(cfg) {
      if (!cfg || typeof cfg !== 'object') return '';
      return `${cfg.apiFormat || ''}|${cfg.baseUrl || ''}|${cfg.model || ''}|${Boolean(cfg.allowRemoteHttps)}|${cfg.timeoutMs || ''}`;
    },
    getProviderCacheVariant(providerId, cfg) {
      if (providerId === 'local-llm' && cfg && typeof cfg === 'object') {
        return `${cfg.apiFormat || ''}|${cfg.baseUrl || ''}|${cfg.model || ''}|${cfg.timeoutMs || ''}`;
      }
      return '';
    },
    shouldRetranslateOnConfigChange(providerId) {
      return providerId === 'local-llm';
    },
  };
}

module.exports = {
  DEFAULT_PROVIDER_ID,
  DEFAULT_LLM_CONFIG,
  PROVIDER_ALIAS_MAP,
  BUILTIN_PROVIDER_IDS,
  createDefaultProviderBundle,
};
