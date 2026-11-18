'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WORKBENCH_UI_ENTRIES } = require('../../src/adapters/antigravity/dictionaries/workbench-ui');
const { COMPANION_UI_ENTRIES } = require('../../src/adapters/antigravity/dictionaries/companion-ui');
const { createAntigravityDictionaryCatalog } = require('../../src/adapters/antigravity/dictionaries/index');
const {
  BASE_EXCLUDED_SELECTOR,
  TEXT_EXCLUDED_SELECTOR,
  STATIC_UI_SUBTREE_PRUNE_SELECTOR,
  hasExcludedCodeDataAttrPrefix,
  isExcludedByFontMonoInheritance,
  createAntigravityUiLocalizer,
} = require('../../src/adapters/antigravity/ui-localizer');
const { createAntigravityTriggerController } = require('../../src/adapters/antigravity/trigger-controller');
const { createDisposableRegistry } = require('../../src/core/disposable-registry');
const {
  isUnsupportedDocumentEnvironment,
  createRuntimeBootstrapper,
} = require('../../src/runtime/bootstrap');

function buildTestDom() {
  class FakeText {
    constructor(val, doc) {
      this.nodeType = 3;
      this.nodeValue = String(val);
      this.ownerDocument = doc;
      this.parentNode = null;
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    get textContent() {
      return this.nodeValue;
    }
    set textContent(v) {
      this.nodeValue = String(v);
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
        ? this.parentNode.childNodes[idx + 1]
        : null;
    }
    cloneNode() {
      return new FakeText(this.nodeValue, this.ownerDocument);
    }
  }

  class FakeElement {
    constructor(tag, doc) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.ownerDocument = doc;
      this.parentNode = null;
      this.childNodes = [];
      this._attrs = new Map();
      this.style = {};
      this.isConnected = true;
      this.classList = {
        _set: new Set(),
        contains: (c) => this.classList._set.has(c),
        add: (...cs) => cs.forEach((c) => this.classList._set.add(c)),
        remove: (...cs) => cs.forEach((c) => this.classList._set.delete(c)),
      };
    }
    get attributes() {
      return Array.from(this._attrs.entries()).map(([name, value]) => ({ name, value }));
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1);
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get firstElementChild() {
      return this.children[0] || null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
        ? this.parentNode.childNodes[idx + 1]
        : null;
    }
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      const idx = siblings.indexOf(this);
      for (let i = idx + 1; i < siblings.length; i++) {
        if (siblings[i].nodeType === 1) return siblings[i];
      }
      return null;
    }
    set className(val) {
      this.classList._set = new Set(String(val || '').split(/\s+/).filter(Boolean));
      this._attrs.set('class', String(val || ''));
    }
    get className() {
      return Array.from(this.classList._set).join(' ');
    }
    setAttribute(name, val) {
      const s = String(val);
      if (name === 'class') {
        this.className = s;
        return;
      }
      this._attrs.set(name, s);
    }
    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    removeAttribute(name) {
      this._attrs.delete(name);
    }
    appendChild(child) {
      if (child.parentNode) {
        const i = child.parentNode.childNodes.indexOf(child);
        if (i >= 0) child.parentNode.childNodes.splice(i, 1);
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      const idx = this.childNodes.indexOf(refNode);
      if (idx < 0) return this.appendChild(newNode);
      newNode.parentNode = this;
      this.childNodes.splice(idx, 0, newNode);
      return newNode;
    }
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
        this.parentNode = null;
      }
    }
    get textContent() {
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      this.childNodes = v === '' ? [] : [new FakeText(v, this.ownerDocument)];
      for (const c of this.childNodes) c.parentNode = this;
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    matches(selectorList) {
      const parts = String(selectorList).split(',').map((s) => s.trim()).filter(Boolean);
      return parts.some((sel) => {
        // Handle descendant combinators used in BASE_EXCLUDED_SELECTOR (`[data-testid="side-question-answer"] button[aria-expanded]`)
        if (sel.includes(' ')) {
          const tokens = sel.split(/\s+/);
          const leaf = tokens[tokens.length - 1];
          const anc = tokens.slice(0, -1).join(' ');
          return this.matches(leaf) && Boolean(this.parentElement && this.parentElement.closest(anc));
        }
        if (sel.startsWith('#')) {
          return this.getAttribute('id') === sel.slice(1);
        }
        if (sel.startsWith('.')) {
          return this.classList.contains(sel.slice(1));
        }
        const tagAndAttr = sel.match(/^([a-zA-Z0-9_-]+)?(?:\[([a-zA-Z0-9_-]+)(?:(\*=|=)"([^"]*)")?\])?$/);
        if (!tagAndAttr) return false;
        const [, tagPart, attrName, op, attrVal] = tagAndAttr;
        if (tagPart && this.tagName !== tagPart.toUpperCase()) return false;
        if (attrName) {
          const actual = this.getAttribute(attrName);
          if (actual === null) return false;
          if (op === '=' && actual !== attrVal) return false;
          if (op === '*=' && !actual.includes(attrVal)) return false;
        }
        return Boolean(tagPart || attrName);
      });
    }
    closest(selectorList) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(selectorList)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(selectorList) {
      const out = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (c.matches(selectorList)) out.push(c);
            walk(c);
          }
        }
      };
      walk(this);
      return out;
    }
    querySelector(selectorList) {
      return this.querySelectorAll(selectorList)[0] || null;
    }
    cloneNode(deep = false) {
      const c = new FakeElement(this.tagName, this.ownerDocument);
      for (const [k, v] of this._attrs) c.setAttribute(k, v);
      if (deep) {
        for (const ch of this.childNodes) c.appendChild(ch.cloneNode(true));
      }
      return c;
    }
  }

  const doc = {
    contentType: 'text/html',
    documentElement: null,
    head: null,
    body: null,
    createElement(tag) {
      return new FakeElement(tag, doc);
    },
    createTextNode(val) {
      return new FakeText(val, doc);
    },
    getElementById(id) {
      return doc.documentElement ? doc.documentElement.querySelector(`#${id}`) : null;
    },
    querySelector(sel) {
      return doc.documentElement ? doc.documentElement.querySelector(sel) : null;
    },
    querySelectorAll(sel) {
      return doc.documentElement ? doc.documentElement.querySelectorAll(sel) : [];
    },
    createTreeWalker(root, _whatToShow, filter) {
      const flat = [];
      const visit = (node) => {
        const res = filter && typeof filter.acceptNode === 'function' ? filter.acceptNode(node) : 1;
        if (res === 2) return; // FILTER_REJECT: prune subtree!
        if (res === 1 && node !== root) flat.push(node);
        if (node.childNodes) {
          for (const ch of node.childNodes) visit(ch);
        }
      };
      visit(root);
      let idx = -1;
      return {
        nextNode() {
          idx += 1;
          return idx < flat.length ? flat[idx] : null;
        },
      };
    },
  };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return doc;
}

