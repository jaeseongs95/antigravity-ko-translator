'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGoogleTranslateAdapter } = require('../../src/adapters/translators/google-translate');
const { createAntigravityDictionaryCatalog } = require('../../src/adapters/antigravity/dictionaries');
const { createAntigravityTriggerController } = require('../../src/adapters/antigravity/trigger-controller');
const { createAntigravityThinkingTranslator } = require('../../src/adapters/antigravity/thinking-translator');
const { createObserverScheduler } = require('../../src/runtime/observer-scheduler');

test('F1: GoogleTranslateAdapter encodes query, concatenates multi-segment output, enforces credentials:omit/redirect:error, and handles aborts', async () => {
  const calls = [];
  const adapter = createGoogleTranslateAdapter({
    async fetchFn(url, init) {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return [[['첫 번째 문장 ', 'First sentence '], ['두 번째 문장.', 'Second sentence.']]];
        },
      };
    },
  });

  const out = await adapter.translate('First sentence Second sentence.', { sourceLang: 'en', targetLang: 'ko' });
  assert.equal(out, '첫 번째 문장 두 번째 문장.');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /client=gtx&sl=en&tl=ko&dt=t&q=/);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');

  // Pre-aborted signal returns empty string without calling fetch
  const ac = new AbortController();
  ac.abort();
  const abortedOut = await adapter.translate('Should not fetch', { signal: ac.signal });
  assert.equal(abortedOut, '');
  assert.equal(calls.length, 1);
});

test('F1: processTriggerButton preserves React origSpan (data-agy-orig-label="1") and inserts .agy-ko-trigger-label sibling', () => {
  const children = [];
  const origSpan = {
    tagName: 'SPAN',
    nodeType: 1,
    textContent: 'Thought for 5s',
    style: {},
    attrs: new Map(),
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    querySelector: () => null,
    classList: { contains: () => false },
  };
  children.push(origSpan);

  const btn = {
    tagName: 'BUTTON',
    nodeType: 1,
    attrs: new Map([['data-testid', 'thinking-collapsible-trigger']]),
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    querySelector(sel) {
      if (sel === '.agy-ko-trigger-label') return children.find((c) => c.className === 'agy-ko-trigger-label') || null;
      if (sel === '[data-agy-orig-label="1"]') return children.find((c) => c.getAttribute('data-agy-orig-label') === '1') || null;
      if (sel.startsWith('span')) return origSpan;
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes('span')) return children.filter((c) => c.tagName === 'SPAN');
      return [];
    },
    insertBefore(el) {
      children.push(el);
      return el;
    },
    appendChild(el) {
      children.push(el);
      return el;
    },
  };
  origSpan.parentNode = btn;

  const doc = {
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        nodeType: 1,
        className: '',
        textContent: '',
        style: {},
        attrs: new Map(),
        getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
        setAttribute(k, v) { this.attrs.set(k, String(v)); },
      };
    },
  };

  const ctrl = createAntigravityTriggerController({
    targetDoc: doc,
    targetWin: {},
    catalog: createAntigravityDictionaryCatalog(),
  });

  ctrl.processTriggerButton(btn);
  assert.equal(origSpan.textContent, 'Thought for 5s', 'Original React span textContent must remain untouched');
  assert.equal(origSpan.getAttribute('data-agy-orig-label'), '1');
  const koLabel = children.find((c) => c.className === 'agy-ko-trigger-label');
  assert.ok(koLabel);
  assert.equal(koLabel.textContent, '5초 동안 생각함');
});

