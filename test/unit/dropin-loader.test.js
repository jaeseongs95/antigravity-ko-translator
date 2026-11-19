'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  MAIN_ANCHOR_TARGET,
  isAllowedHubUrl,
  validateDropinManifest,
  collectExecutableExtensions,
  registerPluginManifest,
  installAsarDropinLoader,
  rollbackAsarDropinLoader,
  isAsarLoaderInstalled,
  isPureUnpatchedArchive,
  readAsarArchive,
} = require('../../host/dropin-loader');

function buildSyntheticAsar(filePath, version = '2.33.0') {
  const pkgBuf = Buffer.from(JSON.stringify({ name: 'antigravity', version }), 'utf8');
  const mainLines = [
    "'use strict';",
    "const electron_1 = require('electron');",
    ...Array.from({ length: 12 }, (_, i) => `// padding comment line ${i} for exact size headroom`),
    MAIN_ANCHOR_TARGET,
    '  void contents;',
    '});',
  ];
  const mainBuf = Buffer.from(mainLines.join('\n') + '\n', 'utf8');
  const makeIntegrity = (buf) => {
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    return { algorithm: 'SHA256', hash, blockSize: 4 * 1024 * 1024, blocks: [hash] };
  };
  const files = {
    'package.json': { size: pkgBuf.length, offset: '0', integrity: makeIntegrity(pkgBuf) },
    dist: {
      files: {
        'main.js': { size: mainBuf.length, offset: String(pkgBuf.length), integrity: makeIntegrity(mainBuf) },
      },
    },
  };
  const headerStr = JSON.stringify({ files });
  const headerStrBuf = Buffer.from(headerStr, 'utf8');
  const aligned = Math.ceil(headerStrBuf.length / 4) * 4;
  const u8 = 4 + aligned;
  const u4 = 4 + u8;
  const hdr = Buffer.alloc(8 + u4, 0);
  hdr.writeUInt32LE(4, 0);
  hdr.writeUInt32LE(u4, 4);
  hdr.writeUInt32LE(u8, 8);
  hdr.writeUInt32LE(headerStrBuf.length, 12);
  headerStrBuf.copy(hdr, 16);
  const full = Buffer.concat([hdr, pkgBuf, mainBuf]);
  fs.writeFileSync(filePath, full);
  return full;
}

test('isAllowedHubUrl allows ONLY local http(s) Hub URLs and rejects devtools/about/data/file', () => {
  assert.equal(isAllowedHubUrl('http://127.0.0.1:4173/index.html'), true);
  assert.equal(isAllowedHubUrl('https://localhost:5387/'), true);
  assert.equal(isAllowedHubUrl('devtools://devtools/bundled/inspector.html'), false);
  assert.equal(isAllowedHubUrl('about:blank'), false);
  assert.equal(isAllowedHubUrl('data:text/html,<h1>x</h1>'), false);
  assert.equal(isAllowedHubUrl('file:///C:/index.html'), false);
  assert.equal(isAllowedHubUrl('https://evil.example.com/'), false);
});

