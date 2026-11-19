'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAntigravityDictionaryCatalog,
  translateStaticUiSync,
  formatDurationKo,
} = require('../../src/adapters/antigravity/dictionaries');
const {
  BASE_EXCLUDED_SELECTOR,
  hasExcludedCodeDataAttrPrefix,
  isExcludedByFontMonoInheritance,
  createAntigravityUiLocalizer,
} = require('../../src/adapters/antigravity/ui-localizer');

test('Workbench static UI dictionary translates exact and patterned phrases without companion-ui coupling', () => {
  const catalog = createAntigravityDictionaryCatalog();
  assert.equal(catalog.translateSync('Settings'), '설정');
  assert.equal(translateStaticUiSync('Thinking'), '생각하는 중');
  assert.equal(formatDurationKo('5s'), '5초');
  assert.equal(translateStaticUiSync('Thought for 12s'), '12초 동안 생각함');
});

test('BASE_EXCLUDED_SELECTOR uses only 100% standard CSS selectors (no [data-line-*] wildcards)', () => {
  assert.equal(BASE_EXCLUDED_SELECTOR.includes('[data-line-*]'), false);
  assert.equal(BASE_EXCLUDED_SELECTOR.includes('[data-quotable*]'), false);
});

test('hasExcludedCodeDataAttrPrefix excludes arbitrary data-line-*, data-diff-*, data-file-uri code elements', () => {
  const codeLineEl = {
    nodeType: 1,
    attributes: [{ name: 'data-diff-type' }, { name: 'data-line-start' }],
    parentElement: null,
  };
  const tokenChild = {
    nodeType: 1,
    attributes: [{ name: 'class' }],
    parentElement: codeLineEl,
  };
  assert.equal(hasExcludedCodeDataAttrPrefix(tokenChild), true);

  const normalUiEl = {
    nodeType: 1,
    attributes: [{ name: 'data-testid' }],
    parentElement: null,
  };
  assert.equal(hasExcludedCodeDataAttrPrefix(normalUiEl), false);
});

test('isExcludedByFontMonoInheritance excludes .font-mono unless overridden by inner .font-sans', () => {
  const monoParent = {
    contains: (x) => x === sansChild,
  };
  const sansChild = {};
  const monoEl = {
    closest: (sel) => (sel === '.font-mono' ? monoParent : null),
  };
  const sansInsideMono = {
    closest: (sel) => (sel === '.font-mono' ? monoParent : sel === '.font-sans' ? sansChild : null),
  };
  assert.equal(isExcludedByFontMonoInheritance(monoEl), true);
  assert.equal(isExcludedByFontMonoInheritance(sansInsideMono), false);
});

test('createAntigravityUiLocalizer skips code-viewer/diff elements and localizes standard UI labels', () => {
  const localizer = createAntigravityUiLocalizer({
    targetDoc: null,
    catalog: createAntigravityDictionaryCatalog(),
  });
  const excludedEl = {
    nodeType: 1,
    attributes: [{ name: 'data-diff-line' }],
    closest: () => null,
    parentElement: null,
  };
  assert.equal(localizer.isExcludedFromStaticUiLocalization(excludedEl), true);
});
