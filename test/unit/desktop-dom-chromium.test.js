'use strict';

/**
 * Real Headless Chromium (Blink CSS Engine + V8) End-to-End Verification.
 *
 * Verifies:
 * 1. Real built `dist/renderer.js` executes in Chromium:
 *    - Translates a real `.cursor-edit` Thinking block into `.agy-ko-thought-wrap` (`data-agy-ko-ready="1"`).
 *    - Localizes static UI (`Settings` -> `설정`, `Thinking` -> `생각하는 중`, `Thought for 5s` -> `5초 동안 생각함`).
 *    - Strictly EXCLUDES ALL 11 D-0042 code/diff/syntax/monospace selectors under Blink's real CSS engine.
 * 2. Built `dist/renderer.js` under simulated `addonHost` + `window.statusbarAddons`:
 *    - Registers statusbar button (`번역:구글`), opens Shadow DOM Quick Settings Modal via `addonHost.openModal`,
 *      switches to `local-llm`, persists via `addonHost.saveSettings`, updates button label to `번역:LLM`,
 *      and toggles back to `google-translate` via `Shift+click`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUNDLE_PATH = path.join(REPO_ROOT, 'dist', 'renderer.js');

function findChromiumBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function runChromeDumpDom(chromeBin, url) {
  return new Promise((resolve, reject) => {
    execFile(
      chromeBin,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--dump-dom',
        '--virtual-time-budget=2500',
        url,
      ],
      { encoding: 'utf8', timeout: 25000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message}\n${stderr || ''}`));
        else resolve(stdout);
      }
    );
  });
}

const CHROME_BIN = findChromiumBinary();
const CHROME_SKIP_REASON = CHROME_BIN ? false : 'Chrome/Chromium binary not available in this environment';

test(
  'Defect-1+F2 (Real Chromium Blink CSS + V8): dist/renderer.js translates Thinking + UI while preserving ALL 11 D-0042 selectors',
  { skip: CHROME_SKIP_REASON },
  async () => {
    const bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');
    const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Workbench E2E</title></head>
<body>
  <div data-testid="conversation-view">
    <button id="ui-settings">Settings</button>
    <span id="ui-thinking">Thinking</span>
    <button id="ui-trigger" data-testid="thinking-collapsible-trigger" aria-expanded="true"><span>Thought for 5s</span></button>
    <div id="thought-block" class="cursor-edit">
      <div class="leading-relaxed"><p>Inspecting the renderer bundle carefully.</p></div>
    </div>

    <div class="code-block"><span id="d42-1">Change</span></div>
    <div class="code-line"><span id="d42-2">Change</span></div>
    <div class="line-content"><span id="d42-3">Change</span></div>
    <span class="token" id="d42-4">Change</span>
    <div data-diff-type="add"><span id="d42-5">Change</span></div>
    <div data-file-uri="file:///App.java"><span id="d42-6">Change</span></div>
    <div data-line-number="42"><span id="d42-7">Change</span></div>
    <div data-line-tokens="1"><span id="d42-8">Change</span></div>
    <div class="cm-editor"><span id="d42-9">Change</span></div>
    <div class="shiki"><span id="d42-10">Change</span></div>
    <div class="font-mono"><span id="d42-11">Change</span></div>
    <div data-addon-host-owner="antigravity-statusbar" data-addon-host-slot="antigravity-statusbar.root"><span id="peer-addon-1">Settings</span></div>
  </div>
  <script>
    window.fetch = async function () {
      return {
        ok: true,
        async json() {
          return [[['렌더러 번들을 주의 깊게 점검하는 중입니다.', 'Inspecting the renderer bundle carefully.']]];
        },
      };
    };
  </script>
  <script src="/renderer.js"></script>
</body>
</html>`;

    const server = http.createServer((req, res) => {
      if (req.url === '/renderer.js') {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
        res.end(bundleSrc);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const dumped = await runChromeDumpDom(CHROME_BIN, `http://127.0.0.1:${port}/workbench.html`);

      assert.match(dumped, /<button id="ui-settings">설정<\/button>/);
      assert.match(dumped, /<span id="ui-thinking">생각하는 중<\/span>/);
      assert.match(dumped, /data-agy-orig-label="1"/);
      assert.match(dumped, /class="agy-ko-trigger-label">5초 동안 생각함<\/span>/);
      assert.match(dumped, /id="thought-block"[^>]*data-agy-ko-ready="1"/);
      assert.match(dumped, /agy-ko-thought-wrap[\s\S]*렌더러 번들을 주의 깊게 점검하는 중입니다\./);

      for (let i = 1; i <= 11; i++) {
        assert.match(
          dumped,
          new RegExp(`id="d42-${i}"[^>]*>Change<`),
          `Real Chromium Blink CSS must exclude D-0042 element #d42-${i} from translation`
        );
      }
      assert.match(
        dumped,
        /id="peer-addon-1"[^>]*>Settings</,
        'Real Chromium Blink CSS must exclude sibling addon slot [data-addon-host-owner] from translation'
      );
      console.log(
        JSON.stringify({
          chromiumWorkbenchVerified: true,
          chromeBin: path.basename(CHROME_BIN),
          thinkingTranslated: true,
          d42SelectorsVerified: 11,
        })
      );
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    }
  });

  test(
    'Defect-1+F2 (Real Chromium): Built dist/renderer.js statusbar button, Shadow DOM quick modal saveSettings, and Shift+click instant toggle',
    { skip: CHROME_SKIP_REASON },
    async () => {
    const bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');
    const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Quick Settings E2E</title><style>*, ::before, ::after { box-sizing: border-box; margin: 0; padding: 0; }</style></head>
<body>
  <pre id="e2e-result">PENDING</pre>
  <script>
    const saved = [];
    const listeners = new Set();
    let currentSnap = {
      status: 'ok',
      revision: 1,
      data: {
        schemaVersion: 1,
        enabled: true,
        translateThinking: true,
        showThinking: true,
        translateStaticUi: true,
        provider: 'google-translate',
        llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b', apiFormat: 'ollama', timeoutMs: 15000 }
      }
    };
    const sbMap = new Map();
    window.statusbarAddons = {
      register(def) { sbMap.set(def.id, def); },
      unregister(id) { sbMap.delete(id); }
    };
    window.__mockAddonHost = {
      pluginId: 'ko-thought-translator',
      trustLevel: 'trusted',
      hasSettingsBridge: true,
      getSettings: () => currentSnap,
      onSettingsChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      async saveSettings(nextData) {
        saved.push(nextData);
        currentSnap = { status: 'ok', revision: saved.length + 1, data: JSON.parse(JSON.stringify(nextData)) };
        for (const cb of listeners) cb(currentSnap);
        return { ok: true, reason: null, snapshot: currentSnap };
      },
      openModal(slotId, opts = {}) {
        const dlg = document.createElement('dialog');
        dlg.setAttribute('data-addon-host-modal-dialog', '1');
        dlg.setAttribute('data-addon-host-slot', slotId);
        // Simulate Tailwind Preflight + legacy host marginTop so the test verifies self-centering resilience
        dlg.style.marginTop = 'max(env(titlebar-area-height, 36px), 36px)';
        const host = document.createElement('div');
        dlg.appendChild(host);
        const sr = host.attachShadow({ mode: 'open' });
        const bodyEl = document.createElement('div');
        sr.appendChild(bodyEl);
        document.body.appendChild(dlg);
        dlg.showModal();
        return {
          id: 'e2e-modal',
          element: dlg,
          bodyEl,
          close() {
            if (dlg.open) dlg.close();
            dlg.remove();
            if (opts.onClose) opts.onClose();
          }
        };
      },
      injectStyle() {},
      removeStyle() {},
      onDispose() {}
    };
  </script>
  <script src="/renderer-wrapped.js"></script>
  <script>
    (async () => {
      const btn0 = sbMap.get('ko-translator');
      const initialLabel = btn0 ? btn0.label : null;
      btn0.onClick({ sessionId: 's1' });
      const dlg = document.querySelector('dialog[data-addon-host-slot="ko-translator.quick-settings-modal"]');
      const sr = dlg && dlg.firstElementChild && dlg.firstElementChild.shadowRoot;
      const cardEl = sr && sr.querySelector('[data-testid="ko-qs-card"]');
      const modalOpened = Boolean(cardEl);
      const switchCount = sr ? sr.querySelectorAll('input[role="switch"]').length : 0;
      const legacyCheckboxCount = sr ? sr.querySelectorAll('.ko-qs-checkbox').length : -1;
      const hasDuplicateEnabledSwitch = Boolean(sr && sr.querySelector('[data-testid="ko-qs-opt-enabled"]'));
      const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
      const modalCenterOffsetX = cardRect ? Math.abs((cardRect.left + cardRect.width / 2) - window.innerWidth / 2) : 9999;
      const modalCenterOffsetY = cardRect
        ? Math.abs((cardRect.top + cardRect.height / 2) - (36 + (window.innerHeight - 36) / 2))
        : 9999;
      const modalLeft = cardRect ? Math.round(cardRect.left) : -1;
      const modalTop = cardRect ? Math.round(cardRect.top) : -1;
      sr.querySelector('[data-testid="ko-qs-engine-local-llm"]').click();
      sr.querySelector('[data-testid="ko-qs-llm-model"]').value = 'gemma3:12b';
      sr.querySelector('[data-testid="ko-qs-save"]').click();
      await new Promise((r) => setTimeout(r, 80));
      const labelAfterModalSave = sbMap.get('ko-translator').label;

      // Shift+click instant toggle without passing MouseEvent to onClick
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
      sbMap.get('ko-translator').onClick({ sessionId: 's1' });
      await new Promise((r) => setTimeout(r, 80));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
      const labelAfterShiftToggle = sbMap.get('ko-translator').label;

      document.getElementById('e2e-result').textContent = JSON.stringify({
        initialLabel,
        modalOpened,
        switchCount,
        legacyCheckboxCount,
        hasDuplicateEnabledSwitch,
        modalLeft,
        modalTop,
        modalCenterOffsetX: Math.round(modalCenterOffsetX * 10) / 10,
        modalCenterOffsetY: Math.round(modalCenterOffsetY * 10) / 10,
        savedCount: saved.length,
        firstSavedProvider: saved[0] && saved[0].provider,
        firstSavedModel: saved[0] && saved[0].llmConfig && saved[0].llmConfig.model,
        labelAfterModalSave,
        secondSavedProvider: saved[1] && saved[1].provider,
        labelAfterShiftToggle,
      });
    })();
  </script>
</body>
</html>`;

    const wrappedBundle = `(function(addonHost){\n${bundleSrc}\n})(window.__mockAddonHost);\n`;
    const server = http.createServer((req, res) => {
      if (req.url === '/renderer-wrapped.js') {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
        res.end(wrappedBundle);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const dumped = await runChromeDumpDom(CHROME_BIN, `http://127.0.0.1:${port}/`);
      const m = dumped.match(/<pre id="e2e-result">([\s\S]*?)<\/pre>/);
      assert.ok(m, 'Chromium output must contain #e2e-result');
      const result = JSON.parse(m[1].replace(/&quot;/g, '"'));
      assert.equal(result.initialLabel, '번역:구글');
      assert.equal(result.modalOpened, true);
      assert.equal(result.switchCount, 4, 'All 4 popup toggles must render as role="switch" slide switches');
      assert.equal(result.legacyCheckboxCount, 0, 'Zero legacy checkboxes may remain in the popup');
      assert.equal(result.hasDuplicateEnabledSwitch, false, 'Duplicate enabled checkbox must remain merged');
      assert.ok(result.modalLeft > 100, `modal must be horizontally centered, got left=${result.modalLeft}`);
      assert.ok(result.modalTop >= 36, `modal must stay below 36px titlebar, got top=${result.modalTop}`);
      assert.ok(result.modalCenterOffsetX <= 2, `horizontal center offset too large: ${result.modalCenterOffsetX}`);
      assert.ok(result.modalCenterOffsetY <= 2, `vertical center offset too large: ${result.modalCenterOffsetY}`);
      assert.equal(result.savedCount, 2);
      assert.equal(result.firstSavedProvider, 'local-llm');
      assert.equal(result.firstSavedModel, 'gemma3:12b');
      assert.equal(result.labelAfterModalSave, '번역:LLM');
      assert.equal(result.secondSavedProvider, 'google-translate');
      assert.equal(result.labelAfterShiftToggle, '번역:구글');
      console.log(
        JSON.stringify({
          chromiumQuickSettingsVerified: true,
          chromeBin: path.basename(CHROME_BIN),
          ...result,
        })
      );
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    }
  });
