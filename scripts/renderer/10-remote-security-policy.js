// Module: 10-remote-security-policy.js
// Responsibility: Remote Control origin/script allowlist, owned Worker Blob URL registry, CSP nonce resolution, and one-time gated TrustedTypes policy port.
  const ownCreatedWorkerBlobUrls = new Set();
  let cachedRemoteTrustedPolicy = null;
  let pendingCompanionInlineAuth = null;

  function isTrustedRemoteOriginUrlObject(parsed) {
    if (!parsed || parsed.protocol !== 'https:') return false;
    const host = String(parsed.hostname || '').toLowerCase();
    return (
      host === 'www.gstatic.com' ||
      host === 'antigravity.google.com' ||
      host.endsWith('.antigravity.google.com') ||
      host === 'antigravity.static.usercontent.goog'
    );
  }

  function isTrustedRemoteScriptUrl(rawUrl) {
    const str = String(rawUrl || '').trim();
    if (!str) return false;
    if (/^blob:/i.test(str)) {
      return typeof ownCreatedWorkerBlobUrls !== 'undefined' && ownCreatedWorkerBlobUrls.has(str);
    }
    try {
      const baseHref =
        window.location && window.location.href && window.location.href !== 'about:blank'
          ? window.location.href
          : 'https://antigravity.google.com/';
      const parsed = new URL(str, baseHref);
      if (
        window.location &&
        window.location.origin &&
        window.location.origin !== 'null' &&
        parsed.origin === window.location.origin &&
        (parsed.protocol === 'https:' ||
          parsed.hostname === '127.0.0.1' ||
          parsed.hostname === 'localhost')
      ) {
        return true;
      }
      return isTrustedRemoteOriginUrlObject(parsed);
    } catch (e) {
      return false;
    }
  }

  function getTrustedPolicyForRemote() {
    if (typeof cachedRemoteTrustedPolicy !== 'undefined' && cachedRemoteTrustedPolicy) {
      return cachedRemoteTrustedPolicy;
    }
    if (window.trustedTypes && typeof window.trustedTypes.createPolicy === 'function') {
      const names = ['agy-ko-translator', 'agy-ko-translator-rc', `agy-ko-translator-${Date.now().toString(36)}`];
      for (const name of names) {
        try {
          const p = window.trustedTypes.createPolicy(name, {
            createScript: (s) => {
              const str = String(s ?? '');
              const auth = typeof pendingCompanionInlineAuth !== 'undefined' ? pendingCompanionInlineAuth : null;
              if (
                !auth ||
                auth.consumed ||
                typeof auth.token !== 'string' ||
                !auth.token ||
                str !== auth.expectedScript ||
                !str.startsWith(auth.token)
              ) {
                throw new TypeError(`Blocked unauthorized inline script in ${name}`);
              }
              auth.consumed = true;
              pendingCompanionInlineAuth = null;
              return str.slice(auth.token.length);
            },
            createScriptURL: (u) => {
              const s = String(u || '');
              if (!isTrustedRemoteScriptUrl(s)) {
                throw new TypeError(`Blocked untrusted script URL in ${name}: ${s}`);
              }
              return s;
            },
          });
          if (typeof cachedRemoteTrustedPolicy !== 'undefined') {
            cachedRemoteTrustedPolicy = p;
          }
          return p;
        } catch (e) {}
      }
    }
    return null;
  }

  function resolveHostCspNonce(doc) {
    if (!doc) return '';
    try {
      const candidates = typeof doc.querySelectorAll === 'function' ? doc.querySelectorAll('script, style, link') : [];
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        const val = (el && (el.nonce || (typeof el.getAttribute === 'function' ? el.getAttribute('nonce') : ''))) || '';
        if (val) return String(val);
      }
      const single = typeof doc.querySelector === 'function' ? doc.querySelector('script[nonce]') : null;
      const fallbackVal =
        (single && (single.nonce || (typeof single.getAttribute === 'function' ? single.getAttribute('nonce') : ''))) || '';
      if (fallbackVal) return String(fallbackVal);
    } catch (e) {}
    return '';
  }

  function canPromoteRemoteScriptUrl(probeUrl) {
    if (!isTrustedRemoteScriptUrl(probeUrl)) return false;
    const preflightPolicy = getTrustedPolicyForRemote();
    try {
      const probeScript = document.createElement('script');
      probeScript.src = preflightPolicy ? preflightPolicy.createScriptURL(probeUrl) : probeUrl;
      return true;
    } catch (e) {
      return false;
    }
  }

  function injectRemoteCompanionScript(code, onDone, companionId = '') {
    if (!code || !document) return;
    if (companionId && typeof document.querySelector === 'function') {
      const existing = document.querySelector(`script[data-agy-companion="${companionId}"]`);
      if (existing) {
        if (typeof onDone === 'function') onDone();
        return;
      }
    }
    const codeStr = String(code);
    let authTicket = null;
    try {
      const s = document.createElement('script');
      const nonce = resolveHostCspNonce(document);
      const p = getTrustedPolicyForRemote();
      if (companionId && typeof s.setAttribute === 'function') {
        s.setAttribute('data-agy-companion', companionId);
      }
      if (nonce) {
        s.nonce = nonce;
        if (typeof s.setAttribute === 'function') s.setAttribute('nonce', nonce);
      }
      if (p && typeof p.createScript === 'function') {
        const randPart =
          typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function'
            ? Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(16)).join('')
            : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        const inlineToken = `/*__agy_ko_inline_${randPart}__*/`;
        const taggedScript = `${inlineToken}${codeStr}`;
        authTicket = { token: inlineToken, expectedScript: taggedScript, consumed: false };
        if (typeof pendingCompanionInlineAuth !== 'undefined') {
          pendingCompanionInlineAuth = authTicket;
        }
        try {
          s.text = p.createScript(taggedScript);
        } finally {
          authTicket.consumed = true;
          if (typeof pendingCompanionInlineAuth !== 'undefined' && pendingCompanionInlineAuth === authTicket) {
            pendingCompanionInlineAuth = null;
          }
        }
      } else {
        s.text = codeStr;
      }
      (document.head || document.documentElement).appendChild(s);
      if (typeof onDone === 'function') onDone();
    } catch (e) {
      if (authTicket) authTicket.consumed = true;
      if (typeof pendingCompanionInlineAuth !== 'undefined' && pendingCompanionInlineAuth === authTicket) {
        pendingCompanionInlineAuth = null;
      }
    }
  }

  if (typeof disposables !== 'undefined' && disposables) {
    disposables.register(() => {
      ownCreatedWorkerBlobUrls.clear();
      cachedRemoteTrustedPolicy = null;
      pendingCompanionInlineAuth = null;
    });
  }
