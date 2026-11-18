'use strict';

/**
 * Authentic Angular 19 LView / TView / TNode + `default_GoogleAntigravity`
 * fixture representing `<ga-remote-control>` on `/r/...-v2`.
 */

function createSignal(initialValue, onChange) {
  let current = initialValue;
  const sig = () => current;
  sig.set = (next) => {
    current = next;
    if (typeof onChange === 'function') onChange(current);
  };
  sig.update = (fn) => {
    current = fn(current);
    if (typeof onChange === 'function') onChange(current);
  };
  return sig;
}

function encodeJsonUtf8(obj) {
  return new Uint8Array(Buffer.from(JSON.stringify(obj), 'utf8'));
}

function createBoqJetskiLViewFixture(options = {}) {
  const {
    iframeSrc = 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true',
    instanceUuid = '547d3ff8-7d19-415f-a68a-9bbf28c06f6f-v2',
    csrfToken = '',
    stripNgContext = false,
    installedPlugins = [],
    disabledPluginIds = [],
    companionBundles = {},
    homeDirUri = 'file:///C:/Users/TestUser',
    appDataDir = 'antigravity',
  } = options;

  const iframeListeners = new Map();
  const iframeAttrs = new Map([['src', iframeSrc]]);
  let iframePropSrc = iframeSrc;

  class FakeHTMLIFrameElement {
    constructor() {
      this.tagName = 'IFRAME';
      this.nodeType = 1;
      this.classList = {
        _set: new Set(['hub-frame']),
        contains(cls) {
          return this._set.has(cls);
        },
        add(cls) {
          this._set.add(cls);
        },
        remove(cls) {
          this._set.delete(cls);
        },
        toggle(cls, force) {
          const shouldHave = force !== undefined ? Boolean(force) : !this._set.has(cls);
          if (shouldHave) this._set.add(cls);
          else this._set.delete(cls);
        },
      };
      this.contentWindow = options.contentWindow || null;
      this.contentDocument = options.contentDocument || null;
    }
    getAttribute(name) {
      return iframeAttrs.has(name) ? iframeAttrs.get(name) : null;
    }
    setAttribute(name, val) {
      const s = String(val);
      iframeAttrs.set(name, s);
      if (name === 'src') iframePropSrc = s;
    }
    removeAttribute(name) {
      iframeAttrs.delete(name);
    }
    addEventListener(type, fn) {
      if (!iframeListeners.has(type)) iframeListeners.set(type, []);
      iframeListeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const arr = iframeListeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
    dispatchLoad() {
      const arr = [...(iframeListeners.get('load') || [])];
      for (const fn of arr) fn({ type: 'load', target: this });
    }
  }

  Object.defineProperty(FakeHTMLIFrameElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get() {
      return iframePropSrc;
    },
    set(val) {
      iframePropSrc = String(val);
      iframeAttrs.set('src', iframePropSrc);
    },
  });

  const iframeEl = new FakeHTMLIFrameElement();

  const appContainerEl = {
    tagName: 'DIV',
    nodeType: 1,
    className: 'app-container',
    firstElementChild: iframeEl,
  };

  const rcHostEl = {
    tagName: 'GA-REMOTE-CONTROL',
    nodeType: 1,
    firstElementChild: appContainerEl,
    querySelector(sel) {
      if (sel.includes('iframe')) return iframeEl;
      if (sel.includes('.app-container')) return appContainerEl;
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes('iframe')) return [iframeEl];
      return [];
    },
  };

  const gaRootEl = {
    tagName: 'GA-ROOT',
    nodeType: 1,
    firstElementChild: rcHostEl,
    querySelector(sel) {
      if (sel === 'ga-remote-control') return rcHostEl;
      return rcHostEl.querySelector(sel);
    },
  };

  const rpcCalls = [];

  class RemoteControlComponent {
    constructor() {
      this.hubFrame = { nativeElement: iframeEl };
      this.iframeSrc = createSignal(iframeSrc);
      this.iframeLoading = createSignal(false);
      this.iframeUiReady = createSignal(true);
      this.iframeReportedReady = createSignal(true);
      this.selectedInstanceUuid = createSignal(instanceUuid);
      this.instances = createSignal([
        {
          uuid: instanceUuid,
          status: 1,
          metadata: { name: 'Dev-Workstation', version: '2.33.0-v2', ...(csrfToken ? { csrfToken } : {}) },
        },
      ]);
      this.onIframeLoadCalls = 0;
      if (csrfToken) {
        this.csrfToken = csrfToken;
      }
    }

    async onIframeLoad() {
      this.onIframeLoadCalls += 1;
      this.iframeLoading.set(false);
    }

    async proxyCommand(rpcPath, bodyBytes, headers = {}) {
      let parsedReq = {};
      if (bodyBytes) {
        try {
          const buf = Buffer.isBuffer(bodyBytes) ? bodyBytes : Buffer.from(bodyBytes);
          parsedReq = JSON.parse(buf.toString('utf8'));
        } catch (_err) {}
      }
      rpcCalls.push({ rpcPath, req: parsedReq, headers });

      if (rpcPath.endsWith('/GetLocalUserInfo')) {
        return { payload: encodeJsonUtf8({ homeDirUri, username: 'TestUser' }) };
      }
      if (rpcPath.endsWith('/GetServerConfiguration')) {
        return { payload: encodeJsonUtf8({ config: { appDataDir } }) };
      }
      if (rpcPath.endsWith('/GetAllPlugins')) {
        return { payload: encodeJsonUtf8({ plugins: installedPlugins }) };
      }
      if (rpcPath.endsWith('/GetAllSkills')) {
        return { payload: encodeJsonUtf8({ skills: [] }) };
      }
      if (rpcPath.endsWith('/GetCustomizationStates')) {
        const states = disabledPluginIds.map((id) => ({ id, enabled: false }));
        return { payload: encodeJsonUtf8({ states }) };
      }
      if (rpcPath.endsWith('/ReadFile')) {
        const reqPath = String(parsedReq.path || parsedReq.filePath || parsedReq.uri || '').replace(/\\/g, '/');
        const matchedKey = Object.keys(companionBundles).find((k) => reqPath.endsWith(k));
        const rawText = matchedKey ? companionBundles[matchedKey] : '';
        return {
          payload: encodeJsonUtf8({
            content: rawText ? Buffer.from(rawText, 'utf8').toString('base64') : '',
          }),
        };
      }
      return { payload: encodeJsonUtf8({}) };
    }
  }

  const rcInstance = new RemoteControlComponent();

  // Authentic Angular 19 LView array: [0]=HOST, [1]=TVIEW, [8]=CONTEXT
  const tNode = { tagName: 'ga-remote-control', index: 20 };
  const tView = { type: 1, data: [tNode] };
  const lView = new Array(24).fill(null);
  lView[0] = rcHostEl;
  lView[1] = tView;
  lView[8] = rcInstance;

  if (!stripNgContext) {
    rcHostEl.__ngContext__ = 42;
    appContainerEl.__ngContext__ = lView;
    iframeEl.__ngContext__ = lView;
  }

  const fakeDoc = {
    documentElement: { tagName: 'HTML', nodeType: 1 },
    head: {
      tagName: 'HEAD',
      nodeType: 1,
      children: [],
      appendChild(el) {
        this.children.push(el);
        el.parentNode = this;
        return el;
      },
    },
    body: {
      tagName: 'BODY',
      nodeType: 1,
      children: [gaRootEl],
      appendChild(el) {
        this.children.push(el);
        el.parentNode = this;
        return el;
      },
    },
    querySelector(sel) {
      if (sel === 'ga-remote-control') return rcHostEl;
      if (sel === 'ga-root') return gaRootEl;
      return gaRootEl.querySelector(sel);
    },
    querySelectorAll(sel) {
      if (sel === 'ga-remote-control') return [rcHostEl];
      if (sel.includes('iframe')) return [iframeEl];
      return [];
    },
    createElement(tag) {
      const attrs = new Map();
      const el = {
        tagName: String(tag).toUpperCase(),
        nodeType: 1,
        text: '',
        textContent: '',
        nonce: '',
        parentNode: null,
        setAttribute(k, v) {
          attrs.set(k, String(v));
          if (k === 'nonce') this.nonce = String(v);
        },
        getAttribute(k) {
          return attrs.has(k) ? attrs.get(k) : null;
        },
        remove() {
          if (this.parentNode && Array.isArray(this.parentNode.children)) {
            const idx = this.parentNode.children.indexOf(this);
            if (idx >= 0) this.parentNode.children.splice(idx, 1);
          }
          this.parentNode = null;
        },
      };
      return el;
    },
  };

  const fakeWin = {
    HTMLIFrameElement: FakeHTMLIFrameElement,
    location: {
      href: `https://antigravity.google.com/r/${instanceUuid}`,
      origin: 'https://antigravity.google.com',
      hostname: 'antigravity.google.com',
      pathname: `/r/${instanceUuid}`,
      protocol: 'https:',
    },
    document: fakeDoc,
    default_GoogleAntigravity: {
      cF: {
        RemoteControlComponent,
        getComponent(el) {
          return el === rcHostEl ? rcInstance : null;
        },
        activeViews: {
          primaryHolder: {
            hostNode: rcHostEl,
            componentRef: { instance: rcInstance, location: { nativeElement: rcHostEl } },
          },
        },
      },
    },
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    TextDecoder,
    TextEncoder,
    Uint8Array,
  };

  return {
    fakeWin,
    fakeDoc,
    gaRootEl,
    rcHostEl,
    appContainerEl,
    iframeEl,
    rcInstance,
    lView,
    rpcCalls,
    RemoteControlComponent,
  };
}

module.exports = {
  createBoqJetskiLViewFixture,
};
