'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDisposableRegistry } = require('../../src/core/disposable-registry');
const { resolveAntigravityHostConfig } = require('../../src/adapters/antigravity/host-config-preset');
const { createCspSecurityPort } = require('../../src/remote/csp-security-policy');
const { createAssetUrlRewriter } = require('../../src/remote/asset-url-rewriter');
const { installDomGuards } = require('../../src/remote/dom-guard-installer');

test('DomGuardInstaller: rewrites script.src, link.href, setAttribute, idempotent customElements.define, dark colorScheme, and replays buffered INITIAL_CONFIG MessagePort', async () => {
  const hostCfg = resolveAntigravityHostConfig();
  const disposables = createDisposableRegistry();
  const rootWin = {
    location: {
      origin: 'https://antigravity.google.com',
      href: 'https://antigravity.google.com/r/547d-v2',
    },
    document: { querySelectorAll: () => [] },
  };
  const csp = createCspSecurityPort(hostCfg, rootWin, disposables);
  const assetRewriter = createAssetUrlRewriter({
    hostCfg,
    cspSecurityPort: csp,
    hostOrigin: rootWin.location.origin,
    hostHref: rootWin.location.href,
    basePath: '/web/2.33.0',
    cdnOrigin: 'https://www.gstatic.com/antigravity',
    cdnBaseUrl: 'https://www.gstatic.com/antigravity/web/2.33.0',
  });

  class FakeElement {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this._attrs = new Map();
      this.nonce = '';
      this.style = {};
      this.classList = {
        _s: new Set(),
        add: (...cs) => cs.forEach((c) => this.classList._s.add(c)),
        contains: (c) => this.classList._s.has(c),
      };
    }
    setAttribute(name, value) {
      this._attrs.set(name, String(value));
    }
    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
  }

  class FakeHTMLScriptElement extends FakeElement {
    constructor() {
      super('script');
      this._src = '';
    }
  }
  Object.defineProperty(FakeHTMLScriptElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get() {
      return this._src;
    },
    set(v) {
      this._src = String(v);
      this._attrs.set('src', String(v));
    },
  });

  class FakeHTMLLinkElement extends FakeElement {
    constructor() {
      super('link');
      this._href = '';
    }
  }
  Object.defineProperty(FakeHTMLLinkElement.prototype, 'href', {
    configurable: true,
    enumerable: true,
    get() {
      return this._href;
    },
    set(v) {
      this._href = String(v);
    },
  });

  const definedElements = new Map();
  const winListeners = new Map();

  const cd = {
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === 'script') return new FakeHTMLScriptElement();
      if (t === 'link') return new FakeHTMLLinkElement();
      return new FakeElement(t);
    },
  };

  const cw = {
    Element: FakeElement,
    HTMLScriptElement: FakeHTMLScriptElement,
    HTMLLinkElement: FakeHTMLLinkElement,
    customElements: {
      get(name) {
        return definedElements.get(name);
      },
      define(name, ctor) {
        if (definedElements.has(name)) {
          throw new Error(`CustomElementRegistry: "${name}" already defined`);
        }
        definedElements.set(name, ctor);
      },
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = winListeners.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchMessage(ev) {
      for (const fn of [...(winListeners.get('message') || [])]) {
        fn.call(cw, ev);
      }
    },
  };

  installDomGuards({
    cw,
    cd,
    assetRewriter,
    nonce: 'nonce-dom-guard-1',
    hostTheme: 'dark',
    disposables,
  });

  // 1) Dark theme applied to documentElement
  assert.equal(cd.documentElement.style.colorScheme, 'dark');

  // 2) Script `.src` & `setAttribute('src', ...)` rewrite + nonce stamp + untrusted script rejection
  const s1 = cd.createElement('script');
  s1.src = '/web/2.33.0/chunk_a.js';
  assert.equal(s1.src, 'https://www.gstatic.com/antigravity/web/2.33.0/chunk_a.js');
  assert.equal(s1.nonce, 'nonce-dom-guard-1');

  const s2 = cd.createElement('script');
  s2.setAttribute('src', './chunk_b.js');
  assert.equal(s2.getAttribute('src'), 'https://www.gstatic.com/antigravity/web/2.33.0/chunk_b.js');
  assert.equal(s2.nonce, 'nonce-dom-guard-1');

  const sEvil = cd.createElement('script');
  assert.throws(() => {
    sEvil.src = 'https://evil.example/steal.js';
  }, TypeError);

  // 3) Link `.href` & `setAttribute('href', ...)` rewrite
  const l1 = cd.createElement('link');
  l1.href = '/web/2.33.0/jetbox.css';
  assert.equal(l1.href, 'https://www.gstatic.com/antigravity/web/2.33.0/jetbox.css');

  // 4) Idempotent `customElements.define` does not throw on duplicate registration
  class MyWidget {}
  cw.customElements.define('x-jetski-widget', MyWidget);
  assert.doesNotThrow(() => cw.customElements.define('x-jetski-widget', class DuplicateWidget {}));
  assert.equal(cw.customElements.get('x-jetski-widget'), MyWidget);

  // 5) Early `INITIAL_CONFIG` MessageEvent with transferred MessagePort is buffered BEFORE main.js registers listener, then replayed!
  const mc = new MessageChannel();
  cw.dispatchMessage({
    type: 'message',
    data: { type: 'INITIAL_CONFIG', portSessionId: 'rc-1' },
    ports: [mc.port2],
  });

  const received = [];
  cw.addEventListener('message', (ev) => {
    received.push({ data: ev.data, portCount: ev.ports.length });
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(received.length, 1);
  assert.equal(received[0].data.type, 'INITIAL_CONFIG');
  assert.equal(received[0].portCount, 1);
  mc.port1.close();
  mc.port2.close();

  // Full restore cleans up prototype guards
  disposables.disposeAll(true);
  assert.equal(cw.__remoteDomGuardsInstalled, undefined);
});
