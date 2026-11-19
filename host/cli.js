'use strict';

/**
 * Explicit, Zero-Daemon Addon CLI for `ko-thought-translator` (AddonManifest.v1).
 *
 * Zero `app.asar` mutation: `app.asar` install/rollback belongs solely to
 * `antigravity-native-addon-host`. This CLI manages ONLY this plugin's manifest
 * registration in `<appDir>/addons.d/ko-thought-translator.json` and isolated settings.
 *
 * Commands:
 *   --status     Read-only JSON status report (0 file mutations)
 *   --install    Register `addons.d/ko-thought-translator.json` (AddonManifest.v1)
 *   --uninstall  Unregister manifest & clean `ko_translator_settings.json`
 *   --rollback   Unregister this plugin's manifest & settings (delegates `app.asar` rollback to addon-host)
 */

const { resolveHostPaths } = require('./paths');
const { ANTIGRAVITY_HOST_PROFILE } = require('./profiles/antigravity');
const {
  isPluginEnabled,
  readTranslatorSettings,
  removeTranslatorSettings,
} = require('./config-store');
const {
  readRegisteredManifest,
  validateAddonManifestContract,
  isAddonHostLoaderPresent,
  registerAddonManifest,
  unregisterAddonManifest,
} = require('./addon-registry');

const HOST_INSTALL_HINT =
  'Install the shared host via antigravity-native-addon-host (`addon-host --install`) to load AddonManifest.v1 plugins.';

function buildStatusReport(pathOverrides = null, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const p = { ...resolveHostPaths(process.env, activeProfile), ...(pathOverrides || {}) };
  const manifest = readRegisteredManifest(p.MANIFEST_PATH);
  const manifestValidation = manifest
    ? validateAddonManifestContract(manifest, p.PLUGINS_ROOT_DIR, {
        expectedHostProfileId: activeProfile.id,
        checkFilesExist: true,
      })
    : { ok: false, reason: 'MANIFEST_NOT_FOUND' };
  const addonHostInstalled = isAddonHostLoaderPresent(p.LOADER_SCRIPT_PATH);

  let settings = null;
  let settingsCorrupted = false;
  let settingsError = null;
  try {
    settings = readTranslatorSettings(p, { strict: true });
  } catch (err) {
    settingsCorrupted = true;
    settingsError = err && err.message ? err.message : 'SETTINGS_FILE_CORRUPTED';
  }
  return {
    version: '2.1.0',
    manifestSchema: 'AddonManifest.v1',
    patchMarker: activeProfile.patchMarker,
    pluginEnabled: isPluginEnabled(p.CONFIG_JSON_PATH, activeProfile.pluginId),
    manifestRegistered: Boolean(manifestValidation.ok),
    manifestValidation,
    addonHostInstalled,
    asarLoaderInstalled: addonHostInstalled,
    settings,
    settingsCorrupted,
    settingsError,
  };
}

async function runCli(argv = process.argv.slice(2), pathOverrides = null, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const p = { ...resolveHostPaths(process.env, activeProfile), ...(pathOverrides || {}) };

  if (argv.includes('--status') || argv.length === 0) {
    const report = buildStatusReport(p, activeProfile);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report;
  }

  if (argv.includes('--install') || argv.includes('--register')) {
    const reg = registerAddonManifest(p, activeProfile);
    if (!reg.ok) {
      const out = {
        status: 'FAILED',
        error: reg.reason || 'INVALID_MANIFEST',
        manifest: reg.manifest || null,
        manifestValidation: reg.manifestValidation || { ok: false, reason: reg.reason },
      };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      process.exitCode = 1;
      return out;
    }
    const addonHostInstalled = isAddonHostLoaderPresent(p.LOADER_SCRIPT_PATH);
    const out = {
      status: 'INSTALLED',
      manifestPath: reg.manifestPath,
      manifest: reg.manifest,
      manifestValidation: reg.manifestValidation,
      addonHostInstalled,
      ...(addonHostInstalled ? {} : { hostInstallHint: HOST_INSTALL_HINT }),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out;
  }

  if (argv.includes('--uninstall') || argv.includes('--unregister')) {
    const manifestRemoved = unregisterAddonManifest(p, activeProfile);
    const settingsRemoved = removeTranslatorSettings(p);
    const out = { status: 'UNINSTALLED', manifestRemoved, settingsRemoved };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out;
  }

  if (argv.includes('--rollback')) {
    const manifestRemoved = unregisterAddonManifest(p, activeProfile);
    const settingsRemoved = removeTranslatorSettings(p);
    const out = {
      status: 'MANIFEST_REMOVED_HOST_PRESERVED',
      manifestRemoved,
      settingsRemoved,
      note: 'To roll back app.asar itself, run `addon-host --rollback` in antigravity-native-addon-host.',
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out;
  }

  throw new Error(`Unsupported CLI arguments: ${argv.join(' ')}`);
}

module.exports = {
  buildStatusReport,
  runCli,
};
