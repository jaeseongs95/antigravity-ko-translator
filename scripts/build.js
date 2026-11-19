#!/usr/bin/env node
'use strict';

/**
 * Deterministic Single-Bundle Builder for `dist/renderer.js`.
 *
 * Collects CommonJS module graph from `src/index.js`, emits a single self-contained
 * IIFE bundle (`dist/renderer.js`), verifies syntax via `vm.Script`, and supports `--check`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ENTRY_FILE = path.join(SRC_ROOT, 'index.js');
const OUTPUT_BUNDLE_REL_PATH = 'dist/renderer.js';

function toPosixRelative(absPath) {
  return path.relative(SRC_ROOT, absPath).split(path.sep).join('/');
}

function resolveLocalRequire(fromFile, spec) {
  const baseTarget = path.resolve(path.dirname(fromFile), spec);
  const candidates = [baseTarget, `${baseTarget}.js`, path.join(baseTarget, 'index.js')];
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
      deps.set(spec, toPosixRelative(depAbs));
    }

    modulesById.set(id, { id, absFile, rawSource, deps });
    for (const spec of Array.from(deps.keys()).sort()) {
      visit(resolveLocalRequire(absFile, spec));
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

function generateBundleSource() {
  const { entryId, modules } = collectModuleGraph(ENTRY_FILE);
  const lines = [
    '// === Antigravity Korean Thought & UI Translator v2.0.0 (Desktop Native App Only — Generated Bundle) ===',
    '(function initKoThoughtTranslatorBundle(globalScope) {',
    "  'use strict';",
    '  const __modules = Object.create(null);',
    '  const __cache = Object.create(null);',
    '  function __require(id) {',
    '    if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id].exports;',
    '    const factory = __modules[id];',
    '    if (typeof factory !== "function") throw new Error("Unknown bundled module: " + id);',
    '    const mod = { exports: {} };',
    '    __cache[id] = mod;',
    '    factory(mod, mod.exports, __require);',
    '    return mod.exports;',
    '  }',
    '',
  ];

  for (const mod of modules) {
    const rewritten = rewriteRelativeRequires(stripLeadingUseStrict(mod.rawSource), mod.deps).trimEnd();
    lines.push(`  __modules[${JSON.stringify(mod.id)}] = function (module, exports, require) {`);
    lines.push(
      rewritten
        .split('\n')
        .map((ln) => (ln.length > 0 ? `    ${ln}` : ''))
        .join('\n')
    );
    lines.push('  };');
    lines.push('');
  }

  lines.push(`  const __entry = __require(${JSON.stringify(entryId)});`);
  lines.push('  if (typeof module !== "undefined" && module && module.exports) {');
  lines.push('    module.exports = __entry;');
  lines.push('  }');
  lines.push('  return __entry;');
  lines.push("})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);");
  lines.push('');

  const bundleSource = lines.join('\n');
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
  collectModuleGraph,
  generateBundleSource,
  buildBundle,
};
