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
const {
  isPluginEnabled,
  readTranslatorSettings,
  removeTranslatorSettings,
} = require('./config-store');
const {
  PATCH_MARKER,
  readDropinManifest,
  isAsarLoaderInstalled,
  registerPluginManifest,
  unregisterPluginManifest,
  installAsarDropinLoader,
  rollbackAsarDropinLoader,
} = require('./dropin-loader');

function buildStatusReport(pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  return {
    version: '2.0.0',
    patchMarker: PATCH_MARKER,
    pluginEnabled: isPluginEnabled(p.CONFIG_JSON_PATH),
    manifestRegistered: Boolean(readDropinManifest(p.MANIFEST_PATH)),
    asarLoaderInstalled: isAsarLoaderInstalled(p.ASAR_PATH),
    settings: readTranslatorSettings(p),
  };
}

async function runCli(argv = process.argv.slice(2), pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };

  if (argv.includes('--status') || argv.length === 0) {
    const report = buildStatusReport(p);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report;
  }

  if (argv.includes('--install')) {
    const manifest = registerPluginManifest(p);
    const asar = installAsarDropinLoader(p);
    const out = { status: 'INSTALLED', manifest, asar };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out;
  }

  if (argv.includes('--uninstall')) {
    const manifestRemoved = unregisterPluginManifest(p);
    const settingsRemoved = removeTranslatorSettings(p);
    const out = { status: 'UNINSTALLED', manifestRemoved, settingsRemoved };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out;
  }

  if (argv.includes('--rollback')) {
    const rollback = rollbackAsarDropinLoader(p);
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
