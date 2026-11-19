'use strict';

/**
 * Clean-Slate Entrypoint for Antigravity Desktop Korean Thought & UI Translator.
 *
 * Exposes `createKoTranslator` both as CommonJS export and as a single clean handle
 * `window.__agyKoTranslator` when mounted in a top-frame Electron Hub window.
 */

const { createKoTranslator } = require('./runtime/bootstrap');

function mountIfBrowser(globalScope) {
  const win = globalScope || (typeof window !== 'undefined' ? window : null);
  const doc = win && win.document ? win.document : typeof document !== 'undefined' ? document : null;
  if (!win || !doc) return null;

  // Never run inside non-top frames (e.g. Sidecar AUX_PANE iframes) unless explicitly mounted by caller.
  if (win.__AGY_KO_TRANSLATOR_AUTO_MOUNT__ === false) {
    win.__agyCreateKoTranslator = createKoTranslator;
    return null;
  }

  try {
    if (win.top && win.top !== win) {
      win.__agyCreateKoTranslator = createKoTranslator;
      return null;
    }
  } catch (_err) {
    return null;
  }

  // Cleanly dispose any previous instance on hot reload.
  if (win.__agyKoTranslator && typeof win.__agyKoTranslator.dispose === 'function') {
    try {
      win.__agyKoTranslator.dispose();
    } catch (_err) {}
  }

  const initialSettings =
    win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ && typeof win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__ === 'object'
      ? win.__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__
      : null;

  const instance = createKoTranslator({
    win,
    doc,
    settings: initialSettings,
    version: '2.0.0',
  });
  win.__agyCreateKoTranslator = createKoTranslator;
  win.__agyKoTranslator = instance;
  instance.start();
  return instance;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  mountIfBrowser(window);
}

module.exports = {
  createKoTranslator,
  mountIfBrowser,
};
