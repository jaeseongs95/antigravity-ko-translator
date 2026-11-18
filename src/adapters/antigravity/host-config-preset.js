'use strict';

const { createHostAdapterConfig } = require('../host-adapter-config');

const ANTIGRAVITY_PROVIDER_ALIASES = Object.freeze({
  google: 'google-translate',
  gtx: 'google-translate',
  'google-translate': 'google-translate',
  local: 'local-llm',
  llm: 'local-llm',
  ollama: 'local-llm',
  'local-llm': 'local-llm',
});

const DEFAULT_ANTIGRAVITY_LLM_CONFIG = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma3:4b',
  apiFormat: 'ollama',
  allowRemoteHttps: false,
  timeoutMs: 15000,
});

const ANTIGRAVITY_HOST_CONFIG_PRESET = createHostAdapterConfig({
  productName: 'antigravity',
  defaultAppVersion: '2.33.0',
  cdnScriptOrigin: 'https://www.gstatic.com',
  cdnMirrorBase: 'https://www.gstatic.com/antigravity',
  cdnMirrorHosts: ['www.gstatic.com'],
  trustedHostOrigins: ['https://antigravity.google.com'],
  trustedHostOriginSuffixes: ['.antigravity.google.com'],
  sandboxIframeHosts: ['antigravity.static.usercontent.goog'],
  pathPrefixToStrip: '/antigravity',
  webVersionPrefix: '/web/',
  protectedHostPathPrefixes: ['/r/', '/_/'],
  shellCssFiles: ['jetbox.css', 'compiled_tailwind.css'],
  shellBootScripts: ['prism_bundle.js', 'main.js'],
  remoteControlSelector: 'ga-remote-control',
  trustedTypesPolicyNames: ['agy-ko-translator', 'agy-ko-translator-rc'],
  trustedCompanionRepoPrefixes: [
    'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/',
    'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/',
  ],
  companionBundles: {
    statusbarUrl: 'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js',
    mcpManagerUrl:
      'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js',
  },
  rootComponentSelector: 'ga-root',
  appGlobalNamespace: 'default_GoogleAntigravity',
  rpcServicePrefix: '/exa.language_server_pb.LanguageServerService/',
});

function resolveAntigravityHostConfig(targetWin) {
  const custom =
    targetWin &&
    targetWin.__AGY_HOST_ADAPTER_CONFIG__ &&
    typeof targetWin.__AGY_HOST_ADAPTER_CONFIG__ === 'object'
      ? targetWin.__AGY_HOST_ADAPTER_CONFIG__
      : null;
  if (!custom) {
    return ANTIGRAVITY_HOST_CONFIG_PRESET;
  }
  const allowLoopbackForTest = Boolean(custom.__allowLoopbackForTest);
  const merged = {
    ...ANTIGRAVITY_HOST_CONFIG_PRESET,
    ...custom,
    companionBundles: {
      ...ANTIGRAVITY_HOST_CONFIG_PRESET.companionBundles,
      ...(custom.companionBundles && typeof custom.companionBundles === 'object' ? custom.companionBundles : {}),
    },
  };
  delete merged.__allowLoopbackForTest;
  return createHostAdapterConfig(merged, { allowLoopbackForTest });
}

module.exports = {
  ANTIGRAVITY_PROVIDER_ALIASES,
  DEFAULT_ANTIGRAVITY_LLM_CONFIG,
  ANTIGRAVITY_HOST_CONFIG_PRESET,
  resolveAntigravityHostConfig,
};
