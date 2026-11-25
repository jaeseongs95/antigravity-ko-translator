'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectGmXhr, createUserscriptFetch } = require('../../src/adapters/translators/gm-fetch');
const { createGoogleTranslateAdapter } = require('../../src/adapters/translators/google-translate');

test('createUserscriptFetch routes HTTPS requests through GM_xmlhttpRequest and works with GoogleTranslateAdapter', async () => {
  const calls = [];
  const mockGmXhr = (details) => {
    calls.push(details);
    setTimeout(() => {
      details.onload({
        status: 200,
        statusText: 'OK',
        responseText: JSON.stringify([[['원격 번역 성공', 'Remote translation ok']]]),
      });
    }, 5);
    return { abort() {} };
  };

  let fallbackCalls = 0;
  const fallbackFetch = async () => {
    fallbackCalls += 1;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const fetchFn = createUserscriptFetch({ fallbackFetch, gmXhr: mockGmXhr });
  const adapter = createGoogleTranslateAdapter({ fetchFn });
  const translated = await adapter.translate('Remote translation ok');

  assert.equal(translated, '원격 번역 성공');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].anonymous, true);
  assert.ok(calls[0].url.startsWith('https://translate.googleapis.com/translate_a/single?'));
  assert.equal(fallbackCalls, 0);

  // Non-HTTPS loopback URLs fall back to standard fetch
  const localRes = await fetchFn('http://127.0.0.1:11434/api/tags');
  assert.equal(localRes.ok, true);
  assert.equal(fallbackCalls, 1);
});

test('createUserscriptFetch honors AbortSignal, non-2xx statuses, GM.xmlHttpRequest detection, and fallback when absent', async () => {
  let aborted = false;
  const hangingGmXhr = () => ({
    abort() {
      aborted = true;
    },
  });

  const abortCtrl = new AbortController();
  const fetchWithAbort = createUserscriptFetch({ gmXhr: hangingGmXhr, fallbackFetch: async () => ({ ok: true }) });
  const pending = fetchWithAbort('https://translate.googleapis.com/translate_a/single?q=test', {
    signal: abortCtrl.signal,
  });
  abortCtrl.abort();
  await assert.rejects(pending, (err) => err && err.name === 'AbortError');
  assert.equal(aborted, true);

  // Non-2xx returns ok: false response
  const errFetch = createUserscriptFetch({
    gmXhr(details) {
      details.onload({ status: 429, statusText: 'Too Many Requests', responseText: 'rate limited' });
    },
  });
  const res429 = await errFetch('https://translate.googleapis.com/translate_a/single?q=limit');
  assert.equal(res429.ok, false);
  assert.equal(res429.status, 429);
  assert.equal(await res429.text(), 'rate limited');

  // Detects GM.xmlHttpRequest on custom globalScope
  let gmNamespaceCalled = false;
  const scope = {
    GM: {
      xmlHttpRequest(details) {
        gmNamespaceCalled = true;
        details.onload({ status: 200, statusText: 'OK', responseText: '{"ok":true}' });
      },
    },
  };
  assert.equal(typeof detectGmXhr(scope), 'function');
  const nsFetch = createUserscriptFetch({ globalScope: scope, fallbackFetch: async () => ({ ok: false }) });
  const nsRes = await nsFetch('https://api.example.com/translate', { method: 'POST', body: '{"a":1}' });
  assert.equal(gmNamespaceCalled, true);
  assert.deepEqual(await nsRes.json(), { ok: true });

  // Returns fallback directly when no GM_xmlhttpRequest exists
  const directFallback = async () => ({ ok: true });
  assert.equal(createUserscriptFetch({ globalScope: {}, fallbackFetch: directFallback }), directFallback);
});
