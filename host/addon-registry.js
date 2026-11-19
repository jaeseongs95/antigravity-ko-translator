'use strict';

/**
 * AddonManifest.v1 Registry & Diagnostics Adapter (Zero `app.asar` Access).
 *
 * Manages ONLY this plugin's declarative manifest in `<appDir>/addons.d/<pluginId>.json`
 * and reports read-only shared host loader presence (`addon-host-loader.js`).
 * Patching or rolling back `app.asar` is strictly owned by `antigravity-native-addon-host`.
 */

const fs = require('node:fs');
const path = require('node:path');

const { resolveHostPaths } = require('./paths');
const { ANTIGRAVITY_HOST_PROFILE } = require('./profiles/antigravity');
const {
  acquireExclusiveLock,
  releaseExclusiveLock,
  writeFileAtomicSync,
} = require('./config-store');

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isPathStrictlyInside(parentDir, candidatePath) {
  const rel = path.relative(parentDir, candidatePath);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function isDirectChildOfDir(dirPath, candidatePath) {
  const rel = path.relative(path.resolve(dirPath), path.resolve(candidatePath));
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep));
}

function resolveConfinedScript(relScript, pluginDir, pluginsRootDir, { checkFilesExist = true } = {}) {
  if (typeof relScript !== 'string' || !relScript.trim()) {
    return { ok: false, reason: 'ERR_EMPTY_ENTRY_SCRIPT' };
  }
  if (path.isAbsolute(relScript) || /^[A-Za-z]:/.test(relScript) || relScript.includes('\0')) {
    return { ok: false, reason: 'ERR_ENTRY_ESCAPES_PLUGIN_DIR' };
  }
  const normalized = path.normalize(relScript);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    return { ok: false, reason: 'ERR_ENTRY_ESCAPES_PLUGIN_DIR' };
  }
  const resolvedPluginDir = path.resolve(pluginDir);
  const resolvedTarget = path.resolve(resolvedPluginDir, normalized);
  if (!isPathStrictlyInside(resolvedPluginDir, resolvedTarget)) {
    return { ok: false, reason: 'ERR_ENTRY_ESCAPES_PLUGIN_DIR' };
  }
  if (pluginsRootDir && !isPathStrictlyInside(path.resolve(pluginsRootDir), resolvedPluginDir)) {
    return { ok: false, reason: 'ERR_PLUGIN_DIR_ESCAPES_ROOT' };
  }
  if (!checkFilesExist) {
    return { ok: true, resolvedPath: resolvedTarget };
  }
  if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isFile()) {
    return { ok: false, reason: 'ERR_ENTRY_SCRIPT_NOT_FOUND', resolvedPath: resolvedTarget };
  }
  try {
    const realBase = fs.realpathSync(resolvedPluginDir);
    if (pluginsRootDir && fs.existsSync(pluginsRootDir)) {
      const realRoot = fs.realpathSync(path.resolve(pluginsRootDir));
      if (!isPathStrictlyInside(realRoot, realBase)) {
        return { ok: false, reason: 'ERR_PLUGIN_DIR_SYMLINK_ESCAPE' };
      }
    }
    const realTarget = fs.realpathSync(resolvedTarget);
    if (!isPathStrictlyInside(realBase, realTarget)) {
      return { ok: false, reason: 'ERR_ENTRY_ESCAPES_PLUGIN_DIR' };
    }
    return { ok: true, resolvedPath: realTarget };
  } catch (_err) {
    return { ok: false, reason: 'ERR_ENTRY_REALPATH_FAILED' };
  }
}

