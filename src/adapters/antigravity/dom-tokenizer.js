'use strict';

const {
  resolveLastHangulJongseong,
  selectKoreanParticleByJongseong,
} = require('../../core/text-tokenizer');

const INLINE_PROTECTED_DOM_SELECTOR = 'code, pre, kbd, a, span.font-mono';
const CODE_PLACEHOLDER_RESTORE_REGEX = /(?:⟦|\[|【)\s*C(\d+)\s*(?:⟧|\]|】)/gi;
const LEADING_PARTICLE_AFTER_CODE_REGEX =
  /^(\(으\)로|\(을\)를|\(이\)가|\(은\)는|\(과\)와|으로|로|와|과|를|을|가|이|는|은)(?=$|[\s.,;:!?)])/;

function tokenizeBlockElement(blockEl, targetDoc = null) {
  if (!blockEl || typeof blockEl.cloneNode !== 'function') {
    return { tokenizedText: '', savedNodes: [] };
  }
  const doc = targetDoc || blockEl.ownerDocument;
  const clone = blockEl.cloneNode(true);
  const allMatches =
    typeof clone.querySelectorAll === 'function'
      ? Array.from(clone.querySelectorAll(INLINE_PROTECTED_DOM_SELECTOR))
      : [];

  // Rev6-F4 #2: Select ONLY outermost protected elements within `clone` so nested
  // `<a href="..."><code>...</code></a>` or `<pre><code>...</code></pre>` subtrees
  // are preserved as a single atomic `⟦Ck⟧` node without detaching inner children.
  const outermostNodes = allMatches.filter((el) => {
    const anc =
      el.parentElement && typeof el.parentElement.closest === 'function'
        ? el.parentElement.closest(INLINE_PROTECTED_DOM_SELECTOR)
        : null;
    return !anc || !clone.contains(anc);
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
  return { tokenizedText, savedNodes };
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
  tokenizeBlockElement,
  buildTranslatedBlockElement,
};
