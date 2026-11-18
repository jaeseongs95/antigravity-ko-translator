'use strict';

const fs = require('fs');
const {
  KO_SCRIPT_PATH,
  DIST_KO_SCRIPT_PATH,
  LEGACY_PLUGIN_KO_SCRIPT_PATH,
  LEGACY_SKILL_KO_SCRIPT_PATH,
  BEGIN_MARKER,
  END_MARKER,
  BEGIN_BLOCK_MARKER,
  END_BLOCK_MARKER,
  resolveHostPaths,
} = require('./paths');
const {
  writeFileAtomicSync,
  acquireExclusiveFileLockWithWait,
  releaseExclusiveFileLock,
} = require('./process-sentinel');
const {
  DEFAULT_LLM_CONFIG,
  normalizeProviderId,
  sanitizeLlmConfig,
  isPluginEnabled,
  readTranslatorOptionsReadOnly,
} = require('./config-store');

function readCanonicalBundleTemplate() {
  for (const candidatePath of [DIST_KO_SCRIPT_PATH, KO_SCRIPT_PATH]) {
    if (candidatePath && fs.existsSync(candidatePath)) {
      return fs.readFileSync(candidatePath, 'utf8').replace(/\r\n/g, '\n');
    }
  }
  const { generateBundleSource } = require('../scripts/build');
  return generateBundleSource();
}

function syncDistributableMirrors() {
  const { generateBundleSource, writeMirrorBundles } = require('../scripts/build');
  const bundle = generateBundleSource();
  const targets = writeMirrorBundles(bundle);
  return { updatedCount: targets.length, targets };
}

// Rev6-F4 #1 & Rev7-F2:
// 1) Whitespace-tolerant regexes matching Prelude Markers inside the outer IIFE (`  const DEFAULT_... = ...;`).
// 2) Function replacers ONLY (`(match, indent) => ...`) so `$&`, `$$`, `$'`, `` $` `` in model/URL strings are NEVER mangled!
function buildRuntimeConfiguredBundle({
  pretranslateEnabled = null,
  translationProvider = null,
  llmConfig = null,
  templateSource = null,
  pathOverrides = null,
} = {}) {
  const stored = readTranslatorOptionsReadOnly(pathOverrides);
  const effPre =
    pretranslateEnabled !== null && pretranslateEnabled !== undefined
      ? Boolean(pretranslateEnabled)
      : Boolean(stored.pretranslateEnabled);
  const rawProv =
    translationProvider !== null && translationProvider !== undefined
      ? translationProvider
      : stored.translationProvider;
  const safeProvider = normalizeProviderId(rawProv) || 'google-translate';
  const safeLlmConfig = sanitizeLlmConfig(llmConfig || stored.llmConfig || DEFAULT_LLM_CONFIG);

  const canonical = (typeof templateSource === 'string' ? templateSource : readCanonicalBundleTemplate())
    .replace(/\r\n/g, '\n')
    .trim();

  return canonical
    .replace(
      /^(\s*)const\s+DEFAULT_PRETRANSLATE_ENABLED\s*=\s*(?:true|false)\s*;/m,
      (_m, indent) => `${indent}const DEFAULT_PRETRANSLATE_ENABLED = ${effPre ? 'true' : 'false'};`
    )
    .replace(
      /^(\s*)const\s+DEFAULT_TRANSLATION_PROVIDER\s*=\s*(?:'[^']*'|"[^"]*")\s*;/m,
      (_m, indent) => `${indent}const DEFAULT_TRANSLATION_PROVIDER = ${JSON.stringify(safeProvider)};`
    )
    .replace(
      /^(\s*)const\s+DEFAULT_LLM_CONFIG\s*=\s*Object\.freeze\(\{[^\n]*\}\)\s*;/m,
      (_m, indent) => `${indent}const DEFAULT_LLM_CONFIG = Object.freeze(${JSON.stringify(safeLlmConfig)});`
    );
}

