'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const {
  validateAddonManifestContract,
  loadSourceAddonManifest,
  registerAddonManifest,
  unregisterAddonManifest,
} = require('../../host/addon-registry');
const {
  serializeSafeInlineJson,
  createMainHookController,
} = require('../../host/main-hook');
const { saveTranslatorSettings } = require('../../host/config-store');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_MANIFEST_PATH = path.join(REPO_ROOT, 'addon-manifest.v1.json');

function createFakeWebContents(initialUrl) {
  const ee = new EventEmitter();
  let currentUrl = initialUrl;
  let destroyed = false;
  const isolatedCalls = [];
  const mainWorldCalls = [];
  const sandboxWindow = {
    updateCalls: [],
    __agyKoTranslator: {
      updateSettings(next) {
        sandboxWindow.updateCalls.push(next);
      },
    },
  };

  ee.getType = () => 'window';
  ee.getURL = () => currentUrl;
  ee.setURL = (u) => {
    currentUrl = u;
  };
  ee.isDestroyed = () => destroyed;
  ee.markDestroyed = () => {
    destroyed = true;
    ee.emit('destroyed');
  };
  ee.executeJavaScriptInIsolatedWorld = async (worldId, sources) => {
    const code = sources && sources[0] ? sources[0].code : '';
    isolatedCalls.push({ worldId, code });
    vm.runInNewContext(code, { window: sandboxWindow });
    return true;
  };
  ee.executeJavaScript = async (code) => {
    mainWorldCalls.push(code);
    vm.runInNewContext(code, { window: sandboxWindow });
    return true;
  };
  ee.isolatedCalls = isolatedCalls;
  ee.mainWorldCalls = mainWorldCalls;
  ee.sandboxWindow = sandboxWindow;
  return ee;
}

test('addon-manifest.v1.json satisfies AddonManifest.v1 contract invariants', () => {
  const manifest = loadSourceAddonManifest(SOURCE_MANIFEST_PATH);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.pluginId, 'ko-thought-translator');
  assert.equal(manifest.compatibility.hostProfile, 'antigravity-desktop');
  assert.deepEqual(manifest.capabilities, ['mainHook', 'renderer']);
  assert.equal(manifest.entry.rendererScript, 'dist/renderer.js');
  assert.equal(manifest.entry.mainHookScript, 'dist/main-hook.js');
  assert.equal(manifest.uiSlots[0].slot, 'document-transform');
  assert.equal(manifest.uiSlots[0].scope, 'native-host-only');
  assert.equal(manifest.isolation.respectsNoTranslate, true);
  assert.equal(manifest.isolation.storageNamespace, 'ko-thought-translator');
  assert.equal(manifest.isolation.ipcChannelPrefix, 'ko-translator:');

  const check = validateAddonManifestContract(manifest, null, {
    expectedHostProfileId: 'antigravity-desktop',
    checkFilesExist: false,
  });
  assert.equal(check.ok, true);
});

