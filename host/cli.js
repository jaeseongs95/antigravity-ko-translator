'use strict';

/**
 * Explicit, Zero-Daemon Host CLI for ko-thought-translator (Desktop Native App Only).
 *
 * Commands:
 *   --status     Read-only JSON status report (0 file mutations)
 *   --install    Register `ui-extensions.d/ko-thought-translator.json` & install `dist/main.js` drop-in loader
 *   --uninstall  Unregister manifest & clean `ko_translator_settings.json`
 *   --rollback   Unregister manifest & atomically restore pure `.orig` `app.asar` when no sibling manifests remain
 */

const { resolveHostPaths } = require('./paths');
const { ANTIGRAVITY_HOST_PROFILE } = require('./profiles/antigravity');
const {
  isPluginEnabled,
  readTranslatorSettings,
  removeTranslatorSettings,
} = require('./config-store');
const {
  readDropinManifest,
  validateDropinManifest,
  isAsarLoaderInstalled,
  registerPluginManifest,
  unregisterPluginManifest,
  installAsarDropinLoader,
  rollbackAsarDropinLoader,
} = require('./dropin-loader');

function buildStatusReport(pathOverrides = null, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const p = { ...resolveHostPaths(process.env, activeProfile), ...(pathOverrides || {}) };
  const manifest = readDropinManifest(p.MANIFEST_PATH);
  const manifestValidation = manifest
    ? validateDropinManifest(manifest, p.PLUGINS_ROOT_DIR)
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
    version: '2.0.0',
    patchMarker: activeProfile.patchMarker,
    pluginEnabled: isPluginEnabled(p.CONFIG_JSON_PATH),
    manifestRegistered: Boolean(manifestValidation.ok),
    manifestValidation,
    asarLoaderInstalled: isAsarLoaderInstalled(p.ASAR_PATH, activeProfile),
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

  if (argv.includes('--install')) {
    const manifest = registerPluginManifest(p, activeProfile);
    const manifestValidation = validateDropinManifest(manifest, p.PLUGINS_ROOT_DIR);
    if (!manifestValidation.ok) {
      unregisterPluginManifest(p, activeProfile);
      const out = {
        status: 'FAILED',
        error: manifestValidation.reason || 'INVALID_MANIFEST',
        manifest,
        manifestValidation,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      process.exitCode = 1;
      return out;
    }
    const asar = installAsarDropinLoader(p, activeProfile);
    const succeeded =
      asar.status === 'INSTALLED' ||
      asar.status === 'ALREADY_INSTALLED' ||
      asar.status === 'SKIPPED_NO_ASAR';
    if (!succeeded) {
      unregisterPluginManifest(p, activeProfile);
    }
    const out = { status: succeeded ? 'INSTALLED' : 'FAILED', manifest, manifestValidation, asar };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    if (!succeeded) {
      process.exitCode = 1;
    }
    return out;
  }

  if (argv.includes('--uninstall')) {
    const manifestRemoved = unregisterPluginManifest(p, activeProfile);
    const settingsRemoved = removeTranslatorSettings(p);
    const out = { status: 'UNINSTALLED', manifestRemoved, settingsRemoved };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out;
  }

  if (argv.includes('--rollback')) {
    const rollback = rollbackAsarDropinLoader(p, activeProfile);
    const succeeded =
      rollback.status === 'ROLLED_BACK' ||
      rollback.status === 'ALREADY_UNPATCHED' ||
      rollback.status === 'SKIPPED_NO_ASAR' ||
      rollback.status === 'MANIFEST_REMOVED_SHARED_LOADER_PRESERVED';
    const settingsRemoved = succeeded ? removeTranslatorSettings(p) : false;
    const out = { ...rollback, settingsRemoved };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    if (!succeeded) {
      process.exitCode = 1;
    }
    return out;
  }

  throw new Error(`Unsupported CLI arguments: ${argv.join(' ')}`);
}

module.exports = {
  buildStatusReport,
  runCli,
};
