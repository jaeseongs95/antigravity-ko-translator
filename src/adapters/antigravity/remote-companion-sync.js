'use strict';

const { assertValidRemoteHostPort } = require('../../remote/remote-host-port');

const KO_PROMOTION_OWNER = 'ko-thought-translator';

function decodeBase64Utf8(b64) {
  if (!b64 || typeof b64 !== 'string') return '';
  try {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      if (typeof TextDecoder === 'function') {
        return new TextDecoder('utf-8').decode(bytes);
      }
      return decodeURIComponent(escape(bin));
    }
  } catch (_err) {}
  return '';
}

function findLineStartMarkerIndex(text, marker, fromIndex = 0) {
  if (!text || !marker) return -1;
  let pos = Math.max(0, fromIndex);
  while (pos <= text.length) {
    const idx = text.indexOf(marker, pos);
    if (idx === -1) return -1;
    const prevChar = idx === 0 ? '\n' : text[idx - 1];
    const afterIdx = idx + marker.length;
    const nextChar = afterIdx >= text.length ? '\n' : text[afterIdx];
    if (
      (prevChar === '\n' || prevChar === '\r') &&
      (nextChar === '\n' || nextChar === '\r' || nextChar === ' ' || nextChar === '\t')
    ) {
      return idx;
    }
    pos = idx + 1;
  }
  return -1;
}

function extractCompanionBlock(text, startMarkers, endMarkers) {
  if (!text || typeof text !== 'string') return '';
  const starts = Array.isArray(startMarkers) ? startMarkers : [startMarkers];
  const ends = Array.isArray(endMarkers) ? endMarkers : [endMarkers];
  for (let i = 0; i < starts.length; i++) {
    const sMarker = starts[i];
    const eMarker = ends[i] || ends[0];
    const s = findLineStartMarkerIndex(text, sMarker, 0);
    if (s === -1) continue;
    const e = findLineStartMarkerIndex(text, eMarker, s + sMarker.length);
    if (e !== -1 && e > s) {
      return text.slice(s + sMarker.length, e).trim();
    }
  }
  return '';
}

function findPrototypeOnIframeLoadOwner(rcInst) {
  let cur = rcInst ? Object.getPrototypeOf(rcInst) : null;
  while (cur && cur !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(cur, 'onIframeLoad') && typeof cur.onIframeLoad === 'function') {
      return cur;
    }
    cur = Object.getPrototypeOf(cur);
  }
  return null;
}

