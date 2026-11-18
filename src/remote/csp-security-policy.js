'use strict';

function isLoopbackHost(hostname) {
  const h = String(hostname || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function createCspSecurityPort(hostCfg, rootWin, disposables, options = {}) {
  if (!hostCfg || typeof hostCfg !== 'object') {
    throw new TypeError('CspSecurityPort requires a valid HostAdapterConfig');
  }
  const win = rootWin || (typeof globalThis !== 'undefined' ? globalThis.window || globalThis : null);
  const allowLoopback = Boolean(options && options.allowLoopbackForTest);

  const ownedBlobUrls = new Set();
  let cachedPolicy = null;
  let policyAttempted = false;
  let pendingInlineAuth = null;

  const trustedHostOriginSet = new Set(
    (Array.isArray(hostCfg.trustedHostOrigins) ? hostCfg.trustedHostOrigins : []).map((o) => String(o).toLowerCase())
  );
  const trustedHostSuffixes = (Array.isArray(hostCfg.trustedHostOriginSuffixes)
    ? hostCfg.trustedHostOriginSuffixes
    : []
  ).map((s) => String(s).toLowerCase());
  const cdnMirrorHostSet = new Set(
    (Array.isArray(hostCfg.cdnMirrorHosts) ? hostCfg.cdnMirrorHosts : []).map((h) => String(h).toLowerCase())
  );
  const sandboxIframeHostSet = new Set(
    (Array.isArray(hostCfg.sandboxIframeHosts) ? hostCfg.sandboxIframeHosts : []).map((h) => String(h).toLowerCase())
  );
  const policyNames = Array.isArray(hostCfg.trustedTypesPolicyNames) ? hostCfg.trustedTypesPolicyNames : [];

  function getRootOrigin() {
    try {
      const origin = win && win.location && typeof win.location.origin === 'string' ? win.location.origin : '';
      return origin && origin !== 'null' ? origin : '';
    } catch (_err) {
      return '';
    }
  }

  function getBaseHref() {
    try {
      const href = win && win.location && typeof win.location.href === 'string' ? win.location.href : '';
      if (href && href !== 'about:blank' && !href.startsWith('about:')) {
        return href;
      }
    } catch (_err) {}
    const fallbackOrigin =
      (Array.isArray(hostCfg.trustedHostOrigins) && hostCfg.trustedHostOrigins[0]) || hostCfg.cdnScriptOrigin;
    return `${fallbackOrigin}/`;
  }

  function isAllowedSchemeForParsed(parsed) {
    if (!parsed) return false;
    if (parsed.protocol === 'https:') {
      if (isLoopbackHost(parsed.hostname)) {
        return allowLoopback || getRootOrigin().toLowerCase() === parsed.origin.toLowerCase();
      }
      return true;
    }
    if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return allowLoopback || getRootOrigin().toLowerCase() === parsed.origin.toLowerCase();
    }
    return false;
  }

  // Script/Worker execution allowlist ONLY — strictly excludes sandboxIframeHosts and multi-tenant domains!
  function isTrustedScriptOriginUrl(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.username || parsed.password) return false;
    if (!isAllowedSchemeForParsed(parsed)) return false;

    const rootOrigin = getRootOrigin();
    if (rootOrigin && parsed.origin.toLowerCase() === rootOrigin.toLowerCase()) {
      const host = String(parsed.hostname || '').toLowerCase();
      if (!sandboxIframeHostSet.has(host)) {
        return true;
      }
    }

    const host = String(parsed.hostname || '').toLowerCase();
    if (sandboxIframeHostSet.has(host)) {
      return false;
    }
    if (cdnMirrorHostSet.has(host)) {
      return true;
    }
    if (trustedHostOriginSet.has(parsed.origin.toLowerCase())) {
      return true;
    }
    for (const suffix of trustedHostSuffixes) {
      if (suffix && host.endsWith(suffix) && host.length > suffix.length) {
        return true;
      }
    }
    return false;
  }

  // Initial iframe.src preflight & sandbox-to-CDN URL mapping ONLY — allows exact sandboxIframeHosts.
  function isTrustedIframePreflightUrl(rawOrParsed) {
    let parsed = rawOrParsed;
    if (typeof rawOrParsed === 'string') {
      const s = rawOrParsed.trim();
      if (!s || /^(?:blob:|data:|javascript:|vbscript:|about:)/i.test(s)) return false;
      try {
        parsed = new URL(s, getBaseHref());
      } catch (_err) {
        return false;
      }
    }
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.username || parsed.password) return false;
    if (!isAllowedSchemeForParsed(parsed)) return false;

    const host = String(parsed.hostname || '').toLowerCase();
    if (sandboxIframeHostSet.has(host)) {
      return true;
    }
    return isTrustedScriptOriginUrl(parsed);
  }

  function isTrustedScriptUrl(rawUrl) {
    const str = String(rawUrl || '').trim();
    if (!str) return false;
    if (/^blob:/i.test(str)) {
      if (!ownedBlobUrls.has(str)) return false;
      const rootOrigin = getRootOrigin();
      if (rootOrigin && !str.toLowerCase().startsWith(`blob:${rootOrigin.toLowerCase()}/`)) {
        return false;
      }
      return true;
    }
    if (/^(?:data:|javascript:|vbscript:|about:)/i.test(str)) {
      return false;
    }
    try {
      const parsed = new URL(str, getBaseHref());
      return isTrustedScriptOriginUrl(parsed);
    } catch (_err) {
      return false;
    }
  }

  function getOrCreateTrustedPolicy() {
    if (cachedPolicy) return cachedPolicy;
    if (policyAttempted) return null;
    const tt = win && win.trustedTypes;
    if (!tt || typeof tt.createPolicy !== 'function') {
      return null;
    }
    policyAttempted = true;
    for (const policyName of policyNames) {
      try {
        const created = tt.createPolicy(policyName, {
          createScript: (scriptInput) => {
            const codeStr = String(scriptInput ?? '');
            const auth = pendingInlineAuth;
            if (
              !auth ||
              auth.consumed ||
              typeof auth.token !== 'string' ||
              !auth.token ||
              codeStr !== auth.expectedScript ||
              !codeStr.startsWith(auth.token)
            ) {
              throw new TypeError(`Unauthorized inline script rejected by policy "${policyName}"`);
            }
            auth.consumed = true;
            pendingInlineAuth = null;
            return codeStr.slice(auth.token.length);
          },
          createScriptURL: (urlInput) => {
            const urlStr = String(urlInput || '');
            if (!isTrustedScriptUrl(urlStr)) {
              throw new TypeError(`Untrusted script URL rejected by policy "${policyName}": ${urlStr}`);
            }
            return urlStr;
          },
        });
        if (created) {
          cachedPolicy = created;
          return created;
        }
      } catch (_err) {}
    }
    return null;
  }

  // D-0041: Chromium CSP3 hides nonce content attributes (`getAttribute('nonce') === ''`) while keeping IDL `el.nonce`.
  // Scan ALL candidate elements and return the FIRST non-empty trimmed nonce!
  function readCspNonce(doc) {
    if (!doc) return '';
    try {
      const selector = 'script[nonce], style[nonce], link[nonce], script, style, link';
      const nodes = typeof doc.querySelectorAll === 'function' ? doc.querySelectorAll(selector) : [];
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el) continue;
        const idlNonce = typeof el.nonce === 'string' ? el.nonce.trim() : '';
        if (idlNonce) return idlNonce;
        const attrNonce =
          typeof el.getAttribute === 'function' ? String(el.getAttribute('nonce') || '').trim() : '';
        if (attrNonce) return attrNonce;
      }
      if (typeof doc.querySelector === 'function') {
        const single = doc.querySelector('script[nonce]');
        if (single) {
          const idlNonce = typeof single.nonce === 'string' ? single.nonce.trim() : '';
          if (idlNonce) return idlNonce;
          const attrNonce =
            typeof single.getAttribute === 'function' ? String(single.getAttribute('nonce') || '').trim() : '';
          if (attrNonce) return attrNonce;
        }
      }
    } catch (_err) {}
    return '';
  }

  // Rev7-F5 #1: Walk up multi-hop same-origin ancestor frames (wDoc -> cw -> rootWin, up to 6 hops)
  function resolveHostCspNonce(doc, explicitWin = null) {
    const startDoc = doc || (explicitWin && explicitWin.document) || (win && win.document ? win.document : null);
    const direct = readCspNonce(startDoc);
    if (direct) return direct;

    const visitedDocs = new Set();
    if (startDoc) visitedDocs.add(startDoc);

    let curWin = null;
    try {
      curWin = explicitWin || (startDoc && startDoc.defaultView) || win || null;
    } catch (_err) {
      curWin = explicitWin || win || null;
    }

    for (let hop = 0; hop < 6 && curWin; hop++) {
      let parentWin = null;
      try {
        parentWin = curWin.parent;
      } catch (_err) {
        break;
      }
      if (!parentWin || parentWin === curWin) break;
      let parentDoc = null;
      try {
        parentDoc = parentWin.document;
      } catch (_err) {
        break;
      }
      if (parentDoc && !visitedDocs.has(parentDoc)) {
        visitedDocs.add(parentDoc);
        const found = readCspNonce(parentDoc);
        if (found) return found;
      }
      curWin = parentWin;
    }

    if (win && win.document && !visitedDocs.has(win.document)) {
      const rootNonce = readCspNonce(win.document);
      if (rootNonce) return rootNonce;
    }
    return '';
  }

  function registerOwnedBlobUrl(blobUrl) {
    const str = String(blobUrl || '').trim();
    if (!str || !/^blob:/i.test(str)) {
      throw new TypeError(`registerOwnedBlobUrl requires a valid blob: URL, got "${blobUrl}"`);
    }
    ownedBlobUrls.add(str);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      ownedBlobUrls.delete(str);
      try {
        const urlApi = (win && win.URL) || (typeof URL !== 'undefined' ? URL : null);
        if (urlApi && typeof urlApi.revokeObjectURL === 'function') {
          urlApi.revokeObjectURL(str);
        }
      } catch (_err) {}
    };
  }

  function createAuthorizedScriptUrl(rawUrl) {
    const str = String(rawUrl || '').trim();
    if (!isTrustedScriptUrl(str)) {
      throw new TypeError(`Blocked untrusted script URL: ${str}`);
    }
    const ttSupported = Boolean(win && win.trustedTypes && typeof win.trustedTypes.createPolicy === 'function');
    const policy = getOrCreateTrustedPolicy();
    if (ttSupported) {
      if (!policy || typeof policy.createScriptURL !== 'function') {
        throw new TypeError(`TrustedTypes policy unavailable for script URL: ${str}`);
      }
      return policy.createScriptURL(str);
    }
    return str;
  }

  function canPromoteScriptUrl(probeUrl) {
    if (!isTrustedScriptUrl(probeUrl)) return false;
    const ttSupported = Boolean(win && win.trustedTypes && typeof win.trustedTypes.createPolicy === 'function');
    const policy = getOrCreateTrustedPolicy();
    if (ttSupported && (!policy || typeof policy.createScriptURL !== 'function')) {
      return false;
    }
    try {
      const authorized = policy ? policy.createScriptURL(probeUrl) : probeUrl;
      const doc = win && win.document;
      if (doc && typeof doc.createElement === 'function') {
        const probeEl = doc.createElement('script');
        probeEl.src = authorized;
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  function makeRandomToken() {
    const cryptoObj = (win && win.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const arr = new Uint32Array(2);
      cryptoObj.getRandomValues(arr);
      return Array.from(arr, (n) => n.toString(16).padStart(8, '0')).join('');
    }
    return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  function assignAuthorizedInlineScript(scriptEl, code, nonce) {
    if (!scriptEl) return false;
    const resolvedNonce = typeof nonce === 'string' && nonce.trim() ? nonce.trim() : '';
    if (resolvedNonce) {
      try {
        scriptEl.nonce = resolvedNonce;
        if (typeof scriptEl.setAttribute === 'function') {
          scriptEl.setAttribute('nonce', resolvedNonce);
        }
      } catch (_err) {}
    }

    const ttSupported = Boolean(win && win.trustedTypes && typeof win.trustedTypes.createPolicy === 'function');
    const policy = getOrCreateTrustedPolicy();
    if (ttSupported && (!policy || typeof policy.createScript !== 'function')) {
      return false;
    }

    const normalizedCode = String(code ?? '');
    let ticket = null;
    try {
      if (policy && typeof policy.createScript === 'function') {
        const token = `/*__inline_auth_${makeRandomToken()}__*/`;
        const tagged = `${token}${normalizedCode}`;
        ticket = { token, expectedScript: tagged, consumed: false };
        pendingInlineAuth = ticket;
        try {
          scriptEl.text = policy.createScript(tagged);
        } finally {
          ticket.consumed = true;
          if (pendingInlineAuth === ticket) {
            pendingInlineAuth = null;
          }
        }
      } else {
        scriptEl.text = normalizedCode;
      }
      return true;
    } catch (_err) {
      if (ticket) ticket.consumed = true;
      if (pendingInlineAuth === ticket) {
        pendingInlineAuth = null;
      }
      return false;
    }
  }

  function executeAuthorizedInlineScript(targetDoc, code, attrs = null) {
    if (!targetDoc || typeof targetDoc.createElement !== 'function' || !code) return false;
    try {
      if (attrs && typeof attrs === 'object' && typeof targetDoc.querySelector === 'function') {
        for (const [attrName, attrVal] of Object.entries(attrs)) {
          if (attrName.startsWith('data-') && attrVal) {
            const safeVal = String(attrVal).replace(/["\\]/g, '');
            const existing = targetDoc.querySelector(`script[${attrName}="${safeVal}"]`);
            if (existing) return true;
          }
        }
      }
      const scriptEl = targetDoc.createElement('script');
      if (attrs && typeof attrs === 'object' && typeof scriptEl.setAttribute === 'function') {
        for (const [k, v] of Object.entries(attrs)) {
          if (v !== undefined && v !== null) {
            scriptEl.setAttribute(k, String(v));
          }
        }
      }
      const nonce = resolveHostCspNonce(targetDoc);
      if (!assignAuthorizedInlineScript(scriptEl, String(code), nonce)) {
        return false;
      }
      const mountTarget = targetDoc.head || targetDoc.body || targetDoc.documentElement;
      if (!mountTarget || typeof mountTarget.appendChild !== 'function') {
        return false;
      }
      mountTarget.appendChild(scriptEl);
      return true;
    } catch (_err) {
      return false;
    }
  }

  if (disposables && typeof disposables.register === 'function') {
    disposables.register(() => {
      for (const blobUrl of Array.from(ownedBlobUrls)) {
        try {
          const urlApi = (win && win.URL) || (typeof URL !== 'undefined' ? URL : null);
          if (urlApi && typeof urlApi.revokeObjectURL === 'function') {
            urlApi.revokeObjectURL(blobUrl);
          }
        } catch (_err) {}
      }
      ownedBlobUrls.clear();
      cachedPolicy = null;
      policyAttempted = false;
      pendingInlineAuth = null;
    });
  }

  return {
    readCspNonce,
    resolveHostCspNonce,
    isTrustedIframePreflightUrl,
    isTrustedScriptOriginUrl,
    isTrustedScriptUrl,
    canPromoteScriptUrl,
    registerOwnedBlobUrl,
    createAuthorizedScriptUrl,
    assignAuthorizedInlineScript,
    executeAuthorizedInlineScript,
  };
}

module.exports = {
  createCspSecurityPort,
};