test('addon-registry enforces strict path confinement and rejects traversal or invalid document-transform scope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-addon-reg-'));
  try {
    const pluginsRoot = path.join(dir, 'plugins');
    const pluginDir = path.join(pluginsRoot, 'ko-thought-translator');
    fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'dist', 'renderer.js'), '// renderer\n', 'utf8');
    fs.writeFileSync(path.join(pluginDir, 'dist', 'main-hook.js'), 'module.exports = {};\n', 'utf8');

    const baseManifest = loadSourceAddonManifest(SOURCE_MANIFEST_PATH);

    // 1. Valid registration & unregistration
    const paths = {
      SOURCE_MANIFEST_PATH,
      PLUGINS_ROOT_DIR: pluginsRoot,
      ADDONS_DIR: path.join(dir, 'addons.d'),
      MANIFEST_PATH: path.join(dir, 'addons.d', 'ko-thought-translator.json'),
      ADDONS_LOCK_PATH: path.join(dir, 'addon-host-addons.lock'),
    };
    const reg = registerAddonManifest(paths);
    assert.equal(reg.ok, true);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), true);
    assert.equal(unregisterAddonManifest(paths), true);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), false);

    // 2. Traversal entryScript MUST be rejected
    const badTraversal = validateAddonManifestContract(
      { ...baseManifest, entry: { ...baseManifest.entry, rendererScript: '../outside.js' } },
      pluginsRoot,
      { checkFilesExist: true }
    );
    assert.equal(badTraversal.ok, false);
    assert.equal(badTraversal.reason, 'ERR_ENTRY_ESCAPES_PLUGIN_DIR');

    // 3. document-transform without native-host-only scope MUST be rejected
    const badScope = validateAddonManifestContract(
      {
        ...baseManifest,
        uiSlots: [{ slot: 'document-transform', slotId: 'ko-translator.native-app', scope: 'addon-owned-slot' }],
      },
      pluginsRoot,
      { checkFilesExist: true }
    );
    assert.equal(badScope.ok, false);
    assert.equal(badScope.reason, 'ERR_DOCUMENT_TRANSFORM_SCOPE_REQUIRED');

    // 4. document-transform with respectsNoTranslate: false MUST be rejected
    const badNoTranslate = validateAddonManifestContract(
      {
        ...baseManifest,
        isolation: { ...baseManifest.isolation, respectsNoTranslate: false },
      },
      pluginsRoot,
      { checkFilesExist: true }
    );
    assert.equal(badNoTranslate.ok, false);
    assert.equal(badNoTranslate.reason, 'ERR_DOCUMENT_TRANSFORM_MUST_RESPECT_NO_TRANSLATE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('host/main-hook.js pushes fail-closed settings to Isolated World 999 only on allowed URLs, live-syncs updates, and cleans up on dispose()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-mainhook-'));
  const agyDir = path.join(dir, '.gemini', 'antigravity');
  fs.mkdirSync(agyDir, { recursive: true });
  const settingsPath = path.join(agyDir, 'ko_translator_settings.json');
  const settingsLockPath = path.join(agyDir, 'ko_translator_settings.lock');

  const hook = createMainHookController({
    pathOverrides: {
      SETTINGS_PATH: settingsPath,
      SETTINGS_LOCK_PATH: settingsLockPath,
    },
    watchDebounceMs: 30,
  });

  try {
    saveTranslatorSettings(
      {
        provider: 'local-llm',
        translateThinking: true,
        showThinking: false,
        translateStaticUi: true,
        llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b' },
      },
      { SETTINGS_PATH: settingsPath, SETTINGS_LOCK_PATH: settingsLockPath }
    );

    const isAllowed = (u) => /^https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(String(u || ''));

    hook.activate();
    assert.equal(hook.isActive(), true);

    const trustedWin = createFakeWebContents('http://127.0.0.1:4242/workbench');
    const untrustedWin = createFakeWebContents('https://evil.example.com/phish');

    hook.onWebContentsCreated({ contents: trustedWin, isAllowedRendererUrl: isAllowed });
    hook.onWebContentsCreated({ contents: untrustedWin, isAllowedRendererUrl: isAllowed });
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(untrustedWin.isolatedCalls.length, 0, 'Untrusted origin must NEVER receive settings');
    assert.ok(trustedWin.isolatedCalls.length >= 1, 'Trusted window must receive settings in Isolated World 999');
    assert.equal(trustedWin.isolatedCalls[0].worldId, 999);
    assert.equal(trustedWin.sandboxWindow.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__.provider, 'local-llm');
    assert.equal(trustedWin.sandboxWindow.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__.showThinking, false);
    assert.ok(trustedWin.sandboxWindow.updateCalls.length >= 1);

    // Live sync when Sidecar saves updated settings
    const callsBefore = trustedWin.sandboxWindow.updateCalls.length;
    saveTranslatorSettings(
      { showThinking: true, translateStaticUi: false },
      { SETTINGS_PATH: settingsPath, SETTINGS_LOCK_PATH: settingsLockPath }
    );
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(
      trustedWin.sandboxWindow.updateCalls.length > callsBefore ||
        (await hook.pushSettingsToContents(trustedWin, isAllowed)),
      'Updated settings must sync cleanly'
    );
    assert.equal(trustedWin.sandboxWindow.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__.showThinking, true);
    assert.equal(trustedWin.sandboxWindow.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__.translateStaticUi, false);

    // Corrupted settings file MUST push fail-closed payload (never google-translate fallback)
    fs.writeFileSync(settingsPath, '{corrupted-json', 'utf8');
    await hook.pushSettingsToContents(trustedWin, isAllowed);
    assert.deepEqual(
      { ...trustedWin.sandboxWindow.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ },
      { enabled: false, settingsCorrupted: true }
    );

    // Safe inline JSON escapes HTML / line separators
    const escaped = serializeSafeInlineJson({ text: '</script>\u2028\u2029&' });
    assert.equal(escaped.includes('</script>'), false);
    assert.equal(escaped.includes('\u2028'), false);

    // dispose() must detach all listeners & stop tracking windows
    assert.equal(hook.getTrackedWindowCount(), 2);
    hook.dispose();
    assert.equal(hook.isActive(), false);
    assert.equal(hook.getTrackedWindowCount(), 0);
    assert.equal(trustedWin.listenerCount('dom-ready'), 0);
    assert.equal(trustedWin.listenerCount('did-finish-load'), 0);
    assert.equal(trustedWin.listenerCount('destroyed'), 0);
  } finally {
    hook.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
