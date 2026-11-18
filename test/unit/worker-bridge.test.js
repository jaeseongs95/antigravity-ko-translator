'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createDisposableRegistry } = require('../../src/core/disposable-registry');
const { resolveAntigravityHostConfig } = require('../../src/adapters/antigravity/host-config-preset');
const { createCspSecurityPort } = require('../../src/remote/csp-security-policy');
const { createAssetUrlRewriter } = require('../../src/remote/asset-url-rewriter');
const { createAntigravityRemoteCompanionSync } = require('../../src/adapters/antigravity/remote-companion-sync');
const { installWorkerBridge } = require('../../src/remote/worker-bridge');

function buildIframeBackedWorkerEnv(scriptMap) {
  const hostCfg = resolveAntigravityHostConfig();
  const disposables = createDisposableRegistry();
  const rootWin = {
    location: {
      origin: 'https://antigravity.google.com',
      href: 'https://antigravity.google.com/r/547d-v2',
    },
    document: { querySelectorAll: () => [] },
  };
  const cspSecurityPort = createCspSecurityPort(hostCfg, rootWin, disposables);
  const assetRewriter = createAssetUrlRewriter({
    hostCfg,
    cspSecurityPort,
    hostOrigin: rootWin.location.origin,
    hostHref: rootWin.location.href,
    basePath: '/web/2.33.0',
    cdnOrigin: 'https://www.gstatic.com/antigravity',
    cdnBaseUrl: 'https://www.gstatic.com/antigravity/web/2.33.0',
  });
  const remoteHostPort = createAntigravityRemoteCompanionSync({
    targetWin: rootWin,
    targetDoc: rootWin.document,
    hostCfg,
    disposables,
  });

  const openCalls = [];
  const closeCalls = [];
  const attachedWorkerFrames = [];

  class FakeXMLHttpRequest {
    open(method, url, asyncFlag) {
      this._method = method;
      this._url = url;
      this._async = asyncFlag;
      this.status = 0;
      this.responseText = '';
    }
    send() {
      if (Object.prototype.hasOwnProperty.call(scriptMap, this._url)) {
        this.status = 200;
        this.responseText = scriptMap[this._url];
      } else {
        this.status = 404;
        this.responseText = 'Not Found';
      }
    }
  }

  function createHiddenWorkerFrame() {
    let frameHref = 'about:blank';
    const ctxObj = {
      console,
      URL,
      Blob,
      AbortController,
      MessageChannel,
      MessageEvent,
      Event,
      ErrorEvent: typeof ErrorEvent === 'function' ? ErrorEvent : Error,
      XMLHttpRequest: FakeXMLHttpRequest,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      location: {
        get href() {
          return frameHref;
        },
        get origin() {
          return frameHref === 'about:blank' ? 'null' : 'https://antigravity.google.com';
        },
      },
      async fetch(url, init) {
        if (init && init.signal && init.signal.aborted) {
          throw new Error('Aborted');
        }
        if (Object.prototype.hasOwnProperty.call(scriptMap, url)) {
          const textVal = scriptMap[url];
          return {
            ok: true,
            status: 200,
            async text() {
              return textVal;
            },
          };
        }
        return {
          ok: false,
          status: 404,
          async text() {
            return '';
          },
        };
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
    };

    const vmCtx = vm.createContext(ctxObj);
    ctxObj.window = vmCtx;
    ctxObj.self = vmCtx;
    ctxObj.globalThis = vmCtx;
    ctxObj.parent = rootWin;

    const wDoc = {
      defaultView: vmCtx,
      head: {
        appendChild(el) {
          if (el.tagName === 'SCRIPT' && el.text) {
            vm.runInContext(el.text, vmCtx);
          }
          return el;
        },
      },
      body: {
        appendChild(el) {
          if (el.tagName === 'SCRIPT' && el.text) {
            vm.runInContext(el.text, vmCtx);
          }
          return el;
        },
      },
      open(...args) {
        openCalls.push(args.length);
        frameHref = rootWin.location.href;
      },
      close(...args) {
        closeCalls.push(args.length);
      },
      createElement(tag) {
        const t = String(tag).toUpperCase();
        if (t === 'IFRAME') {
          return createHiddenWorkerFrame();
        }
        return {
          tagName: t,
          text: '',
          nonce: '',
          setAttribute() {},
          remove() {},
        };
      },
    };
    ctxObj.document = wDoc;

    const frameEl = {
      tagName: 'IFRAME',
      parentNode: null,
      contentWindow: vmCtx,
      contentDocument: wDoc,
      setAttribute() {},
      remove() {
        const idx = attachedWorkerFrames.indexOf(frameEl);
        if (idx >= 0) attachedWorkerFrames.splice(idx, 1);
        this.parentNode = null;
      },
    };
    return frameEl;
  }

  class FallbackNativeWorker {
    constructor(url) {
      this.nativeUrl = url;
    }
  }

  const cd = {
    body: {
      appendChild(el) {
        el.parentNode = cd.body;
        if (el.tagName === 'IFRAME') attachedWorkerFrames.push(el);
        return el;
      },
      removeChild(el) {
        el.remove();
      },
    },
    createElement(tag) {
      if (String(tag).toUpperCase() === 'IFRAME') {
        return createHiddenWorkerFrame();
      }
      return { tagName: String(tag).toUpperCase(), setAttribute() {} };
    },
  };

  const cw = {
    Worker: FallbackNativeWorker,
    MessageChannel,
    MessageEvent,
    XMLHttpRequest: FakeXMLHttpRequest,
    location: rootWin.location,
    async fetch(url, init) {
      if (init && init.signal && init.signal.aborted) throw new Error('Aborted');
      if (Object.prototype.hasOwnProperty.call(scriptMap, url)) {
        return {
          ok: true,
          status: 200,
          async text() {
            return scriptMap[url];
          },
        };
      }
      return { ok: false, status: 404, async text() { return ''; } };
    },
  };

  return {
    cw,
    cd,
    rootWin,
    assetRewriter,
    cspSecurityPort,
    remoteHostPort,
    disposables,
    openCalls,
    closeCalls,
    attachedWorkerFrames,
  };
}

test('WorkerBridge: preserves v2 peer-adapted Worker (`isWorkerAlreadyAdapted`) while upgrading legacy v1 peer Worker with clean restore', () => {
  const env = buildIframeBackedWorkerEnv({});
  function PeerAdaptedWorkerV2() {
    return 'bridgeDepth';
  }
  PeerAdaptedWorkerV2.__agyWorkerAdapted = true;
  env.cw.Worker = PeerAdaptedWorkerV2;

  installWorkerBridge(env);
  assert.equal(env.cw.Worker, PeerAdaptedWorkerV2, 'v2 Peer AdaptedWorker must remain untouched');
  assert.equal(Boolean(env.cw.Worker.__agyWorkerPatched), false);

  const envLegacy = buildIframeBackedWorkerEnv({});
  function LegacyV1AdaptedWorker(scriptURL) {
    return { isNativeTrustedUrlObject: Boolean(scriptURL) };
  }
  LegacyV1AdaptedWorker.__agyWorkerAdapted = true;
  envLegacy.cw.Worker = LegacyV1AdaptedWorker;

  installWorkerBridge(envLegacy);
  assert.notEqual(envLegacy.cw.Worker, LegacyV1AdaptedWorker, 'Legacy v1 AdaptedWorker must be upgraded to v2 bridge');
  assert.equal(Boolean(envLegacy.cw.Worker.__agyWorkerPatched), true);
  assert.equal(Boolean(envLegacy.cw.Worker.__agyWorkerBridgeV2), true);

  envLegacy.disposables.disposeAll(false);
  assert.equal(envLegacy.cw.Worker, LegacyV1AdaptedWorker, 'Disposing v2 bridge must restore peer Worker');
});

test('WorkerBridge: hidden iframe 0-arg open()/close(), classic importScripts sync rethrow, ESM Worker, and cascading child termination', async () => {
  const cdn = 'https://www.gstatic.com/antigravity/web/2.33.0';
  const env = buildIframeBackedWorkerEnv({
    [`${cdn}/helper.js`]: 'self.__helperLoaded = "OK_HELPER";',
    [`${cdn}/bad_helper.js`]: 'throw new RangeError("HELPER_SYNC_BOOM");',
    [`${cdn}/classic_worker.js`]: [
      'importScripts("./helper.js");',
      'let caughtSyncErr = "";',
      'try { importScripts("./bad_helper.js"); } catch (e) { caughtSyncErr = e.message; }',
      'const sub = new Worker("./sub_worker.js");',
      'self.addEventListener("message", (ev) => {',
      '  self.postMessage({ echo: ev.data, helper: self.__helperLoaded, caughtSyncErr, href: location.href });',
      '});',
    ].join('\n'),
    [`${cdn}/sub_worker.js`]: 'self.onmessage = (e) => self.postMessage(e.data);',
    [`${cdn}/esm_dep.js`]: 'export const tag = "ESM_BRIDGE_OK";',
    [`${cdn}/esm_worker.js`]: [
      'import { tag } from "./esm_dep.js";',
      'self.addEventListener("message", (ev) => {',
      '  self.postMessage({ echo: ev.data, tag, href: location.href });',
      '});',
    ].join('\n'),
  });

  installWorkerBridge(env);
  assert.equal(Boolean(env.cw.Worker.__agyWorkerPatched), true);

  // Untrusted origin worker MUST fail closed synchronously with TypeError
  assert.throws(() => new env.cw.Worker('https://evil.example/pwn.js'), TypeError);

  // Classic worker + nested sub-worker + synchronous importScripts error propagation
  const classicReply = await new Promise((resolve, reject) => {
    const w = new env.cw.Worker('/web/2.33.0/classic_worker.js');
    const timer = setTimeout(() => reject(new Error('Classic worker timeout')), 3000);
    w.addEventListener('message', (ev) => {
      clearTimeout(timer);
      resolve({ worker: w, data: ev.data });
    });
    w.postMessage('hello-classic');
  });

  assert.equal(classicReply.data.echo, 'hello-classic');
  assert.equal(classicReply.data.helper, 'OK_HELPER');
  assert.equal(classicReply.data.caughtSyncErr, 'HELPER_SYNC_BOOM');
  assert.equal(classicReply.data.href, `${cdn}/classic_worker.js`);
  assert.equal(env.openCalls.every((n) => n === 0), true, '0-arg wDoc.open() required');
  assert.equal(env.closeCalls.every((n) => n === 0), true, '0-arg wDoc.close() required');

  // Terminate outer worker -> cleans up frame & childWorkers
  classicReply.worker.terminate();
  assert.equal(env.attachedWorkerFrames.length, 0, 'Outer worker frame must detach on terminate()');

  // Module worker (`{ type: 'module' }`)
  const esmData = await new Promise((resolve, reject) => {
    const mw = new env.cw.Worker('./esm_worker.js', { type: 'module' });
    const timer = setTimeout(() => reject(new Error('ESM worker timeout')), 3000);
    mw.onmessage = (ev) => {
      clearTimeout(timer);
      mw.terminate();
      resolve(ev.data);
    };
    mw.postMessage('hello-esm');
  });

  assert.equal(esmData.echo, 'hello-esm');
  assert.equal(esmData.tag, 'ESM_BRIDGE_OK');
  assert.equal(esmData.href, `${cdn}/esm_worker.js`);
});
