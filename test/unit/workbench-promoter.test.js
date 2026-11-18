'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDisposableRegistry } = require('../../src/core/disposable-registry');
const { createHostAdapterConfig } = require('../../src/adapters/host-adapter-config');
const { resolveAntigravityHostConfig } = require('../../src/adapters/antigravity/host-config-preset');
const { createCspSecurityPort } = require('../../src/remote/csp-security-policy');
const { createAntigravityRemoteCompanionSync } = require('../../src/adapters/antigravity/remote-companion-sync');
const { PROMOTER_STATES, createWorkbenchPromoter } = require('../../src/remote/workbench-promoter');
const { createBoqJetskiLViewFixture } = require('./fixtures/boq-jetski-lview.fixture');

test('WorkbenchPromoter (Rev7-F1): preflight checks EVERY script in shellBootScripts and fails closed if any boot script is untrusted', () => {
  const basePreset = resolveAntigravityHostConfig();
  const multiBootCfg = createHostAdapterConfig({
    ...basePreset,
    // 2nd boot script points to an untrusted external URL via `../` or protocol -> must fail preflight BEFORE blanking iframe!
    shellBootScripts: ['prism_bundle.js', 'https://evil.example/malicious_boot.js'],
  });

  const fix = createBoqJetskiLViewFixture();
  const disposables = createDisposableRegistry();
  const csp = createCspSecurityPort(multiBootCfg, fix.fakeWin, disposables);
  const remoteHostPort = createAntigravityRemoteCompanionSync({
    targetWin: fix.fakeWin,
    targetDoc: fix.fakeDoc,
    hostCfg: multiBootCfg,
    disposables,
  });

  const promoter = createWorkbenchPromoter({
    hostCfg: multiBootCfg,
    cspSecurityPort: csp,
    remoteHostPort,
    rootWin: fix.fakeWin,
    rootDoc: fix.fakeDoc,
    disposables,
  });

  const state = promoter.inspectAndPromoteHostElement(fix.rcHostEl);
  assert.equal(state, PROMOTER_STATES.ROLLED_BACK);
  assert.notEqual(fix.iframeEl.getAttribute('src'), 'about:blank', 'Native iframe must NOT be blanked when 2nd boot script fails preflight');
});