function isStandaloneMarkerAt(text, idx, markerLen) {
  const prev = idx === 0 ? '\n' : text[idx - 1];
  if (prev !== '\n' && prev !== '\r') return false;
  let after = idx + markerLen;
  while (after < text.length && (text[after] === ' ' || text[after] === '\t')) {
    after += 1;
  }
  return after === text.length || text[after] === '\n' || text[after] === '\r';
}

function findFirstStandaloneMarker(text, marker) {
  let pos = 0;
  while (pos <= text.length) {
    const idx = text.indexOf(marker, pos);
    if (idx === -1) return -1;
    if (isStandaloneMarkerAt(text, idx, marker.length)) return idx;
    pos = idx + 1;
  }
  return -1;
}

function findLastStandaloneMarker(text, marker, minPos = 0) {
  let pos = text.length;
  while (pos >= minPos) {
    const idx = text.lastIndexOf(marker, pos);
    if (idx === -1 || idx < minPos) return -1;
    if (isStandaloneMarkerAt(text, idx, marker.length)) return idx;
    if (idx === 0) break;
    pos = idx - 1;
  }
  return -1;
}

// Strips ONLY standalone `BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 .. END_AGY_KO_THOUGHT_LOCALIZER_V2` blocks
// while ignoring string literals inside bundled code and preserving sibling statusbar/MCP blocks byte-for-byte!
function stripExistingKoBlock(sourceText) {
  let text = String(sourceText || '');
  const lineStart = findFirstStandaloneMarker(text, BEGIN_MARKER);
  const lineEnd = lineStart !== -1 ? findLastStandaloneMarker(text, END_MARKER, lineStart + BEGIN_MARKER.length) : -1;
  if (lineStart !== -1 && lineEnd !== -1 && lineEnd > lineStart) {
    let before = text.slice(0, lineStart);
    let after = text.slice(lineEnd + END_MARKER.length);
    before = before.replace(/(?:\r?\n)+$/, '');
    after = after.replace(/^(?:\r?\n)+/, '');
    if (before && after) {
      text = `${before}\n\n${after}`;
    } else {
      text = before || after;
    }
  }
  const blockStart = findFirstStandaloneMarker(text, BEGIN_BLOCK_MARKER);
  const blockEnd =
    blockStart !== -1 ? findLastStandaloneMarker(text, END_BLOCK_MARKER, blockStart + BEGIN_BLOCK_MARKER.length) : -1;
  if (blockStart !== -1 && blockEnd !== -1 && blockEnd > blockStart) {
    let before = text.slice(0, blockStart);
    let after = text.slice(blockEnd + END_BLOCK_MARKER.length);
    before = before.replace(/(?:\r?\n)+$/, '');
    after = after.replace(/^(?:\r?\n)+/, '');
    if (before && after) {
      text = `${before}\n\n${after}`;
    } else {
      text = before || after;
    }
  }
  return text.trimEnd();
}

