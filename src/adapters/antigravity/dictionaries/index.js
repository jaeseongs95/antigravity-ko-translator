'use strict';

const { createDictionaryCatalog } = require('../../../core/dictionary-port');
const {
  WORKBENCH_UI_ENTRIES,
  formatDurationKo,
  translateToolClause,
  createWorkbenchPatternMatcher,
} = require('./workbench-ui');
const { COMPANION_UI_ENTRIES } = require('./companion-ui');

function createAntigravityDictionaryCatalog() {
  let catalogRef = null;
  const lookupFn = (subText) => (catalogRef ? catalogRef.translateSync(subText) : null);
  const patternMatcher = createWorkbenchPatternMatcher(lookupFn);

  catalogRef = createDictionaryCatalog({
    exactEntries: [
      { source: 'workbench-ui', entries: WORKBENCH_UI_ENTRIES },
      { source: 'companion-ui', entries: COMPANION_UI_ENTRIES },
    ],
    patternMatcher,
    maxCacheSize: 512,
  });

  return catalogRef;
}

const defaultAntigravityCatalog = createAntigravityDictionaryCatalog();

function translateStaticUiSync(rawText) {
  return defaultAntigravityCatalog.translateSync(rawText);
}

module.exports = {
  createAntigravityDictionaryCatalog,
  defaultAntigravityCatalog,
  translateStaticUiSync,
  formatDurationKo,
  translateToolClause,
};
