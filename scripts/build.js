#!/usr/bin/env node
'use strict';

/**
 * Deterministic Single-Bundle Builder for `dist/renderer.js` powered by `esbuild`.
 *
 * Bundles `src/index.js` (including trusted npm dependencies such as `ipaddr.js`)
 * into a self-contained browser IIFE (`dist/renderer.js`), verifies syntax via `vm.Script`,
 * and supports `--check` for CI determinism enforcement.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const esbuild = require('esbuild');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ENTRY_FILE = path.join(SRC_ROOT, 'index.js');
const OUTPUT_BUNDLE_REL_PATH = 'dist/renderer.js';

function generateBundleSource(entryAbs = ENTRY_FILE) {
  const result = esbuild.buildSync({
    entryPoints: [entryAbs],
    bundle: true,
    platform: 'browser',
    target: ['es2020'],
    format: 'iife',
    globalName: '__agyKoTranslatorBundleExports',
    write: false,
    minify: false,
    keepNames: true,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    banner: {
      js: '// === Antigravity Korean Thought & UI Translator v2.0.0 (Desktop Native App Only — Generated Bundle) ===',
    },
    footer: {
      js: 'if (typeof module !== "undefined" && module && module.exports) { module.exports = __agyKoTranslatorBundleExports; }',
    },
  });

  if (!result || !Array.isArray(result.outputFiles) || result.outputFiles.length === 0) {
    throw new Error('esbuild produced no output files');
  }

  const bundleSource = result.outputFiles[0].text.replace(/\r\n/g, '\n');
  new vm.Script(bundleSource, { filename: OUTPUT_BUNDLE_REL_PATH });
  return bundleSource;
}

function buildBundle({ checkOnly = false } = {}) {
  const bundleSource = generateBundleSource();
  const sha256 = crypto.createHash('sha256').update(bundleSource, 'utf8').digest('hex');
  const outPath = path.join(REPO_ROOT, OUTPUT_BUNDLE_REL_PATH);

  if (checkOnly) {
    if (!fs.existsSync(outPath)) {
      throw new Error(`Missing built bundle: ${OUTPUT_BUNDLE_REL_PATH}`);
    }
    const existing = fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n');
    if (existing !== bundleSource) {
      throw new Error(`Stale bundle detected at ${OUTPUT_BUNDLE_REL_PATH}; run "npm run build"`);
    }
    return {
      ok: true,
      checkOnly: true,
      output: OUTPUT_BUNDLE_REL_PATH,
      bytes: Buffer.byteLength(bundleSource, 'utf8'),
      sha256,
    };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bundleSource, 'utf8');
  return {
    ok: true,
    checkOnly: false,
    output: OUTPUT_BUNDLE_REL_PATH,
    bytes: Buffer.byteLength(bundleSource, 'utf8'),
    sha256,
  };
}

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  try {
    const res = buildBundle({ checkOnly });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  } catch (err) {
    process.stderr.write(`[build] ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  OUTPUT_BUNDLE_REL_PATH,
  generateBundleSource,
  buildBundle,
};
