'use strict';

const { createDisposableRegistry } = require('../core/disposable-registry');
const { assertValidRemoteHostPort } = require('./remote-host-port');
const { resolveRemoteCdnContext, createAssetUrlRewriter } = require('./asset-url-rewriter');
const { installDomGuards } = require('./dom-guard-installer');
const { installWorkerBridge } = require('./worker-bridge');

const PROMOTER_STATES = Object.freeze({
  IDLE: 'IDLE',
  PREFLIGHT: 'PREFLIGHT',
  PROMOTING_BLANK: 'PROMOTING_BLANK',
  BOOTING_WORKBENCH: 'BOOTING_WORKBENCH',
  READY: 'READY',
  ROLLED_BACK: 'ROLLED_BACK',
  EXTERNAL_PROMOTED: 'EXTERNAL_PROMOTED',
});

const ALLOWED_STATE_TRANSITIONS = Object.freeze({
  IDLE: ['PREFLIGHT', 'EXTERNAL_PROMOTED', 'READY'],
  PREFLIGHT: ['PROMOTING_BLANK', 'ROLLED_BACK', 'IDLE'],
  PROMOTING_BLANK: ['BOOTING_WORKBENCH', 'ROLLED_BACK'],
  BOOTING_WORKBENCH: ['READY', 'ROLLED_BACK'],
  READY: ['IDLE', 'ROLLED_BACK'],
  ROLLED_BACK: ['IDLE'],
  EXTERNAL_PROMOTED: ['IDLE', 'READY'],
});

