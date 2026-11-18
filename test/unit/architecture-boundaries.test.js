'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const HOST_ROOT = path.join(REPO_ROOT, 'host');

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

function extractRequireSpecifiers(code) {
  const specs = [];
  const re = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    specs.push(m[2]);
  }
  return specs;
}

function resolveLocalModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  if (fs.existsSync(base + '.js')) return base + '.js';
  const indexCandidate = path.join(base, 'index.js');
  if (fs.existsSync(indexCandidate)) return indexCandidate;
  throw new Error(`Unresolved local require("${spec}") in ${fromFile}`);
}

test('Architecture Boundaries: src/core/* is 100% pure domain with zero outward or DOM/vendor dependencies', () => {
  const coreDir = path.join(SRC_ROOT, 'core');
  const coreFiles = listJsFiles(coreDir);
  assert.ok(coreFiles.length >= 5, 'Expected at least 5 core modules');

  const forbiddenCoreTokens = [
    /\bdocument\b/,
    /\bwindow\b/,
    /\bMutationObserver\b/,
    /\bHTMLElement\b/,
    /\blocalStorage\b/,
    /antigravity/i,
    /gstatic/i,
    /usercontent/i,
    /vscode/i,
  ];

  for (const file of coreFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const specs = extractRequireSpecifiers(src);
    for (const spec of specs) {
      const target = resolveLocalModule(file, spec);
      assert.ok(
        target && target.startsWith(coreDir + path.sep),
        `Core file ${path.relative(REPO_ROOT, file)} must only import src/core/*, found: ${spec}`
      );
    }
    for (const pat of forbiddenCoreTokens) {
      assert.equal(
        pat.test(src),
        false,
        `Core file ${path.relative(REPO_ROOT, file)} violated purity with forbidden pattern ${pat}`
      );
    }
  }
});

test('Architecture Boundaries: src/remote/* has zero vendor/companion/boot-script literals and zero adapter/runtime/host imports', () => {
  const remoteDir = path.join(SRC_ROOT, 'remote');
  const remoteFiles = listJsFiles(remoteDir);
  assert.equal(remoteFiles.length, 7, 'Expected 7 generic remote engine modules');

  const allowedCoreDep = path.join(SRC_ROOT, 'core', 'disposable-registry.js');
  const forbiddenVendorLiterals = [
    'antigravity',
    'gstatic',
    'usercontent',
    'google.com',
    'jetbox.css',
    'prism_bundle.js',
    'main.js',
    '/r/',
    '/_/',
    'exa.language_server_pb',
    '__JETSKI_',
    '__APP_CONFIG__',
    'csrfToken',
    'AudioWorklet',
    'ga-remote-control',
    'mcp-manager',
    'statusbar',
    '__agyMcpPromoted',
    'ko-thought-translator',
    'agy-ko-translator',
  ];

  for (const file of remoteFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const specs = extractRequireSpecifiers(src);
    for (const spec of specs) {
      const target = resolveLocalModule(file, spec);
      assert.ok(target, `src/remote/${path.basename(file)} cannot require Node host builtin "${spec}"`);
      const isRemote = target.startsWith(remoteDir + path.sep);
      const isDisposableRegistry = target === allowedCoreDep;
      assert.ok(
        isRemote || isDisposableRegistry,
        `src/remote/${path.basename(file)} imported forbidden module ${path.relative(REPO_ROOT, target)}`
      );
    }

    const lowerSrc = src.toLowerCase();
    for (const lit of forbiddenVendorLiterals) {
      assert.equal(
        lowerSrc.includes(lit.toLowerCase()),
        false,
        `src/remote/${path.basename(file)} contains forbidden vendor/companion literal "${lit}"`
      );
    }
  }
});

test('Architecture Boundaries: src/adapters/host-adapter-config.js is vendor-neutral and src/adapters/* only touches remote-host-port.js', () => {
  const hostAdapterCfgPath = path.join(SRC_ROOT, 'adapters', 'host-adapter-config.js');
  const cfgSrc = fs.readFileSync(hostAdapterCfgPath, 'utf8');
  for (const vendorWord of ['antigravity', 'gstatic', 'usercontent', 'jetbox', 'prism_bundle', 'mcp-manager']) {
    assert.equal(
      cfgSrc.toLowerCase().includes(vendorWord),
      false,
      `host-adapter-config.js must remain vendor-neutral, found "${vendorWord}"`
    );
  }

  const adaptersDir = path.join(SRC_ROOT, 'adapters');
  const remoteDir = path.join(SRC_ROOT, 'remote');
  const remoteHostPortPath = path.join(remoteDir, 'remote-host-port.js');

  for (const file of listJsFiles(adaptersDir)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of extractRequireSpecifiers(src)) {
      const target = resolveLocalModule(file, spec);
      assert.ok(target, `Adapter ${path.relative(REPO_ROOT, file)} imported unexpected external "${spec}"`);
      assert.equal(
        target.startsWith(path.join(SRC_ROOT, 'runtime') + path.sep) || target.startsWith(HOST_ROOT + path.sep),
        false,
        `Adapter ${path.relative(REPO_ROOT, file)} must not import runtime/ or host/: ${spec}`
      );
      if (target.startsWith(remoteDir + path.sep)) {
        assert.equal(
          target,
          remoteHostPortPath,
          `Adapter ${path.relative(REPO_ROOT, file)} may only import remote-host-port.js from src/remote/, found ${spec}`
        );
      }
    }
  }
});

test('Architecture Boundaries: entire src/ and host/ module dependency graph is a strict DAG with zero cycles', () => {
  const allFiles = [...listJsFiles(SRC_ROOT), ...listJsFiles(HOST_ROOT)];
  const visiting = new Set();
  const visited = new Set();

  function dfs(file, stack) {
    if (visited.has(file)) return;
    if (visiting.has(file)) {
      const cycle = [...stack, file].map((f) => path.relative(REPO_ROOT, f)).join(' -> ');
      assert.fail(`Circular require() detected: ${cycle}`);
    }
    visiting.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of extractRequireSpecifiers(src)) {
      const target = resolveLocalModule(file, spec);
      if (target) dfs(target, [...stack, file]);
    }
    visiting.delete(file);
    visited.add(file);
  }

  for (const f of allFiles) {
    dfs(f, []);
  }
  assert.ok(visited.size >= allFiles.length, `Expected all ${allFiles.length} src/host files visited`);
  for (const f of allFiles) {
    assert.equal(visited.has(f), true, `Unvisited module: ${f}`);
  }
});
