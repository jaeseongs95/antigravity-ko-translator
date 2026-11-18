#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ENTRY_FILE = path.join(SRC_ROOT, 'index.js');

const MIRROR_BUNDLE_REL_PATHS = Object.freeze([
  'dist/ko_thought_autoinject.js',
  'plugins/ko-thought-translator/scripts/ko_thought_autoinject.js',
  'scripts/ko_thought_autoinject.js',
  'skills/ko-thought-translator/scripts/ko_thought_inject.js',
]);

const DEFAULT_PRELUDE_CONFIG = Object.freeze({
  version: 'v2.0.0',
  defaultPretranslateEnabled: false,
  defaultTranslationProvider: 'google-translate',
  defaultLlmConfig: Object.freeze({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'gemma3:4b',
    apiFormat: 'ollama',
    allowRemoteHttps: false,
    timeoutMs: 15000,
  }),
});

function toPosixRelative(absPath) {
  return path.relative(SRC_ROOT, absPath).split(path.sep).join('/');
}

function resolveLocalRequire(fromFile, spec) {
  const baseTarget = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    baseTarget,
    `${baseTarget}.js`,
    path.join(baseTarget, 'index.js'),
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return cand;
    }
  }
  throw new Error(`Cannot resolve require("${spec}") from ${fromFile}`);
}

