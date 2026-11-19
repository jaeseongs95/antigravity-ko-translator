'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createKoTranslator, STYLE_ID } = require('../../src/runtime/bootstrap');

function createRealLikeDom() {
  const elementsById = new Map();
  const listeners = new Map();
  const observers = [];

  class FakeNode {
    constructor(nodeType, nodeValue = null) {
      this.nodeType = nodeType;
      this.nodeValue = nodeValue;
      this.parentNode = null;
      this.parentElement = null;
      this.childNodes = [];
    }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue || '';
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(val) {
      if (this.nodeType === 3) {
        this.nodeValue = String(val);
        return;
      }
      this.childNodes = [];
      if (val !== '' && val !== null && val !== undefined) {
        this.appendChild(new FakeNode(3, String(val)));
      }
    }
    appendChild(child) {
      child.parentNode = this;
      child.parentElement = this.nodeType === 1 ? this : null;
      this.childNodes.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }
    insertBefore(child, ref) {
      child.parentNode = this;
      child.parentElement = this.nodeType === 1 ? this : null;
      const idx = ref ? this.childNodes.indexOf(ref) : -1;
      if (idx === -1) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }
    remove() {
      if (this.id) elementsById.delete(this.id);
      if (this.parentNode) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx !== -1) this.parentNode.childNodes.splice(idx, 1);
      }
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
  }

  class FakeElement extends FakeNode {
    constructor(tagName) {
      super(1, null);
      this.tagName = String(tagName).toUpperCase();
      this.id = '';
      this.attrs = new Map();
      this.style = {};
      this.classList = {
        _set: new Set(),
        add: (...cls) => cls.forEach((c) => this.classList._set.add(c)),
        remove: (...cls) => cls.forEach((c) => this.classList._set.delete(c)),
        contains: (c) => this.classList._set.has(c),
        toggle: (c, force) => {
          if (force === true) this.classList._set.add(c);
          else if (force === false) this.classList._set.delete(c);
          else if (this.classList._set.has(c)) this.classList._set.delete(c);
          else this.classList._set.add(c);
        },
      };
    }
    get className() {
      return Array.from(this.classList._set).join(' ');
    }
    set className(val) {
      this.classList._set = new Set(String(val || '').split(/\s+/).filter(Boolean));
    }
    get attributes() {
      return Array.from(this.attrs.entries()).map(([name, value]) => ({ name, value }));
    }
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1);
    }
    get innerText() {
      return this.textContent;
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === 'id') {
        this.id = String(v);
        elementsById.set(this.id, this);
      }
      if (k === 'class') this.className = String(v);
    }
    getAttribute(k) {
      if (k === 'class') return this.className || null;
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
    matches(selector) {
      const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
      return parts.some((part) => {
        if (part.startsWith('.')) return this.classList.contains(part.slice(1));
        if (part.startsWith('#')) return this.id === part.slice(1);
        const attrMatch = part.match(/^([a-z0-9_-]*)\[([^\]=]+)(?:="([^"]*)")?\]$/i);
        if (attrMatch) {
          const [, tag, attr, val] = attrMatch;
          if (tag && this.tagName !== tag.toUpperCase()) return false;
          if (val !== undefined) return this.getAttribute(attr) === val;
          return this.attrs.has(attr);
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
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    cloneNode(deep = false) {
      const copy = new FakeElement(this.tagName);
      copy.className = this.className;
      for (const [k, v] of this.attrs.entries()) copy.attrs.set(k, v);
      if (deep) {
        for (const c of this.childNodes) {
          copy.appendChild(c.nodeType === 3 ? new FakeNode(3, c.nodeValue) : c.cloneNode(true));
        }
      }
      return copy;
    }
  }

  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const doc = {
    head,
    body,
    documentElement,
    getElementById: (id) => elementsById.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (t) => new FakeNode(3, String(t)),
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
    createTreeWalker(root, whatToShow, filter = null) {
      const list = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1 && filter && typeof filter.acceptNode === 'function') {
            const verdict = filter.acceptNode(c);
            if (verdict === 2) continue; // FILTER_REJECT: prune subtree
            if (verdict === 1 && (whatToShow & 1)) list.push(c);
            walk(c);
            continue;
          }
          if (c.nodeType === 3 && (whatToShow & 4)) {
            if (!filter || typeof filter.acceptNode !== 'function' || filter.acceptNode(c) === 1) {
              list.push(c);
            }
          }
          walk(c);
        }
      };
      walk(root);
      let idx = -1;
      return {
        nextNode() {
          idx += 1;
          return idx < list.length ? list[idx] : null;
        },
      };
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };

  class RealLikeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.active = false;
      this.target = null;
      observers.push(this);
    }
    observe(target) {
      this.active = true;
      this.target = target;
    }
    disconnect() {
      this.active = false;
    }
    takeRecords() {
      return [];
    }
    trigger(mutations) {
      if (this.active) this.cb(mutations);
    }
  }

  const lsMap = new Map();
  const win = {
    document: doc,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    NodeFilter: { SHOW_TEXT: 4 },
    localStorage: {
      getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
      setItem: (k, v) => lsMap.set(String(k), String(v)),
      removeItem: (k) => lsMap.delete(k),
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    MutationObserver: RealLikeMutationObserver,
  };

  return { win, doc, listeners, elementsById, observers, FakeElement, FakeNode };
}