test('Dictionaries (D-0029, D-0030, Rev6-F5 #1): zero duplicate keys and exact Korean UI mappings including Send feedback / Send Feedback', () => {
  // Duplicate keys within a table throw on catalog construction, and cross-table duplicates are checked explicitly
  const seenKeys = new Map();
  for (const [srcName, entries] of [
    ['workbench-ui', WORKBENCH_UI_ENTRIES],
    ['companion-ui', COMPANION_UI_ENTRIES],
  ]) {
    for (const [en, ko] of entries) {
      if (seenKeys.has(en)) {
        assert.equal(
          seenKeys.get(en).ko,
          ko,
          `Conflicting duplicate key "${en}" across ${seenKeys.get(en).srcName} and ${srcName}`
        );
      }
      seenKeys.set(en, { srcName, ko });
    }
  }

  const catalog = createAntigravityDictionaryCatalog();
  assert.equal(catalog.translateSync('Send feedback'), '피드백 보내기');
  assert.equal(catalog.translateSync('Send Feedback'), '피드백 보내기');
  assert.equal(catalog.translateSync('Install as App'), '앱으로 설치');
  assert.equal(catalog.translateSync('General'), '일반');
  assert.equal(catalog.translateSync('Thought for 12s'), '12초 동안 생각함');
  assert.equal(catalog.translateSync('Worked for 1m 5s'), '1분 5초 동안 작업함');
});

