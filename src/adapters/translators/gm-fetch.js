'use strict';

/**
 * Userscript CSP/CORS-resilient HTTPS fetch adapter (v2.4.0).
 *
 * On Antigravity Remote Web (`https://antigravity.google.com`), strict page CSP
 * `connect-src` or CORS can block direct `fetch()` calls to `translate.googleapis.com`
 * or remote HTTPS translation endpoints. When running inside a Userscript manager
 * (Tampermonkey, Violentmonkey, Safari Userscripts) with `@grant GM_xmlhttpRequest`,
 * this adapter transparently routes `https:` requests through `GM_xmlhttpRequest`
 * (`GM.xmlHttpRequest`), honoring `AbortSignal` and `anonymous: true`, while leaving
 * Desktop Electron, MV3 extensions, and local loopback HTTP (`http://127.0.0.1:...`)
 * on standard `fetch`.
 */

function detectGmXhr(globalScope) {
  try {
    // eslint-disable-next-line no-undef
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
  } catch (_err) {}
  try {
    // eslint-disable-next-line no-undef
    if (typeof GM === 'object' && GM && typeof GM.xmlHttpRequest === 'function') {
      // eslint-disable-next-line no-undef
      return GM.xmlHttpRequest.bind(GM);
    }
  } catch (_err) {}
  const scope = globalScope || (typeof globalThis !== 'undefined' ? globalThis : null);
  if (scope && typeof scope.GM_xmlhttpRequest === 'function') {
    return scope.GM_xmlhttpRequest.bind(scope);
  }
  if (scope && scope.GM && typeof scope.GM.xmlHttpRequest === 'function') {
    return scope.GM.xmlHttpRequest.bind(scope.GM);
  }
  return null;
}

function isHttpsUrl(rawUrl) {
  return typeof rawUrl === 'string' && /^https:\/\//i.test(rawUrl.trim());
}

function makeAbortError() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

function createUserscriptFetch({
  fallbackFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  gmXhr = null,
  globalScope = null,
} = {}) {
  const xhrFn = typeof gmXhr === 'function' ? gmXhr : detectGmXhr(globalScope);
  if (typeof xhrFn !== 'function') {
    return fallbackFetch;
  }

  return function userscriptFetch(url, init = {}) {
    const targetUrl = typeof url === 'string' ? url : String(url || '');
    if (!isHttpsUrl(targetUrl)) {
      if (typeof fallbackFetch === 'function') {
        return fallbackFetch(url, init);
      }
      return Promise.reject(new Error('ERR_NON_HTTPS_WITHOUT_FALLBACK_FETCH'));
    }

    const opts = init && typeof init === 'object' ? init : {};
    const signal = opts.signal || null;
    if (signal && signal.aborted) {
      return Promise.reject(makeAbortError());
    }

    const method = typeof opts.method === 'string' && opts.method.trim() ? opts.method.trim().toUpperCase() : 'GET';
    const headers = opts.headers && typeof opts.headers === 'object' ? { ...opts.headers } : undefined;
    const data = opts.body !== undefined && opts.body !== null ? String(opts.body) : undefined;

    return new Promise((resolve, reject) => {
      let settled = false;
      let reqHandle = null;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        try {
          if (reqHandle && typeof reqHandle.abort === 'function') {
            reqHandle.abort();
          }
        } catch (_err) {}
        reject(makeAbortError());
      };

      const cleanup = () => {
        if (signal && typeof signal.removeEventListener === 'function') {
          try {
            signal.removeEventListener('abort', onAbort);
          } catch (_err) {}
        }
      };

      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        reqHandle = xhrFn({
          method,
          url: targetUrl,
          headers,
          data,
          anonymous: opts.credentials !== 'include',
          onload(res) {
            if (settled) return;
            settled = true;
            cleanup();
            const status = res && typeof res.status === 'number' ? res.status : 0;
            const statusText = res && typeof res.statusText === 'string' ? res.statusText : '';
            const responseText = res && typeof res.responseText === 'string' ? res.responseText : '';
            resolve({
              ok: status >= 200 && status < 300,
              status,
              statusText,
              async text() {
                return responseText;
              },
              async json() {
                return JSON.parse(responseText);
              },
            });
          },
          onerror(err) {
            if (settled) return;
            settled = true;
            cleanup();
            const detail = err && typeof err.error === 'string' ? err.error : 'GM_XHR_NETWORK_ERROR';
            reject(new Error(detail));
          },
          ontimeout() {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('GM_XHR_TIMEOUT'));
          },
          onabort() {
            if (settled) return;
            settled = true;
            cleanup();
            reject(makeAbortError());
          },
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      }
    });
  };
}

module.exports = {
  detectGmXhr,
  createUserscriptFetch,
};