function validateAddonManifestContract(
  manifest,
  pluginsRootDir,
  { expectedHostProfileId = null, checkFilesExist = true } = {}
) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, reason: 'INVALID_MANIFEST_OBJECT' };
  }
  if (manifest.schemaVersion !== 1) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  if (typeof manifest.pluginId !== 'string' || !PLUGIN_ID_RE.test(manifest.pluginId) || FORBIDDEN_IDS.has(manifest.pluginId)) {
    return { ok: false, reason: 'ERR_INVALID_PLUGIN_ID' };
  }
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()) {
    return { ok: false, reason: 'ERR_MISSING_DISPLAY_NAME' };
  }
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    return { ok: false, reason: 'ERR_INVALID_VERSION' };
  }
  if (
    expectedHostProfileId &&
    manifest.compatibility &&
    manifest.compatibility.hostProfile &&
    manifest.compatibility.hostProfile !== expectedHostProfileId
  ) {
    return { ok: false, reason: 'ERR_INCOMPATIBLE_HOST_PROFILE' };
  }

  const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  if (caps.length === 0) {
    return { ok: false, reason: 'ERR_MISSING_CAPABILITIES' };
  }
  const capSet = new Set(caps);
  const entry = manifest.entry && typeof manifest.entry === 'object' ? manifest.entry : null;
  if (!entry) {
    return { ok: false, reason: 'ERR_MISSING_ENTRY' };
  }
  if (capSet.has('renderer') && !entry.rendererScript) {
    return { ok: false, reason: 'ERR_MISSING_RENDERER_ENTRY' };
  }
  if (capSet.has('mainHook') && !entry.mainHookScript) {
    return { ok: false, reason: 'ERR_MISSING_MAIN_HOOK_ENTRY' };
  }
  if (!capSet.has('renderer') && entry.rendererScript) {
    return { ok: false, reason: 'ERR_UNDECLARED_RENDERER_CAPABILITY' };
  }
  if (!capSet.has('mainHook') && entry.mainHookScript) {
    return { ok: false, reason: 'ERR_UNDECLARED_MAIN_HOOK_CAPABILITY' };
  }

  if (!manifest.isolation || typeof manifest.isolation !== 'object') {
    return { ok: false, reason: 'ERR_MISSING_ISOLATION' };
  }
  if (typeof manifest.isolation.noTranslate !== 'boolean' || typeof manifest.isolation.i18nSelfManaged !== 'boolean') {
    return { ok: false, reason: 'ERR_INVALID_ISOLATION' };
  }

  const slots = Array.isArray(manifest.uiSlots) ? manifest.uiSlots : [];
  for (const s of slots) {
    if (!s || typeof s !== 'object' || !s.slot || !s.slotId) {
      return { ok: false, reason: 'ERR_INVALID_UI_SLOT' };
    }
    if (s.slot === 'document-transform') {
      if (s.scope !== 'native-host-only') {
        return { ok: false, reason: 'ERR_DOCUMENT_TRANSFORM_SCOPE_REQUIRED' };
      }
      if (manifest.isolation.respectsNoTranslate === false) {
        return { ok: false, reason: 'ERR_DOCUMENT_TRANSFORM_MUST_RESPECT_NO_TRANSLATE' };
      }
    }
  }

  const pluginDir = pluginsRootDir
    ? path.join(pluginsRootDir, manifest.pluginId)
    : path.join('plugins', manifest.pluginId);
  const resolvedEntries = { rendererScript: null, mainHookScript: null };

  if (entry.rendererScript) {
    const res = resolveConfinedScript(entry.rendererScript, pluginDir, pluginsRootDir, {
      checkFilesExist: Boolean(checkFilesExist && pluginsRootDir),
    });
    if (!res.ok) return res;
    resolvedEntries.rendererScript = res.resolvedPath;
  }
  if (entry.mainHookScript) {
    const res = resolveConfinedScript(entry.mainHookScript, pluginDir, pluginsRootDir, {
      checkFilesExist: Boolean(checkFilesExist && pluginsRootDir),
    });
    if (!res.ok) return res;
    resolvedEntries.mainHookScript = res.resolvedPath;
  }

  return {
    ok: true,
    pluginId: manifest.pluginId,
    resolvedEntries,
  };
}

function readJsonFileSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function loadSourceAddonManifest(sourceManifestPath) {
  const parsed = readJsonFileSafe(sourceManifestPath);
  if (!parsed) {
    throw new Error(`SOURCE_MANIFEST_UNREADABLE:${sourceManifestPath}`);
  }
  return parsed;
}

function readRegisteredManifest(manifestPath) {
  return readJsonFileSafe(manifestPath);
}

function isAddonHostLoaderPresent(loaderScriptPath) {
  return Boolean(loaderScriptPath && fs.existsSync(loaderScriptPath));
}

function registerAddonManifest(pathOverrides = null, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const p = { ...resolveHostPaths(process.env, activeProfile), ...(pathOverrides || {}) };
  const manifest = loadSourceAddonManifest(p.SOURCE_MANIFEST_PATH);

  const lockToken = acquireExclusiveLock(p.ADDONS_LOCK_PATH, 30000);
  if (!lockToken) {
    return { ok: false, reason: 'ERR_ADDONS_LOCK_BUSY', manifest };
  }
  try {
    const validation = validateAddonManifestContract(manifest, p.PLUGINS_ROOT_DIR, {
      expectedHostProfileId: activeProfile.id,
      checkFilesExist: true,
    });
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, manifest, manifestValidation: validation };
    }
    if (!isDirectChildOfDir(p.ADDONS_DIR, p.MANIFEST_PATH)) {
      return { ok: false, reason: 'ERR_INVALID_MANIFEST_PATH', manifest };
    }
    writeFileAtomicSync(p.MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    return {
      ok: true,
      manifestPath: p.MANIFEST_PATH,
      manifest,
      manifestValidation: validation,
    };
  } finally {
    releaseExclusiveLock(p.ADDONS_LOCK_PATH, lockToken);
  }
}

function unregisterAddonManifest(pathOverrides = null, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const p = { ...resolveHostPaths(process.env, activeProfile), ...(pathOverrides || {}) };
  if (!isDirectChildOfDir(p.ADDONS_DIR, p.MANIFEST_PATH)) {
    throw new Error('ERR_INVALID_MANIFEST_PATH');
  }
  const lockToken = acquireExclusiveLock(p.ADDONS_LOCK_PATH, 30000);
  if (!lockToken) {
    throw new Error('ERR_ADDONS_LOCK_BUSY');
  }
  try {
    if (fs.existsSync(p.MANIFEST_PATH)) {
      fs.unlinkSync(p.MANIFEST_PATH);
      return true;
    }
    return false;
  } finally {
    releaseExclusiveLock(p.ADDONS_LOCK_PATH, lockToken);
  }
}

module.exports = {
  PLUGIN_ID_RE,
  FORBIDDEN_IDS,
  validateAddonManifestContract,
  loadSourceAddonManifest,
  readRegisteredManifest,
  isAddonHostLoaderPresent,
  registerAddonManifest,
  unregisterAddonManifest,
};
