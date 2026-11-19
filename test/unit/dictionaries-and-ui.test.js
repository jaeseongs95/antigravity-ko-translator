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
const { createAntigravityTriggerController } = require('../../src/adapters/antigravity/trigger-controller');

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

test('F3 (D-0016/D-0023): trigger-controller does NOT force-expand previous completed turn Thinking when latest turn is text-only', () => {
  let prevBtnClicked = false;
  const latestUserBubble = {
    compareDocumentPosition: () => 0,
  };
  const prevThinkingBtn = {
    attrs: new Map([
      ['data-testid', 'thinking-collapsible-trigger'],
      ['aria-expanded', 'false'],
    ]),
    getAttribute(k) {
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    },
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
    },
    removeAttribute(k) {
      this.attrs.delete(k);
    },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    compareDocumentPosition: (other) => (other === latestUserBubble ? 4 : 0),
    click() {
      prevBtnClicked = true;
    },
  };

  const doc = {
    documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute: () => null },
    querySelectorAll(sel) {
      if (sel === '[data-testid="user-message-bubble"]') return [latestUserBubble];
      if (sel === 'button[data-testid="thinking-collapsible-trigger"]') return [prevThinkingBtn];
      return [];
    },
  };

  const ctrl = createAntigravityTriggerController({
    targetDoc: doc,
    targetWin: { Node: { DOCUMENT_POSITION_FOLLOWING: 4 } },
    catalog: createAntigravityDictionaryCatalog(),
    getShowThinkingEnabled: () => true,
  });

  ctrl.scanTriggerButtonsSync(false);
  assert.equal(prevBtnClicked, false, 'Previous turn Thinking button must NOT be force-expanded');
});

test('F3 (D-0023): within [data-turn-content="latest"], ONLY the last Thinking segment expands (earlier completed segments stay collapsed)', () => {
  const clicked = [];
  const makeBtn = (name) => ({
    name,
    attrs: new Map([
      ['data-testid', 'thinking-collapsible-trigger'],
      ['aria-expanded', 'false'],
    ]),
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    click() {
      clicked.push(name);
      this.attrs.set('aria-expanded', 'true');
    },
  });

  const earlierSeg = makeBtn('seg-1-completed');
  const activeSeg = makeBtn('seg-2-active');
  const latestTurnEl = {
    contains: (el) => el === earlierSeg || el === activeSeg,
  };
  const doc = {
    documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute: () => null },
    querySelector: (sel) => (sel === '[data-turn-content="latest"]' ? latestTurnEl : null),
    querySelectorAll: (sel) =>
      sel === 'button[data-testid="thinking-collapsible-trigger"]' ? [earlierSeg, activeSeg] : [],
  };

  const ctrl = createAntigravityTriggerController({
    targetDoc: doc,
    targetWin: { Node: { DOCUMENT_POSITION_FOLLOWING: 4 } },
    catalog: createAntigravityDictionaryCatalog(),
    getShowThinkingEnabled: () => true,
  });

  ctrl.scanTriggerButtonsSync(false);
  assert.deepEqual(clicked, ['seg-2-active'], 'D-0023: only the active last Thinking segment may expand');
});

test('F1 (D-0042): ALL Antigravity 2.0 code/diff/syntax/monospace selectors are excluded from static UI localization', () => {
  const localizer = createAntigravityUiLocalizer({
    targetDoc: null,
    catalog: createAntigravityDictionaryCatalog(),
  });

  // 1) Attribute-based code/diff exclusions (hasExcludedCodeDataAttrPrefix)
  for (const attrName of ['data-diff-type', 'data-file-uri', 'data-line-number', 'data-line-tokens', 'data-line-start']) {
    const el = {
      nodeType: 1,
      attributes: [{ name: attrName }],
      closest: () => null,
      parentElement: null,
    };
    assert.equal(
      localizer.isExcludedFromStaticUiLocalization(el),
      true,
      `Attribute [${attrName}] must be excluded from static UI localization`
    );
  }

  // 2) Selector-based code/syntax/editor/monospace exclusions
  for (const matchedSelector of ['.code-block', '.code-line', '.line-content', '.token', '.cm-editor', '.shiki', '.font-mono']) {
    const el = {
      nodeType: 1,
      attributes: [],
      closest(sel) {
        if (sel === '.font-mono') return matchedSelector === '.font-mono' ? el : null;
        if (sel === '.font-sans') return null;
        return sel.includes(matchedSelector) ? el : null;
      },
      parentElement: null,
    };
    assert.equal(
      localizer.isExcludedFromStaticUiLocalization(el),
      true,
      `Selector ${matchedSelector} must be excluded from static UI localization`
    );
  }
});
