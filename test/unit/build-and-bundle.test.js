'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const {
  generateBundleSource,
  checkMirrorBundles,
} = require('../../scripts/build');
const {
  buildRuntimeConfiguredBundle,
  stripExistingKoBlock,
} = require('../../host/bundle-injector');

test('Build & Bundle (Rev7-F2): deterministic LF output, prelude markers inside IIFE (zero top-level const), and 4-mirror SHA-256 parity', () => {
  const b1 = generateBundleSource();
  const b2 = generateBundleSource();
  assert.equal(b1, b2, 'Bundle generation must be 100% deterministic');
  assert.equal(b1.includes('\r\n'), false, 'Bundle must use LF line endings only');

  // Prelude markers MUST sit inside `(function mountKoThoughtLocalizer(globalScope) {` (zero top-level const!)
  const iifeStart = b1.indexOf('(function mountKoThoughtLocalizer(globalScope)');
  const verMarker = b1.indexOf('const KO_LOCALIZER_VERSION = "v2.0.0";');
  const preMarker = b1.indexOf('const DEFAULT_PRETRANSLATE_ENABLED =');
  const provMarker = b1.indexOf('const DEFAULT_TRANSLATION_PROVIDER =');
  const llmMarker = b1.indexOf('const DEFAULT_LLM_CONFIG = Object.freeze(');

  assert.ok(iifeStart >= 0, 'Outer IIFE header missing');
  assert.ok(verMarker > iifeStart, 'KO_LOCALIZER_VERSION must be scoped inside outer IIFE');
  assert.ok(preMarker > iifeStart, 'DEFAULT_PRETRANSLATE_ENABLED must be scoped inside outer IIFE');
  assert.ok(provMarker > iifeStart, 'DEFAULT_TRANSLATION_PROVIDER must be scoped inside outer IIFE');
  assert.ok(llmMarker > iifeStart, 'DEFAULT_LLM_CONFIG must be scoped inside outer IIFE');

  // Evaluating twice in the SAME VM global realm MUST NOT throw `SyntaxError: Identifier '...' has already been declared`!
  const ctx = vm.createContext({
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
  });
  assert.doesNotThrow(() => {
    vm.runInContext(b1, ctx);
    vm.runInContext(b1, ctx);
  });

  const parity = checkMirrorBundles(b1);
  assert.equal(parity.ok, true, `4 mirror bundles out of sync: ${JSON.stringify(parity)}`);
  assert.equal(parity.targets.length, 4);
});

test('Build & Bundle (Rev6-F4 #1 & Rev7-F2): buildRuntimeConfiguredBundle preserves $&, $$, $\', $` via function replacers and strips only KO block', () => {
  const trickyModel = 'gemma3:4b-$&-$$-$\'-$`';
  const configured = buildRuntimeConfiguredBundle({
    pretranslateEnabled: true,
    translationProvider: 'LOCAL-LLM',
    llmConfig: {
      baseUrl: 'http://127.0.0.1:18080/v1',
      model: trickyModel,
      apiFormat: 'openai',
      allowRemoteHttps: false,
      timeoutMs: 22000,
    },
  });

  assert.match(configured, /^\s+const DEFAULT_PRETRANSLATE_ENABLED = true;/m);
  assert.match(configured, /^\s+const DEFAULT_TRANSLATION_PROVIDER = "local-llm";/m);
  assert.equal(
    configured.includes(JSON.stringify(trickyModel)),
    true,
    'Function replacer must preserve $&, $$, $\', $` literally without RegExp substitution mangling'
  );

  // Double-evaluate runtime-configured bundle in the same VM context -> 0 SyntaxError!
  const ctx = vm.createContext({
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
  });
  assert.doesNotThrow(() => {
    vm.runInContext(configured, ctx);
    vm.runInContext(configured, ctx);
  });

  // Sibling blocks preserved byte-for-byte when stripping KO block
  const siblingStatusbar = '// === BEGIN_STATUSBAR ===\nwindow.sb = 1;\n// === END_STATUSBAR ===';
  const siblingMcp = '// === BEGIN_MCP ===\nwindow.mcp = 1;\n// === END_MCP ===';
  const combined = [
    siblingStatusbar,
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===\nwindow.ko = 2;\n// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    siblingMcp,
  ].join('\n\n');

  const stripped = stripExistingKoBlock(combined);
  assert.equal(stripped, `${siblingStatusbar}\n\n${siblingMcp}`);
});
