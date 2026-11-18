'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const {
  rewriteWorkerGlobalBindings,
  buildEsModuleGraphBundle,
} = require('../../src/remote/js-module-compiler');

async function evalGraph(filesMap, entryUrl = 'https://www.gstatic.com/antigravity/web/2.33.0/entry.js', extraCtx = {}) {
  const { bundleExpression, postOrderIds } = await buildEsModuleGraphBundle({
    entryUrl,
    async fetchSource(url) {
      if (!Object.prototype.hasOwnProperty.call(filesMap, url)) {
        throw new Error(`404 in test module map: ${url}`);
      }
      return filesMap[url];
    },
    resolveImportUrl(spec, importerUrl) {
      return new URL(spec, importerUrl).href;
    },
  });
  const ctx = vm.createContext({
    console,
    URL,
    Symbol,
    Object,
    Array,
    TypeError,
    ReferenceError,
    ...extraCtx,
  });
  const ns = await vm.runInContext(bundleExpression, ctx);
  return { ns, postOrderIds, ctx };
}

test('JS Module Compiler: rewriteWorkerGlobalBindings rewrites free worker globals while preserving shadowed locals, member props, and shorthand properties', () => {
  const input = [
    'const originA = location.origin;',
    'const originB = self.location.href;',
    'const obj = { location: "prop-key", origin: origin };',
    'function inner(location) {',
    '  return { location, prop: obj.location };',
    '}',
  ].join('\n');

  const rewritten = rewriteWorkerGlobalBindings(input, {
    location: '__workerLoc',
    origin: '__workerOrigin',
  });

  assert.match(rewritten, /__workerLoc\.origin/);
  assert.match(rewritten, /self\.location\.href/, 'Member access self.location must not rewrite property token');
  assert.match(rewritten, /\{\s*location:\s*"prop-key",\s*origin:\s*__workerOrigin\s*\}/);
  assert.match(rewritten, /return\s*\{\s*location,\s*prop:\s*obj\.location\s*\}/);

  // Shorthand `{ location }` where `location` is a FREE global expands to `{ location: __workerLoc }`!
  const freeShorthand = rewriteWorkerGlobalBindings('const snap = { location };', {
    location: '__workerLoc',
  });
  assert.match(freeShorthand, /\{\s*location:\s*__workerLoc\s*\}/);
});

test('JS Module Compiler (Rev6-F4 #3): 3-phase DFS post-order link() resolves multi-hop export * chains, live imports, uninitialized let -> undefined, and mutable named export default function/class', async () => {
  const base = 'https://www.gstatic.com/antigravity/web/2.33.0/';
  const files = {
    [`${base}entry.js`]: [
      'import * as barrel from "./barrel1.js";',
      'import fnDefault, { bump, count, uninitLet } from "./leaf.js";',
      'import ClsDefault, { reassignCls } from "./cls.js";',
      'export const beforeBump = barrel.count;',
      'bump();',
      'export const afterBump = barrel.count;',
      'export const checkUninit = uninitLet;',
      'export const fnBefore = fnDefault();',
      'barrel.wrapDefaultFn();',
      'import fnDefaultAfter from "./leaf.js";',
      'export const fnAfter = fnDefaultAfter();',
      'export const clsBefore = new ClsDefault().tag;',
      'reassignCls();',
      'import ClsAfter from "./cls.js";',
      'export const clsAfter = new ClsAfter().tag;',
      'export function tryMutateImport() { count = 999; }',
    ].join('\n'),
    [`${base}barrel1.js`]: 'export * from "./barrel2.js";',
    [`${base}barrel2.js`]: 'export * from "./leaf.js";',
    [`${base}leaf.js`]: [
      'export let uninitLet;',
      'export let count = 10;',
      'export function bump() { count += 5; }',
      'export default function Foo() { return "orig-foo"; }',
      'export function wrapDefaultFn() {',
      '  const prev = Foo;',
      '  Foo = function WrappedFoo() { return "wrapped:" + prev(); };',
      '}',
    ].join('\n'),
    [`${base}cls.js`]: [
      'export default class Bar { constructor() { this.tag = "orig-bar"; } }',
      'export function reassignCls() {',
      '  Bar = class ReplacedBar { constructor() { this.tag = "replaced-bar"; } };',
      '}',
    ].join('\n'),
  };

  const { ns } = await evalGraph(files, `${base}entry.js`);

  assert.equal(ns.checkUninit, undefined, 'Rev6-F4 #3: `export let uninitLet;` must initialize to undefined, not __TDZ');
  assert.equal(ns.beforeBump, 10, '3-hop `export *` chain must link leaf exports into top barrel');
  assert.equal(ns.afterBump, 15, 'Live ES module binding must reflect updates across `export *`');
  assert.equal(ns.fnBefore, 'orig-foo');
  assert.equal(ns.fnAfter, 'wrapped:orig-foo', 'Rev6-F4 #3: Named `export default function Foo` local reassignment must update live default export');
  assert.equal(ns.clsBefore, 'orig-bar');
  assert.equal(ns.clsAfter, 'replaced-bar', 'Rev6-F4 #3: Named `export default class Bar` local reassignment must update live default export');
  assert.throws(() => ns.tryMutateImport(), TypeError, 'Assigning to an imported binding must throw TypeError');
});

