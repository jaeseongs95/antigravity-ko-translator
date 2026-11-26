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
const {
  CLOUD_API_PRESETS,
  DEFAULT_CLOUD_API_CONFIG,
  getCloudPreset,
  getCloudSecretKeyForPreset,
  createCloudApiAdapter,
} = require('./cloud-api');
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
  cloud: 'cloud-api',
  api: 'cloud-api',
  openai: 'cloud-api',
  claude: 'cloud-api',
  anthropic: 'cloud-api',
  gemini: 'cloud-api',
});

const BUILTIN_PROVIDER_IDS = Object.freeze(['google-translate', 'local-llm', 'cloud-api']);

function createDefaultProviderBundle() {
  return {
    defaultProviderId: DEFAULT_PROVIDER_ID,
    defaultLlmConfig: DEFAULT_LLM_CONFIG,
    defaultCloudApiConfig: DEFAULT_CLOUD_API_CONFIG,
    aliasMap: PROVIDER_ALIAS_MAP,
    builtinProviderIds: BUILTIN_PROVIDER_IDS,
    createBuiltinProviders({ fetchFn, llmConfigPort, cloudApiConfigPort }) {
      const list = [
        createGoogleTranslateAdapter({ fetchFn }),
        createLocalLlmAdapter({ fetchFn, llmConfigPort }),
      ];
      if (cloudApiConfigPort && typeof cloudApiConfigPort.getCloudApiConfig === 'function') {
        list.push(createCloudApiAdapter({ fetchFn, cloudApiConfigPort }));
      }
      return list;
    },
    createCustomProvider(spec, { fetchFn }) {
      return createCustomProviderAdapter(spec, { fetchFn });
    },
    getRuntimeConfigSignature(cfg) {
      if (!cfg || typeof cfg !== 'object') return '';
      return `${cfg.apiFormat || ''}|${cfg.baseUrl || ''}|${cfg.model || ''}|${Boolean(cfg.allowRemoteHttps)}|${cfg.timeoutMs || ''}`;
    },
    getCloudApiConfigSignature(cfg) {
      if (!cfg || typeof cfg !== 'object') return '';
      return `${cfg.preset || ''}|${cfg.baseUrl || ''}|${cfg.model || ''}|${cfg.timeoutMs || ''}`;
    },
    getProviderCacheVariant(providerId, cfg, cloudCfg) {
      if (providerId === 'local-llm' && cfg && typeof cfg === 'object') {
        return `${cfg.apiFormat || ''}|${cfg.baseUrl || ''}|${cfg.model || ''}|${cfg.timeoutMs || ''}`;
      }
      if (providerId === 'cloud-api' && cloudCfg && typeof cloudCfg === 'object') {
        return `${cloudCfg.preset || ''}|${cloudCfg.baseUrl || ''}|${cloudCfg.model || ''}|${cloudCfg.timeoutMs || ''}`;
      }
      return '';
    },
    shouldRetranslateOnConfigChange(providerId) {
      return providerId === 'local-llm' || providerId === 'cloud-api';
    },
  };
}

module.exports = {
  DEFAULT_PROVIDER_ID,
  DEFAULT_LLM_CONFIG,
  DEFAULT_CLOUD_API_CONFIG,
  CLOUD_API_PRESETS,
  getCloudPreset,
  getCloudSecretKeyForPreset,
  PROVIDER_ALIAS_MAP,
  BUILTIN_PROVIDER_IDS,
  createDefaultProviderBundle,
};