function createAntigravityRemoteCompanionSync({
  targetWin,
  targetDoc,
  hostCfg,
  version = 'v2.0.0',
  disposables,
  onRefreshStatusbar = null,
  onMountChildLocalizer = null,
  fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
} = {}) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  const hookedRcPrototypes = new Set();
  const hookedOnLoadTargets = new WeakSet();

  if (disposables && typeof disposables.register === 'function') {
    disposables.register((fullRestore) => {
      for (const proto of hookedRcPrototypes) {
        try {
          delete proto.__agyKoProbeHooked;
        } catch (_err) {}
      }
      hookedRcPrototypes.clear();
      if (win) {
        delete win.__agyKoSyncingCompanions;
        if (fullRestore) {
          delete win.__agyKoCompanionsSynced;
          delete win.__agyKoFetchingStatusBar;
          delete win.__agyKoFetchingMcpManager;
        }
      }
    });
  }

  function findHostElements(targetDocument = doc) {
    if (!targetDocument || typeof targetDocument.querySelectorAll !== 'function') return [];
    const sel = (hostCfg && hostCfg.remoteControlSelector) || 'ga-remote-control';
    return Array.from(targetDocument.querySelectorAll(sel));
  }

  function discoverRcComponentInstance(rcEl, parentWin = win) {
    const activeWin = parentWin || win;
    const activeDoc = (rcEl && rcEl.ownerDocument) || doc;
    if (activeWin && activeWin.__agyRemoteControlInstance && !activeWin.__agyRemoteControlInstance.destroyed) {
      return activeWin.__agyRemoteControlInstance;
    }

    const isRcInstance = (obj) =>
      Boolean(
        obj &&
          typeof obj === 'object' &&
          !obj.destroyed &&
          (typeof obj.proxyCommand === 'function' ||
            typeof obj.onIframeLoad === 'function' ||
            typeof obj.handleIframeMessage === 'function')
      );

    const extractFromLContext = (lCtx) => {
      if (!lCtx || typeof lCtx !== 'object') return null;
      if (isRcInstance(lCtx)) return lCtx;
      if (isRcInstance(lCtx.component)) return lCtx.component;
      const lView = lCtx.lView;
      if (Array.isArray(lView)) {
        try {
          const tView = lView[1];
          const nodeIndex = typeof lCtx.nodeIndex === 'number' ? lCtx.nodeIndex : -1;
          const tNode = nodeIndex >= 0 && tView && Array.isArray(tView.data) ? tView.data[nodeIndex] : null;
          if (
            tNode &&
            typeof tNode.directiveStart === 'number' &&
            typeof tNode.componentOffset === 'number' &&
            tNode.componentOffset > -1
          ) {
            const comp = lView[tNode.directiveStart + tNode.componentOffset];
            if (isRcInstance(comp)) return comp;
          }
        } catch (_err) {}
        const scanMax = Math.min(lView.length, 300);
        for (let i = 0; i < scanMax; i++) {
          if (isRcInstance(lView[i])) return lView[i];
        }
      }
      return null;
    };

    const searchNgContext = (ctx) => {
      if (!ctx || typeof ctx !== 'object') return null;
      const direct = extractFromLContext(ctx);
      if (direct) return direct;
      const visited = new Set();
      const queue = [ctx];
      let steps = 0;
      while (queue.length > 0 && steps < 400) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object' || visited.has(cur)) continue;
        visited.add(cur);
        steps += 1;
        const extracted = extractFromLContext(cur);
        if (extracted) return extracted;
        if (Array.isArray(cur)) {
          const scanLen = Math.min(cur.length, 300);
          for (let i = 0; i < scanLen; i++) {
            if (isRcInstance(cur[i])) return cur[i];
          }
          for (let i = 0; i < scanLen; i++) {
            const item = cur[i];
            if (item && typeof item === 'object' && (Array.isArray(item) || isRcInstance(item.component))) {
              queue.push(item);
            }
          }
        } else {
          for (const k of ['component', 'lView', 'data', 'context', '_lView']) {
            if (cur[k] && typeof cur[k] === 'object') queue.push(cur[k]);
          }
        }
      }
      return null;
    };

    if (rcEl) {
      const ngFn = activeWin && activeWin.ng && typeof activeWin.ng.getComponent === 'function' ? activeWin.ng.getComponent : null;
      if (ngFn) {
        try {
          const comp = ngFn(rcEl);
          if (isRcInstance(comp)) {
            if (activeWin) activeWin.__agyRemoteControlInstance = comp;
            return comp;
          }
        } catch (_err) {}
      }
      const ngNodes = [
        rcEl,
        rcEl.firstElementChild || null,
        typeof rcEl.querySelector === 'function' ? rcEl.querySelector('iframe') : null,
      ];
      for (const candidateNode of ngNodes) {
        if (!candidateNode || typeof candidateNode !== 'object') continue;
        const ctxKey = Object.keys(candidateNode).find((k) => k.startsWith('__ngContext'));
        const rawCtx =
          candidateNode.__ngContext__ !== undefined
            ? candidateNode.__ngContext__
            : ctxKey
              ? candidateNode[ctxKey]
              : null;
        if (typeof rawCtx === 'number' && activeWin && activeWin.ng && typeof activeWin.ng.getComponent === 'function') {
          try {
            const compByIdx = activeWin.ng.getComponent(candidateNode);
            if (isRcInstance(compByIdx)) {
              activeWin.__agyRemoteControlInstance = compByIdx;
              return compByIdx;
            }
          } catch (_err) {}
        }
        const found = searchNgContext(rawCtx);
        if (found) {
          if (activeWin) activeWin.__agyRemoteControlInstance = found;
          return found;
        }
      }
    }

    const rootSel = (hostCfg && hostCfg.rootComponentSelector) || 'ga-root';
    const gaRootEl = activeDoc && typeof activeDoc.querySelector === 'function' ? activeDoc.querySelector(rootSel) : null;
    if (gaRootEl) {
      const rootCtxKey = Object.keys(gaRootEl).find((k) => k.startsWith('__ngContext'));
      const foundFromRoot = searchNgContext(
        gaRootEl.__ngContext__ !== undefined ? gaRootEl.__ngContext__ : rootCtxKey ? gaRootEl[rootCtxKey] : null
      );
      if (foundFromRoot) {
        if (activeWin) activeWin.__agyRemoteControlInstance = foundFromRoot;
        return foundFromRoot;
      }
    }

    const nsKey = (hostCfg && hostCfg.appGlobalNamespace) || 'default_GoogleAntigravity';
    const nsRoot = activeWin ? activeWin[nsKey] : null;
    if (nsRoot && typeof nsRoot === 'object') {
      const targetCandidates = [];
      if (rcEl) {
        targetCandidates.push(rcEl);
        if (rcEl.firstElementChild) targetCandidates.push(rcEl.firstElementChild);
        if (typeof rcEl.querySelector === 'function') {
          const inner = rcEl.querySelector('.app-container, .iframe-panel, iframe');
          if (inner && !targetCandidates.includes(inner)) targetCandidates.push(inner);
        }
      }
      if (gaRootEl) {
        targetCandidates.push(gaRootEl);
        if (gaRootEl.firstElementChild) targetCandidates.push(gaRootEl.firstElementChild);
      }

      for (const k of Object.keys(nsRoot)) {
        const mod = nsRoot[k];
        if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) continue;
        for (const targetEl of targetCandidates) {
          if (!targetEl) continue;
          try {
            if (typeof mod.getDebugNode === 'function') {
              const dbgNode = mod.getDebugNode(targetEl);
              const dbgComp = dbgNode && (dbgNode.componentInstance || dbgNode.context);
              if (isRcInstance(dbgComp)) {
                if (activeWin) activeWin.__agyRemoteControlInstance = dbgComp;
                return dbgComp;
              }
              const foundDbg = searchNgContext(dbgComp || dbgNode);
              if (foundDbg) {
                if (activeWin) activeWin.__agyRemoteControlInstance = foundDbg;
                return foundDbg;
              }
            }
            if (typeof mod.getComponent === 'function') {
              const comp = mod.getComponent(targetEl);
              if (isRcInstance(comp)) {
                if (activeWin) activeWin.__agyRemoteControlInstance = comp;
                return comp;
              }
            }
            const getLCtx = mod['\u0275getLContext'] || mod.getLContext;
            if (typeof getLCtx === 'function') {
              const lCtx = getLCtx(targetEl);
              const foundLCtx = extractFromLContext(lCtx) || searchNgContext((lCtx && lCtx.lView) || lCtx);
              if (foundLCtx) {
                if (activeWin) activeWin.__agyRemoteControlInstance = foundLCtx;
                return foundLCtx;
              }
            }
          } catch (_err) {}
        }

        const RC = mod.RemoteControlComponent || (mod.prototype && typeof mod.prototype.proxyCommand === 'function' ? mod : null);
        if (RC && RC.prototype) {
          if (!RC.prototype.__agyKoProbeHooked) {
            RC.prototype.__agyKoProbeHooked = true;
            hookedRcPrototypes.add(RC.prototype);
            for (const mName of [
              'handleIframeMessage',
              'handleUrlChanged',
              'proxyCommand',
              'streamProxyCommand',
              'handlePortRequest',
              'managePolling',
              'shouldPoll',
              'loadInstances',
              'isDisconnected',
              'onIframeLoad',
              'onWindowOnline',
              'onWindowOffline',
              'isOffline',
              'isDirectIngressMode',
              'isTabHidden',
              'getSelectedInstance',
              'instanceInfos',
              'remoteConversationsInfos',
            ]) {
              if (typeof RC.prototype[mName] === 'function' && disposables && typeof disposables.registerMethodHook === 'function') {
                disposables.registerMethodHook(RC.prototype, mName, (origFn) =>
                  function captureRcThis(ev) {
                    if (this && !this.destroyed && activeWin) {
                      activeWin.__agyRemoteControlInstance = this;
                    }
                    if (mName === 'handleIframeMessage' && ev && ev.data === '__agy_ko_probe__') return undefined;
                    return origFn.apply(this, arguments);
                  }
                );
              }
            }
          }
          try {
            if (activeWin && !activeWin.__agyRemoteControlInstance && activeDoc && typeof activeDoc.dispatchEvent === 'function' && typeof Event === 'function') {
              activeDoc.dispatchEvent(new Event('visibilitychange'));
            }
            if (activeWin && !activeWin.__agyRemoteControlInstance && typeof activeWin.dispatchEvent === 'function' && typeof Event === 'function') {
              activeWin.dispatchEvent(new Event('online'));
            }
            if (activeWin && !activeWin.__agyRemoteControlInstance && typeof MessageEvent === 'function') {
              const origOnLoadProto = RC.prototype.onIframeLoad;
              const origHandleUrlChangedProto = RC.prototype.handleUrlChanged;
              let probeIntercepting = true;
              RC.prototype.onIframeLoad = function probeOnLoad() {
                if (this && !this.destroyed) activeWin.__agyRemoteControlInstance = this;
                if (probeIntercepting) return Promise.resolve();
                return typeof origOnLoadProto === 'function' ? origOnLoadProto.apply(this, arguments) : undefined;
              };
              RC.prototype.handleUrlChanged = function probeUrlChanged() {
                if (this && !this.destroyed) activeWin.__agyRemoteControlInstance = this;
                if (probeIntercepting) return undefined;
                return typeof origHandleUrlChangedProto === 'function'
                  ? origHandleUrlChangedProto.apply(this, arguments)
                  : undefined;
              };
              try {
                activeWin.dispatchEvent(new MessageEvent('message', { data: '__agy_ko_probe__' }));
              } finally {
                probeIntercepting = false;
                RC.prototype.onIframeLoad = origOnLoadProto;
                RC.prototype.handleUrlChanged = origHandleUrlChangedProto;
              }
            }
          } catch (_err) {}
          break;
        }
      }
    }

    return activeWin && activeWin.__agyRemoteControlInstance && !activeWin.__agyRemoteControlInstance.destroyed
      ? activeWin.__agyRemoteControlInstance
      : null;
  }

  function ensureChainedOnIframeLoadHook(targetObj) {
    if (!targetObj || hookedOnLoadTargets.has(targetObj) || typeof targetObj.onIframeLoad !== 'function') return;
    hookedOnLoadTargets.add(targetObj);
    if (disposables && typeof disposables.registerMethodHook === 'function') {
      disposables.registerMethodHook(targetObj, 'onIframeLoad', (origFn) =>
        function guardedOnIframeLoad() {
          if (
            !this.__agyForceAllowOnIframeLoad &&
            (this.__agySuppressAutoIframeLoad || (Number(this.__agySuppressAutoIframeLoadCount) || 0) > 0)
          ) {
            return Promise.resolve();
          }
          return origFn.apply(this, arguments);
        }
      );
    }
  }

  function resolveHostBinding(hostEl, parentWin = win) {
    const activeWin = parentWin || win;
    const iframe = hostEl && typeof hostEl.querySelector === 'function' ? hostEl.querySelector('iframe') : null;
    const rcInst = discoverRcComponentInstance(hostEl, activeWin);
    const isReady = Boolean(rcInst && !rcInst.destroyed);

    // Real csrfToken ONLY — NEVER synthesize 'csrf_token'!
    const csrfToken = String(
      (activeWin && activeWin.__APP_CONFIG__ && activeWin.__APP_CONFIG__.csrfToken) ||
        (rcInst && rcInst.csrfToken) ||
        ''
    );

    const searchStr = activeWin && activeWin.location ? String(activeWin.location.search || '') : '';
    let queryP = '';
    try {
      queryP = new URLSearchParams(searchStr).get('p') || '';
    } catch (_err) {}
    const savedChildPath = String(
      queryP ||
        (rcInst && rcInst.lastSyncedChildPath) ||
        (rcInst && rcInst.initialChildPath) ||
        ''
    ).replace(/^\/+/, '');

    function getIframeSrc() {
      if (!iframe) return '';
      const rawCandidate =
        (typeof iframe.getAttribute === 'function' && iframe.getAttribute('src')) ||
        iframe.src ||
        (rcInst && typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
        '';
      const match = String(rawCandidate).match(/https?:\/\/[^\s"'<>)+]+/);
      return match ? match[0] : String(rawCandidate);
    }

    function acquireAutoLoadSuppression() {
      if (!rcInst) return () => {};
      const protoOwner = findPrototypeOnIframeLoadOwner(rcInst);
      if (protoOwner) ensureChainedOnIframeLoadHook(protoOwner);
      if (Object.prototype.hasOwnProperty.call(rcInst, 'onIframeLoad') && typeof rcInst.onIframeLoad === 'function') {
        ensureChainedOnIframeLoadHook(rcInst);
      }
      rcInst.__agySuppressAutoIframeLoadCount = Math.max(0, Number(rcInst.__agySuppressAutoIframeLoadCount) || 0) + 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const nextCount = Math.max(0, (Number(rcInst.__agySuppressAutoIframeLoadCount) || 1) - 1);
        if (nextCount === 0) {
          delete rcInst.__agySuppressAutoIframeLoadCount;
        } else {
          rcInst.__agySuppressAutoIframeLoadCount = nextCount;
        }
      };
    }

    function invokeOriginalOnIframeLoadUnsuppressed() {
      if (!rcInst || typeof rcInst.onIframeLoad !== 'function') return Promise.resolve();
      const prevForce = rcInst.__agyForceAllowOnIframeLoad;
      rcInst.__agyForceAllowOnIframeLoad = true;
      try {
        return Promise.resolve(rcInst.onIframeLoad());
      } catch (_err) {
        return Promise.resolve();
      } finally {
        if (prevForce === undefined) {
          delete rcInst.__agyForceAllowOnIframeLoad;
        } else {
          rcInst.__agyForceAllowOnIframeLoad = prevForce;
        }
      }
    }

    function syncInitialChildPath(childPath) {
      if (rcInst && childPath) {
        rcInst.initialChildPath = childPath;
      }
    }

    function navigateChildPath(childPath) {
      if (rcInst && childPath && typeof rcInst.navigateIframeToChildPath === 'function') {
        try {
          rcInst.navigateIframeToChildPath(childPath);
        } catch (_err) {}
      }
    }

    function markIframeReady() {
      if (!rcInst) return;
      try {
        if (typeof rcInst.markIframeReady === 'function') {
          rcInst.markIframeReady();
        } else {
          if (rcInst.iframeLoading && typeof rcInst.iframeLoading.set === 'function') {
            rcInst.iframeLoading.set(false);
          }
          if (rcInst.iframeUiReady && typeof rcInst.iframeUiReady.set === 'function') {
            rcInst.iframeUiReady.set(true);
          }
        }
      } catch (_err) {}
    }

    return {
      hostEl,
      iframe,
      rcInst,
      isReady,
      csrfToken,
      savedChildPath,
      getIframeSrc,
      acquireAutoLoadSuppression,
      invokeOriginalOnIframeLoadUnsuppressed,
      syncInitialChildPath,
      navigateChildPath,
      markIframeReady,
    };
  }

  function isExternallyPromotedIframe(iframe) {
    if (!iframe) return false;
    if (iframe.__agyMcpPromoted) return true;
    if (
      iframe.__agyRemotePromotionOwner &&
      iframe.__agyRemotePromotionOwner !== KO_PROMOTION_OWNER &&
      (iframe.__agyRemotePromotionState === 'promoting' || iframe.__agyRemotePromotionState === 'ready')
    ) {
      return true;
    }
    if (
      iframe.__agyPromoted &&
      iframe.__agyRemotePromotionOwner &&
      iframe.__agyRemotePromotionOwner !== KO_PROMOTION_OWNER
    ) {
      return true;
    }
    return false;
  }

  function setPromotionOwnership(iframe, state) {
    if (!iframe) return;
    if (state === 'promoting') {
      iframe.__agyKoPromoted = version;
      iframe.__agyKoPromoting = true;
      iframe.__agyPromoted = true;
      iframe.__agyRemotePromotionOwner = KO_PROMOTION_OWNER;
      iframe.__agyRemotePromotionState = 'promoting';
      return;
    }
    if (state === 'ready') {
      iframe.__agyKoPromoted = version;
      iframe.__agyKoPromoting = false;
      iframe.__agyPromoted = true;
      iframe.__agyRemotePromotionOwner = KO_PROMOTION_OWNER;
      iframe.__agyRemotePromotionState = 'ready';
      return;
    }
    if (state === 'rolled_back') {
      iframe.__agyKoPromoting = false;
      iframe.__agyRemotePromotionState = 'rolled_back';
      delete iframe.__agyKoPromoted;
      if (!iframe.__agyRemotePromotionOwner || iframe.__agyRemotePromotionOwner === KO_PROMOTION_OWNER) {
        delete iframe.__agyPromoted;
        delete iframe.__agyRemotePromotionOwner;
      }
      return;
    }
    if (state === 'idle') {
      iframe.__agyKoPromoting = false;
      delete iframe.__agyKoPromoted;
      if (!iframe.__agyRemotePromotionOwner || iframe.__agyRemotePromotionOwner === KO_PROMOTION_OWNER) {
        delete iframe.__agyPromoted;
        delete iframe.__agyRemotePromotionOwner;
        delete iframe.__agyRemotePromotionState;
      }
    }
  }

  function isWorkerAlreadyAdapted(workerCtor) {
    if (!workerCtor) return false;
    if (workerCtor.__agyWorkerPatched || workerCtor.__agyWorkerBridgeV2) return true;
    if (workerCtor.__agyWorkerAdapted) {
      try {
        const fnSrc = Function.prototype.toString.call(workerCtor);
        // Upgrade legacy v1.x companion AdaptedWorker (lacks nested wfw.Worker & ESM module compilation)
        // while preserving v2.0.0 companion AdaptedWorker (`bridgeDepth`) and synthetic unit-test mocks.
        if (fnSrc.includes('isNativeTrustedUrlObject') && !fnSrc.includes('bridgeDepth')) {
          return false;
        }
      } catch (_err) {}
      return true;
    }
    return false;
  }

  function markWorkerPatched(workerCtor) {
    if (!workerCtor || (typeof workerCtor !== 'function' && typeof workerCtor !== 'object')) {
      return () => {};
    }
    for (const flag of ['__agyWorkerPatched', '__agyWorkerBridgeV2']) {
      try {
        Object.defineProperty(workerCtor, flag, {
          configurable: true,
          enumerable: false,
          writable: true,
          value: true,
        });
      } catch (_err) {
        workerCtor[flag] = true;
      }
    }
    return () => {
      for (const flag of ['__agyWorkerPatched', '__agyWorkerBridgeV2']) {
        try {
          delete workerCtor[flag];
        } catch (_err) {}
      }
    };
  }

  async function probeHostCompanionPlugins(hostEl) {
    const info = {
      resolved: false,
      statusbarInstalled: Boolean(win && win.agyStatusBar),
      mcpManagerInstalled: Boolean(win && win.agyMcpManager),
      koTranslatorInstalled: true,
      statusbarCode: '',
      mcpManagerCode: '',
      koTranslatorCode: '',
    };

    if (win && win.__agyHostInstalledPlugins && typeof win.__agyHostInstalledPlugins === 'object') {
      const override = win.__agyHostInstalledPlugins;
      info.resolved = Boolean(override.resolved !== false);
      info.statusbarInstalled = Boolean(
        override.statusbar || override.hasStatusbar || override['antigravity-statusbar']
      );
      info.mcpManagerInstalled = Boolean(
        override.mcpManager || override.hasMcpManager || override['antigravity-mcp-manager']
      );
      info.koTranslatorInstalled =
        override.hasKoTranslator !== undefined || override.koTranslator !== undefined
          ? Boolean(override.hasKoTranslator || override.koTranslator || override['ko-thought-translator'])
          : true;
      info.statusbarCode = String(override.statusbarCode || override.statusbarBlock || '');
      info.mcpManagerCode = String(override.mcpManagerCode || override.mcpManagerBlock || override.mcpBlock || '');
      info.koTranslatorCode = String(override.koTranslatorCode || override.koTranslatorBlock || override.koBlock || '');
      if (
        info.resolved &&
        (info.statusbarInstalled ||
          info.mcpManagerInstalled ||
          override.statusbar !== undefined ||
          override.mcpManager !== undefined ||
          override.hasStatusbar !== undefined ||
          override.hasMcpManager !== undefined)
      ) {
        return info;
      }
    }

    const iframe = hostEl && typeof hostEl.querySelector === 'function' ? hostEl.querySelector('iframe') : null;
    let cwLsClient = null;
    try {
      const cw = iframe && iframe.contentWindow ? iframe.contentWindow : null;
      cwLsClient = cw && cw.__agyCapturedLsClient ? cw.__agyCapturedLsClient : null;
    } catch (_err) {}
    const lsClient = (win && win.__agyCapturedLsClient) || cwLsClient || null;
    const rcInst = discoverRcComponentInstance(hostEl, win);
    if (!lsClient && (!rcInst || typeof rcInst.proxyCommand !== 'function')) return info;

    const callRpc = async (methods, rpcPath, payload = {}) => {
      if (lsClient) {
        for (const m of methods) {
          if (typeof lsClient[m] === 'function') {
            try {
              const res = await lsClient[m](payload);
              if (res) return res;
            } catch (_err) {}
          }
        }
      }
      if (rcInst && typeof rcInst.proxyCommand === 'function' && rpcPath) {
        try {
          const TE = typeof TextEncoder === 'function' ? new TextEncoder() : null;
          const TD = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;
          const reqStr = JSON.stringify(payload || {});
          const reqBytes = TE
            ? TE.encode(reqStr)
            : Uint8Array.from(reqStr.split('').map((c) => c.charCodeAt(0) & 0xff));
          const res = await rcInst.proxyCommand(rpcPath, reqBytes, {
            'content-type': 'application/json',
            'x-is-streaming': 'false',
          });
          if (res && res.payload) {
            const text = TD ? TD.decode(res.payload) : String.fromCharCode(...new Uint8Array(res.payload));
            if (text) return JSON.parse(text);
          }
        } catch (_err) {}
      }
      return null;
    };

    const applyRawBundleInspection = (rawText) => {
      if (!rawText || typeof rawText !== 'string') return;
      info.resolved = true;
      const mcpStarts = [
        '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
        '/* === BEGIN_AGY_MCP_MANAGER_V1 === */',
        '// === BEGIN_AGY_MCP_MANAGER ===',
        '/* === BEGIN_AGY_MCP_MANAGER === */',
      ];
      const mcpEnds = [
        '// === END_AGY_MCP_MANAGER_V1 ===',
        '/* === END_AGY_MCP_MANAGER_V1 === */',
        '// === END_AGY_MCP_MANAGER ===',
        '/* === END_AGY_MCP_MANAGER === */',
      ];
      const koStarts = ['// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===', '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */'];
      const koEnds = ['// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===', '/* === END_AGY_KO_THOUGHT_LOCALIZER_V2 === */'];
      const sbStarts = ['/* === BEGIN_AGY_STATUSBAR === */', '// === BEGIN_AGY_STATUSBAR ==='];
      const sbEnds = ['/* === END_AGY_STATUSBAR === */', '// === END_AGY_STATUSBAR ==='];

      let sbCode = extractCompanionBlock(rawText, sbStarts, sbEnds);
      const mcpCode = extractCompanionBlock(rawText, mcpStarts, mcpEnds);
      const koCode = extractCompanionBlock(rawText, koStarts, koEnds);

      const markerPositions = [];
      for (const m of [...mcpStarts, ...koStarts, ...sbStarts]) {
        const idx = findLineStartMarkerIndex(rawText, m, 0);
        if (idx !== -1) markerPositions.push(idx);
      }
      const firstIdx = markerPositions.length > 0 ? Math.min(...markerPositions) : rawText.length;
      const baseSegment = rawText.slice(0, firstIdx).trim();

      if (
        !sbCode &&
        baseSegment &&
        (baseSegment.includes('Antigravity Custom Statusbar') ||
          baseSegment.includes('mountContextStatusBar') ||
          baseSegment.includes('./context-window-policy') ||
          (baseSegment.includes('mountStatusBar') && baseSegment.includes('agy-ctx-statusbar')))
      ) {
        sbCode = baseSegment;
      }

      if (sbCode) {
        info.statusbarInstalled = true;
        info.statusbarCode = sbCode;
      }
      if (mcpCode) {
        info.mcpManagerInstalled = true;
        info.mcpManagerCode = mcpCode;
      } else if (
        baseSegment.includes('Antigravity Custom MCP Server Manager') ||
        (baseSegment.includes('mountMcpManager') && !baseSegment.includes('mountContextStatusBar'))
      ) {
        info.mcpManagerInstalled = true;
        info.mcpManagerCode = baseSegment;
      }
      if (koCode) {
        info.koTranslatorInstalled = true;
        info.koTranslatorCode = koCode;
      }
    };

    const normalizeFileUriOrPath = (rawVal) => {
      if (!rawVal) return '';
      let str = String(rawVal).trim();
      if (!str) return '';
      try {
        str = decodeURIComponent(str);
      } catch (_err) {}
      str = str.replace(/^file:\/\//i, '').replace(/\\/g, '/');
      str = str.replace(/^\/+([A-Za-z]:\/)/, '$1').replace(/\/+$/, '');
      return str;
    };

    const rpcPrefix = String(
      (hostCfg && hostCfg.rpcServicePrefix) || '/exa.language_server_pb.LanguageServerService/'
    );
    const makeRpcPath = (methodName) => `${rpcPrefix}${methodName}`;

    try {
      const userRes = await callRpc(['getLocalUserInfo', 'GetLocalUserInfo'], makeRpcPath('GetLocalUserInfo'), {});
      const homeDir = normalizeFileUriOrPath(
        (userRes &&
          (userRes.homeDirUri ||
            userRes.homeDir ||
            userRes.userHome ||
            (userRes.userInfo && (userRes.userInfo.homeDirUri || userRes.userInfo.homeDir)))) ||
          ''
      );
      if (homeDir) {
        const bundlePath = `${homeDir}/.gemini/antigravity/statusbar_autoinject.js`;
        const fileRes = await callRpc(['readFile', 'ReadFile', 'viewFile', 'ViewFile'], makeRpcPath('ReadFile'), {
          uri: bundlePath.startsWith('/') ? `file://${bundlePath}` : `file:///${bundlePath}`,
          path: bundlePath,
          filePath: bundlePath,
          absolutePath: bundlePath,
        });
        const rawContent = String((fileRes && (fileRes.content || fileRes.text || fileRes.data)) || '');
        const decoded =
          rawContent && !rawContent.includes('function') && !rawContent.includes('===')
            ? decodeBase64Utf8(rawContent) || rawContent
            : rawContent;
        applyRawBundleInspection(decoded);
      }

      const [pluginsRes, statesRes] = await Promise.all([
        callRpc(['getAllPlugins', 'GetAllPlugins'], makeRpcPath('GetAllPlugins'), { workspaceUris: [] }),
        callRpc(['getCustomizationStates', 'GetCustomizationStates'], makeRpcPath('GetCustomizationStates'), {}),
      ]);

      const candidatePaths = [];
      const explicitlyDisabled = {
        statusbar: false,
        mcpManager: false,
        koTranslator: false,
      };
      const inspectItem = (item) => {
        if (!item || typeof item !== 'object') return;
        const isItemDisabled =
          item.enabled === false ||
          item.disabled === true ||
          String(item.state || item.status || '').toUpperCase() === 'DISABLED';
        for (const f of [
          item.name,
          item.id,
          item.pluginName,
          item.pluginId,
          item.slug,
          item.path,
          item.uri,
          item.rootUri,
          item.directory,
          item.installPath,
        ]) {
          if (!f) continue;
          const s = String(f);
          if (/antigravity-statusbar/i.test(s)) {
            if (isItemDisabled) explicitlyDisabled.statusbar = true;
            else info.statusbarInstalled = true;
          }
          if (/antigravity-mcp-manager/i.test(s)) {
            if (isItemDisabled) explicitlyDisabled.mcpManager = true;
            else info.mcpManagerInstalled = true;
          }
          if (/ko-thought-translator/i.test(s)) {
            if (isItemDisabled) explicitlyDisabled.koTranslator = true;
            else info.koTranslatorInstalled = true;
          }
        }
        const p = item.path || item.uri || item.rootUri || item.directory || item.installPath;
        if (p) candidatePaths.push(String(p));
      };

      for (const resObj of [pluginsRes, statesRes]) {
        if (!resObj) continue;
        info.resolved = true;
        for (const listKey of ['plugins', 'states', 'items', 'customizations']) {
          if (Array.isArray(resObj[listKey])) {
            resObj[listKey].forEach(inspectItem);
          }
        }
      }
      if (explicitlyDisabled.statusbar) {
        info.statusbarInstalled = false;
        info.statusbarCode = '';
      }
      if (explicitlyDisabled.mcpManager) {
        info.mcpManagerInstalled = false;
        info.mcpManagerCode = '';
      }
      if (explicitlyDisabled.koTranslator) {
        info.koTranslatorInstalled = false;
        info.koTranslatorCode = '';
      }

      if (!candidatePaths.length && !homeDir) {
        const skillsRes = await callRpc(['getAllSkills', 'GetAllSkills'], makeRpcPath('GetAllSkills'), {});
        if (skillsRes && Array.isArray(skillsRes.skills)) {
          info.resolved = true;
          for (const sk of skillsRes.skills) {
            const skPath = sk && (sk.path || sk.uri || sk.rootUri);
            if (skPath) candidatePaths.push(String(skPath));
          }
        }
      }

      if (!homeDir && candidatePaths.length > 0) {
        for (const rawPath of candidatePaths) {
          const norm = normalizeFileUriOrPath(rawPath);
          const idx = norm.indexOf('/.gemini/');
          if (idx !== -1) {
            const geminiDir = norm.slice(0, idx + 8);
            const bundlePath = `${geminiDir}/antigravity/statusbar_autoinject.js`;
            const rf = await callRpc(['readFile', 'ReadFile'], makeRpcPath('ReadFile'), {
              uri: bundlePath.startsWith('/') ? `file://${bundlePath}` : `file:///${bundlePath}`,
              path: bundlePath,
              filePath: bundlePath,
              absolutePath: bundlePath,
            });
            const rawContent = String((rf && (rf.content || rf.text || rf.data)) || '');
            const decoded =
              rawContent && !rawContent.includes('function') && !rawContent.includes('===')
                ? decodeBase64Utf8(rawContent) || rawContent
                : rawContent;
            applyRawBundleInspection(decoded);
            break;
          }
        }
      }
    } catch (_err) {}

    if (win && info.resolved && (!win.__agyHostInstalledPlugins || !win.__agyHostInstalledPlugins.resolved)) {
      win.__agyHostInstalledPlugins = {
        resolved: true,
        statusbar: info.statusbarInstalled,
        hasStatusbar: info.statusbarInstalled,
        mcpManager: info.mcpManagerInstalled,
        hasMcpManager: info.mcpManagerInstalled,
        koTranslator: info.koTranslatorInstalled,
        hasKoTranslator: info.koTranslatorInstalled,
        statusbarBlock: info.statusbarCode,
        statusbarCode: info.statusbarCode,
        mcpBlock: info.mcpManagerCode,
        mcpManagerBlock: info.mcpManagerCode,
        mcpManagerCode: info.mcpManagerCode,
        koBlock: info.koTranslatorCode,
        koTranslatorBlock: info.koTranslatorCode,
        koTranslatorCode: info.koTranslatorCode,
      };
    }

    return info;
  }

  async function syncCompanions(hostEl, helpers) {
    if (!hostEl || !win || !doc || !helpers || typeof helpers.executeAuthorizedInlineScript !== 'function') {
      return;
    }
    if (win.__agyKoSyncingCompanions) return;
    if (win.__agyKoCompanionsSynced && win.__agyHostInstalledPlugins === win.__agyLastHostInstalledPluginsRef) {
      return;
    }

    win.__agyKoSyncingCompanions = true;
    win.__agyLastHostInstalledPluginsRef = win.__agyHostInstalledPlugins;
    try {
      const info = await probeHostCompanionPlugins(hostEl);
      win.__agyLastHostInstalledPluginsRef = win.__agyHostInstalledPlugins;
      if (!info || !info.resolved) return;

      let sbOk = false;
      const hasSbScript = Boolean(
        typeof doc.querySelector === 'function' && doc.querySelector('script[data-agy-companion="statusbar"]')
      );
      if (!info.statusbarInstalled || win.agyStatusBar || hasSbScript) {
        sbOk = true;
      } else if (!win.__agyKoFetchingStatusBar && !win.__agyLoadingStatusBarCompanion) {
        win.__agyKoFetchingStatusBar = true;
        win.__agyLoadingStatusBarCompanion = true;
        try {
          let code = info.statusbarCode;
          if (!code && hostCfg && hostCfg.companionBundles && hostCfg.companionBundles.statusbarUrl && fetchFn) {
            const r = await fetchFn(`${hostCfg.companionBundles.statusbarUrl}?t=${Date.now()}`, {
              credentials: 'omit',
              redirect: 'error',
            });
            code = r && r.ok ? await r.text() : '';
          }
          if (code && !win.agyStatusBar) {
            sbOk = helpers.executeAuthorizedInlineScript(doc, code, { 'data-agy-companion': 'statusbar' });
            if (sbOk && typeof onRefreshStatusbar === 'function') {
              onRefreshStatusbar();
            }
          } else {
            sbOk = Boolean(win.agyStatusBar);
          }
        } catch (_err) {
          sbOk = false;
        } finally {
          delete win.__agyKoFetchingStatusBar;
          delete win.__agyLoadingStatusBarCompanion;
        }
      }

      let mcpOk = false;
      const hasMcpScript = Boolean(
        typeof doc.querySelector === 'function' && doc.querySelector('script[data-agy-companion="mcp-manager"]')
      );
      const mountMcpIntoInnerFrame = () => {
        try {
          const innerFrame = hostEl.querySelector && hostEl.querySelector('iframe');
          if (
            innerFrame &&
            innerFrame.contentWindow &&
            innerFrame.contentDocument &&
            typeof win.__agyMountMcpManager === 'function'
          ) {
            win.__agyMountMcpManager(innerFrame.contentWindow, innerFrame.contentDocument);
          }
        } catch (_err) {}
      };

      if (!info.mcpManagerInstalled || win.agyMcpManager || hasMcpScript) {
        mcpOk = true;
      } else if (!win.__agyKoFetchingMcpManager && !win.__agyLoadingMcpManagerCompanion) {
        win.__agyKoFetchingMcpManager = true;
        win.__agyLoadingMcpManagerCompanion = true;
        try {
          let code = info.mcpManagerCode;
          if (!code && hostCfg && hostCfg.companionBundles && hostCfg.companionBundles.mcpManagerUrl && fetchFn) {
            const r = await fetchFn(`${hostCfg.companionBundles.mcpManagerUrl}?t=${Date.now()}`, {
              credentials: 'omit',
              redirect: 'error',
            });
            code = r && r.ok ? await r.text() : '';
          }
          if (code && !win.agyMcpManager) {
            mcpOk = helpers.executeAuthorizedInlineScript(doc, code, { 'data-agy-companion': 'mcp-manager' });
            if (mcpOk) mountMcpIntoInnerFrame();
          } else {
            mcpOk = Boolean(win.agyMcpManager);
          }
        } catch (_err) {
          mcpOk = false;
        } finally {
          delete win.__agyKoFetchingMcpManager;
          delete win.__agyLoadingMcpManagerCompanion;
        }
      }

      if (sbOk && mcpOk) {
        win.__agyKoCompanionsSynced = true;
      }
    } finally {
      win.__agyKoSyncingCompanions = false;
    }
  }

  function installChildEnvironmentShims(cw, _hostBinding, childDisposables, helpers) {
    if (!cw) return;
    const ua = (cw.navigator && cw.navigator.userAgent) || '';
    const platform =
      ua.includes('Windows') ? 'win32' : ua.includes('Macintosh') || ua.includes('Mac OS') ? 'darwin' : 'linux';

    if (!cw.process) {
      const shimProcess = {
        env: { NODE_ENV: 'production' },
        platform,
        nextTick: (cb) => Promise.resolve().then(cb),
      };
      if (childDisposables && typeof childDisposables.registerPropertyValue === 'function') {
        childDisposables.registerPropertyValue(cw, 'process', shimProcess, { enumerable: true });
      } else {
        cw.process = shimProcess;
      }
    } else {
      if (!cw.process.env) cw.process.env = { NODE_ENV: 'production' };
      if (!cw.process.platform) cw.process.platform = platform;
      if (typeof cw.process.nextTick !== 'function') {
        cw.process.nextTick = (cb) => Promise.resolve().then(cb);
      }
    }

    if (cw.AudioWorklet && cw.AudioWorklet.prototype && typeof cw.AudioWorklet.prototype.addModule === 'function') {
      const registerHook =
        childDisposables && typeof childDisposables.registerMethodHook === 'function'
          ? childDisposables.registerMethodHook.bind(childDisposables)
          : null;
      const wrapAddModule = (origAddModule) =>
        async function shimmedAddModule(moduleUrl, options) {
          const rewritten =
            helpers && typeof helpers.rewriteAssetUrl === 'function'
              ? helpers.rewriteAssetUrl(String(moduleUrl || ''))
              : String(moduleUrl || '');
          if (
            helpers &&
            typeof helpers.fetchText === 'function' &&
            typeof helpers.registerOwnedBlobUrl === 'function' &&
            typeof cw.Blob === 'function' &&
            cw.URL &&
            typeof cw.URL.createObjectURL === 'function'
          ) {
            try {
              const srcText = await helpers.fetchText(rewritten);
              if (srcText) {
                const blob = new cw.Blob([srcText], { type: 'application/javascript' });
                const blobUrl = cw.URL.createObjectURL(blob);
                const disposeBlob = helpers.registerOwnedBlobUrl(blobUrl);
                if (childDisposables && typeof childDisposables.register === 'function') {
                  childDisposables.register(disposeBlob);
                }
                const authorizedUrl =
                  typeof helpers.createAuthorizedScriptUrl === 'function'
                    ? helpers.createAuthorizedScriptUrl(blobUrl)
                    : blobUrl;
                return await origAddModule.call(this, authorizedUrl, options);
              }
            } catch (_err) {}
          }
          try {
            return await origAddModule.call(this, rewritten, options);
          } catch (_err) {
            return undefined;
          }
        };

      if (registerHook) {
        registerHook(cw.AudioWorklet.prototype, 'addModule', wrapAddModule);
      } else {
        cw.AudioWorklet.prototype.addModule = wrapAddModule(cw.AudioWorklet.prototype.addModule);
      }
    }
  }

  function installBootGlobals(cw, hostBinding, appVersion, childDisposables, helpers) {
    if (!cw) return;
    const childAppConfig = {
      productName: String((hostCfg && hostCfg.productName) || 'antigravity'),
      appVersion: String(appVersion || (hostCfg && hostCfg.defaultAppVersion) || '2.33.0'),
      isRemoteControl: true,
    };
    // Security invariant: ONLY attach csrfToken when non-empty; NEVER synthesize 'csrf_token'!
    if (hostBinding && hostBinding.csrfToken) {
      childAppConfig.csrfToken = hostBinding.csrfToken;
    }

    if (childDisposables && typeof childDisposables.registerPropertyValue === 'function') {
      childDisposables.registerPropertyValue(cw, '__APP_CONFIG__', childAppConfig, { enumerable: true });
    } else {
      cw.__APP_CONFIG__ = childAppConfig;
    }

    const prevDec = cw.__JETSKI_LS_CLIENT_DECORATOR__;
    const decorator = function jetskiLsClientDecorator(client) {
      const decorated = typeof prevDec === 'function' ? prevDec(client) || client : client;
      if (decorated && typeof decorated === 'object') {
        cw.__agyCapturedLsClient = decorated;
        if (win) win.__agyCapturedLsClient = decorated;
        if (hostBinding && hostBinding.hostEl) {
          syncCompanions(hostBinding.hostEl, helpers).catch(() => {});
        }
      }
      return decorated;
    };
    if (childDisposables && typeof childDisposables.registerPropertyValue === 'function') {
      childDisposables.registerPropertyValue(cw, '__JETSKI_LS_CLIENT_DECORATOR__', decorator);
    } else {
      cw.__JETSKI_LS_CLIENT_DECORATOR__ = decorator;
    }
  }

  function onWorkbenchReady(cw, cd, _hostEl) {
    if (!cw || !cd) return;
    if (typeof onMountChildLocalizer === 'function') {
      onMountChildLocalizer(cw, cd);
    } else if (win && typeof win.__agyMountKoThoughtLocalizer === 'function') {
      win.__agyMountKoThoughtLocalizer(cw, cd);
    }
    if (win && typeof win.__agyMountMcpManager === 'function') {
      try {
        win.__agyMountMcpManager(cw, cd);
      } catch (_err) {}
    }
  }

  const port = {
    findHostElements,
    resolveHostBinding,
    isExternallyPromotedIframe,
    setPromotionOwnership,
    isWorkerAlreadyAdapted,
    markWorkerPatched,
    syncCompanions,
    installChildEnvironmentShims,
    installBootGlobals,
    onWorkbenchReady,
    probeHostCompanionPlugins,
  };

  return assertValidRemoteHostPort(port);
}

module.exports = {
  KO_PROMOTION_OWNER,
  decodeBase64Utf8,
  findLineStartMarkerIndex,
  extractCompanionBlock,
  createAntigravityRemoteCompanionSync,
};