// Rev5-F4 #2: Acquires `STATUSBAR_AUTOINJECT_LOCK_PATH` BEFORE reading `statusbar_autoinject.js`, re-reads latest bytes inside lock, writes atomically!
function syncCombinedAutoinject({
  pretranslateEnabled = null,
  translationProvider = null,
  llmConfig = null,
  pathOverrides = null,
} = {}) {
  const defaults = resolveHostPaths(process.env);
  const autoinjectPath =
    (pathOverrides && (pathOverrides.autoinjectPath || pathOverrides.STATUSBAR_AUTOINJECT_PATH)) ||
    defaults.STATUSBAR_AUTOINJECT_PATH;
  const autoinjectLockPath =
    (pathOverrides && (pathOverrides.autoinjectLockPath || pathOverrides.STATUSBAR_AUTOINJECT_LOCK_PATH)) ||
    defaults.STATUSBAR_AUTOINJECT_LOCK_PATH;

  const lockTok = acquireExclusiveFileLockWithWait(autoinjectLockPath, 3000, 15000);
  if (!lockTok) {
    return { updated: false, reason: 'LOCK_BUSY' };
  }
  try {
    const rawStatusbar = fs.existsSync(autoinjectPath) ? fs.readFileSync(autoinjectPath, 'utf8') : '';
    const baseCode = stripExistingKoBlock(rawStatusbar);
    const prefix = baseCode ? `${baseCode}\n\n` : '';

    let nextCombined;
    if (isPluginEnabled(pathOverrides)) {
      const koCode = buildRuntimeConfiguredBundle({
        pretranslateEnabled,
        translationProvider,
        llmConfig,
        pathOverrides,
      });
      nextCombined =
        `${prefix}${BEGIN_MARKER}\n` +
        `${BEGIN_BLOCK_MARKER}\n` +
        `${koCode}\n` +
        `${END_BLOCK_MARKER}\n` +
        `${END_MARKER}\n`;
    } else {
      const cleanupStub =
        'if (typeof window !== "undefined" && typeof window.__agyKoThoughtCleanup === "function") { try { window.__agyKoThoughtCleanup(true); } catch (_e) {} }';
      nextCombined =
        `${prefix}${BEGIN_MARKER}\n` +
        `${BEGIN_BLOCK_MARKER}\n` +
        `${cleanupStub}\n` +
        `${END_BLOCK_MARKER}\n` +
        `${END_MARKER}\n`;
    }

    if (rawStatusbar !== nextCombined) {
      writeFileAtomicSync(autoinjectPath, nextCombined);
      return { updated: true, code: nextCombined };
    }
    return { updated: false, code: nextCombined };
  } finally {
    releaseExclusiveFileLock(autoinjectLockPath, lockTok);
  }
}

// Step U2 helper: Strips ONLY the KO block under `STATUSBAR_AUTOINJECT_LOCK_PATH`, preserving sibling blocks byte-for-byte!
function removeKoBlockFromCombinedAutoinject(pathOverrides = null) {
  const defaults = resolveHostPaths(process.env);
  const autoinjectPath =
    (pathOverrides && (pathOverrides.autoinjectPath || pathOverrides.STATUSBAR_AUTOINJECT_PATH)) ||
    defaults.STATUSBAR_AUTOINJECT_PATH;
  const autoinjectLockPath =
    (pathOverrides && (pathOverrides.autoinjectLockPath || pathOverrides.STATUSBAR_AUTOINJECT_LOCK_PATH)) ||
    defaults.STATUSBAR_AUTOINJECT_LOCK_PATH;

  const lockTok = acquireExclusiveFileLockWithWait(autoinjectLockPath, 3000, 15000);
  if (!lockTok) {
    return { updated: false, remainingCode: '', reason: 'LOCK_BUSY' };
  }
  try {
    if (!fs.existsSync(autoinjectPath)) {
      return { updated: false, remainingCode: '' };
    }
    const raw = fs.readFileSync(autoinjectPath, 'utf8');
    const stripped = stripExistingKoBlock(raw);
    const nextFileContent = stripped ? `${stripped}\n` : '';
    if (raw !== nextFileContent) {
      writeFileAtomicSync(autoinjectPath, nextFileContent);
      return { updated: true, remainingCode: nextFileContent };
    }
    return { updated: false, remainingCode: nextFileContent };
  } finally {
    releaseExclusiveFileLock(autoinjectLockPath, lockTok);
  }
}

module.exports = {
  MIRROR_TARGETS: [
    KO_SCRIPT_PATH,
    DIST_KO_SCRIPT_PATH,
    LEGACY_PLUGIN_KO_SCRIPT_PATH,
    LEGACY_SKILL_KO_SCRIPT_PATH,
  ],
  readCanonicalBundleTemplate,
  syncDistributableMirrors,
  buildRuntimeConfiguredBundle,
  stripExistingKoBlock,
  syncCombinedAutoinject,
  removeKoBlockFromCombinedAutoinject,
};