test('WorkbenchPromoter: EXTERNAL_PROMOTED peer coexistence, cross-origin SecurityError safety (D-0011), and single-attempt failedSrc rollback lock (0 retry loop)', async () => {
  const hostCfg = resolveAntigravityHostConfig();

  // 1) Peer companion already promoted iframe -> transitions cleanly to `EXTERNAL_PROMOTED` and mounts child localizer!
  let mountedChild = 0;
  const childDoc = {
    readyState: 'complete',
    getElementById(id) {
      return id === 'root' ? { childElementCount: 3 } : null;
    },
  };
  const childWin = {
    location: { origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/547d-v2' },
    document: childDoc,
  };
  const fixPeer = createBoqJetskiLViewFixture({
    contentWindow: childWin,
    contentDocument: childDoc,
  });
  fixPeer.iframeEl.__agyMcpPromoted = true;

  const dispPeer = createDisposableRegistry();
  const cspPeer = createCspSecurityPort(hostCfg, fixPeer.fakeWin, dispPeer);
  const remotePortPeer = createAntigravityRemoteCompanionSync({
    targetWin: fixPeer.fakeWin,
    targetDoc: fixPeer.fakeDoc,
    hostCfg,
    disposables: dispPeer,
    onMountChildLocalizer() {
      mountedChild += 1;
    },
  });

  const promoterPeer = createWorkbenchPromoter({
    hostCfg,
    cspSecurityPort: cspPeer,
    remoteHostPort: remotePortPeer,
    rootWin: fixPeer.fakeWin,
    rootDoc: fixPeer.fakeDoc,
    disposables: dispPeer,
  });

  const peerState = promoterPeer.inspectAndPromoteHostElement(fixPeer.rcHostEl);
  assert.equal(peerState, PROMOTER_STATES.EXTERNAL_PROMOTED);
  assert.equal(mountedChild, 1);

  // 2) Promotion boot failure (`main.js` HTTP 503) -> rolls back native `iframe.src` AND locks `failedSrc` (`0` retry loop on re-scan!)
  let blankDoc = null;
  let blankWin = null;
  const origCrossOriginSrc = 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true';
  const fixFail = createBoqJetskiLViewFixture({ iframeSrc: origCrossOriginSrc });

  // Simulate cross-origin SecurityError BEFORE `about:blank` navigation (D-0011), and accessible `about:blank` AFTER navigation
  Object.defineProperty(fixFail.iframeEl, 'contentWindow', {
    configurable: true,
    get() {
      if (fixFail.iframeEl.getAttribute('src') !== 'about:blank') {
        const crossWin = {};
        Object.defineProperty(crossWin, 'location', {
          get() {
            const err = new Error('Blocked a frame with origin "https://antigravity.google.com" from accessing a cross-origin frame.');
            err.name = 'SecurityError';
            throw err;
          },
        });
        return crossWin;
      }
      return blankWin;
    },
  });
  Object.defineProperty(fixFail.iframeEl, 'contentDocument', {
    configurable: true,
    get() {
      if (fixFail.iframeEl.getAttribute('src') !== 'about:blank') return null;
      return blankDoc;
    },
  });

  blankDoc = {
    readyState: 'complete',
    documentElement: { style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {} },
    head: {
      textContent: '',
      appendChild(el) {
        if (el && el.tagName === 'SCRIPT' && el.src) {
          fetchAttempts += 1;
          if (String(el.src).endsWith('/prism_bundle.js')) {
            if (typeof el.onload === 'function') el.onload();
          } else if (typeof el.onerror === 'function') {
            // Simulate HTTP 503 network error on 2nd boot script (`main.js`)!
            el.onerror(new Error('HTTP 503 Service Unavailable'));
          }
        }
        return el;
      },
      querySelectorAll: () => [],
    },
    body: { textContent: '', innerHTML: '', appendChild() {} },
    open() {},
    close() {},
    getElementById: () => null,
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        src: '',
        href: '',
        nonce: '',
        style: {},
        setAttribute(k, v) {
          if (k === 'src') this.src = String(v);
          if (k === 'href') this.href = String(v);
        },
        getAttribute: () => null,
        remove() {},
      };
      return el;
    },
  };
  blankWin = {
    location: { origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/547d-v2' },
    document: blankDoc,
    addEventListener() {},
    removeEventListener() {},
  };

  let fetchAttempts = 0;
  fixFail.fakeWin.fetch = async (url) => {
    fetchAttempts += 1;
    if (String(url).endsWith('/prism_bundle.js')) {
      return { ok: true, status: 200, async text() { return 'window.Prism = {};'; } };
    }
    // Simulate HTTP 503 on `main.js`!
    return { ok: false, status: 503, async text() { return 'Service Unavailable'; } };
  };

  const dispFail = createDisposableRegistry();
  const cspFail = createCspSecurityPort(hostCfg, fixFail.fakeWin, dispFail);
  const remotePortFail = createAntigravityRemoteCompanionSync({
    targetWin: fixFail.fakeWin,
    targetDoc: fixFail.fakeDoc,
    hostCfg,
    disposables: dispFail,
    fetchFn: fixFail.fakeWin.fetch,
  });

  const promoterFail = createWorkbenchPromoter({
    hostCfg,
    cspSecurityPort: cspFail,
    remoteHostPort: remotePortFail,
    rootWin: fixFail.fakeWin,
    rootDoc: fixFail.fakeDoc,
    disposables: dispFail,
  });

  const s0 = promoterFail.inspectAndPromoteHostElement(fixFail.rcHostEl);
  assert.equal(s0, PROMOTER_STATES.PROMOTING_BLANK);
  assert.equal(fixFail.iframeEl.getAttribute('src'), 'about:blank');

  // Trigger blank load -> attempts boot -> hits 503 on main.js -> rolls back to `origCrossOriginSrc`!
  fixFail.iframeEl.dispatchLoad();
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(promoterFail.getSessionState(fixFail.iframeEl), PROMOTER_STATES.ROLLED_BACK);
  assert.equal(fixFail.iframeEl.getAttribute('src'), origCrossOriginSrc, 'Rollback must restore native cross-origin src');
  const attemptsAfterRollback = fetchAttempts;

  // Re-scanning the same `origCrossOriginSrc` MUST NOT retry or blank the iframe again!
  promoterFail.inspectAndPromoteHostElement(fixFail.rcHostEl);
  promoterFail.inspectAndPromoteHostElement(fixFail.rcHostEl);
  assert.equal(fetchAttempts, attemptsAfterRollback, 'Single-attempt failedSrc lock must prevent retry loops');
  assert.equal(fixFail.iframeEl.getAttribute('src'), origCrossOriginSrc);
  dispFail.disposeAll(true);
});