test('F1+F2+F4: createKoTranslator translates static UI + Thinking blocks with lastError===null and reacts to live MutationObserver mutations', async () => {
  const { win, doc, listeners, elementsById, observers } = createRealLikeDom();

  // Mount a static UI button ("Settings") and a conversation view
  const convView = doc.createElement('div');
  convView.setAttribute('data-testid', 'conversation-view');
  const settingsBtn = doc.createElement('button');
  settingsBtn.appendChild(doc.createTextNode('Settings'));
  convView.appendChild(settingsBtn);
  doc.body.appendChild(convView);

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
    fetchFn: async () => ({ ok: true, json: async () => [[['추론 번역 결과']]] }),
    onStatus: (st) => statusEvents.push(st),
  });

  try {
    const st1 = translator.start();
    assert.equal(st1.started, true);
    assert.equal(st1.disposed, false);
    assert.equal(st1.lastError, null, 'start() / scanAll() must complete with zero swallowed errors');
    assert.ok(elementsById.has(STYLE_ID));
    assert.equal(listeners.has('click'), true);
    assert.equal(settingsBtn.textContent, '설정', 'Static UI label must actually be localized in DOM');

    // F2: Live MutationObserver reaction when a new UI node is appended
    const liveLabel = doc.createElement('span');
    liveLabel.appendChild(doc.createTextNode('Thinking'));
    convView.appendChild(liveLabel);
    assert.ok(observers.length >= 1 && observers[0].active, 'MutationObserver must be actively observing');
    observers[0].trigger([{ type: 'childList', target: convView, addedNodes: [liveLabel], removedNodes: [] }]);

    // Wait for microtask fast-pass
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(liveLabel.textContent, '생각하는 중', 'MutationObserver must trigger live localization of newly added nodes');
    assert.equal(translator.getStatus().lastError, null);
  } finally {
    translator.dispose();
  }
  assert.equal(translator.getStatus().disposed, true);
  assert.equal(elementsById.has(STYLE_ID), false);
  assert.equal(listeners.has('click'), false);
  assert.equal(observers[0].active, false);
  assert.equal(settingsBtn.textContent, 'Settings', 'dispose() must restore original UI text');
  assert.ok(statusEvents.length >= 2);
});

test('F3: start() with enabled:false activates observer & listeners cleanly when updateSettings({ enabled: true }) is called later', async () => {
  const { win, doc, listeners, observers } = createRealLikeDom();
  const label = doc.createElement('span');
  label.appendChild(doc.createTextNode('Settings'));
  doc.body.appendChild(label);

  const translator = createKoTranslator({
    win,
    doc,
    settings: { enabled: false, translateStaticUi: true, provider: 'google-translate' },
    fetchFn: async () => ({ ok: true, json: async () => [[['테스트']]] }),
  });

  try {
    const st0 = translator.start();
    assert.equal(st0.started, true);
    assert.equal(st0.enabled, false);
    assert.equal(listeners.has('click'), false);
    assert.equal(observers.length, 0);
    assert.equal(label.textContent, 'Settings');

    // Now enable dynamically via updateSettings
    const st1 = translator.updateSettings({ enabled: true });
    assert.equal(st1.enabled, true);
    assert.equal(st1.lastError, null);
    assert.equal(listeners.has('click'), true);
    assert.equal(observers.length, 1);
    assert.equal(observers[0].active, true);
    assert.equal(label.textContent, '설정');

    // Disable again -> pauses observer & restores DOM
    const st2 = translator.updateSettings({ enabled: false });
    assert.equal(st2.enabled, false);
    assert.equal(observers[0].active, false);
    assert.equal(label.textContent, 'Settings');
  } finally {
    translator.dispose();
  }
});
