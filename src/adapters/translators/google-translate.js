'use strict';

const DEFAULT_GTX_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

function createLinkedAbort(externalSignal, timeoutMs, setTimer = setTimeout, clearTimer = clearTimeout) {
  const ctrl = new AbortController();
  const timer = setTimer(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      ctrl.abort();
    } else if (typeof externalSignal.addEventListener === 'function') {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  return {
    signal: ctrl.signal,
    cleanup() {
      clearTimer(timer);
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', onAbort);
      }
    },
  };
}

function createGoogleTranslateAdapter({
  fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  endpointUrl = DEFAULT_GTX_ENDPOINT,
  timeoutMs = 10000,
  maxConcurrency = 4,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof fetchFn !== 'function') {
    throw new TypeError('fetchFn is required for GoogleTranslateAdapter');
  }

  return {
    id: 'google-translate',
    label: 'Google 번역 (웹 무료 API)',
    description: '빠른 응답 · 추가 리소스 소모 없음 · 네트워크 연결 필요',
    supportsRemote: true,
    maxConcurrency,
    async translate(text, ctx = {}) {
      const signal = ctx && ctx.signal ? ctx.signal : undefined;
      if (signal && signal.aborted) return '';
      const sourceLang = (ctx && ctx.sourceLang) || 'en';
      const targetLang = (ctx && ctx.targetLang) || 'ko';

      const linked = createLinkedAbort(signal, timeoutMs, setTimer, clearTimer);
      try {
        const sep = endpointUrl.includes('?') ? '&' : '?';
        const url = `${endpointUrl}${sep}client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(
          targetLang
        )}&dt=t&q=${encodeURIComponent(String(text || ''))}`;
        const res = await fetchFn(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          signal: linked.signal,
        });
        if (!res || !res.ok) {
          throw new Error(`HTTP ${res ? res.status : 'ERR'}`);
        }
        const data = await res.json();
        if (!Array.isArray(data) || !Array.isArray(data[0])) {
          return '';
        }
        return data[0]
          .map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : ''))
          .join('')
          .trim();
      } finally {
        linked.cleanup();
      }
    },
  };
}

module.exports = {
  DEFAULT_GTX_ENDPOINT,
  createLinkedAbort,
  createGoogleTranslateAdapter,
};