test('F1: ThinkingTranslator translates .cursor-edit block into .agy-ko-thought-wrap and restores cleanly', async () => {
  const createdWraps = [];
  const makeCloneableP = (text) => {
    const attrs = new Map();
    return {
      tagName: 'P',
      nodeType: 1,
      textContent: text,
      innerText: text,
      innerHTML: text,
      style: {},
      childNodes: [{ nodeType: 3, nodeValue: text }],
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      querySelectorAll: () => [],
      closest: () => null,
      cloneNode() {
        return makeCloneableP(this.textContent);
      },
    };
  };
  const pNode = makeCloneableP('Inspecting the renderer bundle carefully.');
  const origInnerDiv = {
    tagName: 'DIV',
    nodeType: 1,
    className: 'leading-relaxed',
    textContent: pNode.textContent,
    innerText: pNode.textContent,
    children: [pNode],
    childNodes: [pNode],
    classList: { contains: () => false },
    querySelectorAll: (sel) => (sel.includes('p') ? [pNode] : []),
    closest: () => null,
  };
  const thoughtHost = {
    tagName: 'DIV',
    nodeType: 1,
    className: 'cursor-edit',
    attrs: new Map(),
    children: [origInnerDiv],
    childNodes: [origInnerDiv],
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    querySelector(sel) {
      if (sel === ':scope > .agy-ko-thought-wrap' || sel === '.agy-ko-thought-wrap') {
        return createdWraps[0] || null;
      }
      return null;
    },
    querySelectorAll: () => [],
    closest: () => null,
    appendChild(el) {
      createdWraps.push(el);
      this.children.push(el);
      el.remove = () => {
        const idx = createdWraps.indexOf(el);
        if (idx !== -1) createdWraps.splice(idx, 1);
      };
      return el;
    },
  };

  const doc = {
    querySelectorAll(sel) {
      if (sel.includes('.cursor-edit')) return [thoughtHost];
      if (sel === '.agy-ko-thought-wrap') return [...createdWraps];
      if (sel.includes('[data-agy-ko-ready]')) return thoughtHost.getAttribute('data-agy-ko-ready') ? [thoughtHost] : [];
      return [];
    },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        nodeType: 1,
        className: '',
        textContent: '',
        style: {},
        children: [],
        childNodes: [],
        attrs: new Map(),
        setAttribute(k, v) { this.attrs.set(k, String(v)); },
        getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
        appendChild(c) {
          c.parentNode = this;
          this.children.push(c);
          this.childNodes.push(c);
          if (c.nodeType === 3) this.textContent += c.nodeValue;
          return c;
        },
        replaceChild(next, prev) {
          const idx = this.children.indexOf(prev);
          if (idx !== -1) {
            next.parentNode = this;
            this.children[idx] = next;
          }
          return prev;
        },
        remove() {},
      };
      return el;
    },
    createTextNode: (t) => ({ nodeType: 3, nodeValue: String(t) }),
  };

  const translator = createAntigravityThinkingTranslator({
    targetDoc: doc,
    catalog: createAntigravityDictionaryCatalog(),
    translationService: {
      getCachedSync: () => null,
      getEpoch: () => 1,
      async translateText() {
        return '렌더러 번들을 주의 깊게 점검하는 중입니다.';
      },
    },
    getTranslateThinkingEnabled: () => true,
    isDisposed: () => false,
    setTimer: (fn) => setTimeout(fn, 5),
    clearTimer: clearTimeout,
  });

  translator.scanThoughtBlocks();
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(thoughtHost.getAttribute('data-agy-ko-ready'), '1');
  assert.equal(createdWraps.length, 1);
  assert.equal(createdWraps[0].children[0].textContent, '렌더러 번들을 주의 깊게 점검하는 중입니다.');

  translator.restoreOriginalCursorEdits();
  assert.equal(thoughtHost.getAttribute('data-agy-ko-ready'), null);
  assert.equal(createdWraps.length, 0);
});

test('F1+F5: guardSessionSwitchTransitions adds no-animations on cascade swap and cleans it up on stop()/dispose()', () => {
  const clsSet = new Set();
  const attrs = new Map([
    ['data-testid', 'conversation-view'],
    ['data-cascade-id', 'cascade-1'],
  ]);
  const convView = {
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    classList: {
      contains: (c) => clsSet.has(c),
      add: (c) => clsSet.add(c),
      remove: (c) => clsSet.delete(c),
    },
    querySelector: () => ({}),
  };
  const doc = {
    querySelectorAll: () => [convView],
  };

  const scheduler = createObserverScheduler({ targetWin: {}, targetDoc: doc, periodicIntervalMs: 0 });
  scheduler.guardSessionSwitchTransitions();
  assert.equal(clsSet.has('no-animations'), false);

  // Switch cascade id -> must apply session-switch guard + no-animations
  attrs.set('data-cascade-id', 'cascade-2');
  scheduler.guardSessionSwitchTransitions();
  assert.equal(attrs.get('data-agy-session-switching'), '1');
  assert.equal(clsSet.has('no-animations'), true);
  assert.equal(attrs.get('data-agy-added-no-animations'), '1');

  // F5: dispose() must immediately clean up no-animations & data-agy-session-switching
  scheduler.dispose();
  assert.equal(attrs.has('data-agy-session-switching'), false);
  assert.equal(clsSet.has('no-animations'), false);
  assert.equal(attrs.has('data-agy-added-no-animations'), false);
});
