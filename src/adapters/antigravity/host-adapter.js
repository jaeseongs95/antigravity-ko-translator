'use strict';

/**
 * Antigravity Desktop Host UI Adapter.
 *
 * Isolates all Antigravity-specific DOM selectors, overlay CSS, dictionaries,
 * storage keys, and DOM localization controllers behind the vendor-neutral
 * HostUiAdapter port consumed by `src/runtime/bootstrap.js`.
 */

const { createAntigravityDictionaryCatalog } = require('./dictionaries');
const { createStoragePort, STORAGE_KEYS } = require('./storage-port');
const { createAntigravityUiLocalizer } = require('./ui-localizer');
const { createAntigravityTriggerController } = require('./trigger-controller');
const { createAntigravityThinkingTranslator } = require('./thinking-translator');

const STYLE_ID = 'agy-ko-thought-localizer-style';

const ANTIGRAVITY_SELECTORS = Object.freeze({
  noTranslateSubtree:
    '.agy-ko-thought-wrap, [data-addon-host-owner], [data-addon-host-slot], [data-addon-host-no-translate], [data-agy-no-translate="true"], [translate="no"]',
  triggerLabelClass: 'agy-ko-trigger-label',
  conversationViews:
    '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"]',
  conversationViewFallbackList: Object.freeze([
    '[data-testid="conversation-view"]',
    '[data-testid="subagent-tab-conversation"]',
    '[data-testid="side-question-tab-conversation"]',
  ]),
  mountedTurn:
    'button[data-testid="worked-for-collapsible"], button[data-testid="thinking-collapsible-trigger"], [data-testid="user-message-bubble"]',
  fastPassRoots:
    '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"], [data-testid="idle-status-text"], [data-testid="conversation-navigator"]',
  cascadeIdAttr: 'data-cascade-id',
  viewTestIdAttr: 'data-testid',
  primaryViewTestId: 'conversation-view',
  autoExpandedAttr: 'data-agy-auto-expanded',
  origLabelAttr: 'data-agy-orig-label',
  sessionSwitchingAttr: 'data-agy-session-switching',
  addedNoAnimationsAttr: 'data-agy-added-no-animations',
  noAnimationsClass: 'no-animations',
  appliedTextProp: '__agyKoApplied',
  programmaticClickProp: '__agyProgrammaticClick',
});

function buildMinimalOverlayCss() {
  return `
.cursor-edit[data-agy-ko-ready="1"] > div:not(.agy-ko-thought-wrap),
[data-agy-ko-thought-host="1"][data-agy-ko-ready="1"] > div:not(.agy-ko-thought-wrap) {
  display: none !important;
}
.agy-ko-thought-wrap {
  display: block;
}
[data-agy-hide-thinking="1"] button[data-testid="thinking-collapsible-trigger"],
[data-agy-hide-thinking="1"] button[data-testid="thinking-collapsible-trigger"] + div {
  display: none !important;
}
`.trim();
}

function createAntigravityHostAdapter() {
  return {
    id: 'antigravity-desktop',
    styleId: STYLE_ID,
    selectors: ANTIGRAVITY_SELECTORS,
    storageKeys: STORAGE_KEYS,
    buildOverlayCss: buildMinimalOverlayCss,
    createStoragePort,
    createDictionaryCatalog: createAntigravityDictionaryCatalog,
    createUiLocalizer: createAntigravityUiLocalizer,
    createTriggerController: createAntigravityTriggerController,
    createThinkingTranslator: createAntigravityThinkingTranslator,
  };
}

module.exports = {
  STYLE_ID,
  ANTIGRAVITY_SELECTORS,
  buildMinimalOverlayCss,
  createAntigravityHostAdapter,
};
