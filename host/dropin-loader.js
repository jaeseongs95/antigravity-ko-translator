'use strict';

/**
 * Shared Zero-Conflict Drop-In UI Extension Loader (`ui-extensions.d/<plugin-id>.json`).
 *
 * Security & Coexistence Invariants (aligned across Antigravity desktop plugin owners):
 * 1. `schemaVersion: 1`, `pluginId` (`^[a-z0-9][a-z0-9_-]{0,63}$`), `entryScript` whose
 *    `fs.realpathSync` MUST stay strictly inside `fs.realpathSync(<pluginsRoot>/<pluginId>)`.
 *    Symlink escapes and `..` traversal are unconditionally rejected.
 * 2. Live `~/.gemini/config/config.json` check (`plugins[pluginId]?.enabled !== false`) on
 *    every window load: disabling or uninstalling a plugin immediately executes 0 bytes.
 * 3. Top-frame Hub URL filter ONLY (`http(s)://127.0.0.1` or `http(s)://localhost`):
 *    NEVER injects into `devtools://`, `about:`, `data:`, `file://`, or child iframes/Sidecars.
 * 4. Per-plugin isolated IIFE + independent `try/catch`.
 * 5. Patches ONLY ONE anchor in `dist/main.js` (`app.on('web-contents-created', ...)`) with
 *    exact-size preservation, verified `.orig` backup, and atomic rename (ZERO `copyFileSync` fallback).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const asar = require('@electron/asar');

const { resolveHostPaths, PLUGIN_ID } = require('./paths');
const {
  PATCH_MARKER,
  MAIN_ANCHOR_TARGET,
  MAIN_ANCHOR_REPLACEMENT,
  ANTIGRAVITY_HOST_PROFILE,
} = require('./profiles/antigravity');
const {
  acquireExclusiveLock,
  releaseExclusiveLock,
  writeFileAtomicSync,
  readTranslatorSettings,
} = require('./config-store');

const BLOCK_SIZE = 4 * 1024 * 1024;
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ALLOWED_HUB_URL_RE = ANTIGRAVITY_HOST_PROFILE.allowedHubUrlRe;

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isAllowedHubUrl(rawUrl, profile = ANTIGRAVITY_HOST_PROFILE) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  const re = (profile && profile.allowedHubUrlRe) || ALLOWED_HUB_URL_RE;
  return re.test(rawUrl.trim());
}

function isPathStrictlyInside(parentDir, candidatePath) {
  const rel = path.relative(parentDir, candidatePath);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function validateDropinManifest(manifest, pluginsRootDir) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, reason: 'MANIFEST_NOT_OBJECT' };
  }
  if (manifest.schemaVersion !== 1) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  const pluginId = typeof manifest.pluginId === 'string' ? manifest.pluginId.trim() : '';
  if (!PLUGIN_ID_RE.test(pluginId)) {
    return { ok: false, reason: 'INVALID_PLUGIN_ID' };
  }
  if (typeof manifest.entryScript !== 'string' || !manifest.entryScript.trim()) {
    return { ok: false, reason: 'MISSING_ENTRY_SCRIPT' };
  }
  if (!pluginsRootDir || !fs.existsSync(pluginsRootDir)) {
    return { ok: false, reason: 'PLUGINS_ROOT_MISSING' };
  }

  const pluginDir = path.join(pluginsRootDir, pluginId);
  if (!fs.existsSync(pluginDir)) {
    return { ok: false, reason: 'PLUGIN_DIR_MISSING' };
  }

  let realPluginDir;
  let realEntryPath;
  try {
    realPluginDir = fs.realpathSync(pluginDir);
    const resolvedCandidate = path.isAbsolute(manifest.entryScript)
      ? path.resolve(manifest.entryScript)
      : path.resolve(pluginDir, manifest.entryScript);
    if (!fs.existsSync(resolvedCandidate)) {
      return { ok: false, reason: 'ENTRY_SCRIPT_MISSING' };
    }
    realEntryPath = fs.realpathSync(resolvedCandidate);
  } catch (_err) {
    return { ok: false, reason: 'REALPATH_RESOLUTION_FAILED' };
  }

  if (!isPathStrictlyInside(realPluginDir, realEntryPath)) {
    return { ok: false, reason: 'ENTRY_SCRIPT_ESCAPES_PLUGIN_DIR' };
  }

  return {
    ok: true,
    pluginId,
    entryScript: realEntryPath,
  };
}

function readDropinManifest(manifestPath) {
  try {
    if (!manifestPath || !fs.existsSync(manifestPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function isPluginEnabledInConfig(configJsonPath, pluginId) {
  try {
    if (!configJsonPath || !fs.existsSync(configJsonPath)) return true;
    const cfg = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
    const entry = cfg.plugins && cfg.plugins[pluginId];
    if (entry && entry.enabled === false) return false;
    return true;
  } catch (_err) {
    // Fail-closed: corrupted existing config.json MUST NOT silently execute plugins.
    return false;
  }
}

function collectExecutableExtensions({ uiExtensionsDir, pluginsRootDir, configJsonPath, settingsPath }) {
  const results = [];
  if (!uiExtensionsDir || !fs.existsSync(uiExtensionsDir)) return results;
  let entries = [];
  try {
    entries = fs.readdirSync(uiExtensionsDir).filter((f) => f.endsWith('.json')).sort();
  } catch (_err) {
    return results;
  }

  for (const fileName of entries) {
    const manifest = readDropinManifest(path.join(uiExtensionsDir, fileName));
    const check = validateDropinManifest(manifest, pluginsRootDir);
    if (!check.ok) continue;
    if (!isPluginEnabledInConfig(configJsonPath, check.pluginId)) continue;

    let code = '';
    try {
      code = fs.readFileSync(check.entryScript, 'utf8');
    } catch (_err) {
      continue;
    }
    if (!code.trim()) continue;

    let initialSettingsPrelude = '';
    if (check.pluginId === PLUGIN_ID && settingsPath) {
      try {
        const settings = readTranslatorSettings({ SETTINGS_PATH: settingsPath }, { strict: true });
        initialSettingsPrelude = `window.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ = ${JSON.stringify(settings)};\n`;
      } catch (_err) {
        // Fail-closed: NEVER fall back to external google-translate when settings file is corrupted.
        initialSettingsPrelude =
          'window.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ = {"enabled":false,"settingsCorrupted":true};\n';
      }
    }

    const wrapped = `(function(){try{\n${initialSettingsPrelude}${code}\n}catch(_e){}})();`;
    results.push({
      pluginId: check.pluginId,
      entryScript: check.entryScript,
      wrappedCode: wrapped,
    });
  }
  return results;
}

function buildHostLoaderScriptSource(profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const appSegmentsJson = JSON.stringify(Array.from(activeProfile.appDirSegments || ['.gemini', 'antigravity']));
  const cfgSegmentsJson = JSON.stringify(Array.from(activeProfile.configDirSegments || ['.gemini', 'config']));
  const extDirNameJson = JSON.stringify(activeProfile.uiExtensionsDirName || 'ui-extensions.d');
  const pluginIdJson = JSON.stringify(activeProfile.pluginId || PLUGIN_ID);
  const settingsFileJson = JSON.stringify(activeProfile.settingsFileName || 'ko_translator_settings.json');
  const hubReSource = ((activeProfile.allowedHubUrlRe || ALLOWED_HUB_URL_RE).source).replace(/\\/g, '\\');
  const hubReFlags = (activeProfile.allowedHubUrlRe || ALLOWED_HUB_URL_RE).flags || 'i';

  return `'use strict';
// ${activeProfile.patchMarker || PATCH_MARKER} — Shared Drop-In UI Extensions Loader (Zero-Daemon, Top-Frame Hub Only)
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const FORBIDDEN_PROVIDER_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_HEADER_RE = /^(?:authorization|proxy-authorization|x-api-key|api-key|x-goog-api-key|x-auth-token|x-access-token|x-secret|cookie)$/i;
const SECRET_QUERY_RE = /[?&](?:key|api_key|apikey|token|access_token|secret|auth)=/i;
const ALLOWED_HUB_URL_RE = new RegExp(${JSON.stringify(hubReSource)}, ${JSON.stringify(hubReFlags)});
const APP_SEGMENTS = ${appSegmentsJson};
const CFG_SEGMENTS = ${cfgSegmentsJson};
const EXT_DIR_NAME = ${extDirNameJson};
const TARGET_PLUGIN_ID = ${pluginIdJson};
const SETTINGS_FILE_NAME = ${settingsFileJson};

function isInside(parentDir, childPath) {
  const rel = path.relative(parentDir, childPath);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function validateSettingsStrictFallback(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('NOT_OBJECT');
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) throw new Error('BAD_SCHEMA');
  for (const k of ['enabled', 'translateThinking', 'showThinking', 'translateStaticUi']) {
    if (parsed[k] !== undefined && typeof parsed[k] !== 'boolean') throw new Error('BAD_BOOL:' + k);
  }
  if (parsed.provider !== undefined && parsed.provider !== null && parsed.provider !== '') {
    if (typeof parsed.provider !== 'string') throw new Error('BAD_PROVIDER_TYPE');
    const pid = parsed.provider.trim().toLowerCase();
    if (FORBIDDEN_PROVIDER_IDS.has(pid) || !PROVIDER_ID_RE.test(pid)) throw new Error('BAD_PROVIDER_ID');
  }
  if (parsed.llmConfig !== undefined && parsed.llmConfig !== null) {
    if (typeof parsed.llmConfig !== 'object' || Array.isArray(parsed.llmConfig)) throw new Error('BAD_LLM_CFG');
    const lc = parsed.llmConfig;
    if (lc.allowRemoteHttps !== undefined && typeof lc.allowRemoteHttps !== 'boolean') throw new Error('BAD_ALLOW_REMOTE');
    if (lc.apiFormat !== undefined) {
      const f = typeof lc.apiFormat === 'string' ? lc.apiFormat.trim().toLowerCase() : '';
      if (f !== 'ollama' && f !== 'openai' && f !== 'openai-compat') throw new Error('BAD_API_FORMAT');
    }
    if (lc.timeoutMs !== undefined && (typeof lc.timeoutMs !== 'number' || !Number.isFinite(lc.timeoutMs) || lc.timeoutMs < 1000 || lc.timeoutMs > 120000)) {
      throw new Error('BAD_TIMEOUT');
    }
    if (lc.baseUrl !== undefined) {
      const u = new URL(String(lc.baseUrl));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('BAD_SCHEME');
      const h = u.hostname.replace(/^\\[|\\]$/g, '').toLowerCase();
      const isLoop = h === '127.0.0.1' || h === 'localhost' || h === '::1';
      if (!isLoop && (!lc.allowRemoteHttps || u.protocol !== 'https:')) throw new Error('SSRF_BLOCKED');
    }
  }
  if (parsed.customProviders !== undefined) {
    if (!Array.isArray(parsed.customProviders)) throw new Error('BAD_CUSTOM_PROVIDERS');
    for (const cp of parsed.customProviders) {
      if (!cp || typeof cp !== 'object' || Array.isArray(cp)) throw new Error('BAD_CP_ITEM');
      if (cp.headers && typeof cp.headers === 'object') {
        for (const hk of Object.keys(cp.headers)) {
          if (SECRET_HEADER_RE.test(String(hk || '').trim())) throw new Error('SECRET_HEADER');
        }
      }
      const ep = cp.endpointUrl !== undefined ? cp.endpointUrl : cp.url;
      if (SECRET_QUERY_RE.test(String(ep || ''))) throw new Error('SECRET_QUERY');
    }
  }
  return parsed;
}

function loadValidatedSettings(realPDir, sp) {
  const storePath = path.join(realPDir, 'host', 'config-store.js');
  if (fs.existsSync(storePath)) {
    const store = require(storePath);
    if (store && typeof store.readTranslatorSettings === 'function') {
      return store.readTranslatorSettings({ SETTINGS_PATH: sp }, { strict: true });
    }
  }
  const parsed = JSON.parse(fs.readFileSync(sp, 'utf8'));
  return validateSettingsStrictFallback(parsed);
}

function attach(contents) {
  if (!contents || typeof contents.getType !== 'function' || contents.getType() !== 'window') return;
  let lastInjectedUrl = null;
  let inFlightUrl = null;
  const run = () => {
    try {
      if (contents.isDestroyed()) return;
      const url = typeof contents.getURL === 'function' ? String(contents.getURL() || '') : '';
      if (!ALLOWED_HUB_URL_RE.test(url)) return;
      if (lastInjectedUrl === url || inFlightUrl === url) return;

      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      const agyDir = path.join(home, ...APP_SEGMENTS);
      const extDir = path.join(agyDir, EXT_DIR_NAME);
      const cfgDir = path.join(home, ...CFG_SEGMENTS);
      const pluginsRoot = path.join(cfgDir, 'plugins');
      const configPath = path.join(cfgDir, 'config.json');
      if (!fs.existsSync(extDir) || !fs.existsSync(pluginsRoot)) return;

      let cfg = {};
      if (fs.existsSync(configPath)) {
        try {
          cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return;
        } catch (err) {
          try { console.error('[ko-thought-translator] corrupted config.json (fail-closed):', err && err.message ? err.message : err); } catch (_e) {}
          return;
        }
      }

      const files = fs.readdirSync(extDir).filter((f) => f.endsWith('.json')).sort();
      const scriptsToRun = [];
      for (const f of files) {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(extDir, f), 'utf8'));
          if (!m || m.schemaVersion !== 1 || typeof m.pluginId !== 'string' || !PLUGIN_ID_RE.test(m.pluginId)) continue;
          if (cfg && cfg.plugins && cfg.plugins[m.pluginId] && cfg.plugins[m.pluginId].enabled === false) continue;
          const pDir = path.join(pluginsRoot, m.pluginId);
          if (!fs.existsSync(pDir)) continue;
          const realPDir = fs.realpathSync(pDir);
          const cand = path.isAbsolute(m.entryScript) ? path.resolve(m.entryScript) : path.resolve(pDir, String(m.entryScript || ''));
          if (!fs.existsSync(cand)) continue;
          const realEntry = fs.realpathSync(cand);
          if (!isInside(realPDir, realEntry)) continue;
          const rawCode = fs.readFileSync(realEntry, 'utf8');
          let prelude = '';
          if (m.pluginId === TARGET_PLUGIN_ID) {
            const sp = path.join(agyDir, SETTINGS_FILE_NAME);
            try {
              if (fs.existsSync(sp)) {
                const validatedSettings = loadValidatedSettings(realPDir, sp);
                const safeJson = JSON.stringify(validatedSettings)
                  .replace(/</g, '\\\\u003c')
                  .replace(/\\u2028/g, '\\\\u2028')
                  .replace(/\\u2029/g, '\\\\u2029');
                prelude = 'window.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__=' + safeJson + ';\\n';
              }
            } catch (_e) {
              prelude = 'window.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__={"enabled":false,"settingsCorrupted":true};\\n';
            }
          }
          const wrapped = '(function(){try{\\n' + prelude + rawCode + '\\n}catch(err){try{console.error("[ko-thought-translator] renderer error:",err&&err.message?err.message:err);}catch(_e){}}})();';
          scriptsToRun.push(wrapped);
        } catch (err) {
          try { console.error('[ko-thought-translator] extension load failed:', f, err && err.message ? err.message : err); } catch (_e) {}
        }
      }
      if (scriptsToRun.length === 0) return;

      inFlightUrl = url;
      Promise.allSettled(scriptsToRun.map((code) => Promise.resolve(contents.executeJavaScript(code))))
        .then((results) => {
          const anyFulfilled = results.some((r) => r.status === 'fulfilled');
          for (const r of results) {
            if (r.status === 'rejected') {
              try { console.error('[ko-thought-translator] executeJavaScript failed:', r.reason && r.reason.message ? r.reason.message : r.reason); } catch (_e) {}
            }
          }
          if (anyFulfilled && inFlightUrl === url) {
            lastInjectedUrl = url;
          }
        })
        .finally(() => {
          if (inFlightUrl === url) {
            inFlightUrl = null;
          }
        });
    } catch (err) {
      inFlightUrl = null;
      try { console.error('[ko-thought-translator] loader run failed:', err && err.message ? err.message : err); } catch (_e) {}
    }
  };
  contents.on('did-start-navigation', (_ev, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame !== false) {
      lastInjectedUrl = null;
      inFlightUrl = null;
    }
  });
  contents.on('dom-ready', run);
  contents.on('did-finish-load', run);
}

module.exports = { attach };
`;
}

function readAsarArchive(filePath) {
  const buf = fs.readFileSync(filePath);
  const raw = asar.getRawHeader(filePath);
  const u0 = buf.readUInt32LE(0);
  const u4 = raw.headerSize;
  const strSize = Buffer.byteLength(raw.headerString, 'utf8');
  const dataOffset = 8 + raw.headerSize;
  const header = raw.header;

  const fileMap = new Map();
  function walk(node, relPath) {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, relPath ? `${relPath}/${name}` : name);
      }
    } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
      const start = dataOffset + Number(node.offset);
      fileMap.set(relPath, buf.subarray(start, start + node.size));
    }
  }
  walk(header, '');

  let appVersion = 'unknown';
  try {
    const pkgBuf = fileMap.get('package.json');
    if (pkgBuf) {
      const pkg = JSON.parse(pkgBuf.toString('utf8'));
      if (pkg && pkg.version) appVersion = String(pkg.version);
    }
  } catch (_err) {}

  return { buf, u0, u4, strSize, dataOffset, header, fileMap, appVersion };
}

function computeIntegrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(sha256Hex(buf.subarray(i, Math.min(i + BLOCK_SIZE, buf.length))));
  }
  if (blocks.length === 0) blocks.push(sha256Hex(Buffer.alloc(0)));
  return {
    algorithm: 'SHA256',
    hash: sha256Hex(buf),
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

function isAsarLoaderInstalled(asarPath, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const mainEntry = activeProfile.mainEntryInAsar || 'dist/main.js';
  const marker = activeProfile.patchMarker || PATCH_MARKER;
  try {
    if (!asarPath || !fs.existsSync(asarPath)) return false;
    const archive = readAsarArchive(asarPath);
    const mainBuf = archive.fileMap.get(mainEntry);
    return Boolean(mainBuf && mainBuf.toString('utf8').includes(marker));
  } catch (_err) {
    return false;
  }
}

function isPureUnpatchedArchive(archive, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const mainEntry = activeProfile.mainEntryInAsar || 'dist/main.js';
  const marker = activeProfile.patchMarker || PATCH_MARKER;
  const legacyMarkers = Array.isArray(activeProfile.legacyPatchMarkers)
    ? activeProfile.legacyPatchMarkers
    : ['AGY_STATUSBAR', 'AGY_KO_THOUGHT', 'ui-extensions-loader'];
  const mainBuf = archive && archive.fileMap ? archive.fileMap.get(mainEntry) : null;
  if (!mainBuf || mainBuf.length === 0) return false;
  const mainText = mainBuf.toString('utf8');
  const utilsText = archive.fileMap.get('dist/utils.js')?.toString('utf8') || '';
  const preloadText = archive.fileMap.get('dist/preload.js')?.toString('utf8') || '';
  const all = mainText + '\n' + utilsText + '\n' + preloadText;
  if (all.includes(marker)) return false;
  for (const legacy of legacyMarkers) {
    if (all.includes(legacy)) return false;
  }
  return true;
}

function verifyAllAsarIntegrity(archive) {
  if (!archive || !archive.header || !archive.fileMap) return false;
  let valid = true;
  let checkedCount = 0;
  function walk(node, relPath) {
    if (!valid || !node) return;
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, relPath ? `${relPath}/${name}` : name);
      }
    } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
      const start = archive.dataOffset + Number(node.offset);
      const data = archive.fileMap.get(relPath);
      if (
        !Number.isFinite(start) ||
        start < archive.dataOffset ||
        start + node.size > archive.buf.length ||
        !data ||
        data.length !== node.size
      ) {
        valid = false;
        return;
      }
      if (node.integrity && node.integrity.hash) {
        if (
          (node.integrity.algorithm && node.integrity.algorithm !== 'SHA256') ||
          (node.integrity.blockSize !== undefined && node.integrity.blockSize !== BLOCK_SIZE)
        ) {
          valid = false;
          return;
        }
        const expected = computeIntegrity(data);
        if (expected.hash !== node.integrity.hash) {
          valid = false;
          return;
        }
        if (Array.isArray(node.integrity.blocks)) {
          if (node.integrity.blocks.length !== expected.blocks.length) {
            valid = false;
            return;
          }
          for (let i = 0; i < expected.blocks.length; i++) {
            if (node.integrity.blocks[i] !== expected.blocks[i]) {
              valid = false;
              return;
            }
          }
        }
        checkedCount += 1;
      }
    }
  }
  walk(archive.header, '');
  return valid && checkedCount > 0;
}

function transformExactSize(origBuf, targetStr, replacementStr) {
  const origText = origBuf.toString('utf8');
  const firstIdx = origText.indexOf(targetStr);
  if (firstIdx === -1) {
    throw new Error('ANCHOR_NOT_FOUND');
  }
  if (origText.indexOf(targetStr, firstIdx + 1) !== -1) {
    throw new Error('ANCHOR_NOT_UNIQUE');
  }

  let nextText = origText.slice(0, firstIdx) + replacementStr + origText.slice(firstIdx + targetStr.length);
  let delta = Buffer.byteLength(nextText, 'utf8') - origBuf.length;

  if (delta > 0) {
    // Strip only pure standalone single-line `//` comment lines (never touching code or template literals).
    const lines = nextText.split('\n');
    const kept = [];
    for (const line of lines) {
      if (
        delta > 0 &&
        /^\s*\/\/(?!.*AGY_UI_EXTENSIONS_LOADER_V1)\s*[A-Za-z0-9#*\-_=.,:;()[\]{}@/'" ]*$/.test(line)
      ) {
        delta -= Buffer.byteLength(line, 'utf8') + 1;
        continue;
      }
      kept.push(line);
    }
    nextText = kept.join('\n');
  }

  const finalDiff = origBuf.length - Buffer.byteLength(nextText, 'utf8');
  if (finalDiff < 0) {
    throw new Error(`INSUFFICIENT_BYTE_HEADROOM:${-finalDiff}`);
  }
  if (finalDiff > 0) {
    nextText = nextText + ' '.repeat(finalDiff);
  }
  // Syntactic verification: fail closed if comment stripping or anchor replacement broke JS parsing.
  new vm.Script(nextText);
  const outBuf = Buffer.from(nextText, 'utf8');
  if (outBuf.length !== origBuf.length) {
    throw new Error('EXACT_SIZE_MISMATCH');
  }
  return outBuf;
}

function writeBinaryAtomicStrictSync(targetPath, buf) {
  const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, buf);
    const verify = fs.readFileSync(tmpPath);
    if (sha256Hex(verify) !== sha256Hex(buf)) {
      throw new Error('ATOMIC_TEMP_HASH_MISMATCH');
    }
    // Strict atomic rename ONLY — never fall back to `fs.copyFileSync` on live/locked `app.asar`!
    fs.renameSync(tmpPath, targetPath);
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_err) {}
    }
  }
}

function registerPluginManifest(pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  const pluginId = p.PLUGIN_ID || PLUGIN_ID;
  let entryScript = p.RENDERER_BUNDLE_PATH;
  if (!pathOverrides || !pathOverrides.RENDERER_BUNDLE_PATH) {
    const installedEntry = path.join(p.PLUGINS_ROOT_DIR, pluginId, 'dist', 'renderer.js');
    if (fs.existsSync(installedEntry)) {
      entryScript = installedEntry;
    }
  }
  const manifest = {
    schemaVersion: 1,
    pluginId,
    entryScript,
  };
  writeFileAtomicSync(p.MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  writeFileAtomicSync(p.LOADER_SCRIPT_PATH, buildHostLoaderScriptSource());
  return manifest;
}

function unregisterPluginManifest(pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  let removed = false;
  if (fs.existsSync(p.MANIFEST_PATH)) {
    fs.unlinkSync(p.MANIFEST_PATH);
    removed = true;
  }
  return removed;
}

function verifyOrigBackupStrict(backupPath, metaPath, expectedVersion, { backfillMeta = false } = {}) {
  if (!fs.existsSync(backupPath)) {
    return { ok: false, status: 'ERR_ORIG_MISSING' };
  }
  const origArchive = readAsarArchive(backupPath);
  if (!isPureUnpatchedArchive(origArchive) || (expectedVersion && origArchive.appVersion !== expectedVersion)) {
    return { ok: false, status: 'ERR_ORIG_INVALID', appVersion: origArchive.appVersion };
  }
  const origHash = sha256Hex(origArchive.buf);
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!meta || meta.sha256 !== origHash || meta.bytes !== origArchive.buf.length) {
        return { ok: false, status: 'ERR_ORIG_META_MISMATCH', appVersion: origArchive.appVersion };
      }
    } catch (_err) {
      return { ok: false, status: 'ERR_ORIG_META_MISMATCH', appVersion: origArchive.appVersion };
    }
  } else {
    // Verify EVERY packed file's integrity.hash and 4MiB integrity.blocks in the ASAR header when .orig.json is absent.
    if (!verifyAllAsarIntegrity(origArchive)) {
      return { ok: false, status: 'ERR_ORIG_INTEGRITY_MISMATCH', appVersion: origArchive.appVersion };
    }
    if (backfillMeta) {
      writeFileAtomicSync(
        metaPath,
        JSON.stringify(
          {
            appVersion: origArchive.appVersion,
            bytes: origArchive.buf.length,
            sha256: origHash,
            createdAt: new Date().toISOString(),
          },
          null,
          2
        ) + '\n'
      );
    }
  }
  return { ok: true, archive: origArchive, sha256: origHash };
}

function installAsarDropinLoader(pathOverrides = null, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const mainEntry = activeProfile.mainEntryInAsar || 'dist/main.js';
  const marker = activeProfile.patchMarker || PATCH_MARKER;
  const anchorTarget = activeProfile.mainAnchorTarget || MAIN_ANCHOR_TARGET;
  const anchorReplacement = activeProfile.mainAnchorReplacement || MAIN_ANCHOR_REPLACEMENT;
  const p = { ...resolveHostPaths(process.env, activeProfile), ...(pathOverrides || {}) };
  if (!fs.existsSync(p.ASAR_PATH)) {
    return { status: 'SKIPPED_NO_ASAR' };
  }
  const lockTok = acquireExclusiveLock(p.ASAR_LOCK_PATH, 60000);
  if (!lockTok) {
    return { status: 'LOCK_BUSY' };
  }
  try {
    let archive = readAsarArchive(p.ASAR_PATH);
    const existingMainBuf = archive.fileMap.get(mainEntry);
    if (existingMainBuf && existingMainBuf.toString('utf8').includes(marker)) {
      return { status: 'ALREADY_INSTALLED', appVersion: archive.appVersion };
    }
    const backupPath = `${p.ASAR_PATH}.v${archive.appVersion}.orig`;
    const metaPath = `${backupPath}.json`;

    if (fs.existsSync(backupPath)) {
      const check = verifyOrigBackupStrict(backupPath, metaPath, archive.appVersion, { backfillMeta: true });
      if (!check.ok) {
        return { status: check.status, appVersion: archive.appVersion };
      }
      archive = check.archive;
    } else if (isPureUnpatchedArchive(archive, activeProfile)) {
      if (!verifyAllAsarIntegrity(archive)) {
        return { status: 'ERR_ARCHIVE_INTEGRITY_MISMATCH', appVersion: archive.appVersion };
      }
      writeBinaryAtomicStrictSync(backupPath, archive.buf);
      writeFileAtomicSync(
        metaPath,
        JSON.stringify(
          {
            appVersion: archive.appVersion,
            bytes: archive.buf.length,
            sha256: sha256Hex(archive.buf),
            createdAt: new Date().toISOString(),
          },
          null,
          2
        ) + '\n'
      );
    } else {
      return { status: 'ERR_ORIG_MISSING_FOR_PATCHED_ASAR', appVersion: archive.appVersion };
    }

    const mainBuf = archive.fileMap.get(mainEntry);
    if (!mainBuf) {
      return { status: 'ERR_MAIN_MISSING', appVersion: archive.appVersion };
    }

    const patchedMainBuf = transformExactSize(mainBuf, anchorTarget, anchorReplacement);
    archive.fileMap.set(mainEntry, patchedMainBuf);

    const chunks = [];
    let currentOffset = 0n;
    function rebuild(node, relPath) {
      if (node.files) {
        for (const [name, child] of Object.entries(node.files)) {
          rebuild(child, relPath ? `${relPath}/${name}` : name);
        }
      } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
        const data = archive.fileMap.get(relPath);
        node.size = data.length;
        node.offset = currentOffset.toString();
        node.integrity = computeIntegrity(data);
        chunks.push(data);
        currentOffset += BigInt(data.length);
      }
    }
    rebuild(archive.header, '');

    const headerStrBuf = Buffer.from(JSON.stringify(archive.header), 'utf8');
    const alignedStrSize = Math.ceil(headerStrBuf.length / 4) * 4;
    const newU8 = 4 + alignedStrSize;
    const newU4 = 4 + newU8;
    const headerBuf = Buffer.alloc(8 + newU4, 0);
    headerBuf.writeUInt32LE(archive.u0, 0);
    headerBuf.writeUInt32LE(newU4, 4);
    headerBuf.writeUInt32LE(newU8, 8);
    headerBuf.writeUInt32LE(headerStrBuf.length, 12);
    headerStrBuf.copy(headerBuf, 16);

    const outBuf = Buffer.concat([headerBuf, ...chunks]);
    if (outBuf.length !== archive.buf.length) {
      return { status: 'ERR_ARCHIVE_SIZE_DRIFT', appVersion: archive.appVersion };
    }

    writeBinaryAtomicStrictSync(p.ASAR_PATH, outBuf);
    asar.uncacheAll();
    return {
      status: 'INSTALLED',
      patchMarker: PATCH_MARKER,
      appVersion: archive.appVersion,
      backupPath,
      sha256: sha256Hex(outBuf),
    };
  } finally {
    releaseExclusiveLock(p.ASAR_LOCK_PATH, lockTok);
  }
}

function rollbackAsarDropinLoader(pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  const ownManifestName = path.basename(p.MANIFEST_PATH);

  if (!fs.existsSync(p.ASAR_PATH)) {
    const manifestRemoved = unregisterPluginManifest(p);
    return { status: 'SKIPPED_NO_ASAR', manifestRemoved };
  }

  // If other plugins still have registered manifests in `ui-extensions.d`, keep the shared loader intact.
  const siblingManifests = fs.existsSync(p.UI_EXTENSIONS_DIR)
    ? fs.readdirSync(p.UI_EXTENSIONS_DIR).filter((f) => f.endsWith('.json') && f !== ownManifestName)
    : [];
  if (siblingManifests.length > 0) {
    const manifestRemoved = unregisterPluginManifest(p);
    return {
      status: 'MANIFEST_REMOVED_SHARED_LOADER_PRESERVED',
      manifestRemoved,
      remainingManifests: siblingManifests,
    };
  }

  const lockTok = acquireExclusiveLock(p.ASAR_LOCK_PATH, 60000);
  if (!lockTok) {
    return { status: 'LOCK_BUSY', manifestRemoved: false };
  }
  try {
    const cur = readAsarArchive(p.ASAR_PATH);
    if (isPureUnpatchedArchive(cur)) {
      const manifestRemoved = unregisterPluginManifest(p);
      return { status: 'ALREADY_UNPATCHED', appVersion: cur.appVersion, manifestRemoved };
    }
    const backupPath = `${p.ASAR_PATH}.v${cur.appVersion}.orig`;
    const metaPath = `${backupPath}.json`;
    const check = verifyOrigBackupStrict(backupPath, metaPath, cur.appVersion, { backfillMeta: false });
    if (!check.ok) {
      return { status: check.status, appVersion: cur.appVersion, manifestRemoved: false };
    }
    writeBinaryAtomicStrictSync(p.ASAR_PATH, check.archive.buf);
    asar.uncacheAll();
    const manifestRemoved = unregisterPluginManifest(p);
    return {
      status: 'ROLLED_BACK',
      appVersion: cur.appVersion,
      manifestRemoved,
      sha256: check.sha256,
    };
  } finally {
    releaseExclusiveLock(p.ASAR_LOCK_PATH, lockTok);
  }
}

module.exports = {
  PATCH_MARKER,
  MAIN_ANCHOR_TARGET,
  MAIN_ANCHOR_REPLACEMENT,
  isAllowedHubUrl,
  validateDropinManifest,
  readDropinManifest,
  isPluginEnabledInConfig,
  collectExecutableExtensions,
  buildHostLoaderScriptSource,
  readAsarArchive,
  isAsarLoaderInstalled,
  isPureUnpatchedArchive,
  transformExactSize,
  registerPluginManifest,
  unregisterPluginManifest,
  installAsarDropinLoader,
  rollbackAsarDropinLoader,
};
