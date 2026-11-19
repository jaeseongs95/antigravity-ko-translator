'use strict';

/**
 * Real Headless Chromium (Blink CSS Engine + V8) End-to-End Verification.
 *
 * Verifies:
 * 1. Real built `dist/renderer.js` executes in Chromium, localizes static UI (`Settings` -> `설정`,
 *    `Thinking` -> `생각하는 중`, `Thought for 5s` -> `.agy-ko-trigger-label` `5초 동안 생각함`),
 *    and strictly EXCLUDES ALL 11 D-0042 code/diff/syntax/monospace selectors under Blink's real CSS engine.
 * 2. Official Sidecar `index.html` served by `createStandaloneHttpServer` loads in Chromium,
 *    renders diagnostics, and embeds the live CSRF token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function runChromeDumpDom(chromeBin, url) {
  return new Promise((resolve, reject) => {
    execFile(
      chromeBin,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--dump-dom',
        '--virtual-time-budget=1500',
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

const CHROME_BIN = findChromiumBinary();

if (CHROME_BIN) {
  test('Defect-1 (Real Chromium Blink CSS + V8): dist/renderer.js localizes UI while preserving ALL 11 D-0042 code/diff selectors', async () => {
    const bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');
    const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Workbench E2E</title></head>
<body>
  <div data-testid="conversation-view">
    <button id="ui-settings">Settings</button>
    <span id="ui-thinking">Thinking</span>
    <button id="ui-trigger" data-testid="thinking-collapsible-trigger" aria-expanded="false"><span>Thought for 5s</span></button>

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
  </div>
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

      // Verify ALL 11 D-0042 code/diff/syntax/monospace selectors kept 'Change' untouched under real Blink CSS!
      for (let i = 1; i <= 11; i++) {
        assert.match(
          dumped,
          new RegExp(`id="d42-${i}"[^>]*>Change<`),
          `Real Chromium Blink CSS must exclude D-0042 element #d42-${i} from translation`
        );
      }
      console.log(JSON.stringify({ chromiumWorkbenchVerified: true, chromeBin: path.basename(CHROME_BIN), d42SelectorsVerified: 11 }));
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    }
  });

  test('Defect-1 (Real Chromium): Official Sidecar index.html loads diagnostics and live CSRF token from standalone HTTP server', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-chrome-sidecar-'));
    try {
      const mainUrl = pathToFileURL(path.join(REPO_ROOT, 'sidecars', 'ko-translator-settings', 'main.mjs')).href;
      const { createSettingsRequestHandler, createStandaloneHttpServer } = await import(mainUrl);
      const agyDir = path.join(dir, '.gemini', 'antigravity');
      const cfgDir = path.join(dir, '.gemini', 'config');
      fs.mkdirSync(agyDir, { recursive: true });
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.writeFileSync(
        path.join(cfgDir, 'config.json'),
        JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: true } } }),
        'utf8'
      );

      const handle = createSettingsRequestHandler({
        SETTINGS_PATH: path.join(agyDir, 'ko_translator_settings.json'),
        SETTINGS_LOCK_PATH: path.join(agyDir, 'ko_translator_settings.lock'),
        CONFIG_JSON_PATH: path.join(cfgDir, 'config.json'),
        MANIFEST_PATH: path.join(agyDir, 'ui-extensions.d', 'ko-thought-translator.json'),
        ASAR_PATH: path.join(dir, 'missing.asar'),
      });
      const server = createStandaloneHttpServer(handle);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const { port } = server.address();
        const dumped = await runChromeDumpDom(CHROME_BIN, `http://127.0.0.1:${port}/`);
        assert.ok(dumped.includes(`content="${handle.csrfToken}"`), 'Real Chromium DOM must contain live CSRF meta tag');
        assert.match(dumped, /id="diag-plugin-val">활성<\/strong>/);
        console.log(JSON.stringify({ chromiumSidecarVerified: true, chromeBin: path.basename(CHROME_BIN) }));
      } finally {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