test('UI Localizer (D-0042, Rev5-F7, D-0011, D-0030, Rev7-F5 #2): valid CSS selectors, code/font-mono/data-line-* exclusion, Lexical placeholder, and textarea split', () => {
  // 1) Rev5-F7: Zero non-standard attribute-name wildcards (`[data-line-*]`, `[data-quotable*]`) in selector constants!
  for (const sel of [BASE_EXCLUDED_SELECTOR, TEXT_EXCLUDED_SELECTOR, STATIC_UI_SUBTREE_PRUNE_SELECTOR]) {
    assert.equal(/\[data-[a-z-]+\*\]/i.test(sel), false, `Invalid CSS wildcard found in selector: ${sel}`);
  }

  const doc = buildTestDom();
  const catalog = createAntigravityDictionaryCatalog();
  const localizer = createAntigravityUiLocalizer({ targetDoc: doc, catalog });

  // 2) D-0042 exact regression case: `import org.pgledger.application.history.Change;` inside `.font-mono`
  //    AND inside `data-line-index` / `data-quotable-id` MUST NEVER become `...변경;`!
  const codeWrapper = doc.createElement('div');
  codeWrapper.className = 'font-mono text-xs';
  const importSpan1 = doc.createElement('span');
  importSpan1.textContent = 'import org.pgledger.application.history.';
  const changeIdentSpan = doc.createElement('span');
  changeIdentSpan.textContent = 'Change';
  const semiSpan = doc.createElement('span');
  semiSpan.textContent = ';';
  codeWrapper.appendChild(importSpan1);
  codeWrapper.appendChild(changeIdentSpan);
  codeWrapper.appendChild(semiSpan);
  doc.body.appendChild(codeWrapper);

  const customLineAttrRow = doc.createElement('div');
  customLineAttrRow.setAttribute('data-line-index', '42');
  const tokenSpan = doc.createElement('span');
  tokenSpan.textContent = 'Change';
  customLineAttrRow.appendChild(tokenSpan);
  doc.body.appendChild(customLineAttrRow);

  assert.equal(isExcludedByFontMonoInheritance(changeIdentSpan), true);
  assert.equal(hasExcludedCodeDataAttrPrefix(tokenSpan, doc.body), true);

  // 3) D-0011 & Rev7-F5 #2: Lexical `[data-testid="agent-input-box"]` sibling `<p>` placeholder localizes,
  //    while `[contenteditable="true"]` user prose is untouched!
  const inputBox = doc.createElement('div');
  inputBox.setAttribute('data-testid', 'agent-input-box');
  const editableDiv = doc.createElement('div');
  editableDiv.setAttribute('contenteditable', 'true');
  const userProseP = doc.createElement('p');
  userProseP.textContent = 'Change';
  editableDiv.appendChild(userProseP);
  const placeholderP = doc.createElement('p');
  placeholderP.textContent = 'Ask anything, @ to mention, / for actions';
  inputBox.appendChild(editableDiv);
  inputBox.appendChild(placeholderP);
  doc.body.appendChild(inputBox);

  // 4) Textarea placeholder attribute localizes while user-typed textarea textContent stays untouched!
  const textarea = doc.createElement('textarea');
  textarea.setAttribute('placeholder', 'Send a message');
  textarea.textContent = 'Change';
  doc.body.appendChild(textarea);

  // 5) D-0030: `Type ` followed by `<kbd>@</kbd>` becomes `채팅창에 `, NOT `유형 `!
  const hintDiv = doc.createElement('div');
  hintDiv.appendChild(doc.createTextNode('Type '));
  const kbd = doc.createElement('kbd');
  kbd.textContent = '@';
  hintDiv.appendChild(kbd);
  doc.body.appendChild(hintDiv);

  // 6) Genuine UI button outside `.font-mono` DOES localize `'Change'` -> `'변경'`
  const uiBtn = doc.createElement('button');
  uiBtn.textContent = 'Change';
  doc.body.appendChild(uiBtn);

  localizer.localizeStaticUiInRoot(doc.body);

  assert.equal(codeWrapper.textContent, 'import org.pgledger.application.history.Change;');
  assert.equal(customLineAttrRow.textContent, 'Change');
  assert.equal(userProseP.textContent, 'Change');
  assert.equal(placeholderP.textContent, '무엇이든 물어보세요 (@로 멘션, /로 작업 실행)');
  assert.equal(textarea.getAttribute('placeholder'), '메시지 보내기');
  assert.equal(textarea.textContent, 'Change');
  assert.equal(hintDiv.firstChild.nodeValue, '채팅창에 ');
  assert.equal(uiBtn.textContent, '변경');

  // Full lossless restore returns all localized nodes and attributes back to English
  localizer.restoreAllMutatedNodes();
  assert.equal(placeholderP.textContent, 'Ask anything, @ to mention, / for actions');
  assert.equal(textarea.getAttribute('placeholder'), 'Send a message');
  assert.equal(uiBtn.textContent, 'Change');
});