function createWorkbenchPromoter({
  hostCfg,
  cspSecurityPort,
  remoteHostPort,
  rootWin,
  rootDoc,
  disposables,
}) {
  assertValidRemoteHostPort(remoteHostPort);
  const win = rootWin || (typeof globalThis !== 'undefined' ? globalThis.window || globalThis : null);
  const doc = rootDoc || (win && win.document ? win.document : null);
  const sessions = new WeakMap();
  const activeIframes = new Set();

  function getHostOrigin() {
    try {
      const origin = win && win.location && typeof win.location.origin === 'string' ? win.location.origin : '';
      return origin && origin !== 'null' ? origin : '';
    } catch (_err) {
      return '';
    }
  }

  function getHostHref() {
    try {
      return (win && win.location && win.location.href) || '';
    } catch (_err) {
      return '';
    }
  }

  function getOrCreateSession(iframe) {
    let session = sessions.get(iframe);
    if (!session) {
      session = {
        state: PROMOTER_STATES.IDLE,
        rawSrc: '',
        failedSrc: '',
        spoofedSrc: '',
        releaseSuppression: null,
        childDisposables: null,
        cdnCtx: null,
      };
      sessions.set(iframe, session);
      activeIframes.add(iframe);
    }
    return session;
  }

  function transitionSession(session, nextState) {
    if (!session || session.state === nextState) return true;
    const allowed = ALLOWED_STATE_TRANSITIONS[session.state] || [];
    if (!allowed.includes(nextState)) return false;
    session.state = nextState;
    return true;
  }

  function releaseSessionSuppression(session) {
    if (session && typeof session.releaseSuppression === 'function') {
      const fn = session.releaseSuppression;
      session.releaseSuppression = null;
      try {
        fn();
      } catch (_err) {}
    }
  }

  function buildExecutionHelpers(assetRewriter) {
    const fetchFn =
      win && typeof win.fetch === 'function'
        ? win.fetch.bind(win)
        : typeof fetch === 'function'
          ? fetch.bind(globalThis)
          : null;
    return Object.freeze({
      rewriteAssetUrl: assetRewriter ? assetRewriter.rewriteAssetUrl : (u) => String(u || ''),
      fetchText: fetchFn
        ? async (url) => {
            const res = await fetchFn(url);
            if (!res || !res.ok) {
              throw new Error(`HTTP ${res ? res.status : 0}`);
            }
            return res.text();
          }
        : undefined,
      registerOwnedBlobUrl: (blobUrl) => cspSecurityPort.registerOwnedBlobUrl(blobUrl),
      createAuthorizedScriptUrl: (url) => cspSecurityPort.createAuthorizedScriptUrl(url),
      executeAuthorizedInlineScript: (targetDoc, code, attrs) =>
        cspSecurityPort.executeAuthorizedInlineScript(targetDoc, code, attrs),
    });
  }

  function collectChildCandidateUrls(iframe, hostBinding, cw, cd) {
    const out = [];
    try {
      const raw = hostBinding && typeof hostBinding.getIframeSrc === 'function' ? hostBinding.getIframeSrc() : '';
      if (raw) out.push(raw);
    } catch (_err) {}
    try {
      const attrSrc = iframe && typeof iframe.getAttribute === 'function' ? iframe.getAttribute('src') : '';
      if (attrSrc) out.push(attrSrc);
      if (iframe && iframe.src) out.push(iframe.src);
    } catch (_err) {}
    try {
      if (cd && typeof cd.querySelectorAll === 'function') {
        const assetEls = cd.querySelectorAll('script[src], link[href]');
        for (let i = 0; i < assetEls.length; i++) {
          const v =
            assetEls[i].src ||
            (typeof assetEls[i].getAttribute === 'function'
              ? assetEls[i].getAttribute('src') || assetEls[i].getAttribute('href')
              : '');
          if (v) out.push(String(v));
        }
      }
    } catch (_err) {}
    try {
      if (cw && cw.location && cw.location.href) {
        out.push(String(cw.location.href));
      }
    } catch (_err) {}
    return out;
  }

  function attachToBootedSameOriginChild(session, iframe, hostEl, hostBinding, cw, cd) {
    if (!cw || !cd) return;
    if (!session.childDisposables) {
      session.childDisposables = createDisposableRegistry();
    }
    const cdnCtx =
      session.cdnCtx ||
      resolveRemoteCdnContext({
        hostCfg,
        cspSecurityPort,
        hostOrigin: getHostOrigin(),
        hostHref: getHostHref(),
        candidateUrls: collectChildCandidateUrls(iframe, hostBinding, cw, cd),
      });
    if (cdnCtx) {
      session.cdnCtx = cdnCtx;
      const assetRewriter = createAssetUrlRewriter({
        hostCfg,
        cspSecurityPort,
        hostOrigin: getHostOrigin(),
        hostHref: getHostHref(),
        basePath: cdnCtx.basePath,
        cdnOrigin: cdnCtx.cdnOrigin,
        cdnBaseUrl: cdnCtx.cdnBaseUrl,
      });
      const nonce = cspSecurityPort.resolveHostCspNonce(cd) || cspSecurityPort.resolveHostCspNonce(doc);
      installDomGuards({
        cw,
        cd,
        assetRewriter,
        nonce,
        hostTheme: null,
        disposables: session.childDisposables,
      });
      installWorkerBridge({
        cw,
        cd,
        rootWin: win,
        assetRewriter,
        cspSecurityPort,
        remoteHostPort,
        disposables: session.childDisposables,
      });
    }
    remoteHostPort.onWorkbenchReady(cw, cd, hostEl);
  }

  function inspectAndPromoteHostElement(hostEl) {
    if (!hostEl || !doc || !win) return null;

    const baseHelpers = buildExecutionHelpers(null);
    Promise.resolve(remoteHostPort.syncCompanions(hostEl, baseHelpers)).catch(() => {});

    const hostBinding = remoteHostPort.resolveHostBinding(hostEl, win);
    const iframe = hostBinding && hostBinding.iframe;
    if (!iframe) return null;

    const session = getOrCreateSession(iframe);

    // 1. Mid-flight guard: never disturb an in-progress promotion!
    if (
      session.state === PROMOTER_STATES.PROMOTING_BLANK ||
      session.state === PROMOTER_STATES.BOOTING_WORKBENCH
    ) {
      return session.state;
    }

    // 2. Check if child workbench is already same-origin and booted ( wrapped in try/catch for cross-origin safety: D-0011! )
    try {
      const cw = iframe.contentWindow;
      const cd = iframe.contentDocument;
      const rootEl = cd && typeof cd.getElementById === 'function' ? cd.getElementById('root') : null;
      const cwOrigin = cw && cw.location ? cw.location.origin : '';
      const hostOrig = getHostOrigin();
      const isSameOriginOrBlank =
        (hostOrig && cwOrigin === hostOrig) ||
        cwOrigin === 'null' ||
        (cw && cw.location && cw.location.href === 'about:blank');

      if (
        cw &&
        cd &&
        cd.body &&
        isSameOriginOrBlank &&
        (cw.__workbenchMainBooted || (rootEl && rootEl.childElementCount > 0))
      ) {
        if (session.state === PROMOTER_STATES.IDLE || session.state === PROMOTER_STATES.EXTERNAL_PROMOTED) {
          transitionSession(
            session,
            remoteHostPort.isExternallyPromotedIframe(iframe)
              ? PROMOTER_STATES.EXTERNAL_PROMOTED
              : PROMOTER_STATES.READY
          );
        }
        attachToBootedSameOriginChild(session, iframe, hostEl, hostBinding, cw, cd);
        return session.state;
      }
      if (session.state === PROMOTER_STATES.READY && (!cd || !cd.getElementById || !cd.getElementById('root'))) {
        transitionSession(session, PROMOTER_STATES.IDLE);
        remoteHostPort.setPromotionOwnership(iframe, 'idle');
      }
    } catch (_crossOriginErr) {
      // D-0011: Expected when iframe is still on cross-origin sandbox host before promotion!
      if (session.state === PROMOTER_STATES.READY) {
        transitionSession(session, PROMOTER_STATES.IDLE);
        remoteHostPort.setPromotionOwnership(iframe, 'idle');
      }
    }

    // 3. Peer plugin coexistence: if an external plugin promoted this iframe, passively attach without re-promoting!
    if (remoteHostPort.isExternallyPromotedIframe(iframe)) {
      transitionSession(session, PROMOTER_STATES.EXTERNAL_PROMOTED);
      try {
        const cw = iframe.contentWindow;
        const cd = iframe.contentDocument;
        const hostOrig = getHostOrigin();
        if (cw && cd && cw.location && (!hostOrig || cw.location.origin === hostOrig)) {
          attachToBootedSameOriginChild(session, iframe, hostEl, hostBinding, cw, cd);
        }
      } catch (_err) {}
      return session.state;
    }

    if (session.state === PROMOTER_STATES.READY) {
      return session.state;
    }

    if (!hostBinding.isReady) {
      return session.state;
    }

    const rawSrc = hostBinding.getIframeSrc();
    if (!rawSrc || rawSrc === 'about:blank') {
      return session.state;
    }

    // 4. Single-Attempt Terminal Rollback Lock (`0` retry loop!):
    if (session.state === PROMOTER_STATES.ROLLED_BACK) {
      if (session.failedSrc === rawSrc) {
        return session.state;
      }
      transitionSession(session, PROMOTER_STATES.IDLE);
    }
    if (session.failedSrc === rawSrc) {
      transitionSession(session, PROMOTER_STATES.ROLLED_BACK);
      return session.state;
    }

    // 5. Enter PREFLIGHT and verify preflight origin + ALL `hostCfg.shellBootScripts` (`Rev7-F1`) BEFORE mutating iframe!
    if (!transitionSession(session, PROMOTER_STATES.PREFLIGHT)) {
      return session.state;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawSrc, getHostHref() || hostCfg.cdnScriptOrigin);
    } catch (_err) {
      transitionSession(session, PROMOTER_STATES.IDLE);
      return session.state;
    }

    if (parsedUrl.searchParams.get('iframe') !== 'true' || !cspSecurityPort.isTrustedIframePreflightUrl(parsedUrl)) {
      transitionSession(session, PROMOTER_STATES.IDLE);
      return session.state;
    }

    const cdnCtx = resolveRemoteCdnContext({
      hostCfg,
      cspSecurityPort,
      hostOrigin: getHostOrigin(),
      hostHref: getHostHref(),
      candidateUrls: [rawSrc],
    });
    if (!cdnCtx) {
      session.failedSrc = rawSrc;
      transitionSession(session, PROMOTER_STATES.ROLLED_BACK);
      return session.state;
    }

    // Rev7-F1: Verify EVERY boot script in `hostCfg.shellBootScripts` (zero hardcoded script names!)
    const bootScripts = Array.isArray(hostCfg.shellBootScripts) ? hostCfg.shellBootScripts : [];
    if (bootScripts.length === 0) {
      session.failedSrc = rawSrc;
      transitionSession(session, PROMOTER_STATES.ROLLED_BACK);
      return session.state;
    }
    for (const scriptName of bootScripts) {
      let probeScriptUrl = '';
      try {
        if (typeof scriptName !== 'string' || !scriptName.trim() || scriptName.includes('\\')) {
          probeScriptUrl = '';
        } else {
          const resolved = new URL(scriptName, `${cdnCtx.cdnBaseUrl}/`).href;
          if (resolved.startsWith(`${cdnCtx.cdnBaseUrl}/`)) {
            probeScriptUrl = resolved;
          }
        }
      } catch (_err) {
        probeScriptUrl = '';
      }
      if (!probeScriptUrl || !cspSecurityPort.canPromoteScriptUrl(probeScriptUrl)) {
        session.failedSrc = rawSrc;
        transitionSession(session, PROMOTER_STATES.ROLLED_BACK);
        return session.state;
      }
    }

    // 6. Transition PREFLIGHT -> PROMOTING_BLANK and acquire suppression BEFORE navigating to about:blank
    if (!transitionSession(session, PROMOTER_STATES.PROMOTING_BLANK)) {
      return session.state;
    }

    session.rawSrc = rawSrc;
    session.cdnCtx = cdnCtx;
    remoteHostPort.setPromotionOwnership(iframe, 'promoting');

    const hostThemeParam = parsedUrl.searchParams.get('hostTheme');
    const savedChildPath = hostBinding.savedChildPath;
    if (savedChildPath) {
      hostBinding.syncInitialChildPath(savedChildPath);
    }

    const buildInitialIframeHistoryUrl = () => {
      const merged = new URLSearchParams();
      let subPath = savedChildPath || '';
      if (savedChildPath) {
        const qIdx = savedChildPath.indexOf('?');
        if (qIdx >= 0) {
          subPath = savedChildPath.slice(0, qIdx);
          const childParams = new URLSearchParams(savedChildPath.slice(qIdx + 1));
          for (const [k, v] of childParams.entries()) {
            merged.set(k, v);
          }
        }
      }
      for (const [k, v] of parsedUrl.searchParams.entries()) {
        if (k === 'hostTheme') {
          if (v === 'dark' || v === 'light') merged.set('hostTheme', v);
        } else if (k !== 'iframe') {
          merged.set(k, v);
        }
      }
      merged.set('iframe', 'true');
      const queryStr = merged.toString();
      if (!savedChildPath) return `${cdnCtx.basePath}/?${queryStr}`;
      const cleanSubPath = subPath.replace(/^\/+/, '');
      const fullPath = cleanSubPath ? `${cdnCtx.basePath}/${cleanSubPath}` : `${cdnCtx.basePath}/`;
      return `${fullPath}?${queryStr}`;
    };

    const iframeProto =
      (win && win.HTMLIFrameElement && win.HTMLIFrameElement.prototype) ||
      (typeof HTMLIFrameElement !== 'undefined' ? HTMLIFrameElement.prototype : null);
    const origSrcDesc = iframeProto ? Object.getOwnPropertyDescriptor(iframeProto, 'src') : null;
    const spoofedSrc = `${getHostOrigin()}${cdnCtx.basePath}/?iframe=true`;
    session.spoofedSrc = spoofedSrc;

    session.releaseSuppression = hostBinding.acquireAutoLoadSuppression();

    const rollbackPromotion = () => {
      if (session.state === PROMOTER_STATES.ROLLED_BACK) return;
      transitionSession(session, PROMOTER_STATES.ROLLED_BACK);
      session.failedSrc = rawSrc;
      remoteHostPort.setPromotionOwnership(iframe, 'rolled_back');
      releaseSessionSuppression(session);
      if (session.childDisposables) {
        session.childDisposables.disposeAll(true);
        session.childDisposables = null;
      }
      try {
        delete iframe.src;
      } catch (_err) {}
      try {
        if (origSrcDesc && typeof origSrcDesc.set === 'function') {
          origSrcDesc.set.call(iframe, rawSrc);
        } else {
          iframe.src = rawSrc;
        }
      } catch (_err) {}
    };

    const onBlankLoad = () => {
      if (!transitionSession(session, PROMOTER_STATES.BOOTING_WORKBENCH)) return;
      try {
        let cw = iframe.contentWindow;
        let cd = iframe.contentDocument;
        if (!cw || !cd) {
          rollbackPromotion();
          return;
        }

        // WHATWG HTML Standard §8.4 Step 12: 0-arg `cd.open(); cd.close();` inherits parent https: URL
        if (cw.location && cw.location.href === 'about:blank' && typeof cd.open === 'function') {
          try {
            cd.open();
            if (typeof cd.close === 'function') cd.close();
            cw = iframe.contentWindow || cw;
            cd = iframe.contentDocument || cd;
          } catch (_err) {}
        }

        if (session.childDisposables) {
          session.childDisposables.disposeAll(true);
        }
        const childDisposables = createDisposableRegistry();
        session.childDisposables = childDisposables;

        const nonce = cspSecurityPort.resolveHostCspNonce(doc);
        const assetRewriter = createAssetUrlRewriter({
          hostCfg,
          cspSecurityPort,
          hostOrigin: getHostOrigin(),
          hostHref: getHostHref(),
          basePath: cdnCtx.basePath,
          cdnOrigin: cdnCtx.cdnOrigin,
          cdnBaseUrl: cdnCtx.cdnBaseUrl,
        });
        const execHelpers = buildExecutionHelpers(assetRewriter);

        if (cd.documentElement && typeof cd.documentElement.setAttribute === 'function') {
          cd.documentElement.setAttribute('lang', 'en');
        }
        const ensureSection = (propName, tagName) => {
          if (cd[propName]) return cd[propName];
          const sec = cd.createElement(tagName);
          if (cd.documentElement && typeof cd.documentElement.appendChild === 'function') {
            cd.documentElement.appendChild(sec);
          }
          return sec;
        };
        const headEl = ensureSection('head', 'head');
        const bodyEl = ensureSection('body', 'body');
        headEl.textContent = '';
        bodyEl.textContent = '';

        const guardState = installDomGuards({
          cw,
          cd,
          assetRewriter,
          nonce,
          hostTheme: hostThemeParam,
          disposables: childDisposables,
        });

        installWorkerBridge({
          cw,
          cd,
          rootWin: win,
          assetRewriter,
          cspSecurityPort,
          remoteHostPort,
          disposables: childDisposables,
        });

        const metaCharset = cd.createElement('meta');
        metaCharset.setAttribute('charset', 'UTF-8');
        headEl.appendChild(metaCharset);

        const metaViewport = cd.createElement('meta');
        metaViewport.setAttribute('name', 'viewport');
        metaViewport.setAttribute(
          'content',
          'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover'
        );
        headEl.appendChild(metaViewport);

        for (const cssFile of hostCfg.shellCssFiles) {
          const linkEl = cd.createElement('link');
          linkEl.rel = 'stylesheet';
          linkEl.setAttribute('rel', 'stylesheet');
          const cssHref = `${cdnCtx.cdnBaseUrl}/${cssFile}`;
          linkEl.href = cssHref;
          linkEl.setAttribute('href', cssHref);
          if (nonce) linkEl.nonce = nonce;
          headEl.appendChild(linkEl);
        }

        const shellStyle = cd.createElement('style');
        if (nonce) shellStyle.nonce = nonce;
        shellStyle.textContent =
          'html,body,#root{height:100%;height:100dvh;max-height:100dvh;margin:0;overflow:hidden;background-color:transparent;overscroll-behavior:none;-webkit-text-size-adjust:100%;}';
        headEl.appendChild(shellStyle);

        const rootDiv = cd.createElement('div');
        rootDiv.id = 'root';
        rootDiv.setAttribute('id', 'root');
        bodyEl.appendChild(rootDiv);

        try {
          if (cw.history && !cw.history.__historyGuarded) {
            for (const hMethod of ['replaceState', 'pushState']) {
              const origHistFn = cw.history[hMethod];
              if (typeof origHistFn === 'function') {
                cw.history[hMethod] = function guardedHistoryMethod(state, title, url) {
                  try {
                    return origHistFn.call(this, state, title, url);
                  } catch (_err) {
                    return undefined;
                  }
                };
              }
            }
            cw.history.__historyGuarded = true;
          }
          if (cw.history && typeof cw.history.replaceState === 'function') {
            cw.history.replaceState(null, '', buildInitialIframeHistoryUrl());
          }
        } catch (_err) {}

        try {
          const parentHref = getHostHref();
          if (parentHref) {
            Object.defineProperty(cd, 'referrer', {
              configurable: true,
              get: () => parentHref,
            });
          }
        } catch (_err) {}

        remoteHostPort.installChildEnvironmentShims(cw, hostBinding, childDisposables, execHelpers);
        remoteHostPort.installBootGlobals(cw, hostBinding, cdnCtx.appVersion, childDisposables, execHelpers);

        const scriptEls = bootScripts.map((scriptName) => {
          const sEl = cd.createElement('script');
          if (nonce) sEl.nonce = nonce;
          sEl.async = false;
          const fullUrl = new URL(scriptName, `${cdnCtx.cdnBaseUrl}/`).href;
          sEl.src = cspSecurityPort.createAuthorizedScriptUrl(fullUrl);
          return sEl;
        });

        let bootAborted = false;
        const onBootError = () => {
          if (bootAborted) return;
          bootAborted = true;
          rollbackPromotion();
        };

        for (let idx = 0; idx < scriptEls.length; idx++) {
          const sEl = scriptEls[idx];
          sEl.onerror = onBootError;
          if (idx === scriptEls.length - 1) {
            sEl.onload = () => {
              if (bootAborted) return;
              transitionSession(session, PROMOTER_STATES.READY);
              remoteHostPort.setPromotionOwnership(iframe, 'ready');
              cw.__workbenchMainBooted = true;
              releaseSessionSuppression(session);
              if (savedChildPath) {
                hostBinding.syncInitialChildPath(savedChildPath);
              }

              let initialConfigInFlight = false;
              const ensureInitialConfigSent = () => {
                guardState.replayBufferedInitialConfig();
                if (!cw.__initialConfigReceived && !initialConfigInFlight && !cw.__initialOnLoadDispatched) {
                  initialConfigInFlight = true;
                  cw.__initialOnLoadDispatched = true;
                  if (savedChildPath) {
                    hostBinding.syncInitialChildPath(savedChildPath);
                  }
                  Promise.resolve(hostBinding.invokeOriginalOnIframeLoadUnsuppressed())
                    .catch(() => {})
                    .finally(() => {
                      initialConfigInFlight = false;
                      guardState.replayBufferedInitialConfig();
                      const tId = setTimeout(() => guardState.replayBufferedInitialConfig(), 150);
                      childDisposables.registerTimeout(tId);
                    });
                }
              };
              ensureInitialConfigSent();

              if (savedChildPath) {
                for (const delayMs of [120, 400, 1000]) {
                  const navTimer = setTimeout(() => {
                    hostBinding.navigateChildPath(savedChildPath);
                  }, delayMs);
                  childDisposables.registerTimeout(navTimer);
                }
              }

              hostBinding.markIframeReady();
              remoteHostPort.onWorkbenchReady(cw, cd, hostEl);
            };
          }
          headEl.appendChild(sEl);
        }
      } catch (_err) {
        rollbackPromotion();
      }
    };

    try {
      delete iframe.src;
    } catch (_err) {}

    let blankLoadHandled = false;
    const triggerBlankLoadOnce = () => {
      if (blankLoadHandled || session.state !== PROMOTER_STATES.PROMOTING_BLANK) return;
      try {
        const cd = iframe.contentDocument;
        const cw = iframe.contentWindow;
        if (!cd || !cw) return;
        blankLoadHandled = true;
      } catch (_err) {
        return;
      }
      onBlankLoad();
    };

    if (typeof iframe.addEventListener === 'function') {
      iframe.addEventListener('load', triggerBlankLoadOnce, { once: true });
    }
    if (origSrcDesc && typeof origSrcDesc.set === 'function') {
      origSrcDesc.set.call(iframe, 'about:blank');
    } else {
      iframe.src = 'about:blank';
    }

    try {
      Object.defineProperty(iframe, 'src', {
        configurable: true,
        get: () => spoofedSrc,
        set(nextVal) {
          const nextStr = String(nextVal ?? '');
          if (!nextStr || nextStr === spoofedSrc) return;
          try {
            delete iframe.src;
          } catch (_err) {}
          session.state = PROMOTER_STATES.IDLE;
          session.rawSrc = '';
          session.failedSrc = '';
          remoteHostPort.setPromotionOwnership(iframe, 'idle');
          releaseSessionSuppression(session);
          if (session.childDisposables) {
            session.childDisposables.disposeAll(true);
            session.childDisposables = null;
          }
          if (origSrcDesc && typeof origSrcDesc.set === 'function') {
            origSrcDesc.set.call(iframe, nextStr);
          } else if (typeof iframe.setAttribute === 'function') {
            iframe.setAttribute('src', nextStr);
          }
        },
      });
    } catch (_err) {}

    const fallbackBlankTimer = setTimeout(() => {
      if (!blankLoadHandled && session.state === PROMOTER_STATES.PROMOTING_BLANK) {
        try {
          if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
            triggerBlankLoadOnce();
          }
        } catch (_err) {}
      }
    }, 60);
    if (disposables && typeof disposables.registerTimeout === 'function') {
      disposables.registerTimeout(fallbackBlankTimer);
    }

    return session.state;
  }

  function scanAndPromoteAll() {
    if (!doc) return [];
    const hosts = remoteHostPort.findHostElements(doc);
    return hosts.map((hostEl) => inspectAndPromoteHostElement(hostEl));
  }

  if (disposables && typeof disposables.register === 'function') {
    disposables.register((fullRestore) => {
      for (const iframe of Array.from(activeIframes)) {
        const session = sessions.get(iframe);
        if (!session) continue;
        releaseSessionSuppression(session);
        if (session.childDisposables) {
          session.childDisposables.disposeAll(fullRestore);
          if (fullRestore) session.childDisposables = null;
        }
        if (fullRestore) {
          sessions.delete(iframe);
          activeIframes.delete(iframe);
          remoteHostPort.setPromotionOwnership(iframe, 'idle');
          try {
            delete iframe.src;
          } catch (_err) {}
        }
      }
    });
  }

  return {
    PROMOTER_STATES,
    scanAndPromoteAll,
    inspectAndPromoteHostElement,
    getSessionState(iframe) {
      const s = sessions.get(iframe);
      return s ? s.state : PROMOTER_STATES.IDLE;
    },
  };
}

module.exports = {
  PROMOTER_STATES,
  ALLOWED_STATE_TRANSITIONS,
  createWorkbenchPromoter,
};
