'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTranslationEndpointUrl } = require('../../src/adapters/translators/endpoint-validator');
const { createHostAdapterConfig } = require('../../src/adapters/host-adapter-config');
const { resolveAntigravityHostConfig } = require('../../src/adapters/antigravity/host-config-preset');
const { createCspSecurityPort } = require('../../src/remote/csp-security-policy');
const { createAssetUrlRewriter } = require('../../src/remote/asset-url-rewriter');
const { createDisposableRegistry } = require('../../src/core/disposable-registry');

test('Security & URL (SSRF Validator): blocks IPv4 private/metadata, IPv4-mapped/compatible IPv6, NAT64, 6to4, and Teredo', () => {
  // Canonical loopback HTTP is allowed ONLY for local loopback
  const okLoopback = validateTranslationEndpointUrl('http://127.0.0.1:11434/api/chat', {
    allowRemoteHttps: false,
  });
  assert.equal(okLoopback.origin, 'http://127.0.0.1:11434');

  // Remote HTTPS allowed ONLY when allowRemoteHttps === true AND non-private host
  assert.throws(
    () => validateTranslationEndpointUrl('https://translate.example.com/v1', { allowRemoteHttps: false }),
    /requires allowRemoteHttps: true/i
  );
  const okRemote = validateTranslationEndpointUrl('https://translate.example.com/v1', {
    allowRemoteHttps: true,
  });
  assert.equal(okRemote.origin, 'https://translate.example.com');

  const blockedEndpoints = [
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.15/v1',
    'https://172.16.5.4/v1',
    'https://192.168.1.1/v1',
    'https://100.64.0.1/v1',
    'https://[::ffff:169.254.169.254]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::192.168.0.1]/v1',
    'https://[64:ff9b::169.254.169.254]/v1', // NAT64 RFC 6052
    'https://[2002:0a00:0001::1]/v1', // 6to4 RFC 3056 (10.0.0.1)
    'https://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]/v1', // Teredo RFC 4380
    'https://[fe80::1]/v1',
    'https://[fd00::1]/v1',
    'https://internal.localhost/v1',
    'https://db.local/v1',
    'https://user:pass@translate.example.com/v1',
    'file:///etc/passwd',
  ];

  for (const badUrl of blockedEndpoints) {
    assert.throws(
      () => validateTranslationEndpointUrl(badUrl, { allowRemoteHttps: true }),
      (err) => err instanceof Error,
      `Expected SSRF validator to block: ${badUrl}`
    );
  }
});

