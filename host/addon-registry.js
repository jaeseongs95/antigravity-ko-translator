'use strict';

/**
 * AddonManifest.v2 Registry & Diagnostics Adapter (Zero `app.asar` Access).
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
const HOST_PROFILE_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SETTINGS_FILE_RE = /^[a-z0-9][a-z0-9._-]{1,63}\.json$/;
const WINDOWS_DOS_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const RESERVED_SETTINGS_FILES = new Set([
  'trust-policy.json',
  'secrets-vault.json',
  'config.json',
  'index.json',
  'build-manifest.json',
  'package.json',
]);
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemver(ver) {
  if (typeof ver !== 'string') return null;
  const trimmed = ver.trim();
  const m = trimmed.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!m) return null;
  const prerelease = m[4] ? m[4].split('.') : null;
  if (prerelease && prerelease.some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) {
    return null;
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease };
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    if (ia === ib) continue;
    const na = /^\d+$/.test(ia);
    const nb = /^\d+$/.test(ib);
    if (na && nb) return Number(ia) - Number(ib);
    if (na) return -1;
    if (nb) return 1;
    return ia < ib ? -1 : 1;
  }
  return 0;
}

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
  { expectedHostProfileId = null, compatibleHostProfiles = null, hostVersion = null, checkFilesExist = true } = {}
) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, reason: 'INVALID_MANIFEST_OBJECT' };
  }
  if (manifest.schemaVersion !== 2 && manifest.schemaVersion !== 3) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  if (manifest.schemaVersion === 3 && manifest.apiVersion !== undefined && manifest.apiVersion !== 3) {
    return { ok: false, reason: 'ERR_INVALID_API_VERSION' };
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
  if (manifest.trustLevel !== undefined && manifest.trustLevel !== 'trusted' && manifest.trustLevel !== 'restricted') {
    return { ok: false, reason: 'ERR_INVALID_TRUST_LEVEL' };
  }
  if (manifest.compatibility && typeof manifest.compatibility === 'object') {
    const compat = manifest.compatibility;
    if (compat.hostProfiles !== undefined) {
      if (
        !Array.isArray(compat.hostProfiles) ||
        compat.hostProfiles.length === 0 ||
        compat.hostProfiles.some((p) => typeof p !== 'string' || !HOST_PROFILE_ID_RE.test(p) || FORBIDDEN_IDS.has(p))
      ) {
        return { ok: false, reason: 'ERR_INVALID_HOST_PROFILES' };
      }
    }
    if (compat.excludeHostProfiles !== undefined) {
      if (
        !Array.isArray(compat.excludeHostProfiles) ||
        compat.excludeHostProfiles.some((p) => typeof p !== 'string' || !HOST_PROFILE_ID_RE.test(p) || FORBIDDEN_IDS.has(p))
      ) {
        return { ok: false, reason: 'ERR_INVALID_EXCLUDE_HOST_PROFILES' };
      }
    }
    if (expectedHostProfileId) {
      if (Array.isArray(compat.excludeHostProfiles) && compat.excludeHostProfiles.includes(expectedHostProfileId)) {
        return { ok: false, reason: 'ERR_INCOMPATIBLE_HOST_PROFILE' };
      }
      if (Array.isArray(compat.hostProfiles) && compat.hostProfiles.length > 0) {
        if (!compat.hostProfiles.includes(expectedHostProfileId)) {
          return { ok: false, reason: 'ERR_INCOMPATIBLE_HOST_PROFILE' };
        }
      } else if (compat.hostProfile && compat.hostProfile !== expectedHostProfileId) {
        const acceptedCompat =
          Array.isArray(compatibleHostProfiles) && compatibleHostProfiles.includes(compat.hostProfile);
        if (!acceptedCompat) {
          return { ok: false, reason: 'ERR_INCOMPATIBLE_HOST_PROFILE' };
        }
      }
    }
  }
  if (manifest.compatibility && manifest.compatibility.minHostVersion !== undefined) {
    const minVer = manifest.compatibility.minHostVersion;
    if (typeof minVer !== 'string' || !parseSemver(minVer)) {
      return { ok: false, reason: 'ERR_INVALID_MIN_HOST_VERSION' };
    }
    if (hostVersion !== null && hostVersion !== undefined) {
      const cmp = compareSemver(hostVersion, minVer);
      if (cmp === null || cmp < 0) {
        return { ok: false, reason: 'ERR_HOST_VERSION_TOO_OLD' };
      }
    }
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
  if (capSet.has('mainHook') || entry.mainHookScript) {
    return { ok: false, reason: 'ERR_MAIN_HOOK_FORBIDDEN_IN_V2_PLUGIN' };
  }
  if (capSet.has('renderer') && !entry.rendererScript) {
    return { ok: false, reason: 'ERR_MISSING_RENDERER_ENTRY' };
  }
  if (!capSet.has('renderer') && entry.rendererScript) {
    return { ok: false, reason: 'ERR_UNDECLARED_RENDERER_CAPABILITY' };
  }

  if (manifest.settingsBridge !== undefined) {
    const sb = manifest.settingsBridge;
    if (
      !sb ||
      typeof sb !== 'object' ||
      Array.isArray(sb) ||
      typeof sb.fileName !== 'string' ||
      !SETTINGS_FILE_RE.test(sb.fileName) ||
      sb.fileName.includes('..') ||
      RESERVED_SETTINGS_FILES.has(sb.fileName.toLowerCase()) ||
      sb.fileName.toLowerCase().endsWith('.orig.json') ||
      WINDOWS_DOS_DEVICE_RE.test(sb.fileName.toLowerCase())
    ) {
      return { ok: false, reason: 'ERR_INVALID_SETTINGS_BRIDGE' };
    }
    if (
      sb.maxBytes !== undefined &&
      (!Number.isInteger(sb.maxBytes) || sb.maxBytes < 1024 || sb.maxBytes > 262144)
    ) {
      return { ok: false, reason: 'ERR_INVALID_SETTINGS_BRIDGE_MAX_BYTES' };
    }
    if (manifest.trustLevel !== 'trusted') {
      return { ok: false, reason: 'ERR_RESTRICTED_SETTINGS_BRIDGE_FORBIDDEN' };
    }
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
      if (s.shadow === true) {
        return { ok: false, reason: 'ERR_DOCUMENT_TRANSFORM_CANNOT_USE_SHADOW' };
      }
      if (s.scope !== 'native-host-only') {
        return { ok: false, reason: 'ERR_DOCUMENT_TRANSFORM_SCOPE_REQUIRED' };
      }
      if (manifest.isolation.respectsNoTranslate === false) {
        return { ok: false, reason: 'ERR_DOCUMENT_TRANSFORM_MUST_RESPECT_NO_TRANSLATE' };
      }
      if (manifest.trustLevel !== 'trusted') {
        return { ok: false, reason: 'ERR_RESTRICTED_DOCUMENT_TRANSFORM_FORBIDDEN' };
      }
    }
  }

  if (manifest.schemaVersion === 3 && manifest.permissions !== undefined) {
    const perms = manifest.permissions;
    if (!perms || typeof perms !== 'object' || Array.isArray(perms)) {
      return { ok: false, reason: 'ERR_INVALID_PERMISSIONS' };
    }
    if (perms.dom && perms.dom.documentTransform === true) {
      if (manifest.isolation && manifest.isolation.respectsNoTranslate === false) {
        return { ok: false, reason: 'ERR_DOCUMENT_TRANSFORM_MUST_RESPECT_NO_TRANSLATE' };
      }
      if (manifest.trustLevel !== 'trusted') {
        return { ok: false, reason: 'ERR_RESTRICTED_DOCUMENT_TRANSFORM_FORBIDDEN' };
      }
    }
    if (perms.net && typeof perms.net === 'object') {
      if (Array.isArray(perms.net.localLoopback) && perms.net.localLoopback.length > 0 && manifest.trustLevel !== 'trusted') {
        return { ok: false, reason: 'ERR_RESTRICTED_LOCAL_LOOPBACK_FORBIDDEN' };
      }
    }
    if (perms.secrets !== undefined && perms.secrets !== null) {
      if (manifest.trustLevel !== 'trusted') {
        return { ok: false, reason: 'ERR_RESTRICTED_SECRETS_FORBIDDEN' };
      }
    }
  }

  const pluginDir = pluginsRootDir
    ? path.join(pluginsRootDir, manifest.pluginId)
    : path.join('plugins', manifest.pluginId);
  const resolvedEntries = { rendererScript: null };

  if (entry.rendererScript) {
    const res = resolveConfinedScript(entry.rendererScript, pluginDir, pluginsRootDir, {
      checkFilesExist: Boolean(checkFilesExist && pluginsRootDir),
    });
    if (!res.ok) return res;
    resolvedEntries.rendererScript = res.resolvedPath;
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

function readInstalledAddonHostVersion(loaderScriptPath) {
  if (!isAddonHostLoaderPresent(loaderScriptPath)) return null;
  let src = '';
  try {
    src = fs.readFileSync(loaderScriptPath, 'utf8');
  } catch (_err) {
    return null;
  }
  const cfgMatch = src.match(/const\s+HOST_CFG\s*=\s*(\{[\s\S]*?\});/);
  if (cfgMatch && cfgMatch[1]) {
    try {
      const parsed = JSON.parse(cfgMatch[1]);
      if (parsed && typeof parsed.hostVersion === 'string' && parseSemver(parsed.hostVersion)) {
        return parsed.hostVersion.trim();
      }
    } catch (_parseErr) {}
  }
  const verMatch = src.match(/"hostVersion"\s*:\s*"([^"]+)"/);
  if (verMatch && verMatch[1] && parseSemver(verMatch[1])) {
    return verMatch[1].trim();
  }
  return null;
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
  WINDOWS_DOS_DEVICE_RE,
  parseSemver,
  compareSemver,
  validateAddonManifestContract,
  loadSourceAddonManifest,
  readRegisteredManifest,
  isAddonHostLoaderPresent,
  readInstalledAddonHostVersion,
  registerAddonManifest,
  unregisterAddonManifest,
};
