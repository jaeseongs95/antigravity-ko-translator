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
  STATUSBAR_AUTOINJECT_PATH,
  BEGIN_MARKER,
  END_MARKER,
} = require('./paths');
const { isPluginEnabled } = require('./settings-storage');

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
    `// @version      1.2.4\n` +
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

  // Keep `scripts/ko_thought_autoinject.js` in sync with canonical default constants when modular sources change
  const currentDisk = fs.existsSync(KO_SCRIPT_PATH)
    ? fs.readFileSync(KO_SCRIPT_PATH, 'utf8').replace(/\r\n/g, '\n')
    : '';
  if (currentDisk !== assembled) {
    try {
      fs.writeFileSync(KO_SCRIPT_PATH, assembled, 'utf8');
    } catch {}
  }

  return assembled;
}

function buildRuntimeConfiguredBundle(pretranslateEnabled = false, translationProvider = 'local-llm') {
  const canonicalSource = assembleRendererSourceFromModules();
  return canonicalSource
    .trim()
    .replace(
      /const DEFAULT_PRETRANSLATE_ENABLED = (?:true|false);/,
      `const DEFAULT_PRETRANSLATE_ENABLED = ${pretranslateEnabled ? 'true' : 'false'};`
    )
    .replace(
      /const DEFAULT_TRANSLATION_PROVIDER = '[^']+';/,
      `const DEFAULT_TRANSLATION_PROVIDER = '${translationProvider || 'local-llm'}';`
    );
}

function syncCombinedAutoinject(pretranslateEnabled = false, translationProvider = 'local-llm') {
  if (!fs.existsSync(STATUSBAR_AUTOINJECT_PATH)) {
    return false;
  }
  const rawStatusbar = fs.readFileSync(STATUSBAR_AUTOINJECT_PATH, 'utf8');
  const koCode = buildRuntimeConfiguredBundle(pretranslateEnabled, translationProvider);

  let baseCode = rawStatusbar;
  const bIdx = baseCode.indexOf(BEGIN_MARKER);
  const eIdx = baseCode.indexOf(END_MARKER);
  if (bIdx !== -1 && eIdx !== -1 && eIdx > bIdx) {
    baseCode = baseCode.slice(0, bIdx).trimEnd();
  } else {
    baseCode = baseCode.trimEnd();
  }

  let nextCombined = baseCode + '\n';
  if (isPluginEnabled()) {
    nextCombined += `\n${BEGIN_MARKER}\n${koCode}\n${END_MARKER}\n`;
  } else {
    nextCombined += `\n${BEGIN_MARKER}\nif (window.__agyKoThoughtCleanup) { try { window.__agyKoThoughtCleanup(true); } catch (e) {} }\n${END_MARKER}\n`;
  }

  if (rawStatusbar !== nextCombined) {
    fs.writeFileSync(STATUSBAR_AUTOINJECT_PATH, nextCombined, 'utf8');
    return true;
  }
  return false;
}

module.exports = {
  assembleRendererSourceFromModules,
  buildRuntimeConfiguredBundle,
  syncCombinedAutoinject,
};
