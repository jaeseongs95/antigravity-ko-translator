/**
 * Module: scripts/host/bundle-injector.js
 * Responsibility: Assembles modular renderer sources (`scripts/renderer/*.js`) into the distributable
 * `scripts/ko_thought_autoinject.js` bundle and synchronizes `statusbar_autoinject.js` without dirtying Git.
 */

const fs = require('fs');
const path = require('path');
const {
  RENDERER_DIR,
  RENDERER_MODULE_FILES,
  KO_SCRIPT_PATH,
  DIST_KO_SCRIPT_PATH,
  LEGACY_PLUGIN_KO_SCRIPT_PATH,
  LEGACY_SKILL_KO_SCRIPT_PATH,
  STATUSBAR_AUTOINJECT_PATH,
  BEGIN_MARKER,
  END_MARKER,
  BEGIN_BLOCK_MARKER,
  END_BLOCK_MARKER,
} = require('./paths');
const {
  isPluginEnabled,
  getOrSetTranslatorOptions,
  writeFileAtomicSync,
} = require('./settings-storage');

function syncMirrorScriptFile(targetPath, content) {
  if (!targetPath) return;
  try {
    const current = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n')
      : '';
    if (current !== content) {
      writeFileAtomicSync(targetPath, content);
    }
  } catch {}
}

function assembleRendererSourceFromModules() {
  const missing = RENDERER_MODULE_FILES.filter((f) => !fs.existsSync(path.join(RENDERER_DIR, f)));
  if (missing.length > 0) {
    if (fs.existsSync(KO_SCRIPT_PATH)) {
      return fs.readFileSync(KO_SCRIPT_PATH, 'utf8');
    }
    throw new Error(`Missing renderer module files: ${missing.join(', ')}`);
  }

  const body = RENDERER_MODULE_FILES.map((fileName) => {
    const filePath = path.join(RENDERER_DIR, fileName);
    const chunk = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    if (fileName === '01-bootstrap-and-cache.js') {
      return `${chunk}\n  if (!prepareBootstrapLifecycle()) return;`;
    }
    return chunk;
  }).join('\n\n');

  const userscriptHeader =
    `// ==UserScript==\n` +
    `// @name         Antigravity Korean Thought & UI Translator (Local & Remote Control)\n` +
    `// @namespace    https://github.com/jaeseongs95/antigravity-ko-translator\n` +
    `// @version      1.2.28\n` +
    `// @description  Real-time Korean localization for Antigravity 2.0 Thinking blocks and static UI on Desktop and Remote Control web.\n` +
    `// @match        https://antigravity.google.com/*\n` +
    `// @match        https://*.antigravity.google.com/*\n` +
    `// @match        https://antigravity.static.usercontent.goog/*\n` +
    `// @run-at       document-idle\n` +
    `// @grant        none\n` +
    `// ==/UserScript==\n`;

  const runtimePrelude =
    `  const window = __agyWin || (typeof globalThis !== 'undefined' ? globalThis.window : undefined);\n` +
    `  const document = __agyDoc || (window ? window.document : undefined);\n` +
    `  if (!window || !document) return;\n` +
    `  const localStorage = window.localStorage;\n` +
    `  const fetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined);\n` +
    `  const MutationObserver = window.MutationObserver || (typeof globalThis !== 'undefined' ? globalThis.MutationObserver : undefined);\n` +
    `  const Node = window.Node || (typeof globalThis !== 'undefined' ? globalThis.Node : undefined);\n` +
    `  const NodeFilter = window.NodeFilter || (typeof globalThis !== 'undefined' ? globalThis.NodeFilter : undefined);\n` +
    `  const StorageEvent = window.StorageEvent || (typeof globalThis !== 'undefined' ? globalThis.StorageEvent : undefined);\n` +
    `  const MessageEvent = window.MessageEvent || (typeof globalThis !== 'undefined' ? globalThis.MessageEvent : undefined);\n` +
    `  const HTMLIFrameElement = window.HTMLIFrameElement || (typeof globalThis !== 'undefined' ? globalThis.HTMLIFrameElement : undefined);\n` +
    `  window.__agyMountKoThoughtLocalizer = mountKoThoughtLocalizer;`;

  const assembled = `${userscriptHeader}(function mountKoThoughtLocalizer(__agyWin, __agyDoc) {\n${runtimePrelude}\n\n${body}\n})(typeof window !== 'undefined' ? window : undefined, typeof document !== 'undefined' ? document : undefined);\n`;

  // Keep canonical and remote companion fallback paths (`scripts/`, `dist/`, `plugins/ko-thought-translator/scripts/`, `skills/ko-thought-translator/scripts/`) in sync
  syncMirrorScriptFile(KO_SCRIPT_PATH, assembled);
  syncMirrorScriptFile(DIST_KO_SCRIPT_PATH, assembled);
  syncMirrorScriptFile(LEGACY_PLUGIN_KO_SCRIPT_PATH, assembled);
  syncMirrorScriptFile(LEGACY_SKILL_KO_SCRIPT_PATH, assembled);

  return assembled;
}

