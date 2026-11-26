'use strict';

/**
 * Explicit, Zero-Daemon Addon CLI for `ko-thought-translator` (AddonManifest.v2).
 *
 * Zero `app.asar` mutation: `app.asar` install/rollback belongs solely to
 * `antigravity-native-addon-host` (>= v2.1.0). This CLI manages ONLY this plugin's
 * manifest registration in `<appDir>/addons.d/ko-thought-translator.json` and isolated settings.
 *
 * Commands:
 *   --status     Read-only JSON status report (0 file mutations)
 *   --install    Register `addons.d/ko-thought-translator.json` (AddonManifest.v2) and initialize missing settings
 *   --uninstall  Unregister manifest & clean `ko_translator_settings.json`
 *   --rollback   Unregister this plugin's manifest & settings (delegates `app.asar` rollback to addon-host)
 */

const fs = require('node:fs');
const { resolveHostPaths } = require('./paths');
const { ANTIGRAVITY_HOST_PROFILE } = require('./profiles/antigravity');
const {
  isPluginEnabled,
  readTranslatorSettings,
  saveTranslatorSettings,
  removeTranslatorSettings,
} = require('./config-store');
const {
  compareSemver,
  readRegisteredManifest,
  validateAddonManifestContract,
  isAddonHostLoaderPresent,
  readInstalledAddonHostVersion,
  registerAddonManifest,
  unregisterAddonManifest,
} = require('./addon-registry');

const PKG_VERSION = require('../package.json').version || '3.0.0';
const MIN_REQUIRED_HOST_VERSION = '3.0.0';
const HOST_INSTALL_HINT =
  'Install/upgrade antigravity-native-addon-host (>= v3.0.0) via `addon-host --upgrade` and approve trust via `addon-host trust approve ko-thought-translator` (using real copied plugin files, zero symlinks).';
const TRUST_APPROVE_HINT =
  'Run `addon-host trust approve ko-thought-translator` after installing/updating real copied files in `~/.gemini/config/plugins/ko-thought-translator/`.';

function evaluateHostCompatibility(loaderScriptPath, minVersion = MIN_REQUIRED_HOST_VERSION) {
  const addonHostInstalled = isAddonHostLoaderPresent(loaderScriptPath);
  const addonHostVersion = addonHostInstalled ? readInstalledAddonHostVersion(loaderScriptPath) : null;
  const cmp = addonHostVersion ? compareSemver(addonHostVersion, minVersion) : null;
  const addonHostCompatible = Boolean(addonHostInstalled && cmp !== null && cmp >= 0);
  return { addonHostInstalled, addonHostVersion, addonHostCompatible };
}

function buildStatusReport(pathOverrides = null, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const p = { ...resolveHostPaths(process.env, activeProfile), ...(pathOverrides || {}) };
  const manifest = readRegisteredManifest(p.MANIFEST_PATH);
  const { addonHostInstalled, addonHostVersion, addonHostCompatible } = evaluateHostCompatibility(
    p.LOADER_SCRIPT_PATH,
    (manifest && manifest.compatibility && manifest.compatibility.minHostVersion) || MIN_REQUIRED_HOST_VERSION
  );
  const manifestValidation = manifest
    ? validateAddonManifestContract(manifest, p.PLUGINS_ROOT_DIR, {
        expectedHostProfileId: activeProfile.id,
        hostVersion: addonHostVersion,
        checkFilesExist: true,
      })
    : { ok: false, reason: 'MANIFEST_NOT_FOUND' };

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
    version: PKG_VERSION,
    manifestSchema: manifest && manifest.schemaVersion === 2 ? 'AddonManifest.v2' : 'AddonManifest.v3',
    patchMarker: activeProfile.patchMarker,
    pluginEnabled: isPluginEnabled(p.CONFIG_JSON_PATH, activeProfile.pluginId),
    manifestRegistered: Boolean(manifestValidation.ok),
    manifestValidation,
    addonHostInstalled,
    addonHostVersion,
    addonHostCompatible,
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
    let settingsInitialized = false;
    if (p.SETTINGS_PATH && !fs.existsSync(p.SETTINGS_PATH)) {
      saveTranslatorSettings({}, p);
      settingsInitialized = true;
    }
    const { addonHostInstalled, addonHostVersion, addonHostCompatible } = evaluateHostCompatibility(
      p.LOADER_SCRIPT_PATH,
      (reg.manifest && reg.manifest.compatibility && reg.manifest.compatibility.minHostVersion) ||
        MIN_REQUIRED_HOST_VERSION
    );
    const out = {
      status: 'INSTALLED',
      manifestPath: reg.manifestPath,
      manifest: reg.manifest,
      manifestValidation: reg.manifestValidation,
      settingsInitialized,
      addonHostInstalled,
      addonHostVersion,
      addonHostCompatible,
      trustApproveHint: TRUST_APPROVE_HINT,
      ...(addonHostCompatible ? {} : { hostInstallHint: HOST_INSTALL_HINT }),
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
