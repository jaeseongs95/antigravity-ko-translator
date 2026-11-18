// Module: 12-remote-workbench-bridge.js
// Responsibility: WeakMap-backed Finite State Machine (IDLE -> PREFLIGHT -> PROMOTING_BLANK -> BOOTING_WORKBENCH -> READY | ROLLED_BACK | EXTERNAL_PROMOTED)
// for same-origin Remote Control (-v2) workbench promotion, WHATWG cd.open()+cd.close() URL inheritance, MessagePort replay, and multi-plugin coexistence.
  const REMOTE_BRIDGE_STATES = Object.freeze({
    IDLE: 'IDLE',
    PREFLIGHT: 'PREFLIGHT',
    PROMOTING_BLANK: 'PROMOTING_BLANK',
    BOOTING_WORKBENCH: 'BOOTING_WORKBENCH',
    READY: 'READY',
    ROLLED_BACK: 'ROLLED_BACK',
    EXTERNAL_PROMOTED: 'EXTERNAL_PROMOTED',
  });

  const REMOTE_BRIDGE_ALLOWED_TRANSITIONS = Object.freeze({
    IDLE: ['PREFLIGHT', 'EXTERNAL_PROMOTED', 'READY'],
    PREFLIGHT: ['PROMOTING_BLANK', 'ROLLED_BACK', 'IDLE'],
    PROMOTING_BLANK: ['BOOTING_WORKBENCH', 'ROLLED_BACK'],
    BOOTING_WORKBENCH: ['READY', 'ROLLED_BACK'],
    READY: ['IDLE', 'ROLLED_BACK'],
    ROLLED_BACK: ['IDLE'],
    EXTERNAL_PROMOTED: ['IDLE', 'READY'],
  });

  const remoteBridgeSessions = new WeakMap();
  const hookedOnLoadTargets = new Set();
  const origOnLoadFnMap = new WeakMap();

  function getOrCreateBridgeSession(iframe) {
    let session = remoteBridgeSessions.get(iframe);
    if (!session) {
      session = {
        state: REMOTE_BRIDGE_STATES.IDLE,
        rawSrc: '',
        failedSrc: '',
        spoofedSrc: '',
        suppressionHeld: false,
        rcInst: null,
      };
      remoteBridgeSessions.set(iframe, session);
    }
    return session;
  }

  function transitionBridgeSession(session, nextState) {
    if (!session || session.state === nextState) return true;
    const allowed = REMOTE_BRIDGE_ALLOWED_TRANSITIONS[session.state] || [];
    if (!allowed.includes(nextState)) return false;
    session.state = nextState;
    return true;
  }

  function ensureChainedOnIframeLoadHook(target) {
    if (!target || typeof target.onIframeLoad !== 'function' || hookedOnLoadTargets.has(target)) {
      return;
    }
    const prevFn = target.onIframeLoad;
    origOnLoadFnMap.set(target, prevFn);
    hookedOnLoadTargets.add(target);
    if (typeof disposables !== 'undefined' && disposables && typeof disposables.registerMethodHook === 'function') {
      disposables.registerMethodHook(target, 'onIframeLoad', (orig) =>
        function (...args) {
          if (
            this &&
            (this.__agySuppressAutoIframeLoad ||
              (typeof this.__agySuppressAutoIframeLoadCount === 'number' && this.__agySuppressAutoIframeLoadCount > 0))
          ) {
            return Promise.resolve();
          }
          return orig.apply(this, args);
        }
      );
    } else {
      target.onIframeLoad = function (...args) {
        if (
          this &&
          (this.__agySuppressAutoIframeLoad ||
            (typeof this.__agySuppressAutoIframeLoadCount === 'number' && this.__agySuppressAutoIframeLoadCount > 0))
        ) {
          return Promise.resolve();
        }
        return prevFn.apply(this, args);
      };
    }
  }

  function acquireAutoLoadSuppression(session, rcInst) {
    if (!session || !rcInst || session.suppressionHeld) return;
    session.suppressionHeld = true;
    session.rcInst = rcInst;
    const nextCount = (typeof rcInst.__agySuppressAutoIframeLoadCount === 'number' ? rcInst.__agySuppressAutoIframeLoadCount : 0) + 1;
    rcInst.__agySuppressAutoIframeLoadCount = nextCount;
    rcInst.__agySuppressAutoIframeLoad = true;
  }

  function releaseAutoLoadSuppression(session) {
    if (!session || !session.suppressionHeld || !session.rcInst) return;
    const rcInst = session.rcInst;
    session.suppressionHeld = false;
    const nextCount = Math.max(
      0,
      (typeof rcInst.__agySuppressAutoIframeLoadCount === 'number' ? rcInst.__agySuppressAutoIframeLoadCount : 1) - 1
    );
    if (nextCount > 0) {
      rcInst.__agySuppressAutoIframeLoadCount = nextCount;
      rcInst.__agySuppressAutoIframeLoad = true;
    } else {
      delete rcInst.__agySuppressAutoIframeLoadCount;
      rcInst.__agySuppressAutoIframeLoad = false;
    }
  }

  function mountIntoBootedSameOriginChild(cw, cd) {
    if (cw.__agyKoLocalizerActive !== KO_LOCALIZER_VERSION) {
      window.__agyMountKoThoughtLocalizer(cw, cd);
    }
    if (typeof window.__agyMountMcpManager === 'function') {
      try {
        window.__agyMountMcpManager(cw, cd);
      } catch (e) {}
    }
  }

  function isExternallyPromotedIframe(iframe) {
    if (!iframe) return false;
    if (iframe.__agyMcpPromoted) return true;
    if (
      iframe.__agyRemotePromotionOwner &&
      iframe.__agyRemotePromotionOwner !== 'ko-thought-translator' &&
      (iframe.__agyRemotePromotionState === 'promoting' || iframe.__agyRemotePromotionState === 'ready')
    ) {
      return true;
    }
    if (iframe.__agyPromoted && iframe.__agyRemotePromotionOwner && iframe.__agyRemotePromotionOwner !== 'ko-thought-translator') {
      return true;
    }
    return false;
  }

  function bridgeRemoteControlIframe() {
    if (!document || typeof window.__agyMountKoThoughtLocalizer !== 'function') return;
    const rcEl = document.querySelector('ga-remote-control');
    if (!rcEl) return;

    syncRemoteCompanionPlugins(rcEl);

    const iframe = rcEl.querySelector('iframe');
    if (!iframe) return;

    const session = getOrCreateBridgeSession(iframe);

    // 1. Mid-flight FSM guard: never interfere with or reset an in-progress promotion!
    if (
      session.state === REMOTE_BRIDGE_STATES.PROMOTING_BLANK ||
      session.state === REMOTE_BRIDGE_STATES.BOOTING_WORKBENCH
    ) {
      return;
    }

    // 2. Check if child workbench is already same-origin and booted (either READY or EXTERNAL_PROMOTED)
    try {
      const cw = iframe.contentWindow;
      const cd = iframe.contentDocument;
      const rootEl = cd && cd.getElementById ? cd.getElementById('root') : null;
      const cwOrigin = cw && cw.location ? cw.location.origin : '';
      const isSameOriginOrBlank =
        cwOrigin === window.location.origin ||
        cwOrigin === 'null' ||
        (cw && cw.location && cw.location.href === 'about:blank');
      if (
        cw &&
        cd &&
        cd.body &&
        isSameOriginOrBlank &&
        (cw.__agyMainBooted || (rootEl && rootEl.childElementCount > 0))
      ) {
        if (session.state === REMOTE_BRIDGE_STATES.IDLE || session.state === REMOTE_BRIDGE_STATES.EXTERNAL_PROMOTED) {
          transitionBridgeSession(
            session,
            isExternallyPromotedIframe(iframe) ? REMOTE_BRIDGE_STATES.EXTERNAL_PROMOTED : REMOTE_BRIDGE_STATES.READY
          );
        }
        mountIntoBootedSameOriginChild(cw, cd);
        return;
      }
      if (
        session.state === REMOTE_BRIDGE_STATES.READY &&
        (!cd || !cd.getElementById || !cd.getElementById('root'))
      ) {
        transitionBridgeSession(session, REMOTE_BRIDGE_STATES.IDLE);
        delete iframe.__agyKoPromoted;
        delete iframe.__agyPromoted;
        delete iframe.__agyRemotePromotionOwner;
        delete iframe.__agyRemotePromotionState;
      }
    } catch (e) {
      if (session.state === REMOTE_BRIDGE_STATES.READY) {
        transitionBridgeSession(session, REMOTE_BRIDGE_STATES.IDLE);
        delete iframe.__agyKoPromoted;
        delete iframe.__agyPromoted;
        delete iframe.__agyRemotePromotionOwner;
        delete iframe.__agyRemotePromotionState;
      }
    }

    // 3. Multi-plugin coexistence: if a peer plugin (statusbar / mcp-manager) owns promotion, passively attach without re-promoting
    if (isExternallyPromotedIframe(iframe)) {
      transitionBridgeSession(session, REMOTE_BRIDGE_STATES.EXTERNAL_PROMOTED);
      return;
    }
    if (iframe.__agyKoPromoted === KO_LOCALIZER_VERSION && session.state === REMOTE_BRIDGE_STATES.READY) {
      return;
    }

    const rcInst = getRemoteControlComponentInstance(rcEl);
    if (!rcInst) return;

    const rawCandidate =
      iframe.getAttribute('src') ||
      iframe.src ||
      (typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
      '';
    const rawSrc = rawCandidate.match(/https?:\/\/[^\s"'<>)+]+/)?.[0] || rawCandidate;
    if (!rawSrc) return;

    // 4. Terminal rollback lock: if this exact rawSrc previously failed preflight or CDN load, never re-enter about:blank loop!
    if (session.state === REMOTE_BRIDGE_STATES.ROLLED_BACK) {
      if (session.failedSrc === rawSrc || iframe.__agyKoPromotionFailedSrc === rawSrc) {
        return;
      }
      transitionBridgeSession(session, REMOTE_BRIDGE_STATES.IDLE);
    }
    if (iframe.__agyKoPromotionFailedSrc === rawSrc) return;

    // 5. Enter PREFLIGHT state and validate URL, origin allowlist, and detached <script> TrustedTypes capability BEFORE mutating iframe
    if (!transitionBridgeSession(session, REMOTE_BRIDGE_STATES.PREFLIGHT)) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(rawSrc, window.location.href);
    } catch (e) {
      transitionBridgeSession(session, REMOTE_BRIDGE_STATES.IDLE);
      return;
    }
    if (parsedUrl.searchParams.get('iframe') !== 'true' || !isTrustedRemoteOriginUrlObject(parsedUrl)) {
      transitionBridgeSession(session, REMOTE_BRIDGE_STATES.IDLE);
      return;
    }
    const basePath = parsedUrl.pathname.replace(/^\/antigravity/, '').replace(/\/+$/, '');
    if (!basePath || /(?:\.\.|\\|\/\/|[\s"'<>])/.test(basePath)) {
      transitionBridgeSession(session, REMOTE_BRIDGE_STATES.IDLE);
      return;
    }
    const verMatch = basePath.match(/\/web\/([^/]+)/);
    const appVersion = verMatch ? verMatch[1] : '2.28.2';
    // Host CSP on antigravity.google.com blocks script-src from antigravity.static.usercontent.goog
    // but explicitly allows https://www.gstatic.com, which mirrors all /antigravity/web/<ver>/ assets identically.
    const cdnOrigin =
      parsedUrl.hostname === 'antigravity.static.usercontent.goog' || parsedUrl.origin === window.location.origin
        ? 'https://www.gstatic.com/antigravity'
        : parsedUrl.origin;
    const cdnBaseUrl = `${cdnOrigin}${basePath}`;
    if (!canPromoteRemoteScriptUrl(`${cdnBaseUrl}/main.js`)) {
      session.failedSrc = rawSrc;
      iframe.__agyKoPromotionFailedSrc = rawSrc;
      transitionBridgeSession(session, REMOTE_BRIDGE_STATES.ROLLED_BACK);
      return;
    }

    // 6. Transition PREFLIGHT -> PROMOTING_BLANK and claim multi-plugin promotion ownership
    if (!transitionBridgeSession(session, REMOTE_BRIDGE_STATES.PROMOTING_BLANK)) return;
    session.rawSrc = rawSrc;
    iframe.__agyKoPromoted = KO_LOCALIZER_VERSION;
    iframe.__agyKoPromoting = true;
    iframe.__agyPromoted = true;
    iframe.__agyRemotePromotionOwner = 'ko-thought-translator';
    iframe.__agyRemotePromotionState = 'promoting';

    const hostThemeParam = parsedUrl.searchParams.get('hostTheme');
    const savedChildPath = String(
      new URLSearchParams(window.location.search || '').get('p') ||
        rcInst.lastSyncedChildPath ||
        rcInst.initialChildPath ||
        ''
    ).replace(/^\/+/, '');
    if (savedChildPath) {
      rcInst.initialChildPath = savedChildPath;
    }

    const buildInitialIframeHistoryUrl = () => {
      const extraQuery =
        hostThemeParam === 'dark' || hostThemeParam === 'light'
          ? `hostTheme=${encodeURIComponent(hostThemeParam)}&iframe=true`
          : 'iframe=true';
      if (!savedChildPath) return `${basePath}/?${extraQuery}`;
      const qIdx = savedChildPath.indexOf('?');
      const subPath = qIdx >= 0 ? savedChildPath.slice(0, qIdx) : savedChildPath;
      const subQuery = qIdx >= 0 ? savedChildPath.slice(qIdx + 1) : '';
      const cleanSubPath = subPath.replace(/^\/+/, '');
      const fullPath = cleanSubPath ? `${basePath}/${cleanSubPath}` : `${basePath}/`;
      return subQuery ? `${fullPath}?${subQuery}&${extraQuery}` : `${fullPath}?${extraQuery}`;
    };

    const origSrcDesc =
      typeof HTMLIFrameElement !== 'undefined'
        ? Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
        : null;
    const spoofedSrc = `${window.location.origin}${basePath}/?iframe=true`;
    session.spoofedSrc = spoofedSrc;

    const rcProto = Object.getPrototypeOf(rcInst);
    if (rcProto && typeof rcProto.onIframeLoad === 'function') {
      ensureChainedOnIframeLoadHook(rcProto);
    }
    if (typeof rcInst.onIframeLoad === 'function') {
      ensureChainedOnIframeLoadHook(rcInst);
    }
    acquireAutoLoadSuppression(session, rcInst);

    const rollbackIframePromotion = () => {
      if (session.state === REMOTE_BRIDGE_STATES.ROLLED_BACK) return;
      transitionBridgeSession(session, REMOTE_BRIDGE_STATES.ROLLED_BACK);
      session.failedSrc = rawSrc;
      iframe.__agyKoPromoting = false;
      iframe.__agyKoPromotionFailedSrc = rawSrc;
      iframe.__agyRemotePromotionState = 'rolled_back';
      delete iframe.__agyKoPromoted;
      delete iframe.__agyPromoted;
      delete iframe.__agyRemotePromotionOwner;
      releaseAutoLoadSuppression(session);
      try {
        delete iframe.src;
      } catch (e) {}
      try {
        if (origSrcDesc && typeof origSrcDesc.set === 'function') {
          origSrcDesc.set.call(iframe, rawSrc);
        } else {
          iframe.src = rawSrc;
        }
      } catch (e) {}
    };

    const onBlankLoad = () => {
      if (!transitionBridgeSession(session, REMOTE_BRIDGE_STATES.BOOTING_WORKBENCH)) return;
      try {
        let cw = iframe.contentWindow;
        let cd = iframe.contentDocument;
        if (!cw || !cd) {
          rollbackIframePromotion();
          return;
        }

        // WHATWG HTML Standard § 8.4 Step 12: calling cd.open(); cd.close(); (0 string args, 0 TrustedHTML sinks)
        // on a same-origin about:blank document transitions cw.location.href from 'about:blank' ('about:' scheme)
        // to the entry document's https://antigravity.google.com/r/... URL ('https:' scheme), preventing
        // TanStack Router inside 2.33.0/main.js from crashing with an uncaught History.replaceState SecurityError.
        if (cw.location && cw.location.href === 'about:blank' && typeof cd.open === 'function') {
          try {
            cd.open();
            if (typeof cd.close === 'function') cd.close();
            cw = iframe.contentWindow || cw;
            cd = iframe.contentDocument || cd;
          } catch (e) {}
        }

        const nonce = resolveHostCspNonce(document);
        const ttPolicy = getTrustedPolicyForRemote();
        const safeCdnBase =
          /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>]*)?$/i.test(cdnBaseUrl) &&
          isTrustedRemoteScriptUrl(`${cdnBaseUrl}/main.js`)
            ? cdnBaseUrl
            : '';
        if (!safeCdnBase) {
          rollbackIframePromotion();
          return;
        }

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

        try {
          if (typeof cd.createElement === 'function' && !cd.__agyCreateElPatched) {
            const origCreateEl = cd.createElement.bind(cd);
            cd.createElement = function (tagName, options) {
              const el = options !== undefined ? origCreateEl(tagName, options) : origCreateEl(tagName);
              if (nonce && el && typeof tagName === 'string') {
                const upper = tagName.toUpperCase();
                if (upper === 'SCRIPT' || upper === 'STYLE' || upper === 'LINK') {
                  try {
                    el.nonce = nonce;
                    if (typeof el.setAttribute === 'function') el.setAttribute('nonce', nonce);
                  } catch (e) {}
                }
              }
              return el;
            };
            cd.__agyCreateElPatched = true;
          }
          const scriptProto = cw.HTMLScriptElement && cw.HTMLScriptElement.prototype;
          const scriptSrcDesc = scriptProto ? Object.getOwnPropertyDescriptor(scriptProto, 'src') : null;
          if (scriptProto && scriptSrcDesc && typeof scriptSrcDesc.set === 'function' && !scriptProto.__agyScriptSrcPatched) {
            Object.defineProperty(scriptProto, 'src', {
              configurable: true,
              enumerable: true,
              get: scriptSrcDesc.get,
              set(val) {
                if (typeof val === 'string') {
                  let nextUrl = val;
                  if (basePath && nextUrl.startsWith(basePath + '/')) {
                    nextUrl = `${cdnBaseUrl}${nextUrl.slice(basePath.length)}`;
                  }
                  if (ttPolicy && isTrustedRemoteScriptUrl(nextUrl)) {
                    return scriptSrcDesc.set.call(this, ttPolicy.createScriptURL(nextUrl));
                  }
                  return scriptSrcDesc.set.call(this, nextUrl);
                }
                return scriptSrcDesc.set.call(this, val);
              },
            });
            scriptProto.__agyScriptSrcPatched = true;
          }
        } catch (e) {}

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

        for (const cssFile of ['jetbox.css', 'compiled_tailwind.css']) {
          const linkEl = cd.createElement('link');
          linkEl.rel = 'stylesheet';
          linkEl.setAttribute('rel', 'stylesheet');
          linkEl.href = `${safeCdnBase}/${cssFile}`;
          linkEl.setAttribute('href', `${safeCdnBase}/${cssFile}`);
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
          const prevDec = cw.__JETSKI_LS_CLIENT_DECORATOR__;
          cw.__JETSKI_LS_CLIENT_DECORATOR__ = function (client) {
            const decorated = typeof prevDec === 'function' ? prevDec(client) || client : client;
            if (decorated && typeof decorated === 'object') {
              cw.__agyCapturedLsClient = decorated;
              window.__agyCapturedLsClient = decorated;
              syncRemoteCompanionPlugins(rcEl);
            }
            return decorated;
          };
        } catch (e) {}

        try {
          if (cw.history && !cw.history.__agyHistoryGuarded) {
            for (const hMethod of ['replaceState', 'pushState']) {
              const origHistFn = cw.history[hMethod];
              if (typeof origHistFn === 'function') {
                cw.history[hMethod] = function (state, title, url) {
                  try {
                    return origHistFn.call(this, state, title, url);
                  } catch (histErr) {
                    return undefined;
                  }
                };
              }
            }
            cw.history.__agyHistoryGuarded = true;
          }
          cw.history.replaceState(null, '', buildInitialIframeHistoryUrl());
        } catch (e) {}
        try {
          Object.defineProperty(cd, 'referrer', {
            configurable: true,
            get: () => window.location.href,
          });
        } catch (e) {}

        cw.__APP_CONFIG__ = {
          productName: 'antigravity',
          csrfToken: String(window?.__APP_CONFIG__?.csrfToken || rcInst?.csrfToken || 'csrf_token'),
          appVersion,
          isRemoteControl: true,
        };
        const ua = cw.navigator?.userAgent || '';
        const platform =
          ua.indexOf('Windows') >= 0
            ? 'win32'
            : ua.indexOf('Macintosh') >= 0 || ua.indexOf('Mac OS') >= 0
            ? 'darwin'
            : 'linux';
        cw.process = cw.process || {
          env: { NODE_ENV: 'production' },
          platform,
          nextTick: (cb) => Promise.resolve().then(cb),
        };
        if (cw.AudioWorklet && cw.AudioWorklet.prototype) {
          cw.AudioWorklet.prototype.addModule = () => Promise.resolve();
        }
        if (cw.customElements && !cw.customElements.__agyGuarded) {
          const origDef = cw.customElements.define.bind(cw.customElements);
          cw.customElements.define = (name, ctor, opts) => {
            if (!cw.customElements.get(name)) origDef(name, ctor, opts);
          };
          cw.customElements.__agyGuarded = true;
        }
        const imgProto = cw.HTMLImageElement && cw.HTMLImageElement.prototype;
        const imgSrcDesc = imgProto ? Object.getOwnPropertyDescriptor(imgProto, 'src') : null;
        if (imgProto && imgSrcDesc && typeof imgSrcDesc.set === 'function' && !imgProto.__agyImgSrcPatched) {
          Object.defineProperty(imgProto, 'src', {
            configurable: true,
            enumerable: true,
            get: imgSrcDesc.get,
            set(val) {
              if (typeof val === 'string' && basePath && val.startsWith(basePath + '/')) {
                val = `${cdnBaseUrl}${val.slice(basePath.length)}`;
              }
              return imgSrcDesc.set.call(this, val);
            },
          });
          imgProto.__agyImgSrcPatched = true;
        }
        const elProto = cw.Element && cw.Element.prototype;
        if (elProto && typeof elProto.setAttribute === 'function' && !elProto.__agySetAttrPatched) {
          const origSetAttr = elProto.setAttribute;
          elProto.setAttribute = function (name, val) {
            if (
              this.tagName === 'IMG' &&
              typeof name === 'string' &&
              name.toLowerCase() === 'src' &&
              typeof val === 'string' &&
              basePath &&
              val.startsWith(basePath + '/')
            ) {
              val = `${cdnBaseUrl}${val.slice(basePath.length)}`;
            }
            return origSetAttr.call(this, name, val);
          };
          elProto.__agySetAttrPatched = true;
        }
        try {
          cw.document.documentElement.style.colorScheme = hostThemeParam === 'light' ? 'light' : 'dark';
        } catch (e) {}

        const msgListeners = new Set();
        try {
          if (typeof cw.addEventListener === 'function' && !cw.__agyMsgBufferInstalled) {
            cw.__agyMsgBufferInstalled = true;
            const origAddEv = cw.addEventListener.bind(cw);
            const origRemoveEv = typeof cw.removeEventListener === 'function' ? cw.removeEventListener.bind(cw) : null;
            origAddEv('message', (ev) => {
              if (ev && ev.data && ev.data.type === 'INITIAL_CONFIG') {
                cw.__agyBufferedInitialConfigEvent = ev;
                if (msgListeners.size > 0) {
                  cw.__initialConfigReceived = true;
                }
              }
            });
            cw.addEventListener = function (type, listener, options) {
              if (type === 'message' && typeof listener === 'function') {
                msgListeners.add(listener);
                const res = origAddEv(type, listener, options);
                if (cw.__agyBufferedInitialConfigEvent && !cw.__initialConfigReceived) {
                  const bufferedEv = cw.__agyBufferedInitialConfigEvent;
                  cw.__initialConfigReceived = true;
                  Promise.resolve().then(() => {
                    try {
                      listener.call(cw, bufferedEv);
                    } catch (e) {}
                  });
                }
                return res;
              }
              return origAddEv(type, listener, options);
            };
            if (origRemoveEv) {
              cw.removeEventListener = function (type, listener, options) {
                if (type === 'message' && typeof listener === 'function') {
                  msgListeners.delete(listener);
                }
                return origRemoveEv(type, listener, options);
              };
            }
          }
        } catch (e) {}

        try {
          if (typeof cw.Worker === 'function' && !cw.Worker.__agyWorkerPatched) {
            const OrigWorker = cw.Worker;
            const makeInertWorkerStub = () => ({
              postMessage() {},
              terminate() {},
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent: () => false,
              onmessage: null,
              onerror: null,
            });
            const PatchedWorker = function (scriptURL, options) {
              const urlStr = String(scriptURL || '');
              if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
                const targetWorkerUrl = `${cdnBaseUrl}${urlStr}`;
                if (isTrustedRemoteScriptUrl(targetWorkerUrl)) {
                  try {
                    if (typeof cw.Blob === 'function' && cw.URL && typeof cw.URL.createObjectURL === 'function') {
                      const blob = new cw.Blob([`importScripts(${JSON.stringify(targetWorkerUrl)});`], {
                        type: 'application/javascript',
                      });
                      const blobUrl = cw.URL.createObjectURL(blob);
                      ownCreatedWorkerBlobUrls.add(blobUrl);
                      let revoked = false;
                      const revokeBlobUrl = () => {
                        if (revoked) return;
                        revoked = true;
                        ownCreatedWorkerBlobUrls.delete(blobUrl);
                        try {
                          if (cw.URL && typeof cw.URL.revokeObjectURL === 'function') {
                            cw.URL.revokeObjectURL(blobUrl);
                          }
                        } catch (e) {}
                      };
                      try {
                        const worker = new OrigWorker(ttPolicy ? ttPolicy.createScriptURL(blobUrl) : blobUrl, options);
                        if (worker && typeof worker.addEventListener === 'function') {
                          worker.addEventListener('error', revokeBlobUrl, { once: true });
                        }
                        const sched = typeof cw.setTimeout === 'function' ? cw.setTimeout.bind(cw) : setTimeout;
                        sched(revokeBlobUrl, 1500);
                        return worker;
                      } catch (workerErr) {
                        revokeBlobUrl();
                        return makeInertWorkerStub();
                      }
                    }
                  } catch (e) {
                    return makeInertWorkerStub();
                  }
                }
              }
              try {
                return new OrigWorker(scriptURL, options);
              } catch (e) {
                return makeInertWorkerStub();
              }
            };
            PatchedWorker.prototype = OrigWorker.prototype;
            PatchedWorker.__agyWorkerPatched = true;
            cw.Worker = PatchedWorker;
          }
        } catch (e) {}

        const prismScript = cd.createElement('script');
        if (nonce) prismScript.nonce = nonce;
        prismScript.async = false;
        const prismUrl = `${cdnBaseUrl}/prism_bundle.js`;
        prismScript.src = ttPolicy ? ttPolicy.createScriptURL(prismUrl) : prismUrl;

        const mainScript = cd.createElement('script');
        if (nonce) mainScript.nonce = nonce;
        mainScript.async = false;
        const mainUrl = `${cdnBaseUrl}/main.js`;
        mainScript.src = ttPolicy ? ttPolicy.createScriptURL(mainUrl) : mainUrl;

        mainScript.onload = () => {
          transitionBridgeSession(session, REMOTE_BRIDGE_STATES.READY);
          iframe.__agyKoPromoting = false;
          iframe.__agyRemotePromotionState = 'ready';
          cw.__agyMainBooted = true;
          releaseAutoLoadSuppression(session);
          if (savedChildPath) rcInst.initialChildPath = savedChildPath;
          const origLoad =
            origOnLoadFnMap.get(rcInst) ||
            (rcProto ? origOnLoadFnMap.get(rcProto) : null) ||
            rcInst.onIframeLoad;
          let initialConfigInFlight = false;
          const replayBufferedInitialConfig = () => {
            if (!cw.__initialConfigReceived && cw.__agyBufferedInitialConfigEvent && msgListeners.size > 0) {
              const bufferedEv = cw.__agyBufferedInitialConfigEvent;
              cw.__initialConfigReceived = true;
              for (const fn of Array.from(msgListeners)) {
                try {
                  fn.call(cw, bufferedEv);
                } catch (e) {}
              }
            }
          };
          const ensureInitialConfigSent = () => {
            replayBufferedInitialConfig();
            if (typeof origLoad === 'function' && !cw.__initialConfigReceived && !initialConfigInFlight && !cw.__agyOnIframeLoadCalled) {
              initialConfigInFlight = true;
              cw.__agyOnIframeLoadCalled = true;
              if (savedChildPath) rcInst.initialChildPath = savedChildPath;
              try {
                const res = origLoad.call(rcInst);
                Promise.resolve(res)
                  .catch(() => {})
                  .finally(() => {
                    initialConfigInFlight = false;
                    replayBufferedInitialConfig();
                    setTimeout(replayBufferedInitialConfig, 150);
                  });
              } catch (e) {
                initialConfigInFlight = false;
              }
            }
          };
          ensureInitialConfigSent();
          [120, 400, 1000].forEach((delay) => {
            setTimeout(() => {
              if (savedChildPath && typeof rcInst.navigateIframeToChildPath === 'function') {
                try {
                  rcInst.navigateIframeToChildPath(savedChildPath);
                } catch (e) {}
              }
            }, delay);
          });
          try {
            if (typeof rcInst.markIframeReady === 'function') {
              rcInst.markIframeReady();
            } else {
              rcInst.iframeLoading?.set?.(false);
              rcInst.iframeUiReady?.set?.(true);
            }
          } catch (e) {}
          mountIntoBootedSameOriginChild(cw, cd);
        };
        mainScript.onerror = () => {
          rollbackIframePromotion();
        };

        headEl.appendChild(prismScript);
        headEl.appendChild(mainScript);
      } catch (e) {
        rollbackIframePromotion();
      }
    };

    try {
      delete iframe.src;
    } catch (e) {}
    let blankLoadHandled = false;
    const triggerBlankLoadOnce = () => {
      if (blankLoadHandled || session.state !== REMOTE_BRIDGE_STATES.PROMOTING_BLANK) return;
      try {
        const cd = iframe.contentDocument;
        const cw = iframe.contentWindow;
        if (!cd || !cw) return;
        blankLoadHandled = true;
      } catch (e) {
        return;
      }
      onBlankLoad();
    };
    iframe.addEventListener('load', triggerBlankLoadOnce, { once: true });
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
          } catch (e) {}
          session.state = REMOTE_BRIDGE_STATES.IDLE;
          session.rawSrc = '';
          session.failedSrc = '';
          delete iframe.__agyKoPromoted;
          delete iframe.__agyPromoted;
          delete iframe.__agyRemotePromotionOwner;
          delete iframe.__agyRemotePromotionState;
          iframe.__agyKoPromoting = false;
          delete iframe.__agyKoPromotionFailedSrc;
          releaseAutoLoadSuppression(session);
          if (origSrcDesc && typeof origSrcDesc.set === 'function') {
            origSrcDesc.set.call(iframe, nextStr);
          } else {
            iframe.setAttribute?.('src', nextStr);
          }
        },
      });
    } catch (e) {}
    setTimeout(() => {
      if (!blankLoadHandled && session.state === REMOTE_BRIDGE_STATES.PROMOTING_BLANK) {
        try {
          if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
            triggerBlankLoadOnce();
          }
        } catch (e) {}
      }
    }, 60);
  }

  if (typeof disposables !== 'undefined' && disposables) {
    disposables.register((fullRestore) => {
      for (const target of hookedOnLoadTargets) {
        try {
          delete target.__agySuppressAutoIframeLoad;
          delete target.__agySuppressAutoIframeLoadCount;
        } catch (e) {}
      }
      hookedOnLoadTargets.clear();
      try {
        const rcFrame = document.querySelector && document.querySelector('ga-remote-control');
        const innerIframe = rcFrame && rcFrame.querySelector ? rcFrame.querySelector('iframe') : null;
        if (innerIframe) {
          const session = remoteBridgeSessions.get(innerIframe);
          if (session) releaseAutoLoadSuppression(session);
          const cw = innerIframe.contentWindow;
          if (cw && cw !== window && typeof cw.__agyKoThoughtCleanup === 'function') {
            cw.__agyKoThoughtCleanup(fullRestore);
          }
          if (fullRestore) {
            remoteBridgeSessions.delete(innerIframe);
            delete innerIframe.__agyKoPromoted;
            delete innerIframe.__agyKoPromoting;
            delete innerIframe.__agyKoPromotionFailedSrc;
            if (innerIframe.__agyRemotePromotionOwner === 'ko-thought-translator') {
              delete innerIframe.__agyPromoted;
              delete innerIframe.__agyRemotePromotionOwner;
              delete innerIframe.__agyRemotePromotionState;
            }
            try {
              delete innerIframe.src;
            } catch (e) {}
          }
        }
      } catch (e) {}
    });
  }
