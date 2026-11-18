// Module: 11-remote-companion-sync.js
// Responsibility: Angular 19 <ga-remote-control> host component discovery adapter and conditional companion plugin synchronizer (statusbar / mcp-manager).
  const hookedRcPrototypes = new Set();

  function getRemoteControlComponentInstance(rcEl) {
    if (window.__agyRemoteControlInstance && !window.__agyRemoteControlInstance.destroyed) {
      return window.__agyRemoteControlInstance;
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
          const tNode = nodeIndex >= 0 && Array.isArray(tView?.data) ? tView.data[nodeIndex] : null;
          if (
            tNode &&
            typeof tNode.directiveStart === 'number' &&
            typeof tNode.componentOffset === 'number' &&
            tNode.componentOffset > -1
          ) {
            const comp = lView[tNode.directiveStart + tNode.componentOffset];
            if (isRcInstance(comp)) return comp;
          }
        } catch (e) {}
        for (let i = 0; i < Math.min(lView.length, 300); i++) {
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
        steps++;
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
      const ngFn = window.ng && typeof window.ng.getComponent === 'function' ? window.ng.getComponent : null;
      if (ngFn) {
        try {
          const comp = ngFn(rcEl);
          if (isRcInstance(comp)) {
            window.__agyRemoteControlInstance = comp;
            return comp;
          }
        } catch (e) {}
      }
      const ngNodes = [
        rcEl,
        rcEl.firstElementChild || null,
        typeof rcEl.querySelector === 'function' ? rcEl.querySelector('iframe') : null,
      ];
      for (const candidateNode of ngNodes) {
        if (!candidateNode || typeof candidateNode !== 'object') continue;
        const ctxKey = Object.keys(candidateNode).find((k) => k.startsWith('__ngContext'));
        const found = searchNgContext(candidateNode.__ngContext__ || (ctxKey ? candidateNode[ctxKey] : null));
        if (found) {
          window.__agyRemoteControlInstance = found;
          return found;
        }
      }
    }
    const gaRootEl = typeof document?.querySelector === 'function' ? document.querySelector('ga-root') : null;
    if (gaRootEl) {
      const rootCtxKey = Object.keys(gaRootEl).find((k) => k.startsWith('__ngContext'));
      const foundFromRoot = searchNgContext(gaRootEl.__ngContext__ || (rootCtxKey ? gaRootEl[rootCtxKey] : null));
      if (foundFromRoot) {
        window.__agyRemoteControlInstance = foundFromRoot;
        return foundFromRoot;
      }
    }
    const nsRoot = window.default_GoogleAntigravity;
    if (nsRoot && typeof nsRoot === 'object') {
      const targetCandidates = [];
      if (rcEl) {
        targetCandidates.push(rcEl);
        if (rcEl.firstElementChild) targetCandidates.push(rcEl.firstElementChild);
        if (typeof rcEl.querySelector === 'function') {
          const innerContainer = rcEl.querySelector('.app-container, .iframe-panel, iframe');
          if (innerContainer && !targetCandidates.includes(innerContainer)) {
            targetCandidates.push(innerContainer);
          }
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
              const dbgComp = dbgNode?.componentInstance || dbgNode?.context;
              if (isRcInstance(dbgComp)) {
                window.__agyRemoteControlInstance = dbgComp;
                return dbgComp;
              }
              const foundFromDbg = searchNgContext(dbgComp || dbgNode);
              if (foundFromDbg) {
                window.__agyRemoteControlInstance = foundFromDbg;
                return foundFromDbg;
              }
            }
            if (typeof mod.getComponent === 'function') {
              const comp = mod.getComponent(targetEl);
              if (isRcInstance(comp)) {
                window.__agyRemoteControlInstance = comp;
                return comp;
              }
            }
            const getLCtx = mod['\u0275getLContext'] || mod.getLContext;
            if (typeof getLCtx === 'function') {
              const lCtx = getLCtx(targetEl);
              const foundFromLCtx = extractFromLContext(lCtx) || searchNgContext(lCtx?.lView || lCtx);
              if (foundFromLCtx) {
                window.__agyRemoteControlInstance = foundFromLCtx;
                return foundFromLCtx;
              }
            }
          } catch (e) {}
        }
        const RC = mod.RemoteControlComponent || (typeof mod.prototype?.proxyCommand === 'function' ? mod : null);
        if (RC && RC.prototype) {
          if (!RC.prototype.__agyKoProbeHooked) {
            RC.prototype.__agyKoProbeHooked = true;
            if (typeof hookedRcPrototypes !== 'undefined' && hookedRcPrototypes) {
              hookedRcPrototypes.add(RC.prototype);
            }
            const hookMethod = (mName) => {
              if (typeof RC.prototype[mName] !== 'function') return;
              if (typeof disposables !== 'undefined' && disposables && typeof disposables.registerMethodHook === 'function') {
                disposables.registerMethodHook(RC.prototype, mName, (origFn) =>
                  function (ev) {
                    if (this && !this.destroyed) {
                      window.__agyRemoteControlInstance = this;
                    }
                    if (mName === 'handleIframeMessage' && ev && ev.data === '__agy_ko_probe__') return;
                    return origFn.apply(this, arguments);
                  }
                );
              } else {
                const origFn = RC.prototype[mName];
                RC.prototype[mName] = function (ev) {
                  if (this && !this.destroyed) {
                    window.__agyRemoteControlInstance = this;
                  }
                  if (mName === 'handleIframeMessage' && ev && ev.data === '__agy_ko_probe__') return;
                  return origFn.apply(this, arguments);
                };
              }
            };
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
              hookMethod(mName);
            }
          }
          try {
            if (!window.__agyRemoteControlInstance && typeof document?.dispatchEvent === 'function' && typeof Event === 'function') {
              document.dispatchEvent(new Event('visibilitychange'));
            }
            if (!window.__agyRemoteControlInstance && typeof window?.dispatchEvent === 'function' && typeof Event === 'function') {
              window.dispatchEvent(new Event('online'));
            }
            if (!window.__agyRemoteControlInstance && typeof MessageEvent === 'function') {
              const innerIframe = rcEl && typeof rcEl.querySelector === 'function' ? rcEl.querySelector('iframe') : null;
              let innerCw = null;
              try {
                innerCw = innerIframe ? innerIframe.contentWindow : null;
              } catch (e) {}
              let innerOrigin = window.location?.origin || '';
              try {
                const rawIframeSrc = innerIframe?.getAttribute?.('src') || innerIframe?.src || '';
                if (rawIframeSrc) {
                  innerOrigin = new URL(rawIframeSrc, window.location?.href || 'https://antigravity.google.com').origin;
                }
              } catch (e) {}
              const origOnLoadProto = RC.prototype.onIframeLoad;
              const origHandleUrlChangedProto = RC.prototype.handleUrlChanged;
              let probeIntercepting = true;
              RC.prototype.onIframeLoad = function () {
                if (this && !this.destroyed) {
                  window.__agyRemoteControlInstance = this;
                }
                if (probeIntercepting) return Promise.resolve();
                return typeof origOnLoadProto === 'function' ? origOnLoadProto.apply(this, arguments) : undefined;
              };
              RC.prototype.handleUrlChanged = function () {
                if (this && !this.destroyed) {
                  window.__agyRemoteControlInstance = this;
                }
                if (probeIntercepting) return;
                return typeof origHandleUrlChangedProto === 'function'
                  ? origHandleUrlChangedProto.apply(this, arguments)
                  : undefined;
              };
              try {
                window.dispatchEvent(new MessageEvent('message', { data: '__agy_ko_probe__' }));
                const buildProbeMessageEvent = (dataPayload) => {
                  const evInit = {
                    data: dataPayload,
                    origin: innerOrigin,
                  };
                  if (innerCw) {
                    try {
                      evInit.source = innerCw;
                    } catch (e) {}
                  }
                  let probeMsgEv;
                  try {
                    probeMsgEv = new MessageEvent('message', evInit);
                  } catch (e) {
                    probeMsgEv = new MessageEvent('message', {
                      data: dataPayload,
                      origin: innerOrigin,
                    });
                    if (innerCw) {
                      try {
                        Object.defineProperty(probeMsgEv, 'source', { get: () => innerCw });
                      } catch (err) {}
                    }
                  }
                  return probeMsgEv;
                };
                if (!window.__agyRemoteControlInstance) {
                  window.dispatchEvent(
                    buildProbeMessageEvent({ type: 'URL_CHANGED', path: '', __agyKoProbe: true })
                  );
                }
                if (!window.__agyRemoteControlInstance) {
                  window.dispatchEvent(
                    buildProbeMessageEvent({ type: 'IFRAME_READY', payload: { __agyKoProbe: true } })
                  );
                }
              } finally {
                probeIntercepting = false;
                RC.prototype.onIframeLoad = origOnLoadProto;
                RC.prototype.handleUrlChanged = origHandleUrlChangedProto;
              }
            }
          } catch (e) {}
          break;
        }
      }
    }
    return window.__agyRemoteControlInstance && !window.__agyRemoteControlInstance.destroyed
      ? window.__agyRemoteControlInstance
      : null;
  }

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
    } catch (e) {}
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

  async function probeHostCompanionPluginsForRemote(rcEl) {
    const info = {
      resolved: false,
      statusbarInstalled: Boolean(window.agyStatusBar),
      mcpManagerInstalled: Boolean(window.agyMcpManager),
      koTranslatorInstalled: true,
      statusbarCode: '',
      mcpManagerCode: '',
      koTranslatorCode: '',
    };
    if (window.__agyHostInstalledPlugins && typeof window.__agyHostInstalledPlugins === 'object') {
      const override = window.__agyHostInstalledPlugins;
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

    const iframe = rcEl && rcEl.querySelector ? rcEl.querySelector('iframe') : null;
    let cwLsClient = null;
    try {
      const cw = iframe && iframe.contentWindow ? iframe.contentWindow : null;
      cwLsClient = cw && cw.__agyCapturedLsClient ? cw.__agyCapturedLsClient : null;
    } catch (e) {}
    const lsClient = window.__agyCapturedLsClient || cwLsClient || null;
    const rcInst = getRemoteControlComponentInstance(rcEl);
    if (!lsClient && (!rcInst || typeof rcInst.proxyCommand !== 'function')) return info;

    const callRpc = async (methods, rpcPath, payload = {}) => {
      if (lsClient) {
        for (const m of methods) {
          if (typeof lsClient[m] === 'function') {
            try {
              const res = await lsClient[m](payload);
              if (res) return res;
            } catch (e) {}
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
            const text = TD
              ? TD.decode(res.payload)
              : String.fromCharCode(...new Uint8Array(res.payload));
            if (text) return JSON.parse(text);
          }
        } catch (e) {}
      }
      return null;
    };

    const applyRawBundleInspection = (rawText) => {
      if (!rawText || typeof rawText !== 'string') return;
      info.resolved = true;
      const mcpStartMarkers = [
        '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
        '/* === BEGIN_AGY_MCP_MANAGER_V1 === */',
        '// === BEGIN_AGY_MCP_MANAGER ===',
        '/* === BEGIN_AGY_MCP_MANAGER === */',
      ];
      const mcpEndMarkers = [
        '// === END_AGY_MCP_MANAGER_V1 ===',
        '/* === END_AGY_MCP_MANAGER_V1 === */',
        '// === END_AGY_MCP_MANAGER ===',
        '/* === END_AGY_MCP_MANAGER === */',
      ];
      const koStartMarkers = [
        '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
        '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
      ];
      const koEndMarkers = [
        '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
        '/* === END_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
      ];
      const sbStartMarkers = ['/* === BEGIN_AGY_STATUSBAR === */', '// === BEGIN_AGY_STATUSBAR ==='];
      const sbEndMarkers = ['/* === END_AGY_STATUSBAR === */', '// === END_AGY_STATUSBAR ==='];

      let sbCode = extractCompanionBlock(rawText, sbStartMarkers, sbEndMarkers);
      const mcpCode = extractCompanionBlock(rawText, mcpStartMarkers, mcpEndMarkers);
      const koCode = extractCompanionBlock(rawText, koStartMarkers, koEndMarkers);

      const markerPositions = [];
      for (const m of [...mcpStartMarkers, ...koStartMarkers, ...sbStartMarkers]) {
        const idx = findLineStartMarkerIndex(rawText, m, 0);
        if (idx !== -1) markerPositions.push(idx);
      }
      const firstMarkerIdx = markerPositions.length > 0 ? Math.min(...markerPositions) : rawText.length;
      const baseSegment = rawText.slice(0, firstMarkerIdx).trim();

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
      } catch (e) {}
      str = str.replace(/^file:\/\//i, '').replace(/\\/g, '/');
      str = str.replace(/^\/+([A-Za-z]:\/)/, '$1').replace(/\/+$/, '');
      return str;
    };

    try {
      const userRes = await callRpc(
        ['getLocalUserInfo', 'GetLocalUserInfo'],
        '/exa.language_server_pb.LanguageServerService/GetLocalUserInfo',
        {}
      );
      const homeDir = normalizeFileUriOrPath(
        userRes?.homeDirUri ||
          userRes?.homeDir ||
          userRes?.userHome ||
          userRes?.userInfo?.homeDirUri ||
          userRes?.userInfo?.homeDir ||
          ''
      );
      if (homeDir) {
        const bundlePath = `${homeDir}/.gemini/antigravity/statusbar_autoinject.js`;
        const fileRes = await callRpc(
          ['readFile', 'ReadFile', 'viewFile', 'ViewFile'],
          '/exa.language_server_pb.LanguageServerService/ReadFile',
          {
            uri: bundlePath.startsWith('/') ? `file://${bundlePath}` : `file:///${bundlePath}`,
            path: bundlePath,
            filePath: bundlePath,
            absolutePath: bundlePath,
          }
        );
        const rawContent = String(fileRes?.content || fileRes?.text || fileRes?.data || '');
        const decoded =
          rawContent && !rawContent.includes('function') && !rawContent.includes('===')
            ? decodeBase64Utf8(rawContent) || rawContent
            : rawContent;
        applyRawBundleInspection(decoded);
      }

      const [pluginsRes, statesRes] = await Promise.all([
        callRpc(
          ['getAllPlugins', 'GetAllPlugins'],
          '/exa.language_server_pb.LanguageServerService/GetAllPlugins',
          { workspaceUris: [] }
        ),
        callRpc(
          ['getCustomizationStates', 'GetCustomizationStates'],
          '/exa.language_server_pb.LanguageServerService/GetCustomizationStates',
          {}
        ),
      ]);

      const candidatePaths = [];
      const inspectPluginItemIdentity = (item) => {
        if (!item || typeof item !== 'object') return;
        const fields = [
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
        ];
        for (const f of fields) {
          if (!f) continue;
          const s = String(f);
          if (/antigravity-statusbar/i.test(s)) info.statusbarInstalled = true;
          if (/antigravity-mcp-manager/i.test(s)) info.mcpManagerInstalled = true;
          if (/ko-thought-translator/i.test(s)) info.koTranslatorInstalled = true;
        }
        const pathCandidate = item.path || item.uri || item.rootUri || item.directory || item.installPath;
        if (pathCandidate) candidatePaths.push(String(pathCandidate));
      };

      for (const resObj of [pluginsRes, statesRes]) {
        if (!resObj) continue;
        info.resolved = true;
        for (const listKey of ['plugins', 'states', 'items', 'customizations']) {
          if (Array.isArray(resObj[listKey])) {
            for (const entry of resObj[listKey]) {
              inspectPluginItemIdentity(entry);
            }
          }
        }
      }

      if (!candidatePaths.length && !homeDir) {
        const skillsRes = await callRpc(
          ['getAllSkills', 'GetAllSkills'],
          '/exa.language_server_pb.LanguageServerService/GetAllSkills',
          {}
        );
        if (Array.isArray(skillsRes?.skills)) {
          info.resolved = true;
          for (const sk of skillsRes.skills) {
            const skPath = sk?.path || sk?.uri || sk?.rootUri;
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
            const uri = bundlePath.startsWith('/') ? `file://${bundlePath}` : `file:///${bundlePath}`;
            const rf = await callRpc(
              ['readFile', 'ReadFile'],
              '/exa.language_server_pb.LanguageServerService/ReadFile',
              { uri, path: bundlePath, filePath: bundlePath, absolutePath: bundlePath }
            );
            const rawContent = String(rf?.content || rf?.text || rf?.data || '');
            const decoded =
              rawContent && !rawContent.includes('function') && !rawContent.includes('===')
                ? decodeBase64Utf8(rawContent) || rawContent
                : rawContent;
            applyRawBundleInspection(decoded);
            break;
          }
        }
      }
    } catch (e) {}

    if (info.resolved && (!window.__agyHostInstalledPlugins || !window.__agyHostInstalledPlugins.resolved)) {
      window.__agyHostInstalledPlugins = {
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

  function syncRemoteCompanionPlugins(rcEl) {
    if (!rcEl || window.__agyKoSyncingCompanions) return;
    let cwLsClient = null;
    try {
      cwLsClient = rcEl.querySelector?.('iframe')?.contentWindow?.__agyCapturedLsClient || null;
    } catch (e) {}
    const hasRpcOrOverride = Boolean(
      window.__agyCapturedLsClient ||
        cwLsClient ||
        window.__agyHostInstalledPlugins ||
        getRemoteControlComponentInstance(rcEl)
    );
    if (!hasRpcOrOverride) return;
    if (window.__agyKoCompanionsSynced && window.__agyHostInstalledPlugins === window.__agyLastHostInstalledPluginsRef) {
      return;
    }
    window.__agyKoSyncingCompanions = true;
    window.__agyLastHostInstalledPluginsRef = window.__agyHostInstalledPlugins;

    probeHostCompanionPluginsForRemote(rcEl)
      .then((info) => {
        window.__agyLastHostInstalledPluginsRef = window.__agyHostInstalledPlugins;
        if (!info || !info.resolved) return;

        let sbSyncDone = false;
        let sbAsyncPromise = null;
        const hasSbScript = Boolean(
          typeof document?.querySelector === 'function' &&
            document.querySelector('script[data-agy-companion="statusbar"]')
        );
        if (!info.statusbarInstalled || window.agyStatusBar || hasSbScript) {
          sbSyncDone = true;
        } else if (!window.__agyKoFetchingStatusBar && !window.__agyLoadingStatusBarCompanion) {
          window.__agyKoFetchingStatusBar = true;
          window.__agyLoadingStatusBarCompanion = true;
          if (info.statusbarCode) {
            try {
              sbSyncDone = Boolean(
                injectRemoteCompanionScript(info.statusbarCode, () => refreshStatusbarTranslatorAdapter(), 'statusbar')
              );
            } finally {
              delete window.__agyKoFetchingStatusBar;
              delete window.__agyLoadingStatusBarCompanion;
            }
          } else if (typeof fetch === 'function') {
            sbAsyncPromise = fetch(
              'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js?t=' +
                Date.now()
            )
              .then((r) => (r && r.ok ? r.text() : ''))
              .then((code) => {
                if (window.agyStatusBar) return true;
                if (!code) return false;
                return Boolean(
                  injectRemoteCompanionScript(code, () => refreshStatusbarTranslatorAdapter(), 'statusbar')
                );
              })
              .catch(() => false)
              .finally(() => {
                delete window.__agyKoFetchingStatusBar;
                delete window.__agyLoadingStatusBarCompanion;
              });
          } else {
            delete window.__agyKoFetchingStatusBar;
            delete window.__agyLoadingStatusBarCompanion;
          }
        }

        let mcpSyncDone = false;
        let mcpAsyncPromise = null;
        const hasMcpScript = Boolean(
          typeof document?.querySelector === 'function' &&
            document.querySelector('script[data-agy-companion="mcp-manager"]')
        );
        if (!info.mcpManagerInstalled || window.agyMcpManager || hasMcpScript) {
          mcpSyncDone = true;
        } else if (!window.__agyKoFetchingMcpManager && !window.__agyLoadingMcpManagerCompanion) {
          window.__agyKoFetchingMcpManager = true;
          window.__agyLoadingMcpManagerCompanion = true;
          const mountMcpIntoInnerFrame = () => {
            try {
              const innerFrame = rcEl.querySelector('iframe');
              if (
                innerFrame &&
                innerFrame.contentWindow &&
                innerFrame.contentDocument &&
                typeof window.__agyMountMcpManager === 'function'
              ) {
                window.__agyMountMcpManager(innerFrame.contentWindow, innerFrame.contentDocument);
              }
            } catch (e) {}
          };
          if (info.mcpManagerCode) {
            try {
              mcpSyncDone = Boolean(injectRemoteCompanionScript(info.mcpManagerCode, mountMcpIntoInnerFrame, 'mcp-manager'));
            } finally {
              delete window.__agyKoFetchingMcpManager;
              delete window.__agyLoadingMcpManagerCompanion;
            }
          } else if (typeof fetch === 'function') {
            mcpAsyncPromise = fetch(
              'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t=' +
                Date.now()
            )
              .then((r) => (r && r.ok ? r.text() : ''))
              .then((code) => {
                if (window.agyMcpManager) return true;
                if (!code) return false;
                return Boolean(injectRemoteCompanionScript(code, mountMcpIntoInnerFrame, 'mcp-manager'));
              })
              .catch(() => false)
              .finally(() => {
                delete window.__agyKoFetchingMcpManager;
                delete window.__agyLoadingMcpManagerCompanion;
              });
          } else {
            delete window.__agyKoFetchingMcpManager;
            delete window.__agyLoadingMcpManagerCompanion;
          }
        }

        if (!sbAsyncPromise && !mcpAsyncPromise) {
          if (sbSyncDone && mcpSyncDone) {
            window.__agyKoCompanionsSynced = true;
          }
          return null;
        }
        return Promise.all([
          sbAsyncPromise || Promise.resolve(sbSyncDone),
          mcpAsyncPromise || Promise.resolve(mcpSyncDone),
        ])
          .then(([sbOk, mcpOk]) => {
            if (sbOk && mcpOk) {
              window.__agyKoCompanionsSynced = true;
            }
          })
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        window.__agyKoSyncingCompanions = false;
      });
  }

  if (typeof disposables !== 'undefined' && disposables) {
    disposables.register((fullRestore) => {
      for (const proto of hookedRcPrototypes) {
        try {
          delete proto.__agyKoProbeHooked;
        } catch (e) {}
      }
      hookedRcPrototypes.clear();
      delete window.__agyKoSyncingCompanions;
      if (fullRestore) {
        delete window.__agyKoCompanionsSynced;
        delete window.__agyKoFetchingStatusBar;
        delete window.__agyKoFetchingMcpManager;
      }
    });
  }
