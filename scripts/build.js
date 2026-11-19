#!/usr/bin/env node
'use strict';

/**
 * Deterministic Bundle Builder powered by `esbuild`:
 * 1. `dist/renderer.js` — self-contained browser IIFE for Isolated World 999
 * 2. `dist/main-hook.js` — self-contained Node CJS bundle for AddonManifest.v1 mainHook
 *    (bundles `proper-lockfile` / `ipaddr.js` so plugin install directories need zero `node_modules`)
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const esbuild = require('esbuild');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ENTRY_FILE = path.join(SRC_ROOT, 'index.js');
const MAIN_HOOK_ENTRY_FILE = path.join(REPO_ROOT, 'host', 'main-hook.js');
const OUTPUT_BUNDLE_REL_PATH = 'dist/renderer.js';
const OUTPUT_MAIN_HOOK_REL_PATH = 'dist/main-hook.js';

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
      js: '// === Antigravity Korean Thought & UI Translator v2.1.0 (AddonManifest.v1 Desktop Native App Only — Generated Bundle) ===',
    },
    footer: {
      js: 'if (typeof module !== "undefined" && module && module.exports) { module.exports = __agyKoTranslatorBundleExports; }',
    },
  });

  if (!result || !Array.isArray(result.outputFiles) || result.outputFiles.length === 0) {
    throw new Error('esbuild produced no renderer output files');
  }

  const bundleSource = result.outputFiles[0].text.replace(/\r\n/g, '\n');
  new vm.Script(bundleSource, { filename: OUTPUT_BUNDLE_REL_PATH });
  return bundleSource;
}

function generateMainHookBundleSource(entryAbs = MAIN_HOOK_ENTRY_FILE) {
  const result = esbuild.buildSync({
    entryPoints: [entryAbs],
    bundle: true,
    platform: 'node',
    target: ['node20'],
    format: 'cjs',
    write: false,
    minify: false,
    keepNames: true,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    banner: {
      js: '// === Antigravity Korean Thought & UI Translator v2.1.0 (AddonManifest.v1 Main Hook — Generated Bundle) ===',
    },
  });

  if (!result || !Array.isArray(result.outputFiles) || result.outputFiles.length === 0) {
    throw new Error('esbuild produced no main-hook output files');
  }

  const bundleSource = result.outputFiles[0].text.replace(/\r\n/g, '\n');
  new vm.Script(bundleSource, { filename: OUTPUT_MAIN_HOOK_REL_PATH });
  return bundleSource;
}

function writeOrCheckArtifact(relPath, sourceText, checkOnly) {
  const sha256 = crypto.createHash('sha256').update(sourceText, 'utf8').digest('hex');
  const outPath = path.join(REPO_ROOT, relPath);
  if (checkOnly) {
    if (!fs.existsSync(outPath)) {
      throw new Error(`Missing built bundle: ${relPath}`);
    }
    const existing = fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n');
    if (existing !== sourceText) {
      throw new Error(`Stale bundle detected at ${relPath}; run "npm run build"`);
    }
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, sourceText, 'utf8');
  }
  return {
    output: relPath,
    bytes: Buffer.byteLength(sourceText, 'utf8'),
    sha256,
  };
}

function buildBundle({ checkOnly = false } = {}) {
  const rendererInfo = writeOrCheckArtifact(OUTPUT_BUNDLE_REL_PATH, generateBundleSource(), checkOnly);
  const mainHookInfo = writeOrCheckArtifact(OUTPUT_MAIN_HOOK_REL_PATH, generateMainHookBundleSource(), checkOnly);
  return {
    ok: true,
    checkOnly: Boolean(checkOnly),
    output: rendererInfo.output,
    bytes: rendererInfo.bytes,
    sha256: rendererInfo.sha256,
    mainHook: mainHookInfo,
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
  OUTPUT_MAIN_HOOK_REL_PATH,
  generateBundleSource,
  generateMainHookBundleSource,
  buildBundle,
};
