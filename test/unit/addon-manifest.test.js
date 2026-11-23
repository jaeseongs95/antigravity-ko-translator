'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  validateAddonManifestContract,
  loadSourceAddonManifest,
  registerAddonManifest,
  unregisterAddonManifest,
} = require('../../host/addon-registry');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_MANIFEST_PATH = path.join(REPO_ROOT, 'addon-manifest.v2.json');

test('addon-manifest.v2.json satisfies AddonManifest.v2 renderer-only + settingsBridge contract invariants', () => {
  const manifest = loadSourceAddonManifest(SOURCE_MANIFEST_PATH);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.pluginId, 'ko-thought-translator');
  assert.equal(manifest.trustLevel, 'trusted');
  assert.equal(manifest.compatibility.hostProfile, 'antigravity-desktop');
  assert.equal(manifest.compatibility.minHostVersion, '2.1.0');
  assert.deepEqual(manifest.capabilities, ['renderer']);
  assert.equal(manifest.entry.rendererScript, 'dist/renderer.js');
  assert.equal(manifest.entry.mainHookScript, undefined);
  assert.deepEqual(manifest.settingsBridge, {
    fileName: 'ko_translator_settings.json',
    maxBytes: 65536,
  });
  assert.equal(manifest.uiSlots[0].slot, 'document-transform');
  assert.equal(manifest.uiSlots[0].scope, 'native-host-only');
  assert.equal(manifest.uiSlots[0].shadow, false);
  assert.equal(manifest.isolation.respectsNoTranslate, true);
  assert.equal(manifest.isolation.storageNamespace, 'ko-thought-translator');
  assert.equal(manifest.isolation.ipcChannelPrefix, 'ko-translator:');

  const check = validateAddonManifestContract(manifest, null, {
    expectedHostProfileId: 'antigravity-desktop',
    checkFilesExist: false,
  });
  assert.equal(check.ok, true);
});

test('addon-registry enforces v2 path confinement, rejects mainHook, restricted settingsBridge, reserved files, and invalid document-transform', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-addon-reg-v2-'));
  try {
    const pluginsRoot = path.join(dir, 'plugins');
    const pluginDir = path.join(pluginsRoot, 'ko-thought-translator');
    fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'dist', 'renderer.js'), '// renderer\n', 'utf8');

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
      { ...baseManifest, entry: { rendererScript: '../outside.js' } },
      pluginsRoot,
      { checkFilesExist: true }
    );
    assert.equal(badTraversal.ok, false);
    assert.equal(badTraversal.reason, 'ERR_ENTRY_ESCAPES_PLUGIN_DIR');

    // 3. mainHook MUST be forbidden in v2 renderer-only plugin
    const badMainHook = validateAddonManifestContract(
      { ...baseManifest, capabilities: ['renderer', 'mainHook'], entry: { rendererScript: 'dist/renderer.js', mainHookScript: 'dist/main-hook.js' } },
      pluginsRoot,
      { checkFilesExist: false }
    );
    assert.equal(badMainHook.ok, false);
    assert.equal(badMainHook.reason, 'ERR_MAIN_HOOK_FORBIDDEN_IN_V2_PLUGIN');

    // 4. restricted trustLevel with settingsBridge MUST fail closed
    const badRestricted = validateAddonManifestContract(
      { ...baseManifest, trustLevel: 'restricted' },
      pluginsRoot,
      { checkFilesExist: false }
    );
    assert.equal(badRestricted.ok, false);
    assert.equal(badRestricted.reason, 'ERR_RESTRICTED_SETTINGS_BRIDGE_FORBIDDEN');

    // 5. Reserved settingsBridge filename MUST be rejected
    const badReserved = validateAddonManifestContract(
      { ...baseManifest, settingsBridge: { fileName: 'trust-policy.json', maxBytes: 65536 } },
      pluginsRoot,
      { checkFilesExist: false }
    );
    assert.equal(badReserved.ok, false);
    assert.equal(badReserved.reason, 'ERR_INVALID_SETTINGS_BRIDGE');

    // 6. document-transform with shadow: true or wrong scope MUST be rejected
    const badShadow = validateAddonManifestContract(
      {
        ...baseManifest,
        uiSlots: [{ slot: 'document-transform', slotId: 'ko-translator.native-app', scope: 'native-host-only', shadow: true }],
      },
      pluginsRoot,
      { checkFilesExist: true }
    );
    assert.equal(badShadow.ok, false);
    assert.equal(badShadow.reason, 'ERR_DOCUMENT_TRANSFORM_CANNOT_USE_SHADOW');

    const badScope = validateAddonManifestContract(
      {
        ...baseManifest,
        uiSlots: [{ slot: 'document-transform', slotId: 'ko-translator.native-app', scope: 'addon-owned-slot', shadow: false }],
      },
      pluginsRoot,
      { checkFilesExist: true }
    );
    assert.equal(badScope.ok, false);
    assert.equal(badScope.reason, 'ERR_DOCUMENT_TRANSFORM_SCOPE_REQUIRED');

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
