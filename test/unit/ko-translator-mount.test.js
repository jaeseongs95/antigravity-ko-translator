'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createKoTranslator, STYLE_ID } = require('../../src/runtime/bootstrap');

function createMinimalMockDom() {
  const elementsById = new Map();
  const listeners = new Map();
  const styleElList = [];
  const head = {
    appendChild(el) {
      styleElList.push(el);
      if (el.id) elementsById.set(el.id, el);
      el.remove = () => {
        if (el.id) elementsById.delete(el.id);
      };
    },
  };
  const docEl = {
    attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
  };
  const doc = {
    head,
    body: {
      nodeType: 1,
      querySelectorAll: () => [],
    },
    documentElement: docEl,
    getElementById: (id) => elementsById.get(id) || null,
    createElement: (tag) => ({
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      style: {},
      remove() {},
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  const lsMap = new Map();
  const win = {
    document: doc,
    localStorage: {
      getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
      setItem: (k, v) => lsMap.set(String(k), String(v)),
      removeItem: (k) => lsMap.delete(k),
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    MutationObserver: class MockMO {
      observe() {}
      disconnect() {}
      takeRecords() { return []; }
    },
  };
  return { win, doc, listeners, elementsById };
}

test('createKoTranslator supports start(), updateSettings(), getStatus(), and clean dispose()', () => {
  const { win, doc, listeners, elementsById } = createMinimalMockDom();
  const statusEvents = [];
  const translator = createKoTranslator({
    win,
    doc,
    settings: {
      enabled: true,
      translateThinking: true,
      showThinking: true,
      translateStaticUi: true,
      provider: 'google-translate',
    },
    fetchFn: async () => ({ ok: true, json: async () => [[['테스트']]] }),
    onStatus: (st) => statusEvents.push(st),
  });

  const st1 = translator.start();
  assert.equal(st1.started, true);
  assert.equal(st1.disposed, false);
  assert.equal(st1.provider, 'google-translate');
  assert.ok(elementsById.has(STYLE_ID));
  assert.equal(listeners.has('click'), true);

  const st2 = translator.updateSettings({ showThinking: false, provider: 'local-llm' });
  assert.equal(st2.showThinking, false);
  assert.equal(st2.provider, 'local-llm');
  assert.equal(doc.documentElement.getAttribute('data-agy-hide-thinking'), '1');

  translator.dispose();
  assert.equal(translator.getStatus().disposed, true);
  assert.equal(elementsById.has(STYLE_ID), false);
  assert.equal(listeners.has('click'), false);
  assert.equal(doc.documentElement.getAttribute('data-agy-hide-thinking'), null);
  assert.ok(statusEvents.length >= 3);
});
