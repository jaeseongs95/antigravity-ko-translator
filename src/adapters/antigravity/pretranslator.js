'use strict';

const { extractTokenizedSegmentsFromMarkdown } = require('../../core/text-tokenizer');
const { getReactFiberFromElement } = require('./trigger-controller');
const { STORAGE_KEYS } = require('./storage-port');

function isDomOrWindowObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.nodeType === 'number') return true;
  if (obj.window === obj && obj.document) return true;
  return false;
}

function createAntigravityPretranslator({
  targetWin,
  targetDoc,
  storage,
  nativeBridge,
  translationService,
  defaultPretranslateEnabled = false,
  getTranslateThinkingEnabled = () => true,
  isDisposed = () => false,
  onRefreshUi = null,
  onBroadcastPretranslate = null,
} = {}) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);

  let pretranslateEnabled = Boolean(defaultPretranslateEnabled);
  if (storage && typeof storage.getItem === 'function') {
    const saved = storage.getItem(STORAGE_KEYS.PRETRANSLATE);
    if (saved === '1' || saved === 'true') {
      pretranslateEnabled = true;
    } else if (saved === '0' || saved === 'false') {
      pretranslateEnabled = false;
    } else if (typeof storage.setItem === 'function') {
      storage.setItem(STORAGE_KEYS.PRETRANSLATE, pretranslateEnabled ? '1' : '0');
    }
  }

  const pretranslatedRawSet = new Set();
  let running = false;
  const stats = {
    enabled: pretranslateEnabled,
    scannedThoughts: 0,
    queuedSegments: 0,
    completedSegments: 0,
  };

  if (win) {
    win.__agyPretranslateStats = stats;
  }

  function isEnabled() {
    return Boolean(pretranslateEnabled && getTranslateThinkingEnabled());
  }

  function getRawFlag() {
    return Boolean(pretranslateEnabled);
  }

  function resetHistory() {
    pretranslatedRawSet.clear();
  }

  function collectHiddenThinkingStringsFromFiber() {
    const found = [];
    if (!isEnabled() || !doc || typeof doc.querySelector !== 'function') return found;
    try {
      const rootEl = doc.querySelector('#root, #app') || (doc.body && doc.body.firstElementChild);
      if (!rootEl) return found;
      const startFiber = getReactFiberFromElement(rootEl);
      const seenObj = new WeakSet();

      const scanObj = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 7) return;
        if (seenObj.has(obj) || isDomOrWindowObject(obj)) return;
        seenObj.add(obj);
        if (typeof obj.thinking === 'string') {
          const t = obj.thinking.trim();
          if (t.length > 5 && !pretranslatedRawSet.has(t)) {
            found.push(t);
          }
        }
        if (Array.isArray(obj)) {
          const len = Math.min(obj.length, 150);
          for (let i = 0; i < len; i++) {
            scanObj(obj[i], depth + 1);
          }
          return;
        }
        const keys = Object.keys(obj);
        const keyLen = Math.min(keys.length, 50);
        for (let i = 0; i < keyLen; i++) {
          const k = keys[i];
          if (
            k.startsWith('_') ||
            k === 'children' ||
            k === 'return' ||
            k === 'sibling' ||
            k === 'child' ||
            k === 'stateNode'
          ) {
            continue;
          }
          try {
            scanObj(obj[k], depth + 1);
          } catch (_err) {}
        }
      };

      if (startFiber) {
        const stack = [startFiber];
        const visited = new Set();
        while (stack.length > 0) {
          const node = stack.pop();
          if (!node || visited.has(node)) continue;
          visited.add(node);
          if (node.memoizedProps) scanObj(node.memoizedProps, 0);
          if (node.memoizedState) {
            let st = node.memoizedState;
            let sc = 0;
            while (st && sc < 12) {
              if (st.memoizedState) scanObj(st.memoizedState, 0);
              st = st.next;
              sc++;
            }
          }
          if (node.child) stack.push(node.child);
          if (node.sibling) stack.push(node.sibling);
        }
      }

      if (win && win.__agyStore && typeof win.__agyStore.getState === 'function') {
        try {
          scanObj(win.__agyStore.getState(), 0);
        } catch (_err) {}
      }
    } catch (_err) {}
    return found;
  }

  async function runPretranslatePass() {
    if (isDisposed() || running || !isEnabled() || !translationService) return;
    const rawList = collectHiddenThinkingStringsFromFiber();
    if (rawList.length === 0) return;

    running = true;
    try {
      const uniqueNew = Array.from(new Set(rawList)).reverse();
      for (const raw of uniqueNew) {
        if (isDisposed() || !isEnabled()) break;
        pretranslatedRawSet.add(raw);
        stats.scannedThoughts += 1;
        const segments = extractTokenizedSegmentsFromMarkdown(raw);
        for (const seg of segments) {
          if (isDisposed() || !isEnabled()) break;
          if (translationService.getCachedSync(seg) === null) {
            stats.queuedSegments += 1;
            await translationService.translateText(seg);
            stats.completedSegments += 1;
          }
        }
      }
    } finally {
      running = false;
    }
  }

  function setPretranslateEnabled(enabled, { persistHost = true, broadcast = true } = {}) {
    pretranslateEnabled = Boolean(enabled);
    stats.enabled = pretranslateEnabled;
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(STORAGE_KEYS.PRETRANSLATE, pretranslateEnabled ? '1' : '0');
    }
    if (persistHost && nativeBridge && typeof nativeBridge.writeItems === 'function') {
      nativeBridge.writeItems({ [STORAGE_KEYS.PRETRANSLATE]: pretranslateEnabled ? '1' : '0' });
    }
    if (pretranslateEnabled) {
      runPretranslatePass();
    }
    if (typeof onRefreshUi === 'function') {
      onRefreshUi();
    }
    if (broadcast && typeof onBroadcastPretranslate === 'function') {
      onBroadcastPretranslate(pretranslateEnabled);
    }
    return {
      pretranslateEnabled,
      stats,
    };
  }

  return {
    isEnabled,
    getRawFlag,
    getStats: () => stats,
    resetHistory,
    collectHiddenThinkingStringsFromFiber,
    runPretranslatePass,
    setPretranslateEnabled,
  };
}

module.exports = {
  createAntigravityPretranslator,
};