test('TriggerController (D-0005, D-0012) & Bootstrapper (D-0034, Rev7-F3): origSpan preservation, read-only verboseConversationSteps, data: guard, and parameterized mount(targetWin, targetDoc)', () => {
  // D-0034: data: and XML/SVG documents are rejected cleanly
  assert.equal(
    isUnsupportedDocumentEnvironment(
      { location: { protocol: 'data:' } },
      { contentType: 'text/html', documentElement: { tagName: 'HTML' } }
    ),
    true
  );
  assert.equal(
    isUnsupportedDocumentEnvironment(
      { location: { protocol: 'https:' } },
      { contentType: 'application/xml', documentElement: { tagName: 'SVG' } }
    ),
    true
  );

  // D-0005 & D-0012: TriggerController preserves React-owned origSpan and NEVER mutates native setPrefValue
  const doc = buildTestDom();
  let setPrefCalled = 0;
  const rootAnchor = doc.createElement('div');
  rootAnchor.setAttribute('data-testid', 'conversation-view');
  rootAnchor.__reactFiber$test = {
    memoizedProps: {
      value: {
        getState: () => ({
          getPrefValue: (k) => (k === 'verboseConversationSteps' ? false : undefined),
          setPrefValue: () => {
            setPrefCalled += 1;
          },
        }),
        onDidChange: () => {},
      },
    },
    return: null,
  };
  const btn = doc.createElement('button');
  btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
  btn.setAttribute('aria-expanded', 'false');
  const origSpan = doc.createElement('span');
  origSpan.textContent = 'Thought for 4s';
  btn.appendChild(origSpan);
  rootAnchor.appendChild(btn);
  doc.body.appendChild(rootAnchor);

  const disposables = createDisposableRegistry();
  const catalog = createAntigravityDictionaryCatalog();
  const triggerCtrl = createAntigravityTriggerController({
    targetDoc: doc,
    catalog,
    disposables,
  });
  triggerCtrl.scanTriggerButtonsSync();

  assert.equal(origSpan.parentNode, btn, 'D-0005: React-owned origSpan child must remain attached in button');
  assert.equal(origSpan.getAttribute('data-agy-orig-label'), '1');
  const cloneLabel = btn.querySelector('.agy-ko-trigger-label');
  assert.ok(cloneLabel, 'Sibling Korean trigger label must be injected');
  assert.equal(cloneLabel.textContent, '4초 동안 생각함');
  assert.equal(setPrefCalled, 0, 'D-0012: Native verboseConversationSteps preference must NEVER be overwritten');

  // Rev7-F3: Parameterized `mount(childWin, childDoc)` binds to `childWin` & `childDoc` without touching global `window`!
  const childDoc = buildTestDom();
  const childNavBtn = childDoc.createElement('button');
  childNavBtn.textContent = 'General';
  childDoc.body.appendChild(childNavBtn);

  class FakeMutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  const childWin = {
    location: { protocol: 'https:', href: 'https://antigravity.google.com/r/test', pathname: '/r/test' },
    document: childDoc,
    MutationObserver: FakeMutationObserver,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    queueMicrotask,
  };
  childDoc.defaultView = childWin;

  const bootstrapper = createRuntimeBootstrapper({ version: 'v2.0.0' });
  const mounted = bootstrapper.mount(childWin, childDoc);
  assert.equal(mounted.mounted, true);
  assert.equal(childWin.__agyKoLocalizerActive, 'v2.0.0');
  assert.equal(typeof childWin.__agyMountKoThoughtLocalizer, 'function');
  assert.equal(childNavBtn.textContent, '일반');

  childWin.__agyKoThoughtCleanup(true);
  assert.equal(childWin.__agyKoLocalizerActive, undefined);
  assert.equal(childNavBtn.textContent, 'General');
});