function resolveEffectiveOptions(pretranslateEnabled = null, translationProvider = null) {
  if (pretranslateEnabled !== null && pretranslateEnabled !== undefined && translationProvider) {
    return {
      pretranslateEnabled: Boolean(pretranslateEnabled),
      translationProvider: String(translationProvider),
    };
  }
  const stored = getOrSetTranslatorOptions(null, null);
  return {
    pretranslateEnabled:
      pretranslateEnabled !== null && pretranslateEnabled !== undefined
        ? Boolean(pretranslateEnabled)
        : Boolean(stored.pretranslateEnabled),
    translationProvider: translationProvider || stored.translationProvider || 'google-translate',
  };
}

function buildRuntimeConfiguredBundle(pretranslateEnabled = null, translationProvider = null) {
  const effective = resolveEffectiveOptions(pretranslateEnabled, translationProvider);
  const canonicalSource = assembleRendererSourceFromModules();
  return canonicalSource
    .trim()
    .replace(
      /const DEFAULT_PRETRANSLATE_ENABLED = (?:true|false);/,
      `const DEFAULT_PRETRANSLATE_ENABLED = ${effective.pretranslateEnabled ? 'true' : 'false'};`
    )
    .replace(
      /const DEFAULT_TRANSLATION_PROVIDER = '[^']+';/,
      `const DEFAULT_TRANSLATION_PROVIDER = '${effective.translationProvider}';`
    );
}

function stripExistingKoBlock(sourceText) {
  let text = String(sourceText || '');
  const lineStart = text.indexOf(BEGIN_MARKER);
  const lineEnd = text.indexOf(END_MARKER);
  if (lineStart !== -1 && lineEnd !== -1 && lineEnd > lineStart) {
    const before = text.slice(0, lineStart).trimEnd();
    const after = text.slice(lineEnd + END_MARKER.length).trim();
    text = after ? `${before}\n\n${after}` : before;
  }
  const blockStart = text.indexOf(BEGIN_BLOCK_MARKER);
  const blockEnd = text.indexOf(END_BLOCK_MARKER);
  if (blockStart !== -1 && blockEnd !== -1 && blockEnd > blockStart) {
    const before = text.slice(0, blockStart).trimEnd();
    const after = text.slice(blockEnd + END_BLOCK_MARKER.length).trim();
    text = after ? `${before}\n\n${after}` : before;
  }
  return text.trimEnd();
}

function syncCombinedAutoinject(pretranslateEnabled = null, translationProvider = null) {
  const rawStatusbar = fs.existsSync(STATUSBAR_AUTOINJECT_PATH)
    ? fs.readFileSync(STATUSBAR_AUTOINJECT_PATH, 'utf8')
    : '';
  const koCode = buildRuntimeConfiguredBundle(pretranslateEnabled, translationProvider);
  const baseCode = stripExistingKoBlock(rawStatusbar);

  const prefix = baseCode ? `${baseCode}\n\n` : '';
  let nextCombined;
  if (isPluginEnabled()) {
    nextCombined =
      `${prefix}${BEGIN_MARKER}\n` +
      `${BEGIN_BLOCK_MARKER}\n` +
      `${koCode}\n` +
      `${END_BLOCK_MARKER}\n` +
      `${END_MARKER}\n`;
  } else {
    const cleanupStub =
      `if (window.__agyKoThoughtCleanup) { try { window.__agyKoThoughtCleanup(true); } catch (e) {} }`;
    nextCombined =
      `${prefix}${BEGIN_MARKER}\n` +
      `${BEGIN_BLOCK_MARKER}\n` +
      `${cleanupStub}\n` +
      `${END_BLOCK_MARKER}\n` +
      `${END_MARKER}\n`;
  }

  if (rawStatusbar !== nextCombined) {
    writeFileAtomicSync(STATUSBAR_AUTOINJECT_PATH, nextCombined);
    return true;
  }
  return false;
}

module.exports = {
  assembleRendererSourceFromModules,
  buildRuntimeConfiguredBundle,
  syncCombinedAutoinject,
};
