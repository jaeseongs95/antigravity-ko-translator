'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDisposableRegistry } = require('../../src/core/disposable-registry');
const { resolveAntigravityHostConfig } = require('../../src/adapters/antigravity/host-config-preset');
const { createAntigravityRemoteCompanionSync } = require('../../src/adapters/antigravity/remote-companion-sync');
const { createBoqJetskiLViewFixture } = require('./fixtures/boq-jetski-lview.fixture');

test('CompanionSync: Angular 19 LView & default_GoogleAntigravity fallback discovery, real csrfToken only (0 synthetic token), ref-counted suppression, and 5-RPC companion sync', async () => {
  const hostCfg = resolveAntigravityHostConfig();

  // 1) LView discovery + ZERO synthetic csrfToken when host has no csrfToken!
  const fixNoCsrf = createBoqJetskiLViewFixture({ csrfToken: '', stripNgContext: false });
  const disp1 = createDisposableRegistry();
  const sync1 = createAntigravityRemoteCompanionSync({
    targetWin: fixNoCsrf.fakeWin,
    targetDoc: fixNoCsrf.fakeDoc,
    hostCfg,
    disposables: disp1,
  });

  const binding1 = sync1.resolveHostBinding(fixNoCsrf.rcHostEl);
  assert.ok(binding1 && binding1.iframe === fixNoCsrf.iframeEl);
  assert.equal(binding1.csrfToken, '', 'Must NOT synthesize fake csrf_token');

  const cwNoCsrf = {};
  sync1.installBootGlobals(cwNoCsrf, binding1, '2.33.0', disp1, {});
  assert.equal(Object.prototype.hasOwnProperty.call(cwNoCsrf.__APP_CONFIG__, 'csrfToken'), false);

  // Ref-counted suppression (`acquireAutoLoadSuppression`): 2 concurrent holders keep `onIframeLoad` suppressed until BOTH release!
  const relA = binding1.acquireAutoLoadSuppression();
  const relB = binding1.acquireAutoLoadSuppression();
  await fixNoCsrf.rcInstance.onIframeLoad();
  assert.equal(fixNoCsrf.rcInstance.onIframeLoadCalls, 0, 'Suppressed while count === 2');
  relA();
  await fixNoCsrf.rcInstance.onIframeLoad();
  assert.equal(fixNoCsrf.rcInstance.onIframeLoadCalls, 0, 'Still suppressed while count === 1');
  relB();
  await fixNoCsrf.rcInstance.onIframeLoad();
  assert.equal(fixNoCsrf.rcInstance.onIframeLoadCalls, 1, 'Resumes once count reaches 0');

  // 2) `stripNgContext: true` fallback via `default_GoogleAntigravity` + real `csrfToken` + 5-RPC base64 ReadFile companion sync + disabled plugin skip!
  const sbSource = [
    '// === BEGIN_AGY_STATUSBAR_INJECT ===',
    'window.agyStatusBar = { version: "1.9.0", registerAdapter() {} };',
    '// === END_AGY_STATUSBAR_INJECT ===',
  ].join('\n');
  const mcpSource = [
    '// === BEGIN_AGY_MCP_MANAGER_INJECT ===',
    'window.agyMcpManager = { version: "1.4.0" };',
    'window.__agyMountMcpManager = function() {};',
    '// === END_AGY_MCP_MANAGER_INJECT ===',
  ].join('\n');

  const fixFull = createBoqJetskiLViewFixture({
    csrfToken: 'real-host-csrf-9988',
    stripNgContext: true,
    installedPlugins: [
      { id: 'antigravity-statusbar', installPath: 'C:/Users/TestUser/.gemini/config/plugins/antigravity-statusbar' },
      { id: 'antigravity-mcp-manager', installPath: 'C:/Users/TestUser/.gemini/config/plugins/antigravity-mcp-manager' },
    ],
    disabledPluginIds: ['antigravity-mcp-manager'], // MCP disabled -> must NOT mount MCP!
    companionBundles: {
      'statusbar_autoinject.js': sbSource,
      'mcp_manager_autoinject.js': mcpSource,
    },
  });

  const disp2 = createDisposableRegistry();
  const executedScripts = [];
  const sync2 = createAntigravityRemoteCompanionSync({
    targetWin: fixFull.fakeWin,
    targetDoc: fixFull.fakeDoc,
    hostCfg,
    disposables: disp2,
  });

  const binding2 = sync2.resolveHostBinding(fixFull.rcHostEl);
  assert.equal(binding2.csrfToken, 'real-host-csrf-9988');

  const cwWithCsrf = {
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    AudioWorklet: function AudioWorklet() {},
  };
  cwWithCsrf.AudioWorklet.prototype.addModule = async (u) => u;
  sync2.installChildEnvironmentShims(cwWithCsrf, binding2, disp2, {
    rewriteAssetUrl: (u) => `https://www.gstatic.com/antigravity${u}`,
  });
  sync2.installBootGlobals(cwWithCsrf, binding2, '2.33.0', disp2, {});

  assert.equal(cwWithCsrf.__APP_CONFIG__.csrfToken, 'real-host-csrf-9988');
  assert.equal(cwWithCsrf.process.platform, 'win32');

  await sync2.syncCompanions(fixFull.rcHostEl, {
    executeAuthorizedInlineScript(_doc, code) {
      executedScripts.push(code);
      return true;
    },
  });

  assert.equal(executedScripts.length, 1, 'Only enabled statusbar companion should execute; disabled mcp-manager must be skipped');
  assert.match(executedScripts[0], /agyStatusBar/);
});
