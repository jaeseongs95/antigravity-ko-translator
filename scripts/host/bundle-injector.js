/**
 * Module: scripts/host/bundle-injector.js
 * Responsibility: Assembles modular renderer sources (`scripts/renderer/*.js`) into the distributable
 * `scripts/ko_thought_autoinject.js` bundle and synchronizes `statusbar_autoinject.js` & `web_bundle` without dirtying Git.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  RENDERER_DIR,
  RENDERER_MODULE_FILES,
  KO_SCRIPT_PATH,
  STATUSBAR_AUTOINJECT_PATH,
  WEB_BUNDLE_DIR,
  WEB_BUNDLE_META_PATH,
  BEGIN_MARKER,
  END_MARKER,
} = require('./paths');
const { isPluginEnabled } = require('./settings-storage');

function sha256Hex(bufferOrString) {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
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
    `// @version      1.2.7\n` +
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

function syncWebBundleAutoinject(combinedCode, webBundleDir = WEB_BUNDLE_DIR, metaPath = WEB_BUNDLE_META_PATH) {
  try {
    const origPrismPath = path.join(webBundleDir, 'prism_bundle.orig.js');
    const origHtmlPath = path.join(webBundleDir, 'index.orig.html');
    const outPrismPath = path.join(webBundleDir, 'prism_bundle.js');
    const outHtmlPath = path.join(webBundleDir, 'index.html');
    if (!fs.existsSync(origPrismPath) || !fs.existsSync(origHtmlPath)) {
      return { synced: false, autoinjectHash: null };
    }
    const autoinjectHash = sha256Hex(combinedCode).slice(0, 16);
    const origPrism = fs.readFileSync(origPrismPath, 'utf8');
    const patchedPrism = `${origPrism}\n;\n/* AGY_STATUSBAR_AUTOINJECT_V6:${autoinjectHash} */\n${combinedCode}\n`;
    fs.writeFileSync(outPrismPath, patchedPrism, 'utf8');

    const origHtml = fs.readFileSync(origHtmlPath, 'utf8');
    const lsHookTag = `<script>globalThis.__JETSKI_LS_CLIENT_DECORATOR__=function(c){globalThis.__agyLsClient=c;return c;};</script>`;
    const patchedHtml = origHtml.replace(
      '<script defer src="/prism_bundle.js"></script>',
      `${lsHookTag}\n    <script defer src="/prism_bundle.js?agy=${autoinjectHash}"></script>`
    );
    fs.writeFileSync(outHtmlPath, patchedHtml, 'utf8');

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.autoinjectHash = autoinjectHash;
        meta.updatedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
      } catch {}
    }
    return { synced: true, autoinjectHash };
  } catch {
    return { synced: false, autoinjectHash: null };
  }
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

  let changed = false;
  if (rawStatusbar !== nextCombined) {
    fs.writeFileSync(STATUSBAR_AUTOINJECT_PATH, nextCombined, 'utf8');
    changed = true;
  }
  syncWebBundleAutoinject(nextCombined);
  return changed;
}

module.exports = {
  assembleRendererSourceFromModules,
  buildRuntimeConfiguredBundle,
  syncWebBundleAutoinject,
  syncCombinedAutoinject,
};