test('Security & URL (Rev6-F1 Apex-Pinned Suffix & Disjoint Sandbox-vs-Script Invariant): blocks .usercontent.goog and excludes sandboxIframeHosts from script execution', () => {
  // 1) Multi-tenant public suffixes (`.usercontent.goog`, `.github.io`) without apex pin MUST be rejected at HostAdapterConfig construction
  const preset = resolveAntigravityHostConfig();
  assert.throws(
    () =>
      createHostAdapterConfig({
        ...preset,
        trustedHostOriginSuffixes: ['.usercontent.goog'],
      }),
    /Apex-Pinned Invariant violated/i
  );

  // 2) Disjoint Sandbox-vs-Script Invariant on Antigravity preset:
  //    `antigravity.static.usercontent.goog` is trusted ONLY for iframe preflight & asset rewrite -> `www.gstatic.com`,
  //    and NEVER for script execution (`isTrustedScriptUrl` === false, `createAuthorizedScriptUrl` throws TypeError)!
  const disposables = createDisposableRegistry();
  const hostCfg = resolveAntigravityHostConfig();
  const revokedUrls = [];
  const fakeWin = {
    location: { origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/abc' },
    URL: {
      revokeObjectURL(u) {
        revokedUrls.push(u);
      },
    },
    document: {
      querySelectorAll: () => [],
      createElement: () => ({ src: '' }),
    },
  };

  const csp = createCspSecurityPort(hostCfg, fakeWin, disposables);

  assert.equal(
    csp.isTrustedIframePreflightUrl('https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true'),
    true
  );
  assert.equal(
    csp.isTrustedIframePreflightUrl('https://attacker-tenant.usercontent.goog/web/2.33.0/?iframe=true'),
    false
  );
  assert.equal(
    csp.isTrustedScriptUrl('https://antigravity.static.usercontent.goog/web/2.33.0/main.js'),
    false,
    'Rev6-F1: sandboxIframeHosts must NEVER be trusted for direct script execution'
  );
  assert.throws(
    () => csp.createAuthorizedScriptUrl('https://antigravity.static.usercontent.goog/web/2.33.0/main.js'),
    TypeError
  );
  assert.equal(csp.isTrustedScriptUrl('https://www.gstatic.com/antigravity/web/2.33.0/main.js'), true);

  // Closure-private ownedBlobUrls: arbitrary foreign blob: URLs are rejected!
  assert.equal(csp.isTrustedScriptUrl('blob:https://antigravity.google.com/unowned-foreign-uuid'), false);
  const ownedBlob = 'blob:https://antigravity.google.com/owned-worker-1';
  const releaseBlob = csp.registerOwnedBlobUrl(ownedBlob);
  assert.equal(csp.isTrustedScriptUrl(ownedBlob), true);
  releaseBlob();
  assert.equal(csp.isTrustedScriptUrl(ownedBlob), false);
  assert.deepEqual(revokedUrls, [ownedBlob]);
});

test('Security & URL (D-0041 CSP3 Nonce-Hiding, Rev7-F5 #1 Multi-Hop Nonce, and Protected /r/ & /_/ Asset Rewriter)', () => {
  const hostCfg = resolveAntigravityHostConfig();

  // D-0041: Element 1 has empty `nonce=""` decoy; Element 2 has CSP3 hidden attribute (`getAttribute('nonce') === ''`)
  //         with live `el.nonce === 'real-csp3-nonce-xyz'`!
  const rootDoc = {
    querySelectorAll() {
      return [
        { nonce: '', getAttribute: () => '' },
        { nonce: 'real-csp3-nonce-xyz', getAttribute: () => '' },
      ];
    },
  };
  const rootWin = {
    location: { origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/123' },
    document: rootDoc,
  };
  rootWin.parent = rootWin;

  // Rev7-F5 #1: 3-frame hierarchy: rootWin -> promotedChildWin (no nonce) -> workerGrandchildWin (no nonce)
  const childDoc = { querySelectorAll: () => [] };
  const childWin = { parent: rootWin, document: childDoc };
  childDoc.defaultView = childWin;
  const workerGrandchildDoc = { querySelectorAll: () => [] };
  const workerGrandchildWin = {
    location: { origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/123' },
    parent: childWin,
    document: workerGrandchildDoc,
  };
  workerGrandchildDoc.defaultView = workerGrandchildWin;

  const csp = createCspSecurityPort(hostCfg, workerGrandchildWin);
  assert.equal(csp.readCspNonce(rootDoc), 'real-csp3-nonce-xyz');
  assert.equal(
    csp.resolveHostCspNonce(workerGrandchildDoc, workerGrandchildWin),
    'real-csp3-nonce-xyz',
    'Rev7-F5 #1: 3-frame worker grandchild must traverse parent chain up to rootWin nonce'
  );

  // Asset URL rewriter preserves `/r/` and `/_/` on host origin while rewriting sandbox & `/web/` assets to CDN
  const rewriter = createAssetUrlRewriter({
    basePath: '/web/2.33.0',
    cdnBaseUrl: 'https://www.gstatic.com/antigravity/web/2.33.0',
    cdnOrigin: 'https://www.gstatic.com/antigravity',
    hostOrigin: 'https://antigravity.google.com',
    hostHref: 'https://antigravity.google.com/r/547d-v2',
    hostCfg,
    cspSecurityPort: csp,
  });

  assert.equal(
    rewriter.rewriteAssetUrl('/_/GoogleAntigravity/cspreport'),
    'https://antigravity.google.com/_/GoogleAntigravity/cspreport'
  );
  assert.equal(
    rewriter.rewriteAssetUrl('/r/547d-v2'),
    'https://antigravity.google.com/r/547d-v2'
  );
  assert.equal(
    rewriter.rewriteAssetUrl('https://antigravity.static.usercontent.goog/web/2.33.0/main.js'),
    'https://www.gstatic.com/antigravity/web/2.33.0/main.js'
  );
  assert.equal(
    rewriter.rewriteAssetUrl('./jetski_worker.js'),
    'https://www.gstatic.com/antigravity/web/2.33.0/jetski_worker.js'
  );
});
