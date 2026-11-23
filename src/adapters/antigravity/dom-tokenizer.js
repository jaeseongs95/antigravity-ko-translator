'use strict';

const {
  resolveLastHangulJongseong,
  selectKoreanParticleByJongseong,
} = require('../../core/text-tokenizer');

const INLINE_PROTECTED_DOM_SELECTOR = 'code, pre, kbd, a, span.font-mono';
const WHOLE_CODE_BLOCK_SELECTOR =
  'pre, code, .code-block, .shiki, .cm-editor, .monaco-editor, .xterm, [class*="language-"], [data-code-block], [data-diff-line]';
const CODE_PLACEHOLDER_RESTORE_REGEX = /(?:⟦|\[|【)\s*C(\d+)\s*(?:⟧|\]|】)/gi;
const LEADING_PARTICLE_AFTER_CODE_REGEX =
  /^(\(으\)로|\(을\)를|\(이\)가|\(은\)는|\(과\)와|으로|로|와|과|를|을|가|이|는|은)(?=$|[\s.,;:!?)])/;

function isWholeProtectedCodeBlock(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'PRE' || tag === 'CODE' || tag === 'STYLE' || tag === 'SCRIPT') return true;
  if (typeof el.matches === 'function') {
    try {
      if (el.matches(WHOLE_CODE_BLOCK_SELECTOR)) return true;
    } catch (_err) {}
  }
  if (typeof el.querySelector === 'function') {
    try {
      // Wrapper div whose sole substantive element is a <pre> or code-viewer container
      const children = Array.from(el.children || []).filter(
        (ch) => ch && ch.tagName !== 'STYLE' && ch.tagName !== 'SCRIPT'
      );
      if (children.length === 1 && children[0] !== el && isWholeProtectedCodeBlock(children[0])) {
        const directText = Array.from(el.childNodes || [])
          .filter((n) => n && n.nodeType === 3)
          .map((n) => String(n.nodeValue || '').trim())
          .join('');
        if (!directText) return true;
      }
    } catch (_err) {}
  }
  return false;
}

function tokenizeBlockElement(blockEl, targetDoc = null) {
  if (!blockEl || typeof blockEl.cloneNode !== 'function') {
    return { tokenizedText: '', savedNodes: [], skipTranslation: false };
  }
  if (isWholeProtectedCodeBlock(blockEl)) {
    return { tokenizedText: '', savedNodes: [], skipTranslation: true };
  }
  const doc = targetDoc || blockEl.ownerDocument;
  const clone = blockEl.cloneNode(true);
  const allMatches =
    typeof clone.querySelectorAll === 'function'
      ? Array.from(clone.querySelectorAll(INLINE_PROTECTED_DOM_SELECTOR))
      : [];

  // Select ONLY outermost protected elements strictly inside `clone` (`anc !== clone`) so nested
  // `<a href="..."><code>...</code></a>` or `<pre><code>...</code></pre>` subtrees
  // are preserved as a single atomic `⟦Ck⟧` node without detaching inner children.
  const outermostNodes = allMatches.filter((el) => {
    const anc =
      el.parentElement && typeof el.parentElement.closest === 'function'
        ? el.parentElement.closest(INLINE_PROTECTED_DOM_SELECTOR)
        : null;
    return !anc || anc === clone || !clone.contains(anc);
  });

  const savedNodes = [];
  for (let i = 0; i < outermostNodes.length; i++) {
    const node = outermostNodes[i];
    if (!node.parentNode) continue;
    savedNodes.push(node.cloneNode(true));
    const placeholderText = `⟦C${savedNodes.length - 1}⟧`;
    const textNode = doc && typeof doc.createTextNode === 'function'
      ? doc.createTextNode(placeholderText)
      : { nodeType: 3, nodeValue: placeholderText };
    node.parentNode.replaceChild(textNode, node);
  }

  const tokenizedText = String(clone.textContent || '').trim();
  return { tokenizedText, savedNodes, skipTranslation: false };
}

function buildTranslatedBlockElement(origEl, savedNodes, translatedText, targetDoc = null) {
  const doc = targetDoc || (origEl && origEl.ownerDocument) || null;
  const out = origEl.cloneNode(false);
  const nodes = Array.isArray(savedNodes) ? savedNodes : [];
  const text = String(translatedText || '');

  if (nodes.length === 0 || !doc || typeof doc.createTextNode !== 'function') {
    out.textContent = text;
    return out;
  }

  CODE_PLACEHOLDER_RESTORE_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let prevRestoredNodeText = null;

  const appendTrailingSegment = (segText) => {
    if (!segText) return;
    let adjusted = segText;
    if (prevRestoredNodeText) {
      const jong = resolveLastHangulJongseong(prevRestoredNodeText);
      adjusted = adjusted.replace(LEADING_PARTICLE_AFTER_CODE_REGEX, (m) =>
        selectKoreanParticleByJongseong(jong, m)
      );
    }
    out.appendChild(doc.createTextNode(adjusted));
    prevRestoredNodeText = null;
  };

  let match;
  while ((match = CODE_PLACEHOLDER_RESTORE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      appendTrailingSegment(text.slice(lastIndex, match.index));
    } else {
      prevRestoredNodeText = null;
    }
    const idx = parseInt(match[1], 10);
    if (nodes[idx]) {
      const nodeClone = nodes[idx].cloneNode(true);
      out.appendChild(nodeClone);
      prevRestoredNodeText = nodeClone.textContent || '';
    } else {
      out.appendChild(doc.createTextNode(match[0]));
      prevRestoredNodeText = null;
    }
    lastIndex = CODE_PLACEHOLDER_RESTORE_REGEX.lastIndex;
  }
  if (lastIndex < text.length) {
    appendTrailingSegment(text.slice(lastIndex));
  }

  return out;
}

module.exports = {
  INLINE_PROTECTED_DOM_SELECTOR,
  WHOLE_CODE_BLOCK_SELECTOR,
  isWholeProtectedCodeBlock,
  tokenizeBlockElement,
  buildTranslatedBlockElement,
};
