'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const {
  buildBundle,
  OUTPUT_BUNDLE_REL_PATH,
  OUTPUT_MAIN_HOOK_REL_PATH,
} = require('../../scripts/build');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('build:check confirms deterministic dist/renderer.js and dist/main-hook.js match current source graph', () => {
  const res = buildBundle({ checkOnly: true });
  assert.equal(res.ok, true);
  assert.equal(res.output, OUTPUT_BUNDLE_REL_PATH);
  assert.ok(res.bytes > 10000);
  assert.match(res.sha256, /^[a-f0-9]{64}$/);
  assert.equal(res.mainHook.output, OUTPUT_MAIN_HOOK_REL_PATH);
  assert.ok(res.mainHook.bytes > 5000);
  assert.match(res.mainHook.sha256, /^[a-f0-9]{64}$/);
});

test('dist/renderer.js executes cleanly in isolated VM and exports createKoTranslator', () => {
  const bundlePath = path.join(REPO_ROOT, OUTPUT_BUNDLE_REL_PATH);
  const code = fs.readFileSync(bundlePath, 'utf8');
  const mod = { exports: {} };
  const ctx = vm.createContext({
    module: mod,
    exports: mod.exports,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    AbortController,
  });
  vm.runInContext(code, ctx, { filename: OUTPUT_BUNDLE_REL_PATH });
  assert.equal(typeof mod.exports.createKoTranslator, 'function');
  assert.equal(typeof mod.exports.mountIfBrowser, 'function');
});

test('dist/main-hook.js is self-contained and loads cleanly outside the repo without node_modules', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-mainhook-standalone-'));
  try {
    const copiedPath = path.join(tmpDir, 'main-hook.js');
    fs.copyFileSync(path.join(REPO_ROOT, OUTPUT_MAIN_HOOK_REL_PATH), copiedPath);
    const loaded = require(copiedPath);
    assert.equal(typeof loaded.activate, 'function');
    assert.equal(typeof loaded.onWebContentsCreated, 'function');
    assert.equal(typeof loaded.dispose, 'function');
    assert.equal(typeof loaded.createMainHookController, 'function');
    delete require.cache[require.resolve(copiedPath)];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
