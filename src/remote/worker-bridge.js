'use strict';

const { rewriteWorkerGlobalBindings, buildEsModuleGraphBundle } = require('./js-module-compiler');

function installWorkerBridge({
  cw,
  cd,
  rootWin,
  assetRewriter,
  cspSecurityPort,
  remoteHostPort,
  disposables,
}) {
  if (!cw || !cd || typeof cw.Worker !== 'function') return () => {};
  if (remoteHostPort && remoteHostPort.isWorkerAlreadyAdapted(cw.Worker)) {
    return () => {};
  }

  const OrigWorker = cw.Worker;
  const hostOrigin = (() => {
    try {
      const w = rootWin || cw;
      return w && w.location && w.location.origin && w.location.origin !== 'null' ? w.location.origin : '';
    } catch (_err) {
      return '';
    }
  })();

  function mountIframeBackedWorker(targetWorkerUrl, options) {
    if (typeof cw.MessageChannel !== 'function' || !cd) return null;
    const container = cd.body || cd.documentElement;
    if (!container || typeof container.appendChild !== 'function' || typeof cd.createElement !== 'function') {
      return null;
    }

    let wf = null;
    try {
      wf = cd.createElement('iframe');
      if (!wf) return null;
      if (typeof wf.setAttribute === 'function') {
        wf.setAttribute('aria-hidden', 'true');
        wf.setAttribute('tabindex', '-1');
        wf.setAttribute('data-remote-worker-frame', '1');
        wf.setAttribute(
          'style',
          'display:none!important;width:0!important;height:0!important;border:0!important;'
        );
      }
      container.appendChild(wf);
      let wWin = wf.contentWindow;
      let wDoc = wf.contentDocument;
      if (!wWin || !wDoc) {
        if (typeof wf.remove === 'function') wf.remove();
        else if (wf.parentNode) wf.parentNode.removeChild(wf);
        return null;
      }

      // WHATWG 0-arg document.open()/close() so wWin.location inherits same-origin https: URL
      if (wWin.location && wWin.location.href === 'about:blank' && typeof wDoc.open === 'function') {
        try {
          wDoc.open();
          if (typeof wDoc.close === 'function') wDoc.close();
          wWin = wf.contentWindow || wWin;
          wDoc = wf.contentDocument || wDoc;
        } catch (_err) {}
      }

      const mc = new cw.MessageChannel();
      const hostPort = mc.port1;
      const workerPort = mc.port2;
      let terminated = false;
      const childWorkers = new Set();
      const abortCtrl = typeof AbortController === 'function' ? new AbortController() : null;

      const outerListeners = {
        message: new Set(),
        error: new Set(),
        messageerror: new Set(),
      };
      let outerOnMessage = null;
      let outerOnError = null;
      let outerOnMessageError = null;

      const workerFacade = Object.create(OrigWorker.prototype);
      Object.defineProperties(workerFacade, {
        url: { configurable: true, enumerable: true, value: targetWorkerUrl },
        onmessage: {
          configurable: true,
          enumerable: true,
          get: () => outerOnMessage,
          set: (fn) => {
            outerOnMessage = typeof fn === 'function' ? fn : null;
          },
        },
        onerror: {
          configurable: true,
          enumerable: true,
          get: () => outerOnError,
          set: (fn) => {
            outerOnError = typeof fn === 'function' ? fn : null;
          },
        },
        onmessageerror: {
          configurable: true,
          enumerable: true,
          get: () => outerOnMessageError,
          set: (fn) => {
            outerOnMessageError = typeof fn === 'function' ? fn : null;
          },
        },
      });

      workerFacade.addEventListener = function addEventListener(type, listener) {
        const set = outerListeners[String(type || '').toLowerCase()];
        if (set && typeof listener === 'function') set.add(listener);
      };
      workerFacade.removeEventListener = function removeEventListener(type, listener) {
        const set = outerListeners[String(type || '').toLowerCase()];
        if (set && typeof listener === 'function') set.delete(listener);
      };
      workerFacade.dispatchEvent = function dispatchEvent(ev) {
        if (!ev || !ev.type) return false;
        const typeLower = String(ev.type).toLowerCase();
        const propHandler = workerFacade[`on${typeLower}`];
        if (typeof propHandler === 'function') propHandler.call(workerFacade, ev);
        const set = outerListeners[typeLower];
        if (set) {
          for (const fn of Array.from(set)) fn.call(workerFacade, ev);
        }
        return true;
      };
      workerFacade.postMessage = function postMessage(data, transferOrOptions) {
        if (terminated) return;
        if (Array.isArray(transferOrOptions)) {
          hostPort.postMessage(data, transferOrOptions);
        } else {
          hostPort.postMessage(data);
        }
      };
      workerFacade.terminate = function terminate() {
        if (terminated) return;
        terminated = true;
        if (abortCtrl) {
          try {
            abortCtrl.abort();
          } catch (_err) {}
        }
        for (const subWorker of Array.from(childWorkers)) {
          try {
            if (subWorker && typeof subWorker.terminate === 'function') {
              subWorker.terminate();
            }
          } catch (_err) {}
        }
        childWorkers.clear();
        try {
          hostPort.onmessage = null;
          workerPort.onmessage = null;
          if (typeof hostPort.close === 'function') hostPort.close();
          if (typeof workerPort.close === 'function') workerPort.close();
        } catch (_err) {}
        try {
          if (wf && typeof wf.remove === 'function') wf.remove();
          else if (wf && wf.parentNode) wf.parentNode.removeChild(wf);
        } catch (_err) {}
      };

      if (disposables && typeof disposables.register === 'function') {
        disposables.register(() => workerFacade.terminate());
      }

      const emitOuterError = (errObj) => {
        if (terminated) return;
        const EvCtor = cw.ErrorEvent || cw.Event || Event;
        const message = errObj && errObj.message ? String(errObj.message) : String(errObj || 'Worker error');
        let errEv;
        try {
          errEv = new EvCtor('error', { message, error: errObj });
        } catch (_err) {
          errEv = { type: 'error', message, error: errObj };
        }
        if (typeof workerFacade.onerror === 'function') {
          try {
            workerFacade.onerror.call(workerFacade, errEv);
          } catch (_err) {}
        }
        for (const fn of Array.from(outerListeners.error)) {
          try {
            fn.call(workerFacade, errEv);
          } catch (_err) {}
        }
      };

      hostPort.onmessage = (ev) => {
        if (terminated) return;
        const MsgEvCtor = cw.MessageEvent || MessageEvent;
        let msgEv;
        try {
          msgEv = new MsgEvCtor('message', { data: ev.data });
        } catch (_err) {
          msgEv = { type: 'message', data: ev.data };
        }
        if (typeof workerFacade.onmessage === 'function') {
          workerFacade.onmessage.call(workerFacade, msgEv);
        }
        for (const fn of Array.from(outerListeners.message)) {
          fn.call(workerFacade, msgEv);
        }
      };

      const baseHref = (rootWin && rootWin.location && rootWin.location.href) || 'https://localhost/';
      const parsedWorkerUrl = new URL(targetWorkerUrl, baseHref);
      const resolveWorkerRelativeUrl = assetRewriter
        ? assetRewriter.createWorkerUrlResolver(parsedWorkerUrl.href)
        : (u) => String(u || '');

      const origWFetch =
        typeof wWin.fetch === 'function'
          ? wWin.fetch.bind(wWin)
          : typeof cw.fetch === 'function'
            ? cw.fetch.bind(cw)
            : null;
      if (origWFetch) {
        wWin.fetch = function workerFetch(input, init) {
          if (terminated) return Promise.reject(new Error('Worker terminated'));
          const mergedInit =
            abortCtrl && (!init || !init.signal) ? { ...(init || {}), signal: abortCtrl.signal } : init;
          if (typeof input === 'string' || (input && typeof input === 'object' && typeof input.href === 'string')) {
            return origWFetch(resolveWorkerRelativeUrl(input), mergedInit);
          }
          return origWFetch(input, mergedInit);
        };
      }

      const OrigWRequest = wWin.Request || cw.Request;
      if (typeof OrigWRequest === 'function') {
        const WrappedWorkerRequest = function WorkerRequest(input, init) {
          const nextIn =
            typeof input === 'string' || (input && typeof input === 'object' && typeof input.href === 'string')
              ? resolveWorkerRelativeUrl(input)
              : input;
          return init !== undefined ? new OrigWRequest(nextIn, init) : new OrigWRequest(nextIn);
        };
        WrappedWorkerRequest.prototype = OrigWRequest.prototype;
        try {
          wWin.Request = WrappedWorkerRequest;
        } catch (_err) {}
      }

      const wXhrProto = wWin.XMLHttpRequest && wWin.XMLHttpRequest.prototype;
      if (wXhrProto && typeof wXhrProto.open === 'function' && !wXhrProto.__workerXhrOpenPatched) {
        const origXhrOpen = wXhrProto.open;
        wXhrProto.open = function patchedXhrOpen(method, url, ...restArgs) {
          return origXhrOpen.call(this, method, resolveWorkerRelativeUrl(url), ...restArgs);
        };
        wXhrProto.__workerXhrOpenPatched = true;
      }

      try {
        const NestedWorkerProxy = function NestedWorker(subUrl, subOpts) {
          if (terminated) throw new Error('Worker terminated');
          const nextSub =
            typeof subUrl === 'string' || (subUrl && typeof subUrl === 'object' && typeof subUrl.href === 'string')
              ? resolveWorkerRelativeUrl(subUrl)
              : subUrl;
          const subInstance = subOpts !== undefined ? new cw.Worker(nextSub, subOpts) : new cw.Worker(nextSub);
          childWorkers.add(subInstance);
          return subInstance;
        };
        NestedWorkerProxy.prototype = OrigWorker.prototype;
        wWin.Worker = NestedWorkerProxy;
      } catch (_err) {}

      const workerLocation = Object.freeze({
        href: parsedWorkerUrl.href,
        origin: parsedWorkerUrl.origin,
        protocol: parsedWorkerUrl.protocol,
        host: parsedWorkerUrl.host,
        hostname: parsedWorkerUrl.hostname,
        port: parsedWorkerUrl.port,
        pathname: parsedWorkerUrl.pathname,
        search: parsedWorkerUrl.search,
        hash: parsedWorkerUrl.hash,
        toString() {
          return parsedWorkerUrl.href;
        },
      });
      try {
        wWin.__workerLocation = workerLocation;
      } catch (_err) {}

      let innerOnMessage = null;
      const innerMsgListeners = new Set();
      try {
        Object.defineProperty(wWin, 'onmessage', {
          configurable: true,
          get: () => innerOnMessage,
          set: (fn) => {
            innerOnMessage = typeof fn === 'function' ? fn : null;
          },
        });
      } catch (_err) {
        wWin.onmessage = null;
      }

      const origInnerAddEv = typeof wWin.addEventListener === 'function' ? wWin.addEventListener.bind(wWin) : null;
      const origInnerRemEv =
        typeof wWin.removeEventListener === 'function' ? wWin.removeEventListener.bind(wWin) : null;

      const customAddEv = function workerAddEventListener(type, listener, evOpts) {
        if (type === 'message' && typeof listener === 'function') {
          innerMsgListeners.add(listener);
          return undefined;
        }
        return origInnerAddEv ? origInnerAddEv(type, listener, evOpts) : undefined;
      };
      const customRemEv = function workerRemoveEventListener(type, listener, evOpts) {
        if (type === 'message' && typeof listener === 'function') {
          innerMsgListeners.delete(listener);
          return undefined;
        }
        return origInnerRemEv ? origInnerRemEv(type, listener, evOpts) : undefined;
      };
      const customPostMsg = function workerPostMessage(data, transferOrOptions) {
        if (terminated) return;
        if (Array.isArray(transferOrOptions)) {
          workerPort.postMessage(data, transferOrOptions);
        } else {
          workerPort.postMessage(data);
        }
      };
      const customClose = function workerClose() {
        workerFacade.terminate();
      };

      const nonce = cspSecurityPort ? cspSecurityPort.resolveHostCspNonce(wDoc) : '';
      let inlineExecSeq = 0;
      let capturingInlineError = false;
      let capturedSyncError = null;

      if (origInnerAddEv) {
        origInnerAddEv('error', (ev) => {
          if (capturingInlineError) {
            capturedSyncError = (ev && ev.error) || new Error((ev && ev.message) || 'importScripts execution error');
            if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
            if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
            return;
          }
          emitOuterError((ev && ev.error) || new Error((ev && ev.message) || 'Worker runtime error'));
        });
      }

      const executeInlineWorkerScript = (scriptCode, { rethrowSyncError = false } = {}) => {
        const wScript = wDoc.createElement('script');
        const execFlag = `__wExec_${++inlineExecSeq}`;
        wWin[execFlag] = false;
        const wrappedCode = `window[${JSON.stringify(execFlag)}] = true;\n${String(scriptCode ?? '')}`;
        if (!cspSecurityPort || !cspSecurityPort.assignAuthorizedInlineScript(wScript, wrappedCode, nonce)) {
          try {
            delete wWin[execFlag];
          } catch (_err) {}
          return false;
        }
        const scriptTarget = wDoc.head || wDoc.body || wDoc.documentElement;
        if (rethrowSyncError) {
          capturingInlineError = true;
          capturedSyncError = null;
        }
        try {
          scriptTarget.appendChild(wScript);
        } finally {
          capturingInlineError = false;
        }
        const didRun = Boolean(wWin[execFlag] === true);
        try {
          delete wWin[execFlag];
        } catch (_err) {}
        if (rethrowSyncError && capturedSyncError) {
          const toThrow = capturedSyncError;
          capturedSyncError = null;
          throw toThrow;
        }
        return didRun;
      };

      const isModuleWorker = Boolean(options && options.type === 'module');

      const customImportScripts = function importScripts(...urls) {
        if (isModuleWorker) {
          throw new TypeError('importScripts is not available in module Workers');
        }
        const XhrCtor = wWin.XMLHttpRequest || cw.XMLHttpRequest;
        if (typeof XhrCtor !== 'function') {
          throw new Error('XMLHttpRequest unavailable for importScripts');
        }
        for (const rawImportArg of urls) {
          if (terminated) return;
          const rawImportStr = String(rawImportArg ?? '').trim();
          if (!rawImportStr) {
            throw new TypeError('Empty importScripts URL rejected');
          }
          const resolvedAbs = new URL(rawImportStr, parsedWorkerUrl.href).href;
          const safeImportUrl = assetRewriter ? assetRewriter.rewriteAssetUrl(resolvedAbs) : resolvedAbs;
          if (!safeImportUrl || (cspSecurityPort && !cspSecurityPort.isTrustedScriptUrl(safeImportUrl))) {
            throw new TypeError(`Blocked untrusted importScripts URL: ${rawImportStr}`);
          }
          const xhr = new XhrCtor();
          xhr.open('GET', safeImportUrl, false);
          xhr.send(null);
          if (!(xhr.status >= 200 && xhr.status < 300) && !(xhr.status === 0 && xhr.responseText)) {
            throw new Error(`Failed importScripts HTTP ${xhr.status}: ${safeImportUrl}`);
          }
          const rewrittenClassic = rewriteWorkerGlobalBindings(String(xhr.responseText || ''), {
            location: '__workerLocation',
          });
          if (!executeInlineWorkerScript(rewrittenClassic, { rethrowSyncError: true })) {
            throw new Error(`CSP or TrustedTypes blocked importScripts execution: ${safeImportUrl}`);
          }
        }
      };

      for (const [k, v] of [
        ['addEventListener', customAddEv],
        ['removeEventListener', customRemEv],
        ['postMessage', customPostMsg],
        ['close', customClose],
        ['importScripts', customImportScripts],
      ]) {
        try {
          Object.defineProperty(wWin, k, { configurable: true, writable: true, value: v });
        } catch (_err) {
          try {
            wWin[k] = v;
          } catch (_err2) {}
        }
      }

      let workerScope = wWin;
      if (typeof Proxy === 'function') {
        try {
          workerScope = new Proxy(Object.create(null), {
            get(_, prop) {
              if (prop === 'self' || prop === 'globalThis') return workerScope;
              if (prop === 'postMessage') return customPostMsg;
              if (prop === 'onmessage') return innerOnMessage;
              if (prop === 'addEventListener') return customAddEv;
              if (prop === 'removeEventListener') return customRemEv;
              if (prop === 'close') return customClose;
              if (prop === 'location') return workerLocation;
              if (prop === 'importScripts' && !isModuleWorker) return customImportScripts;
              const val = wWin[prop];
              if (typeof val === 'function') {
                const isCtor = Boolean(val.prototype && val.prototype.constructor === val);
                return isCtor ? val : val.bind(wWin);
              }
              return val;
            },
            set(_, prop, val) {
              if (prop === 'onmessage') {
                innerOnMessage = typeof val === 'function' ? val : null;
                return true;
              }
              wWin[prop] = val;
              return true;
            },
            has(_, prop) {
              return (
                prop === 'self' ||
                prop === 'globalThis' ||
                prop === 'postMessage' ||
                prop === 'onmessage' ||
                prop === 'addEventListener' ||
                prop === 'removeEventListener' ||
                prop === 'close' ||
                prop === 'location' ||
                (prop === 'importScripts' && !isModuleWorker) ||
                prop in wWin
              );
            },
          });
          wWin.__workerScope = workerScope;
          try {
            Object.defineProperty(wWin, 'self', {
              configurable: true,
              writable: true,
              value: workerScope,
            });
          } catch (_err) {}
        } catch (_err) {
          workerScope = wWin;
        }
      }

      let scriptEvaluated = false;
      const preEvalMessageQueue = [];
      const deliverToWorkerRealm = (ev) => {
        if (terminated) return;
        const MsgEvCtor = wWin.MessageEvent || cw.MessageEvent || MessageEvent;
        let msgEv;
        try {
          msgEv = new MsgEvCtor('message', { data: ev.data });
        } catch (_err) {
          msgEv = { type: 'message', data: ev.data };
        }
        const handler = innerOnMessage || wWin.onmessage;
        if (typeof handler === 'function') {
          try {
            handler.call(workerScope, msgEv);
          } catch (err) {
            emitOuterError(err);
          }
        }
        for (const fn of Array.from(innerMsgListeners)) {
          try {
            fn.call(workerScope, msgEv);
          } catch (err) {
            emitOuterError(err);
          }
        }
      };

      const flushPreEvalMessages = () => {
        if (scriptEvaluated) return;
        scriptEvaluated = true;
        while (preEvalMessageQueue.length > 0 && !terminated) {
          deliverToWorkerRealm(preEvalMessageQueue.shift());
        }
      };

      workerPort.onmessage = (ev) => {
        if (terminated) return;
        if (!scriptEvaluated) {
          preEvalMessageQueue.push(ev);
          return;
        }
        deliverToWorkerRealm(ev);
      };

      if (typeof hostPort.start === 'function') hostPort.start();
      if (typeof workerPort.start === 'function') workerPort.start();

      const loadWorkerViaScriptTag = () => {
        if (terminated) return;
        const wScript = wDoc.createElement('script');
        if (nonce) {
          wScript.nonce = nonce;
          if (typeof wScript.setAttribute === 'function') wScript.setAttribute('nonce', nonce);
        }
        if (isModuleWorker) {
          wScript.type = 'module';
        }
        wScript.onload = () => flushPreEvalMessages();
        wScript.onerror = () => {
          preEvalMessageQueue.length = 0;
          emitOuterError(new Error(`Failed to load Worker script: ${targetWorkerUrl}`));
        };
        wScript.src = cspSecurityPort
          ? cspSecurityPort.createAuthorizedScriptUrl(targetWorkerUrl)
          : targetWorkerUrl;
        const scriptTarget = wDoc.head || wDoc.body || wDoc.documentElement;
        scriptTarget.appendChild(wScript);
      };

      const canFetchWorkerSource =
        typeof cw.fetch === 'function' &&
        cspSecurityPort &&
        typeof cspSecurityPort.assignAuthorizedInlineScript === 'function';

      if (canFetchWorkerSource && isModuleWorker) {
        wWin.__onWorkerReady = () => flushPreEvalMessages();
        wWin.__onWorkerError = (err) => emitOuterError(err);
        Promise.resolve()
          .then(() =>
            buildEsModuleGraphBundle({
              entryUrl: targetWorkerUrl,
              fetchSource: async (url) => {
                const res = await cw.fetch(
                  url,
                  abortCtrl ? { signal: abortCtrl.signal } : undefined
                );
                if (!res || !res.ok) {
                  throw new Error(`Module Worker fetch HTTP ${res ? res.status : 0}: ${url}`);
                }
                const raw = await res.text();
                return rewriteWorkerGlobalBindings(raw, { location: '__workerLocation' });
              },
              resolveImportUrl: (spec, importerUrl) => {
                const abs = new URL(spec, importerUrl).href;
                const rewritten = assetRewriter ? assetRewriter.rewriteAssetUrl(abs) : abs;
                if (!rewritten || (cspSecurityPort && !cspSecurityPort.isTrustedScriptUrl(rewritten))) {
                  throw new TypeError(`Blocked untrusted module Worker import URL: ${spec}`);
                }
                return rewritten;
              },
              workerGlobalsPreamble:
                'const __ws = window.__workerScope || window, self = __ws, postMessage = __ws.postMessage, addEventListener = __ws.addEventListener, removeEventListener = __ws.removeEventListener, close = __ws.close, location = __ws.location;',
            })
          )
          .then(({ bundleExpression }) => {
            if (terminated) return;
            const runnerCode = `${bundleExpression}.then(() => { if (typeof window.__onWorkerReady === 'function') window.__onWorkerReady(); }, (err) => { if (typeof window.__onWorkerError === 'function') window.__onWorkerError(err); });`;
            if (!executeInlineWorkerScript(runnerCode)) {
              loadWorkerViaScriptTag();
            }
          })
          .catch((err) => {
            if (terminated) return;
            if (err && (err.name === 'TypeError' || err.name === 'ReferenceError')) {
              emitOuterError(err);
              return;
            }
            loadWorkerViaScriptTag();
          });
      } else if (canFetchWorkerSource) {
        Promise.resolve()
          .then(() => cw.fetch(targetWorkerUrl, abortCtrl ? { signal: abortCtrl.signal } : undefined))
          .then((res) => {
            if (!res || !res.ok) {
              throw new Error(`Worker fetch HTTP ${res ? res.status : 0}`);
            }
            return res.text();
          })
          .then((workerSource) => {
            if (terminated) return;
            const rewrittenClassic = rewriteWorkerGlobalBindings(String(workerSource || ''), {
              location: '__workerLocation',
            });
            if (!executeInlineWorkerScript(rewrittenClassic)) {
              loadWorkerViaScriptTag();
              return;
            }
            flushPreEvalMessages();
          })
          .catch(() => {
            if (!terminated) loadWorkerViaScriptTag();
          });
      } else {
        loadWorkerViaScriptTag();
      }

      return workerFacade;
    } catch (_err) {
      try {
        if (wf && typeof wf.remove === 'function') wf.remove();
        else if (wf && wf.parentNode) wf.parentNode.removeChild(wf);
      } catch (_err2) {}
      return null;
    }
  }

  function constructAdaptedWorker(OrigCtor, args, newTarget) {
    const [scriptURL, options] = args;
    const rawStr = String(
      scriptURL && typeof scriptURL === 'object' && typeof scriptURL.href === 'string'
        ? scriptURL.href
        : scriptURL ?? ''
    ).trim();
    if (!rawStr) {
      throw new TypeError('Empty Worker script URL rejected');
    }

    if (/^blob:/i.test(rawStr)) {
      if (hostOrigin && !rawStr.toLowerCase().startsWith(`blob:${hostOrigin.toLowerCase()}/`)) {
        throw new TypeError(`Blocked cross-origin blob Worker URL: ${rawStr}`);
      }
      if (cspSecurityPort && !cspSecurityPort.isTrustedScriptUrl(rawStr)) {
        throw new TypeError(`Blocked unowned blob Worker URL: ${rawStr}`);
      }
      const authorizedBlob = cspSecurityPort ? cspSecurityPort.createAuthorizedScriptUrl(rawStr) : rawStr;
      return Reflect.construct(OrigCtor, options !== undefined ? [authorizedBlob, options] : [authorizedBlob], newTarget);
    }

    const targetWorkerUrl = assetRewriter ? assetRewriter.rewriteAssetUrl(scriptURL) : rawStr;
    if (!targetWorkerUrl || (cspSecurityPort && !cspSecurityPort.isTrustedScriptUrl(targetWorkerUrl))) {
      throw new TypeError(`Blocked untrusted Worker script URL: ${rawStr}`);
    }

    const iframeWorker = mountIframeBackedWorker(targetWorkerUrl, options);
    if (iframeWorker) {
      return iframeWorker;
    }

    if (
      typeof cw.Blob === 'function' &&
      cw.URL &&
      typeof cw.URL.createObjectURL === 'function' &&
      cspSecurityPort &&
      typeof cspSecurityPort.registerOwnedBlobUrl === 'function'
    ) {
      const bootCode =
        options && options.type === 'module'
          ? `import ${JSON.stringify(targetWorkerUrl)};`
          : `importScripts(${JSON.stringify(targetWorkerUrl)});`;
      const blob = new cw.Blob([bootCode], { type: 'application/javascript' });
      const blobUrl = cw.URL.createObjectURL(blob);
      const revokeBlobUrl = cspSecurityPort.registerOwnedBlobUrl(blobUrl);
      try {
        const safeBlobUrl = cspSecurityPort.createAuthorizedScriptUrl(blobUrl);
        const worker = Reflect.construct(
          OrigCtor,
          options !== undefined ? [safeBlobUrl, options] : [safeBlobUrl],
          newTarget
        );
        if (worker && typeof worker.addEventListener === 'function') {
          worker.addEventListener('error', revokeBlobUrl, { once: true });
        }
        const sched = typeof cw.setTimeout === 'function' ? cw.setTimeout.bind(cw) : setTimeout;
        sched(revokeBlobUrl, 1500);
        return worker;
      } catch (workerErr) {
        revokeBlobUrl();
        throw workerErr;
      }
    }

    const safeDirectUrl = cspSecurityPort
      ? cspSecurityPort.createAuthorizedScriptUrl(targetWorkerUrl)
      : targetWorkerUrl;
    return Reflect.construct(OrigCtor, options !== undefined ? [safeDirectUrl, options] : [safeDirectUrl], newTarget);
  }

  let unmarkPatched = () => {};
  let unregisterHook = () => {};

  if (disposables && typeof disposables.registerConstructorHook === 'function') {
    unregisterHook = disposables.registerConstructorHook(cw, 'Worker', (_OrigCtor) => ({
      construct: (OrigCtor, args, newTarget) => constructAdaptedWorker(OrigCtor, args, newTarget),
    }));
  } else {
    cw.Worker = new Proxy(OrigWorker, {
      construct(target, args, newTarget) {
        return constructAdaptedWorker(target, args, newTarget);
      },
    });
    unregisterHook = () => {
      if (cw.Worker !== OrigWorker) cw.Worker = OrigWorker;
    };
  }

  if (remoteHostPort && typeof remoteHostPort.markWorkerPatched === 'function') {
    unmarkPatched = remoteHostPort.markWorkerPatched(cw.Worker);
    if (disposables && typeof disposables.register === 'function') {
      disposables.register((fullRestore) => {
        if (fullRestore) unmarkPatched();
      });
    }
  }

  return () => {
    unmarkPatched();
    unregisterHook();
  };
}

module.exports = {
  installWorkerBridge,
};
