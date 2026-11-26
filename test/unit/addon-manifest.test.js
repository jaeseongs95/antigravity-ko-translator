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
const SOURCE_MANIFEST_PATH = path.join(REPO_ROOT, 'addon-manifest.v3.json');

test('addon-manifest.v3.json satisfies AddonManifest.v3 API-First + permissions + settingsBridge contract invariants', () => {
  const manifest = loadSourceAddonManifest(SOURCE_MANIFEST_PATH);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.apiVersion, 3);
  assert.equal(manifest.pluginId, 'ko-thought-translator');
  assert.equal(manifest.version, '3.2.0');
  assert.equal(manifest.trustLevel, 'trusted');
  assert.equal(manifest.compatibility.hostProfile, 'antigravity-desktop');
  assert.deepEqual(manifest.compatibility.hostProfiles, ['antigravity-desktop', 'antigravity-remote-web']);
  assert.deepEqual(manifest.compatibility.surfaces, ['desktop', 'remote-web']);
  assert.equal(manifest.compatibility.minHostVersion, '3.3.0');
  assert.deepEqual(manifest.capabilities, ['renderer']);
  assert.equal(manifest.entry.rendererScript, 'dist/renderer.js');
  assert.equal(manifest.entry.mainHookScript, undefined);
  assert.deepEqual(manifest.permissions.secrets, {
    maxKeys: 8,
    maxBytes: 16384,
    allowRead: false,
  });
  assert.equal(manifest.permissions.net.userApprovedHttps, true);
  assert.deepEqual(manifest.permissions.net.localLoopback, [11434]);
  for (const host of [
    'translate.googleapis.com',
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'openrouter.ai',
  ]) {
    assert.equal(manifest.permissions.net.httpsHosts.includes(host), true, `missing httpsHost: ${host}`);
  }
  assert.deepEqual(manifest.permissions.dom, { documentTransform: true });
  assert.deepEqual(manifest.permissions.services, { consume: ['host.statusbar'] });
  assert.equal(manifest.permissions.ui.statusItems, true);
  assert.equal(manifest.permissions.ui.settingsPages, true);
  assert.equal(manifest.permissions.ui.commands, true);
  assert.equal(manifest.permissions.ui.overlays, true);
  assert.deepEqual(manifest.settingsBridge, {
    fileName: 'ko_translator_settings.json',
    maxBytes: 65536,
  });
  assert.equal(manifest.uiSlots[0].slot, 'document-transform');
  assert.equal(manifest.uiSlots[0].scope, 'native-host-only');
  assert.equal(manifest.uiSlots[0].shadow, false);
  assert.deepEqual(manifest.uiSlots[1], {
    slot: 'modal',
    slotId: 'ko-translator.quick-settings-modal',
    exclusive: false,
    scope: 'addon-owned-slot',
    shadow: true,
  });
  assert.equal(manifest.isolation.respectsNoTranslate, true);
  assert.equal(manifest.isolation.storageNamespace, 'ko-thought-translator');
  assert.equal(manifest.isolation.ipcChannelPrefix, 'ko-translator:');

  const checkDesktop = validateAddonManifestContract(manifest, null, {
    expectedHostProfileId: 'antigravity-desktop',
    hostVersion: '3.3.0',
    checkFilesExist: false,
  });
  assert.equal(checkDesktop.ok, true);

  const checkRemoteWeb = validateAddonManifestContract(manifest, null, {
    expectedHostProfileId: 'antigravity-remote-web',
    hostVersion: '3.3.0',
    checkFilesExist: false,
  });
  assert.equal(checkRemoteWeb.ok, true);

  const checkUnlistedProfile = validateAddonManifestContract(manifest, null, {
    expectedHostProfileId: 'unknown-host-profile',
    hostVersion: '3.3.0',
    checkFilesExist: false,
  });
  assert.equal(checkUnlistedProfile.ok, false);
  assert.equal(checkUnlistedProfile.reason, 'ERR_INCOMPATIBLE_HOST_PROFILE');
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

    // 7. I7: Windows DOS device names in settingsBridge.fileName MUST be rejected
    for (const dosName of ['nul.json', 'con.json', 'com1.json', 'lpt9.json']) {
      const badDos = validateAddonManifestContract(
        { ...baseManifest, settingsBridge: { fileName: dosName, maxBytes: 65536 } },
        pluginsRoot,
        { checkFilesExist: false }
      );
      assert.equal(badDos.ok, false, `DOS name ${dosName} must be rejected`);
      assert.equal(badDos.reason, 'ERR_INVALID_SETTINGS_BRIDGE');
    }

    // 8. I7 & v3.1.0: compatibility.minHostVersion SemVer comparison and hostProfiles/excludeHostProfiles
    const tooOldHost = validateAddonManifestContract(baseManifest, pluginsRoot, {
      hostVersion: '3.2.1',
      checkFilesExist: false,
    });
    assert.equal(tooOldHost.ok, false);
    assert.equal(tooOldHost.reason, 'ERR_HOST_VERSION_TOO_OLD');

    const okHost = validateAddonManifestContract(baseManifest, pluginsRoot, {
      hostVersion: '3.3.0',
      checkFilesExist: false,
    });
    assert.equal(okHost.ok, true);

    const excludedProfile = validateAddonManifestContract(
      {
        ...baseManifest,
        compatibility: {
          ...baseManifest.compatibility,
          excludeHostProfiles: ['antigravity-remote-web'],
        },
      },
      pluginsRoot,
      { expectedHostProfileId: 'antigravity-remote-web', hostVersion: '3.3.0', checkFilesExist: false }
    );
    assert.equal(excludedProfile.ok, false);
    assert.equal(excludedProfile.reason, 'ERR_INCOMPATIBLE_HOST_PROFILE');

    const invalidHostProfiles = validateAddonManifestContract(
      {
        ...baseManifest,
        compatibility: {
          ...baseManifest.compatibility,
          hostProfiles: [],
        },
      },
      pluginsRoot,
      { expectedHostProfileId: 'antigravity-desktop', hostVersion: '3.3.0', checkFilesExist: false }
    );
    assert.equal(invalidHostProfiles.ok, false);
    assert.equal(invalidHostProfiles.reason, 'ERR_INVALID_HOST_PROFILES');

    // 9. v3 restricted localLoopback MUST fail closed
    const badRestrictedLoopback = validateAddonManifestContract(
      {
        ...baseManifest,
        trustLevel: 'restricted',
        settingsBridge: undefined,
        uiSlots: [],
        permissions: { ...baseManifest.permissions, dom: undefined },
      },
      pluginsRoot,
      { checkFilesExist: false }
    );
    assert.equal(badRestrictedLoopback.ok, false);
    assert.equal(badRestrictedLoopback.reason, 'ERR_RESTRICTED_LOCAL_LOOPBACK_FORBIDDEN');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
