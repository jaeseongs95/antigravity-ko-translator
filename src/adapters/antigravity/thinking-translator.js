'use strict';

const {
  isAlreadyKoreanOrNonEnglish,
  isInvalidCachedOrTranslatedText,
} = require('../../core/text-tokenizer');
const {
  isWholeProtectedCodeBlock,
  tokenizeBlockElement,
  buildTranslatedBlockElement,
} = require('./dom-tokenizer');

function createAntigravityThinkingTranslator({
  targetDoc,
  catalog,
  translationService,
  triggerController,
  getTranslateThinkingEnabled = () => true,
  onTriggerPretranslate = null,
  isDisposed = () => false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);

  function translateStaticSync(raw) {
    return catalog && typeof catalog.translateSync === 'function' ? catalog.translateSync(raw) : null;
  }

  function tryTranslateBlockElementSync(origEl) {
    if (!origEl) return null;
    if (isWholeProtectedCodeBlock(origEl)) {
      return origEl.cloneNode(true);
    }
    if (origEl.tagName === 'UL' || origEl.tagName === 'OL') {
      const items = Array.from(origEl.querySelectorAll(':scope > li'));
      const syncItems = [];
      for (const li of items) {
        const sLi = tryTranslateBlockElementSync(li);
        if (!sLi) return null;
        syncItems.push(sLi);
      }
      const listClone = origEl.cloneNode(false);
      for (const sLi of syncItems) listClone.appendChild(sLi);
      return listClone;
    }

    const { tokenizedText, savedNodes, skipTranslation } = tokenizeBlockElement(origEl, doc);
    if (skipTranslation || !tokenizedText || isAlreadyKoreanOrNonEnglish(tokenizedText)) {
      return origEl.cloneNode(true);
    }
    const cached = translationService ? translationService.getCachedSync(tokenizedText) : null;
    if (cached !== null && !isInvalidCachedOrTranslatedText(cached, tokenizedText)) {
      return buildTranslatedBlockElement(origEl, savedNodes, cached, doc);
    }
    return null;
  }

  async function translateBlockElement(origEl, signal = null) {
    if (isWholeProtectedCodeBlock(origEl)) {
      return { node: origEl.cloneNode(true), translated: true };
    }
    const { tokenizedText, savedNodes, skipTranslation } = tokenizeBlockElement(origEl, doc);
    if (skipTranslation || !tokenizedText || isAlreadyKoreanOrNonEnglish(tokenizedText)) {
      return { node: origEl.cloneNode(true), translated: true };
    }
    const translatedText = await translationService.translateText(tokenizedText, { signal });
    const isTranslated =
      translatedText !== tokenizedText && !isInvalidCachedOrTranslatedText(translatedText, tokenizedText);
    return {
      node: buildTranslatedBlockElement(origEl, savedNodes, translatedText, doc),
      translated: isTranslated,
    };
  }

  function resetThoughtHost(el) {
    if (!el) return;
    if (el.__agyAbortCtrl) {
      try {
        el.__agyAbortCtrl.abort();
      } catch (_err) {}
      delete el.__agyAbortCtrl;
    }
    if (el.__agyStreamDebounce) {
      clearTimer(el.__agyStreamDebounce);
      delete el.__agyStreamDebounce;
    }
    delete el.__agyLastSnapshot;
    delete el.__agyPendingSnapshot;
    const wrap = el.querySelector && el.querySelector(':scope > .agy-ko-thought-wrap');
    if (wrap) wrap.remove();
    if (typeof el.removeAttribute === 'function') {
      el.removeAttribute('data-agy-ko-ready');
    }
  }

  function restoreOriginalCursorEdits() {
    if (translationService && typeof translationService.abortAllPending === 'function') {
      translationService.abortAllPending('TRANSLATE_THINKING_DISABLED');
    }
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    doc.querySelectorAll('.cursor-edit').forEach(resetThoughtHost);
    doc.querySelectorAll('[data-agy-ko-thought-host="1"]').forEach(resetThoughtHost);
    doc.querySelectorAll('[data-testid="browser-subagent-thinking"] span').forEach((el) => {
      delete el.__agyDynamicSource;
      delete el.__agyTranslatingDynamic;
      if (el.firstChild && el.firstChild.__agyOrigValue !== undefined) {
        el.firstChild.nodeValue = el.firstChild.__agyOrigValue;
        delete el.firstChild.__agyOrigValue;
        delete el.firstChild.__agyKoApplied;
      }
    });
  }

  function processCursorEdit(cursorEdit, triggerBtn = null) {
    if (!cursorEdit || !doc) return;
    if (!getTranslateThinkingEnabled()) {
      if (
        cursorEdit.getAttribute('data-agy-ko-ready') === '1' ||
        (cursorEdit.querySelector && cursorEdit.querySelector(':scope > .agy-ko-thought-wrap'))
      ) {
        resetThoughtHost(cursorEdit);
      }
      if (triggerBtn && triggerController) triggerController.processTriggerButton(triggerBtn);
      return;
    }

    const origContainer = Array.from(cursorEdit.children || []).find(
      (ch) => ch.tagName === 'DIV' && (!ch.classList || !ch.classList.contains('agy-ko-thought-wrap'))
    );
    if (!origContainer) return;

    const blockChildren = Array.from(origContainer.children || []).filter(
      (el) => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT'
    );

    const rawSnapshot = (
      blockChildren.length > 0
        ? blockChildren
            .map((ch) => String(ch.textContent || '').trim())
            .filter(Boolean)
            .join('\n\n')
        : String(origContainer.textContent || '').trim()
    ).trim();
    if (!rawSnapshot) return;

    const hasEnglishBlock =
      blockChildren.length > 0
        ? blockChildren.some((ch) => !isWholeProtectedCodeBlock(ch) && !isAlreadyKoreanOrNonEnglish(ch.textContent || ''))
        : !isWholeProtectedCodeBlock(origContainer) && !isAlreadyKoreanOrNonEnglish(rawSnapshot);

    if (!hasEnglishBlock) {
      resetThoughtHost(cursorEdit);
      cursorEdit.__agyLastSnapshot = rawSnapshot;
      if (triggerBtn && triggerController) triggerController.processTriggerButton(triggerBtn);
      return;
    }

    if (
      (cursorEdit.__agyLastSnapshot === rawSnapshot && cursorEdit.getAttribute('data-agy-ko-ready') === '1') ||
      cursorEdit.__agyPendingSnapshot === rawSnapshot
    ) {
      if (triggerBtn && triggerController) triggerController.processTriggerButton(triggerBtn);
      return;
    }

    if (cursorEdit.__agyAbortCtrl) {
      try {
        cursorEdit.__agyAbortCtrl.abort();
      } catch (_err) {}
      delete cursorEdit.__agyAbortCtrl;
    }
    if (cursorEdit.__agyStreamDebounce) {
      clearTimer(cursorEdit.__agyStreamDebounce);
      delete cursorEdit.__agyStreamDebounce;
    }

    let wrap = cursorEdit.querySelector(':scope > .agy-ko-thought-wrap');
    if (!wrap) {
      wrap = doc.createElement('div');
      wrap.className = (origContainer.className ? origContainer.className + ' ' : '') + 'agy-ko-thought-wrap';
      cursorEdit.appendChild(wrap);
    }

    const prevWrapChildren = Array.from(wrap.children || []);

    if (blockChildren.length > 0) {
      const slots = blockChildren.map((ch, idx) => {
        const chSrc = String(ch.textContent || '').trim();
        const prevSlot = prevWrapChildren[idx];
        if (
          prevSlot &&
          prevSlot.getAttribute('data-agy-src') === chSrc &&
          /[가-힣]/.test(prevSlot.textContent || '')
        ) {
          return { orig: ch, slot: prevSlot, alreadyDone: true, src: chSrc };
        }
        const syncNode = tryTranslateBlockElementSync(ch);
        if (syncNode) {
          syncNode.setAttribute('data-agy-src', chSrc);
          if (!prevSlot) {
            wrap.appendChild(syncNode);
          } else if (prevSlot !== syncNode) {
            wrap.replaceChild(syncNode, prevSlot);
          }
          return { orig: ch, slot: syncNode, alreadyDone: true, src: chSrc };
        }
        if (prevSlot && /[가-힣]/.test(prevSlot.textContent || '')) {
          return { orig: ch, slot: prevSlot, alreadyDone: false, src: chSrc };
        }
        if (prevSlot && prevSlot.getAttribute('data-agy-src') === chSrc) {
          return { orig: ch, slot: prevSlot, alreadyDone: false, src: chSrc };
        }
        const initialNode = ch.cloneNode(true);
        initialNode.setAttribute('data-agy-src', chSrc);
        if (!prevSlot) {
          wrap.appendChild(initialNode);
        } else {
          wrap.replaceChild(initialNode, prevSlot);
        }
        return { orig: ch, slot: initialNode, alreadyDone: false, src: chSrc };
      });

      while (wrap.children.length > slots.length) {
        wrap.lastElementChild.remove();
      }
      cursorEdit.setAttribute('data-agy-ko-ready', '1');
      if (triggerBtn && triggerController) triggerController.processTriggerButton(triggerBtn);

      const pendingSlots = slots.filter((s) => !s.alreadyDone);
      if (pendingSlots.length === 0) {
        cursorEdit.__agyLastSnapshot = rawSnapshot;
        delete cursorEdit.__agyPendingSnapshot;
        return;
      }

      cursorEdit.__agyPendingSnapshot = rawSnapshot;
      cursorEdit.__agyStreamDebounce = setTimer(async () => {
        delete cursorEdit.__agyStreamDebounce;
        if (isDisposed() || cursorEdit.__agyPendingSnapshot !== rawSnapshot) return;
        const abortCtrl = new AbortController();
        cursorEdit.__agyAbortCtrl = abortCtrl;
        let allTranslated = true;

        try {
          await Promise.all(
            pendingSlots.map(async ({ orig, slot, src }) => {
              if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) {
                allTranslated = false;
                return;
              }
              if (orig.tagName === 'UL' || orig.tagName === 'OL') {
                const listClone = orig.cloneNode(false);
                const items = Array.from(orig.querySelectorAll(':scope > li'));
                const itemResults = await Promise.all(
                  items.map((li) => translateBlockElement(li, abortCtrl.signal))
                );
                if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) {
                  allTranslated = false;
                  return;
                }
                for (const res of itemResults) {
                  if (!res.translated) allTranslated = false;
                  listClone.appendChild(res.node);
                }
                listClone.setAttribute('data-agy-src', src);
                if (slot.parentNode === wrap) wrap.replaceChild(listClone, slot);
              } else {
                const res = await translateBlockElement(orig, abortCtrl.signal);
                if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) {
                  allTranslated = false;
                  return;
                }
                if (!res.translated) allTranslated = false;
                res.node.setAttribute('data-agy-src', src);
                if (slot.parentNode === wrap) wrap.replaceChild(res.node, slot);
              }
            })
          );

          if (!abortCtrl.signal.aborted && cursorEdit.__agyPendingSnapshot === rawSnapshot) {
            delete cursorEdit.__agyPendingSnapshot;
            if (allTranslated) {
              cursorEdit.__agyLastSnapshot = rawSnapshot;
            }
            cursorEdit.setAttribute('data-agy-ko-ready', '1');
          }
          if (triggerBtn && triggerController) triggerController.processTriggerButton(triggerBtn);
        } finally {
          if (cursorEdit.__agyAbortCtrl === abortCtrl) {
            delete cursorEdit.__agyAbortCtrl;
          }
          if (cursorEdit.__agyPendingSnapshot === rawSnapshot && cursorEdit.__agyLastSnapshot !== rawSnapshot) {
            delete cursorEdit.__agyPendingSnapshot;
          }
        }
      }, 150);
    } else {
      const p = doc.createElement('p');
      p.textContent = rawSnapshot;
      const syncNode = tryTranslateBlockElementSync(p);
      if (syncNode) {
        if (wrap.firstElementChild) {
          wrap.replaceChild(syncNode, wrap.firstElementChild);
        } else {
          wrap.appendChild(syncNode);
        }
        while (wrap.children.length > 1) {
          wrap.lastElementChild.remove();
        }
        cursorEdit.setAttribute('data-agy-ko-ready', '1');
        cursorEdit.__agyLastSnapshot = rawSnapshot;
        delete cursorEdit.__agyPendingSnapshot;
        if (triggerBtn && triggerController) triggerController.processTriggerButton(triggerBtn);
        return;
      }

      if (wrap.children.length === 0) {
        wrap.appendChild(p.cloneNode(true));
      }
      cursorEdit.setAttribute('data-agy-ko-ready', '1');
      cursorEdit.__agyPendingSnapshot = rawSnapshot;

      cursorEdit.__agyStreamDebounce = setTimer(async () => {
        delete cursorEdit.__agyStreamDebounce;
        if (isDisposed() || cursorEdit.__agyPendingSnapshot !== rawSnapshot) return;
        const abortCtrl = new AbortController();
        cursorEdit.__agyAbortCtrl = abortCtrl;
        try {
          const res = await translateBlockElement(p, abortCtrl.signal);
          if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) return;
          if (wrap.firstElementChild) {
            wrap.replaceChild(res.node, wrap.firstElementChild);
          } else {
            wrap.appendChild(res.node);
          }
          while (wrap.children.length > 1) {
            wrap.lastElementChild.remove();
          }
          delete cursorEdit.__agyPendingSnapshot;
          if (res.translated) {
            cursorEdit.__agyLastSnapshot = rawSnapshot;
          }
          cursorEdit.setAttribute('data-agy-ko-ready', '1');
          if (triggerBtn && triggerController) triggerController.processTriggerButton(triggerBtn);
        } finally {
          if (cursorEdit.__agyAbortCtrl === abortCtrl) {
            delete cursorEdit.__agyAbortCtrl;
          }
          if (cursorEdit.__agyPendingSnapshot === rawSnapshot && cursorEdit.__agyLastSnapshot !== rawSnapshot) {
            delete cursorEdit.__agyPendingSnapshot;
          }
        }
      }, 150);
    }
  }

  function scanSideQuestionAndBrowserSubagentThoughts() {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    const sqBtns = doc.querySelectorAll('[data-testid="side-question-answer"] button[aria-expanded]');
    for (const btn of sqBtns) {
      if (triggerController) triggerController.processTriggerButton(btn);
      const panel = btn.nextElementSibling;
      if (!panel || panel.tagName !== 'DIV') continue;
      let hostEl = panel.querySelector ? panel.querySelector('.cursor-edit') : null;
      if (!hostEl && typeof panel.querySelectorAll === 'function') {
        hostEl = Array.from(panel.querySelectorAll('div')).find(
          (d) =>
            String(d.className || '').includes('border-l') &&
            Array.from(d.children || []).some(
              (c) => c.tagName === 'DIV' && (!c.classList || !c.classList.contains('agy-ko-thought-wrap'))
            )
        );
      }
      if (
        !hostEl &&
        Array.from(panel.children || []).some(
          (c) => c.tagName === 'DIV' && (!c.classList || !c.classList.contains('agy-ko-thought-wrap'))
        )
      ) {
        hostEl = panel;
      }
      if (hostEl) {
        if (!hostEl.classList || !hostEl.classList.contains('cursor-edit')) {
          if (typeof hostEl.setAttribute === 'function') {
            hostEl.setAttribute('data-agy-ko-thought-host', '1');
          }
        }
        processCursorEdit(hostEl, btn);
      }
    }

    const browserThoughtSpans = doc.querySelectorAll('[data-testid="browser-subagent-thinking"] span');
    const translateEnabled = Boolean(getTranslateThinkingEnabled());
    for (const el of browserThoughtSpans) {
      if (!el.childNodes || el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) continue;
      const tn = el.firstChild;
      if (!translateEnabled) {
        delete el.__agyDynamicSource;
        delete el.__agyTranslatingDynamic;
        if (tn.__agyOrigValue !== undefined) {
          tn.nodeValue = tn.__agyOrigValue;
          delete tn.__agyOrigValue;
          delete tn.__agyKoApplied;
        }
        continue;
      }
      const liveVal = tn.nodeValue || '';
      const trimmed = liveVal.trim();
      if (!trimmed) continue;
      if (tn.__agyKoApplied && trimmed === tn.__agyKoApplied) continue;
      tn.__agyOrigValue = liveVal;
      if (isAlreadyKoreanOrNonEnglish(trimmed)) continue;

      const syncKo = translateStaticSync(trimmed);
      if (syncKo && syncKo !== trimmed) {
        tn.__agyKoApplied = syncKo;
        tn.nodeValue = syncKo;
        continue;
      }
      const cached = translationService ? translationService.getCachedSync(trimmed) : null;
      if (cached !== null) {
        tn.__agyKoApplied = cached;
        tn.nodeValue = cached;
        continue;
      }
      if (translationService && el.__agyDynamicSource !== trimmed && !el.__agyTranslatingDynamic) {
        el.__agyDynamicSource = trimmed;
        el.__agyTranslatingDynamic = true;
        translationService
          .translateText(trimmed)
          .then((ko) => {
            const wasTranslating = Boolean(el.__agyTranslatingDynamic);
            delete el.__agyTranslatingDynamic;
            if (isDisposed() || !wasTranslating || !ko || ko === trimmed || el.isConnected === false) {
              if (el.__agyDynamicSource === trimmed) delete el.__agyDynamicSource;
              return;
            }
            if (!el.firstChild || el.firstChild.nodeType !== 3 || String(el.firstChild.nodeValue || '').trim() !== trimmed) {
              if (el.__agyDynamicSource === trimmed) delete el.__agyDynamicSource;
              return;
            }
            el.firstChild.__agyOrigValue = el.firstChild.nodeValue;
            el.firstChild.__agyKoApplied = ko;
            el.firstChild.nodeValue = ko;
          })
          .catch(() => {
            delete el.__agyTranslatingDynamic;
            if (el.__agyDynamicSource === trimmed) delete el.__agyDynamicSource;
          });
      }
    }
  }

  function scanThoughtBlocks() {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    if (triggerController) {
      triggerController.scanTriggerButtonsSync();
    }
    const allCursorEdits = doc.querySelectorAll('.cursor-edit');
    for (const cursorEdit of allCursorEdits) {
      const container =
        (typeof cursorEdit.closest === 'function' && cursorEdit.closest('.relative')) || cursorEdit.parentElement;
      const btn = container
        ? container.querySelector('button[data-testid="thinking-collapsible-trigger"]')
        : null;
      processCursorEdit(cursorEdit, btn);
    }
    scanSideQuestionAndBrowserSubagentThoughts();
    if (typeof onTriggerPretranslate === 'function') {
      onTriggerPretranslate();
    }
  }

  function retranslateVisibleThoughts(clearCache = false, onResetPretranslate = null) {
    if (clearCache) {
      if (translationService) translationService.clearCache();
      if (typeof onResetPretranslate === 'function') onResetPretranslate();
    } else if (translationService) {
      translationService.bumpEpoch();
    }
    if (doc && typeof doc.querySelectorAll === 'function') {
      doc.querySelectorAll('.cursor-edit, [data-agy-ko-thought-host="1"]').forEach((el) => {
        if (el.__agyAbortCtrl) {
          try {
            el.__agyAbortCtrl.abort();
          } catch (_err) {}
          delete el.__agyAbortCtrl;
        }
        if (el.__agyStreamDebounce) {
          clearTimer(el.__agyStreamDebounce);
          delete el.__agyStreamDebounce;
        }
        delete el.__agyLastSnapshot;
        delete el.__agyPendingSnapshot;
        const wrap = el.querySelector && el.querySelector(':scope > .agy-ko-thought-wrap');
        if (wrap) {
          Array.from(wrap.children || []).forEach((ch) => ch.removeAttribute('data-agy-src'));
        }
      });
      doc.querySelectorAll('[data-testid="browser-subagent-thinking"] span').forEach((el) => {
        delete el.__agyDynamicSource;
        delete el.__agyTranslatingDynamic;
        if (el.firstChild && el.firstChild.__agyOrigValue !== undefined) {
          el.firstChild.nodeValue = el.firstChild.__agyOrigValue;
          delete el.firstChild.__agyKoApplied;
        }
      });
    }
    scanThoughtBlocks();
    return {
      clearedCache: Boolean(clearCache),
      cacheSize: translationService ? translationService.getCacheSize() : 0,
      provider: translationService ? translationService.getEffectiveProviderId() : '',
    };
  }

  return {
    tryTranslateBlockElementSync,
    translateBlockElement,
    processCursorEdit,
    scanThoughtBlocks,
    retranslateVisibleThoughts,
    restoreAll: restoreOriginalCursorEdits,
    restoreOriginalCursorEdits,
  };
}

module.exports = {
  createAntigravityThinkingTranslator,
};