function collectModuleGraph(entryAbs = ENTRY_FILE) {
  const modulesById = new Map();

  function visit(absFile) {
    const id = toPosixRelative(absFile);
    if (modulesById.has(id)) return id;

    const rawSource = fs.readFileSync(absFile, 'utf8').replace(/\r\n/g, '\n');
    const deps = new Map();
    const requireRe = /(^|[^\w$.])require\(\s*(['"])(\.[^'"]+)\2\s*\)/g;
    let m;
    while ((m = requireRe.exec(rawSource)) !== null) {
      const spec = m[3];
      const depAbs = resolveLocalRequire(absFile, spec);
      const depId = toPosixRelative(depAbs);
      deps.set(spec, depId);
    }

    modulesById.set(id, {
      id,
      absFile,
      rawSource,
      deps,
    });

    for (const spec of Array.from(deps.keys()).sort()) {
      const depAbs = resolveLocalRequire(absFile, spec);
      visit(depAbs);
    }
    return id;
  }

  const entryId = visit(entryAbs);
  const sortedIds = Array.from(modulesById.keys()).sort();
  return {
    entryId,
    modules: sortedIds.map((id) => modulesById.get(id)),
  };
}

function stripLeadingUseStrict(source) {
  return source.replace(/^\s*(['"])use strict\1\s*;?\s*\n?/, '');
}

function rewriteRelativeRequires(source, depsMap) {
  return source.replace(/(^|[^\w$.])require\(\s*(['"])(\.[^'"]+)\2\s*\)/g, (_, prefix, _quote, spec) => {
    const resolvedId = depsMap.get(spec);
    if (!resolvedId) {
      throw new Error(`Unmapped relative require("${spec}") during bundle emit`);
    }
    return `${prefix}require(${JSON.stringify(resolvedId)})`;
  });
}

function generateBundleSource(preludeConfig = DEFAULT_PRELUDE_CONFIG) {
  const { entryId, modules } = collectModuleGraph(ENTRY_FILE);
  const ver = String(preludeConfig.version || DEFAULT_PRELUDE_CONFIG.version);
  const preEn = Boolean(preludeConfig.defaultPretranslateEnabled);
  const prov = String(preludeConfig.defaultTranslationProvider || DEFAULT_PRELUDE_CONFIG.defaultTranslationProvider);
  const llmCfg = preludeConfig.defaultLlmConfig || DEFAULT_PRELUDE_CONFIG.defaultLlmConfig;

  const lines = [
    '// === Antigravity Korean Thought & UI Localizer (Generated CommonJS Bundle — DO NOT EDIT DIRECTLY) ===',
    '(function mountKoThoughtLocalizer(globalScope) {',
    "  'use strict';",
    `  const KO_LOCALIZER_VERSION = ${JSON.stringify(ver)};`,
    `  const DEFAULT_PRETRANSLATE_ENABLED = ${preEn ? 'true' : 'false'};`,
    `  const DEFAULT_TRANSLATION_PROVIDER = ${JSON.stringify(prov)};`,
    `  const DEFAULT_LLM_CONFIG = Object.freeze(${JSON.stringify(llmCfg)});`,
    '',
    '  const __modules = Object.create(null);',
    '  const __cache = Object.create(null);',
    '',
    '  function __require(moduleId) {',
    '    if (Object.prototype.hasOwnProperty.call(__cache, moduleId)) {',
    '      return __cache[moduleId].exports;',
    '    }',
    '    const factory = __modules[moduleId];',
    '    if (typeof factory !== "function") {',
    '      throw new Error("Unknown bundled module: " + moduleId);',
    '    }',
    '    const mod = { id: moduleId, exports: {} };',
    '    __cache[moduleId] = mod;',
    '    factory(mod, mod.exports, __require);',
    '    return mod.exports;',
    '  }',
    '',
  ];

  for (const mod of modules) {
    const body = rewriteRelativeRequires(stripLeadingUseStrict(mod.rawSource), mod.deps).trimEnd();
    lines.push(`  __modules[${JSON.stringify(mod.id)}] = function (module, exports, require) {`);
    lines.push(body);
    lines.push('  };');
    lines.push('');
  }

  lines.push(`  const __entry = __require(${JSON.stringify(entryId)});`);
  lines.push('  if (__entry && typeof __entry.bootDefaultBrowserRuntime === "function") {');
  lines.push('    __entry.bootDefaultBrowserRuntime(globalScope);');
  lines.push('  }');
  lines.push('})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);');
  lines.push('');

  const output = lines.join('\n').replace(/\r\n/g, '\n');
  // Validate JS syntax via vm.Script (and verify zero SyntaxError when evaluated twice in the same context: Rev7-F2!)
  new vm.Script(output, { filename: 'ko_thought_autoinject.js' });
  const testCtx = vm.createContext({
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
  });
  vm.runInContext(output, testCtx);
  vm.runInContext(output, testCtx);
  return output;
}

function getMirrorBundleAbsPaths(repoRoot = REPO_ROOT) {
  return MIRROR_BUNDLE_REL_PATHS.map((rel) => path.join(repoRoot, rel));
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function writeMirrorBundles(bundleText, repoRoot = REPO_ROOT) {
  const targets = getMirrorBundleAbsPaths(repoRoot);
  for (const absPath of targets) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const tmpPath = `${absPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, bundleText, 'utf8');
    fs.renameSync(tmpPath, absPath);
  }
  return targets;
}

function checkMirrorBundles(expectedBundleText, repoRoot = REPO_ROOT) {
  const expectedHash = sha256Hex(expectedBundleText);
  const targets = getMirrorBundleAbsPaths(repoRoot);
  const mismatches = [];
  for (const absPath of targets) {
    if (!fs.existsSync(absPath)) {
      mismatches.push({ path: absPath, reason: 'MISSING' });
      continue;
    }
    const actual = fs.readFileSync(absPath, 'utf8');
    if (actual.includes('\r\n')) {
      mismatches.push({ path: absPath, reason: 'CRLF_DETECTED' });
      continue;
    }
    const actualHash = sha256Hex(actual);
    if (actualHash !== expectedHash) {
      mismatches.push({ path: absPath, reason: 'HASH_MISMATCH', expectedHash, actualHash });
    }
  }
  return {
    ok: mismatches.length === 0,
    expectedHash,
    mismatches,
    targets,
  };
}

function runCli(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const bundleText = generateBundleSource(DEFAULT_PRELUDE_CONFIG);
  if (checkOnly) {
    const report = checkMirrorBundles(bundleText, REPO_ROOT);
    if (!report.ok) {
      console.error(JSON.stringify({ ok: false, mismatches: report.mismatches }, null, 2));
      process.exitCode = 1;
      return report;
    }
    console.log(
      JSON.stringify({
        ok: true,
        sha256: report.expectedHash,
        bytes: Buffer.byteLength(bundleText, 'utf8'),
        mirrors: MIRROR_BUNDLE_REL_PATHS,
      })
    );
    return report;
  }

  writeMirrorBundles(bundleText, REPO_ROOT);
  const verify = checkMirrorBundles(bundleText, REPO_ROOT);
  if (!verify.ok) {
    throw new Error(`Mirror verification failed after build: ${JSON.stringify(verify.mismatches)}`);
  }
  console.log(
    JSON.stringify({
      ok: true,
      built: true,
      sha256: verify.expectedHash,
      bytes: Buffer.byteLength(bundleText, 'utf8'),
      mirrors: MIRROR_BUNDLE_REL_PATHS,
    })
  );
  return verify;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  MIRROR_BUNDLE_REL_PATHS,
  DEFAULT_PRELUDE_CONFIG,
  collectModuleGraph,
  generateBundleSource,
  getMirrorBundleAbsPaths,
  writeMirrorBundles,
  checkMirrorBundles,
  runCli,
};
