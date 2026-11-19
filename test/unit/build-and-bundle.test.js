'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { buildBundle, OUTPUT_BUNDLE_REL_PATH } = require('../../scripts/build');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('build:check confirms deterministic dist/renderer.js matches current source graph', () => {
  const res = buildBundle({ checkOnly: true });
  assert.equal(res.ok, true);
  assert.equal(res.output, OUTPUT_BUNDLE_REL_PATH);
  assert.ok(res.bytes > 10000);
  assert.match(res.sha256, /^[a-f0-9]{64}$/);
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