test('validateDropinManifest enforces schemaVersion, pluginId, and rejects path traversal outside plugin dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-dropin-sec-'));
  try {
    const pluginsRoot = path.join(dir, 'plugins');
    const pluginDir = path.join(pluginsRoot, 'ko-thought-translator');
    fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
    const goodScript = path.join(pluginDir, 'dist', 'renderer.js');
    const outsideScript = path.join(dir, 'outside.js');
    fs.writeFileSync(goodScript, '// ok\n', 'utf8');
    fs.writeFileSync(outsideScript, '// escape\n', 'utf8');

    const okRes = validateDropinManifest(
      { schemaVersion: 1, pluginId: 'ko-thought-translator', entryScript: goodScript },
      pluginsRoot
    );
    assert.equal(okRes.ok, true);

    const travRes = validateDropinManifest(
      { schemaVersion: 1, pluginId: 'ko-thought-translator', entryScript: '../../outside.js' },
      pluginsRoot
    );
    assert.equal(travRes.ok, false);
    assert.equal(travRes.reason, 'ENTRY_SCRIPT_ESCAPES_PLUGIN_DIR');

    const badVer = validateDropinManifest(
      { schemaVersion: 2, pluginId: 'ko-thought-translator', entryScript: goodScript },
      pluginsRoot
    );
    assert.equal(badVer.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectExecutableExtensions respects live config.json enabled:false gate immediately', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-dropin-gate-'));
  try {
    const agyDir = path.join(dir, '.gemini', 'antigravity');
    const cfgDir = path.join(dir, '.gemini', 'config');
    const pluginsRoot = path.join(cfgDir, 'plugins');
    const entry = path.join(pluginsRoot, 'ko-thought-translator', 'dist', 'renderer.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, 'window.__loaded = true;\n', 'utf8');

    const overrides = {
      PLUGIN_ID: 'ko-thought-translator',
      RENDERER_BUNDLE_PATH: entry,
      UI_EXTENSIONS_DIR: path.join(agyDir, 'ui-extensions.d'),
      MANIFEST_PATH: path.join(agyDir, 'ui-extensions.d', 'ko-thought-translator.json'),
      LOADER_SCRIPT_PATH: path.join(agyDir, 'ui-extensions-loader.js'),
    };
    registerPluginManifest(overrides);

    const cfgPath = path.join(cfgDir, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: true } } }), 'utf8');
    const enabledList = collectExecutableExtensions({
      uiExtensionsDir: overrides.UI_EXTENSIONS_DIR,
      pluginsRootDir: pluginsRoot,
      configJsonPath: cfgPath,
    });
    assert.equal(enabledList.length, 1);

    // Flip enabled -> false in config.json: immediately 0 executable extensions!
    fs.writeFileSync(cfgPath, JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: false } } }), 'utf8');
    const disabledList = collectExecutableExtensions({
      uiExtensionsDir: overrides.UI_EXTENSIONS_DIR,
      pluginsRootDir: pluginsRoot,
      configJsonPath: cfgPath,
    });
    assert.equal(disabledList.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installAsarDropinLoader patches dist/main.js exact-size and rollbackAsarDropinLoader restores byte-identical .orig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-asar-roundtrip-'));
  try {
    const asarPath = path.join(dir, 'app.asar');
    const origBuf = buildSyntheticAsar(asarPath, '2.33.0');
    const origHash = crypto.createHash('sha256').update(origBuf).digest('hex');

    const overrides = {
      ASAR_PATH: asarPath,
      ASAR_LOCK_PATH: path.join(dir, 'asar.lock'),
      UI_EXTENSIONS_DIR: path.join(dir, 'ui-extensions.d'),
      MANIFEST_PATH: path.join(dir, 'ui-extensions.d', 'ko-thought-translator.json'),
      LOADER_SCRIPT_PATH: path.join(dir, 'ui-extensions-loader.js'),
      RENDERER_BUNDLE_PATH: path.join(dir, 'renderer.js'),
    };

    const inst = installAsarDropinLoader(overrides);
    assert.equal(inst.status, 'INSTALLED');
    assert.equal(isAsarLoaderInstalled(asarPath), true);
    assert.equal(fs.statSync(asarPath).size, origBuf.length);

    const rb = rollbackAsarDropinLoader(overrides);
    assert.equal(rb.status, 'ROLLED_BACK');
    assert.equal(isPureUnpatchedArchive(readAsarArchive(asarPath)), true);
    const restoredHash = crypto.createHash('sha256').update(fs.readFileSync(asarPath)).digest('hex');
    assert.equal(restoredHash, origHash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const defaultLocalOrig = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar.v2.33.0.orig')
  : '';
const realAsarFlagIdx = process.argv.indexOf('--real-asar');
const realAsarOrigPath =
  (realAsarFlagIdx !== -1 && process.argv[realAsarFlagIdx + 1]) ||
  process.env.AGY_REAL_ASAR_ORIG ||
  (defaultLocalOrig && fs.existsSync(defaultLocalOrig) ? defaultLocalOrig : '');

if (realAsarOrigPath && fs.existsSync(realAsarOrigPath)) {
  test('Real Antigravity app.asar copy: exact-size dist/main.js patch preserves preload/utils and rolls back byte-identically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-asar-real-'));
    try {
      const asarPath = path.join(dir, 'app.asar');
      fs.copyFileSync(realAsarOrigPath, asarPath);
      const origBuf = fs.readFileSync(asarPath);
      const origHash = crypto.createHash('sha256').update(origBuf).digest('hex');
      const origArc = readAsarArchive(asarPath);
      const origPreloadHash = crypto.createHash('sha256').update(origArc.fileMap.get('dist/preload.js')).digest('hex');
      const origUtilsHash = crypto.createHash('sha256').update(origArc.fileMap.get('dist/utils.js')).digest('hex');

      const overrides = {
        ASAR_PATH: asarPath,
        ASAR_LOCK_PATH: path.join(dir, 'asar.lock'),
        UI_EXTENSIONS_DIR: path.join(dir, 'ui-extensions.d'),
        MANIFEST_PATH: path.join(dir, 'ui-extensions.d', 'ko-thought-translator.json'),
        LOADER_SCRIPT_PATH: path.join(dir, 'ui-extensions-loader.js'),
        RENDERER_BUNDLE_PATH: path.join(dir, 'renderer.js'),
      };

      const inst = installAsarDropinLoader(overrides);
      assert.equal(inst.status, 'INSTALLED');
      assert.equal(isAsarLoaderInstalled(asarPath), true);
      assert.equal(fs.statSync(asarPath).size, origBuf.length);

      const patchedArc = readAsarArchive(asarPath);
      const patchedPreloadHash = crypto.createHash('sha256').update(patchedArc.fileMap.get('dist/preload.js')).digest('hex');
      const patchedUtilsHash = crypto.createHash('sha256').update(patchedArc.fileMap.get('dist/utils.js')).digest('hex');
      assert.equal(patchedPreloadHash, origPreloadHash);
      assert.equal(patchedUtilsHash, origUtilsHash);

      const rb = rollbackAsarDropinLoader(overrides);
      assert.equal(rb.status, 'ROLLED_BACK');
      const restoredHash = crypto.createHash('sha256').update(fs.readFileSync(asarPath)).digest('hex');
      assert.equal(restoredHash, origHash);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
