'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');

const { createGoogleTranslateAdapter } = require('../../src/adapters/translators/google-translate');
const { createAntigravityDictionaryCatalog } = require('../../src/adapters/antigravity/dictionaries');
const { createAntigravityTriggerController } = require('../../src/adapters/antigravity/trigger-controller');
const { createAntigravityThinkingTranslator } = require('../../src/adapters/antigravity/thinking-translator');
const { createObserverScheduler } = require('../../src/runtime/observer-scheduler');
const { ANTIGRAVITY_SELECTORS } = require('../../src/adapters/antigravity/host-adapter');

test('F1: GoogleTranslateAdapter encodes query, concatenates multi-segment output, enforces credentials:omit/redirect:error, and handles aborts', async () => {
  const calls = [];
  const adapter = createGoogleTranslateAdapter({
    async fetchFn(url, init) {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return [[['첫 번째 문장 ', 'First sentence '], ['두 번째 문장.', 'Second sentence.']]];
        },
      };
    },
  });

  const out = await adapter.translate('First sentence Second sentence.', { sourceLang: 'en', targetLang: 'ko' });
  assert.equal(out, '첫 번째 문장 두 번째 문장.');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /client=gtx&sl=en&tl=ko&dt=t&q=/);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');

  const ac = new AbortController();
  ac.abort();
  const abortedOut = await adapter.translate('Should not fetch', { signal: ac.signal });
  assert.equal(abortedOut, '');
  assert.equal(calls.length, 1);
});

test('F1: processTriggerButton preserves React origSpan (data-agy-orig-label="1") and inserts .agy-ko-trigger-label sibling (happy-dom)', () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  try {
    const doc = win.document;
    const btn = doc.createElement('button');
    btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
    const origSpan = doc.createElement('span');
    origSpan.textContent = 'Thought for 5s';
    btn.appendChild(origSpan);
    doc.body.appendChild(btn);

    const ctrl = createAntigravityTriggerController({
      targetDoc: doc,
      targetWin: win,
      catalog: createAntigravityDictionaryCatalog(),
    });

    ctrl.processTriggerButton(btn);
    assert.equal(origSpan.textContent, 'Thought for 5s', 'Original React span textContent must remain untouched');
    assert.equal(origSpan.getAttribute('data-agy-orig-label'), '1');
    const koLabel = btn.querySelector('.agy-ko-trigger-label');
    assert.ok(koLabel);
    assert.equal(koLabel.textContent, '5초 동안 생각함');
  } finally {
    win.happyDOM.close();
  }
});

test('F1: ThinkingTranslator translates .cursor-edit block into .agy-ko-thought-wrap and restores cleanly (happy-dom)', async () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  try {
    const doc = win.document;
    const block = doc.createElement('div');
    block.className = 'cursor-edit';
    const origInnerDiv = doc.createElement('div');
    origInnerDiv.className = 'leading-relaxed';
    const pNode = doc.createElement('p');
    pNode.textContent = 'Inspecting the renderer bundle carefully.';
    origInnerDiv.appendChild(pNode);
    block.appendChild(origInnerDiv);
    doc.body.appendChild(block);

    let translateCalls = 0;
    const mockTranslationService = {
      getEpoch: () => 1,
      getActiveProviderId: () => 'google-translate',
      getCachedSync: () => null,
      async translateText() {
        translateCalls += 1;
        return '렌더러 번들을 주의 깊게 점검하는 중입니다.';
      },
    };

    const translator = createAntigravityThinkingTranslator({
      targetDoc: doc,
      catalog: createAntigravityDictionaryCatalog(),
      translationService: mockTranslationService,
      getTranslateThinkingEnabled: () => true,
      isDisposed: () => false,
    });

    translator.scanThoughtBlocks();
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.equal(translateCalls, 1);
    assert.equal(block.getAttribute('data-agy-ko-ready'), '1');
    const wrap = block.querySelector('.agy-ko-thought-wrap');
    assert.ok(wrap, 'Must insert .agy-ko-thought-wrap sibling');
    assert.match(wrap.textContent, /렌더러 번들을 주의 깊게 점검하는 중입니다/);

    translator.restoreOriginalCursorEdits();
    assert.equal(block.getAttribute('data-agy-ko-ready'), null);
    assert.equal(block.querySelector('.agy-ko-thought-wrap'), null);
  } finally {
    win.happyDOM.close();
  }
});

test('F1+F5: guardSessionSwitchTransitions adds no-animations on cascade swap and cleans it up on stop()/dispose() (happy-dom)', () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  try {
    const doc = win.document;
    const convView = doc.createElement('div');
    convView.setAttribute('data-testid', 'conversation-view');
    convView.setAttribute('data-cascade-id', 'cascade-1');
    const turn = doc.createElement('div');
    turn.setAttribute('data-testid', 'user-message-bubble');
    convView.appendChild(turn);
    doc.body.appendChild(convView);

    const scheduler = createObserverScheduler({
      targetWin: win,
      targetDoc: doc,
      selectors: ANTIGRAVITY_SELECTORS,
      periodicIntervalMs: 0,
    });
    scheduler.guardSessionSwitchTransitions();
    assert.equal(convView.classList.contains('no-animations'), false);

    convView.setAttribute('data-cascade-id', 'cascade-2');
    scheduler.guardSessionSwitchTransitions();
    assert.equal(convView.getAttribute('data-agy-session-switching'), '1');
    assert.equal(convView.classList.contains('no-animations'), true);
    assert.equal(convView.getAttribute('data-agy-added-no-animations'), '1');

    scheduler.dispose();
    assert.equal(convView.hasAttribute('data-agy-session-switching'), false);
    assert.equal(convView.classList.contains('no-animations'), false);
    assert.equal(convView.hasAttribute('data-agy-added-no-animations'), false);
  } finally {
    win.happyDOM.close();
  }
});