test('JS Module Compiler (Rev5-F5 ECMA-262 §13.15.2): RHS side-effect executes BEFORE TDZ ReferenceError or const TypeError', async () => {
  const base = 'https://www.gstatic.com/antigravity/web/2.33.0/';

  // Case 1: `x = recordRhs()` BEFORE `let x = 1` -> `recordRhs()` MUST run first, THEN ReferenceError!
  let rhsCallsLetTdz = 0;
  await assert.rejects(
    () =>
      evalGraph(
        {
          [`${base}entry.js`]: [
            'export function trigger() {',
            '  x = recordRhs();',
            '  let x = 1;',
            '  return x;',
            '}',
            'trigger();',
          ].join('\n'),
        },
        `${base}entry.js`,
        {
          recordRhs() {
            rhsCallsLetTdz += 1;
            return 42;
          },
        }
      ),
    { name: 'ReferenceError' }
  );
  assert.equal(rhsCallsLetTdz, 1, 'RHS expression must evaluate once BEFORE TDZ ReferenceError on `let`');

  // Case 2: `c = recordRhs()` BEFORE `const c = 1` -> `recordRhs()` runs first, THEN ReferenceError (TDZ precedes const check)!
  let rhsCallsConstTdz = 0;
  await assert.rejects(
    () =>
      evalGraph(
        {
          [`${base}entry.js`]: [
            'function run() {',
            '  c = recordRhs();',
            '  const c = 1;',
            '  return c;',
            '}',
            'run();',
          ].join('\n'),
        },
        `${base}entry.js`,
        {
          recordRhs() {
            rhsCallsConstTdz += 1;
            return 7;
          },
        }
      ),
    { name: 'ReferenceError' }
  );
  assert.equal(rhsCallsConstTdz, 1, 'RHS expression must evaluate once BEFORE TDZ ReferenceError on uninitialized `const`');

  // Case 3: `c = recordRhs()` AFTER `const c = 1` -> `recordRhs()` runs first, THEN TypeError!
  let rhsCallsConstPostInit = 0;
  await assert.rejects(
    () =>
      evalGraph(
        {
          [`${base}entry.js`]: [
            'const c = 1;',
            'c = recordRhs();',
          ].join('\n'),
        },
        `${base}entry.js`,
        {
          recordRhs() {
            rhsCallsConstPostInit += 1;
            return 99;
          },
        }
      ),
    { name: 'TypeError' }
  );
  assert.equal(rhsCallsConstPostInit, 1, 'RHS expression must evaluate once BEFORE TypeError on initialized `const`');
});
