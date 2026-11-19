'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function walkJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('Clean-Slate Zero-Interference: zero legacy remote, statusbar, Fiber, Angular, Worker, or watcher references in src/ and host/', () => {
  const forbiddenPatterns = [
    /statusbar_autoinject/i,
    /agy-statusbar-code/i,
    /app_storage\.json/i,
    /__reactFiber\$/,
    /__reactContainer\$/,
    /ɵgetLContext/,
    /ga-remote-control/i,
    /default_GoogleAntigravity/,
    /__JETSKI_LS_CLIENT_DECORATOR__/,
    /__agyCapturedLsClient/,
    /AudioWorklet/,
    /--watch-storage/,
    /ko_thought_watcher\.pid/,
    /copyFileSync\([^)]*ASAR/i,
  ];

  const files = [
    ...walkJsFiles(path.join(REPO_ROOT, 'src')),
    ...walkJsFiles(path.join(REPO_ROOT, 'host')),
    ...walkJsFiles(path.join(REPO_ROOT, 'sidecars')),
  ];
  assert.ok(files.length > 0);

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    for (const re of forbiddenPatterns) {
      assert.equal(re.test(src), false, `Forbidden legacy pattern ${re} found in ${rel}`);
    }
  }
});

test('Hexagonal boundary: src/core/ has zero DOM, window, or vendor Antigravity dependencies', () => {
  const coreFiles = walkJsFiles(path.join(REPO_ROOT, 'src', 'core'));
  assert.ok(coreFiles.length >= 4);
  for (const file of coreFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    assert.equal(/\bdocument\b/.test(src), false, `DOM document reference leaked into ${rel}`);
    assert.equal(/adapters\/antigravity/.test(src), false, `Vendor adapter leaked into ${rel}`);
  }
});

test('No hooks.json exists (zero per-turn PreInvocation/PostInvocation host hooks)', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'hooks.json')), false);
});

test('R8 F2 DIP boundary: src/runtime/ and host/dropin-loader.js contain zero hardcoded vendor literals', () => {
  const runtimeFiles = walkJsFiles(path.join(REPO_ROOT, 'src', 'runtime'));
  assert.ok(runtimeFiles.length >= 2);
  const forbiddenRuntimePatterns = [
    /adapters\/antigravity/,
    /data-agy-/,
    /__agy[A-Z]/,
    /restoreOriginalCursorEdits/,
    /'local-llm'/,
    /'google-translate'/,
  ];
  for (const file of runtimeFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    for (const re of forbiddenRuntimePatterns) {
      assert.equal(re.test(src), false, `Vendor literal ${re} leaked into vendor-neutral runtime ${rel}`);
    }
  }

  const loaderSrc = fs.readFileSync(path.join(REPO_ROOT, 'host', 'dropin-loader.js'), 'utf8');
  const forbiddenLoaderPatterns = [
    /'AGY_UI_EXTENSIONS_LOADER_V1'/,
    /'AGY_STATUSBAR'/,
    /'AGY_KO_THOUGHT'/,
    /'__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__'/,
    /'dist\/utils\.js'/,
    /'dist\/preload\.js'/,
  ];
  for (const re of forbiddenLoaderPatterns) {
    assert.equal(re.test(loaderSrc), false, `Hardcoded host literal ${re} leaked into host/dropin-loader.js`);
  }
});
