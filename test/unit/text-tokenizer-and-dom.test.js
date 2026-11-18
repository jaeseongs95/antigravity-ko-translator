'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAlreadyKoreanOrNonEnglish,
  isInvalidCachedOrTranslatedText,
  protectIdentifiersInThoughtText,
  restoreIdentifiersInThoughtText,
  extractTokenizedSegmentsFromMarkdown,
} = require('../../src/core/text-tokenizer');
const {
  tokenizeBlockElement,
  buildTranslatedBlockElement,
} = require('../../src/adapters/antigravity/dom-tokenizer');

function createMiniDom() {
  class MiniText {
    constructor(text) {
      this.nodeType = 3;
      this.nodeValue = String(text);
      this.parentNode = null;
    }
    get textContent() {
      return this.nodeValue;
    }
    set textContent(v) {
      this.nodeValue = String(v);
    }
    cloneNode() {
      return new MiniText(this.nodeValue);
    }
  }

  class MiniElement {
    constructor(tagName, doc) {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.ownerDocument = doc;
      this.attributes = new Map();
      this.childNodes = [];
      this.parentNode = null;
      this.className = '';
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'class') this.className = String(v);
    }
    getAttribute(k) {
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    appendChild(child) {
      if (child.parentNode) {
        const idx = child.parentNode.childNodes.indexOf(child);
        if (idx >= 0) child.parentNode.childNodes.splice(idx, 1);
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    replaceChild(newChild, oldChild) {
      const idx = this.childNodes.indexOf(oldChild);
      if (idx < 0) throw new Error('oldChild not found');
      if (newChild.parentNode) {
        const prevIdx = newChild.parentNode.childNodes.indexOf(newChild);
        if (prevIdx >= 0) newChild.parentNode.childNodes.splice(prevIdx, 1);
      }
      oldChild.parentNode = null;
      newChild.parentNode = this;
      this.childNodes[idx] = newChild;
      return oldChild;
    }
    get textContent() {
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = v === '' ? [] : [new MiniText(v)];
      for (const c of this.childNodes) c.parentNode = this;
    }
    contains(target) {
      let cur = target;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    matches(selector) {
      const parts = selector.split(',').map((s) => s.trim());
      return parts.some((part) => {
        if (part === 'span.font-mono') {
          return this.tagName === 'SPAN' && this.className.split(/\s+/).includes('font-mono');
        }
        return this.tagName === part.toUpperCase();
      });
    }
    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.matches(selector)) out.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return out;
    }
    cloneNode(deep = false) {
      const copy = new MiniElement(this.tagName, this.ownerDocument);
      copy.className = this.className;
      for (const [k, v] of this.attributes) copy.attributes.set(k, v);
      if (deep) {
        for (const c of this.childNodes) {
          copy.appendChild(c.cloneNode(true));
        }
      }
      return copy;
    }
  }

  const doc = {
    createElement(tag) {
      return new MiniElement(tag, doc);
    },
    createTextNode(text) {
      return new MiniText(text);
    },
  };
  return { doc };
}

test('TextTokenizer (D-0036): multi-backtick Markdown code spans, CLI flags, file paths, and Korean particle correction', () => {
  const input = 'Inspect ``foo`bar`` in `ensure_statusbar_patch.js` with --watch-storage before continuing.';
  const { protectedText, savedTokens } = protectIdentifiersInThoughtText(input);

  assert.equal(savedTokens[0], '``foo`bar``');
  assert.equal(savedTokens[1], '`ensure_statusbar_patch.js`');
  assert.equal(savedTokens[2], '--watch-storage');
  assert.match(protectedText, /⟦T0⟧/);
  assert.match(protectedText, /⟦T1⟧/);
  assert.match(protectedText, /⟦T2⟧/);

  // Simulate translator returning wrong vowel/consonant particles after placeholders
  const translated = '계속하기 전에 ⟦T2⟧을 사용해 ⟦T1⟧의 ⟦T0⟧를 점검합니다.';
  const restored = restoreIdentifiersInThoughtText(translated, savedTokens);
  assert.equal(
    restored,
    '계속하기 전에 --watch-storage를 사용해 `ensure_statusbar_patch.js`의 ``foo`bar``과 함께 점검합니다.'.replace(
      '과 함께 점검합니다.',
      '를 점검합니다.'
    )
  );

  // Consonant-ending English word (`LOCK_PACK` / `local_llm`) selects '을' / '으로', while `LOCK_PATH` ("패스") selects '를'
  const { savedTokens: t2 } = protectIdentifiersInThoughtText('Check `LOCK_PACK`, `LOCK_PATH`, and `local_llm`');
  const restored2 = restoreIdentifiersInThoughtText('⟦T0⟧를 확인하고 ⟦T1⟧을 점검한 뒤 ⟦T2⟧로 이동합니다.', t2);
  assert.equal(restored2, '`LOCK_PACK`을 확인하고 `LOCK_PATH`를 점검한 뒤 `local_llm`으로 이동합니다.');
});

test('TextTokenizer (D-0036): rejects Kana, Hanja, leaked T-tokens, or dropped C-tokens', () => {
  const src = 'Update ⟦C0⟧ and ⟦C1⟧ safely.';
  assert.equal(isInvalidCachedOrTranslatedText('⟦C0⟧와 ⟦C1⟧을 안전하게 업데이트합니다.', src), false);
  // Dropped ⟦C1⟧ -> invalid!
  assert.equal(isInvalidCachedOrTranslatedText('⟦C0⟧만 안전하게 업데이트합니다.', src), true);
  // Hallucinated Japanese Kana -> invalid!
  assert.equal(isInvalidCachedOrTranslatedText('⟦C0⟧と⟦C1⟧を 안전하게 업데이트합니다.', src), true);
  // Hallucinated CJK Hanja not in source -> invalid!
  assert.equal(isInvalidCachedOrTranslatedText('⟦C0⟧와 ⟦C1⟧을 安全하게 업데이트합니다.', src), true);
  // Unrestored ⟦T0⟧ token -> invalid!
  assert.equal(isInvalidCachedOrTranslatedText('⟦T0⟧와 ⟦C0⟧와 ⟦C1⟧을 업데이트합니다.', src), true);

  assert.equal(isAlreadyKoreanOrNonEnglish('이미 한국어로 작성된 문장입니다.'), true);
  assert.equal(isAlreadyKoreanOrNonEnglish('Checking the workbench configuration now.'), false);

  const mdSegments = extractTokenizedSegmentsFromMarkdown(
    '### Checking ``a`b`` state\n\n```js\nconst skipFence = true;\n```\n\n- Verify `main.js` load\n- Confirm rollback safety'
  );
  assert.deepEqual(mdSegments, [
    'Checking ⟦C0⟧ state',
    'Verify ⟦C0⟧ load',
    'Confirm rollback safety',
  ]);
});

test('DomTokenizer (Rev6-F4 #2): nested <a href="..."><code>foo.js</code></a> tokenizes as a single outermost ⟦C0⟧', () => {
  const { doc } = createMiniDom();
  const p = doc.createElement('p');
  p.appendChild(doc.createTextNode('Open '));

  const link = doc.createElement('a');
  link.setAttribute('href', 'https://example.com/docs');
  const nestedCode = doc.createElement('code');
  nestedCode.textContent = 'remote-host-port.js';
  link.appendChild(nestedCode);
  p.appendChild(link);

  p.appendChild(doc.createTextNode(' and press '));
  const kbd = doc.createElement('kbd');
  kbd.textContent = 'Enter';
  p.appendChild(kbd);

  const { tokenizedText, savedNodes } = tokenizeBlockElement(p, doc);
  assert.equal(tokenizedText, 'Open ⟦C0⟧ and press ⟦C1⟧');
  assert.equal(savedNodes.length, 2, 'Nested <code> inside <a> must NOT create a second placeholder');
  assert.equal(savedNodes[0].tagName, 'A');
  assert.equal(savedNodes[0].childNodes[0].tagName, 'CODE');
  assert.equal(savedNodes[0].childNodes[0].textContent, 'remote-host-port.js');

  const rebuilt = buildTranslatedBlockElement(p, savedNodes, '⟦C0⟧을 열고 ⟦C1⟧을 누르세요.', doc);
  // 'remote-host-port.js' -> ends in 'js' ('에스', vowel -> '를'); 'Enter' -> ends in 'r' (vowel -> '를')
  assert.equal(rebuilt.textContent, 'remote-host-port.js를 열고 Enter를 누르세요.');
  const restoredAnchors = rebuilt.querySelectorAll('a');
  assert.equal(restoredAnchors.length, 1);
  assert.equal(restoredAnchors[0].getAttribute('href'), 'https://example.com/docs');
  assert.equal(restoredAnchors[0].childNodes[0].tagName, 'CODE');
});
