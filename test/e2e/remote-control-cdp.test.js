'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const KO_BUNDLE_PATH = path.join(REPO_ROOT, 'scripts', 'ko_thought_autoinject.js');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const SIBLING_STATUSBAR_PATH = path.resolve(REPO_ROOT, '..', 'antigravity-statusbar', 'dist', 'statusbar_autoinject.js');
const SIBLING_MCP_PATH = path.resolve(REPO_ROOT, '..', 'antigravity-mcp-manager', 'dist', 'mcp_manager_autoinject.js');

const HOST_NONCE = 'E2eLiveHostNonce2026AbCdEf12';
const HOST_ORIGIN = 'https://antigravity.google.com';
const SANDBOX_ORIGIN = 'https://antigravity.static.usercontent.goog';
const CDN_ORIGIN = 'https://www.gstatic.com';
const APP_VERSION = '2.33.0';
const CDN_BASE = `${CDN_ORIGIN}/antigravity/web/${APP_VERSION}`;
const SANDBOX_BASE = `${SANDBOX_ORIGIN}/web/${APP_VERSION}`;
const REAL_CSRF_TOKEN = 'e2e-real-csrf-token-9988';

const DEFAULT_V2_CSP =
  `script-src 'nonce-${HOST_NONCE}' 'unsafe-inline' 'strict-dynamic' https: http:; ` +
  `object-src 'none'; base-uri 'self'; worker-src 'self'; ` +
  `require-trusted-types-for 'script'; report-uri /_/GoogleAntigravity/cspreport`;

const SAVED_V1_2_39_BOOKMARKLET =
  `javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js?t='+Date.now()).then(r=>r.ok?r.text():'').then(c=>{if(!c)return;try{const s=document.createElement('script'),n=[...document.querySelectorAll('script,style,link')].map(e=>e.nonce||e.getAttribute('nonce')).find(Boolean),t=window.trustedTypes,p=t?.createPolicy?t.createPolicy('agy-ko-translator-bm',{createScript:x=>x}):null;if(n){s.nonce=n;s.setAttribute('nonce',n)}s.text=p?p.createScript(c):c;(document.head||document.documentElement).appendChild(s)}catch{}})})();`;

function extractReadmeBookmarklet() {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const match = readme.match(/javascript:\(\(\)=>\{[^\r\n]+\}\)\(\);/);
  assert.ok(match && match[0], 'README.md must contain a single-line 1-click bookmarklet');
  return match[0];
}

function resolveBrowserBinary() {
  const envBin = process.env.CHROME_BIN || process.env.BROWSER_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;

  const winCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  const unixCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  const list = process.platform === 'win32' ? winCandidates : unixCandidates;
  for (const candidate of list) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform !== 'win32') {
    for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium', 'microsoft-edge']) {
      try {
        const found = execFileSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (found && fs.existsSync(found)) return found;
      } catch (_err) {}
    }
  }
  return '';
}

class MiniCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.recvBuf = Buffer.alloc(0);
    this.fragOpcode = 0;
    this.fragChunks = [];
    this.closed = false;
  }

  async connect() {
    const parsed = new URL(this.wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    await new Promise((resolve, reject) => {
      const sock = net.connect(Number(parsed.port), parsed.hostname, () => {
        const reqLines = [
          `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
          `Host: ${parsed.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '\r\n',
        ];
        sock.write(reqLines.join('\r\n'));
      });
      this.socket = sock;

      let upgraded = false;
      let headerBuf = Buffer.alloc(0);

      sock.on('data', (chunk) => {
        if (!upgraded) {
          headerBuf = Buffer.concat([headerBuf, chunk]);
          const sepIdx = headerBuf.indexOf('\r\n\r\n');
          if (sepIdx === -1) return;
          const headerStr = headerBuf.slice(0, sepIdx).toString('latin1');
          const rest = headerBuf.slice(sepIdx + 4);
          headerBuf = Buffer.alloc(0);
          if (!headerStr.startsWith('HTTP/1.1 101') || !headerStr.includes(expectedAccept)) {
            reject(new Error(`WebSocket upgrade failed: ${headerStr.split('\r\n')[0]}`));
            return;
          }
          upgraded = true;
          resolve();
          if (rest.length > 0) this._onSocketData(rest);
          return;
        }
        this._onSocketData(chunk);
      });

      sock.on('error', (err) => {
        if (!upgraded) reject(err);
        this._rejectAllPending(err);
      });

      sock.on('close', () => {
        this.closed = true;
        this._rejectAllPending(new Error('CDP WebSocket closed'));
      });
    });
  }

  _rejectAllPending(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  _sendFrame(opcode, payloadBuf) {
    if (!this.socket || this.closed) return;
    const len = payloadBuf.length;
    let headerLen = 2;
    if (len >= 126 && len < 65536) headerLen = 4;
    else if (len >= 65536) headerLen = 10;

    const frame = Buffer.allocUnsafe(headerLen + 4 + len);
    frame[0] = 0x80 | (opcode & 0x0f);
    let offset = 2;
    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len < 65536) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
      offset = 4;
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
      offset = 10;
    }
    const mask = crypto.randomBytes(4);
    mask.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i++) {
      frame[offset + i] = payloadBuf[i] ^ mask[i & 3];
    }
    this.socket.write(frame);
  }

  _onSocketData(chunk) {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
    while (this.recvBuf.length >= 2) {
      const b0 = this.recvBuf[0];
      const b1 = this.recvBuf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.recvBuf.length < 4) return;
        len = this.recvBuf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.recvBuf.length < 10) return;
        len = Number(this.recvBuf.readBigUInt64BE(2));
        offset = 10;
      }
      if (masked) offset += 4;
      if (this.recvBuf.length < offset + len) return;

      let payload = this.recvBuf.slice(offset, offset + len);
      if (masked) {
        const mask = this.recvBuf.slice(offset - 4, offset);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.recvBuf = this.recvBuf.slice(offset + len);

      if (opcode === 0x08) {
        this.close();
        return;
      }
      if (opcode === 0x09) {
        this._sendFrame(0x0a, payload);
        continue;
      }
      if (opcode === 0x0a) continue;

      if (!fin) {
        if (opcode !== 0) this.fragOpcode = opcode;
        this.fragChunks.push(payload);
        continue;
      }
      let fullPayload = payload;
      let effOpcode = opcode;
      if (opcode === 0 && this.fragChunks.length > 0) {
        this.fragChunks.push(payload);
        fullPayload = Buffer.concat(this.fragChunks);
        effOpcode = this.fragOpcode;
        this.fragChunks = [];
        this.fragOpcode = 0;
      }
      if (effOpcode === 0x01) {
        this._handleMessage(fullPayload.toString('utf8'));
      }
    }
  }

  _handleMessage(rawJson) {
    let msg;
    try {
      msg = JSON.parse(rawJson);
    } catch (_err) {
      return;
    }
    if (typeof msg.id === 'number') {
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method} error: ${msg.error.message || JSON.stringify(msg.error)}`));
        } else {
          entry.resolve(msg.result || {});
        }
      }
      return;
    }
    if (msg.method) {
      const set = this.listeners.get(msg.method);
      if (set) {
        for (const fn of Array.from(set)) {
          try {
            fn(msg.params || {}, msg.sessionId || null);
          } catch (_err) {}
        }
      }
    }
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => {
      const set = this.listeners.get(method);
      if (set) set.delete(fn);
    };
  }

  send(method, params = {}, sessionId = null, timeoutMs = 15000) {
    if (!this.socket || this.closed) {
      return Promise.reject(new Error(`Cannot send ${method}: CDP closed`));
    }
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this._sendFrame(0x01, Buffer.from(JSON.stringify(payload), 'utf8'));
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.socket) this.socket.destroy();
    } catch (_err) {}
    this._rejectAllPending(new Error('CDP client closed'));
  }
}

function fetchJsonHttp(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
  });
}

async function launchHeadlessChromium(browserBin) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ko-e2e-cdp-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-popup-blocking',
    '--disable-sync',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--mute-audio',
  ];
  if (process.platform === 'linux') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  args.push('about:blank');

  const child = spawn(browserBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrLog = '';

  const wsBrowserUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for DevTools listening URL. stderr:\n${stderrLog}`));
    }, 20000);

    const onData = (chunk) => {
      stderrLog += chunk.toString('utf8');
      const m = stderrLog.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\r\n]+)/);
      if (m) {
        clearTimeout(timeout);
        resolve(m[1]);
      }
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Browser exited prematurely (code=${code}):\n${stderrLog}`));
    });
  });

  const port = Number(new URL(wsBrowserUrl).port);
  const targets = await fetchJsonHttp(`http://127.0.0.1:${port}/json/list`);
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  assert.ok(pageTarget && pageTarget.webSocketDebuggerUrl, 'Expected at least one page DevTools target');

  const browserCdp = new MiniCdpClient(wsBrowserUrl);
  await browserCdp.connect();

  const cdp = new MiniCdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  cdp.browserCdp = browserCdp;

  const cleanup = async () => {
    cdp.close();
    browserCdp.close();
    if (child.exitCode === null) {
      try {
        child.kill();
      } catch (_err) {}
      await new Promise((r) => {
        const t = setTimeout(r, 1500);
        child.once('exit', () => {
          clearTimeout(t);
          r();
        });
      });
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_err) {}
  };

  return { child, port, cdp, cleanup };
}

function buildCombinedHostBundle({ koBundle, statusbarBundle, mcpBundle }) {
  return [
    statusbarBundle,
    '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
    mcpBundle,
    '// === END_AGY_MCP_MANAGER_V1 ===',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    koBundle,
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    '',
  ].join('\n');
}

function buildHostShellHtml({ hostTheme = 'light', prependEmptyNonceDecoy = false, companionsInstalled = true, combinedHostBundleB64 = '' }) {
  const iframeQuery = hostTheme ? `hostTheme=${encodeURIComponent(hostTheme)}&iframe=true` : 'iframe=true';
  const rawSandboxSrc = `${SANDBOX_BASE}/?${iframeQuery}`;
  const decoyTag = prependEmptyNonceDecoy
    ? '<script id="ng-state" type="application/json" nonce="">{"__decoy":true}</script>\n'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Antigravity Remote Control</title>
  ${decoyTag}<style nonce="${HOST_NONCE}">
    body { margin: 0; background: #111; color: #eee; font-family: sans-serif; }
    #rc-frame-wrapper.dimmed { opacity: 0.35; pointer-events: none; }
    iframe { width: 100vw; height: 100vh; border: 0; }
  </style>
</head>
<body>
  <ga-remote-control id="rc-host">
    <div id="rc-frame-wrapper" class="dimmed">
      <iframe id="rc-workbench-iframe" src="${rawSandboxSrc}"></iframe>
    </div>
  </ga-remote-control>
  <script nonce="${HOST_NONCE}">
    (() => {
      window.__e2eCspViolations = [];
      window.addEventListener('securitypolicyviolation', (e) => {
        window.__e2eCspViolations.push({
          scope: 'parent',
          violatedDirective: e.violatedDirective,
          blockedURI: e.blockedURI,
          sample: e.sample || '',
        });
      });

      window.__APP_CONFIG__ = {
        productName: 'antigravity',
        csrfToken: ${JSON.stringify(REAL_CSRF_TOKEN)},
        appVersion: '2.33.0',
        isRemoteControl: true,
      };

      const companionsInstalled = ${JSON.stringify(Boolean(companionsInstalled))};
      const combinedBundleB64 = ${JSON.stringify(combinedHostBundleB64)};
      const rawSandboxSrc = ${JSON.stringify(rawSandboxSrc)};
      const hostEl = document.getElementById('rc-host');
      const wrapperEl = document.getElementById('rc-frame-wrapper');
      const iframeEl = document.getElementById('rc-workbench-iframe');

      window.__rcOnIframeLoadCalls = 0;
      window.__rcRpcCalls = [];

      function handleRpcMethod(methodPath, payload) {
        window.__rcRpcCalls.push({ methodPath: String(methodPath || ''), payload: payload || {} });
        const m = String(methodPath || '');
        if (/GetLocalUserInfo/i.test(m)) {
          return { homeDirUri: 'file:///C:/Users/e2euser', homeDir: 'C:/Users/e2euser' };
        }
        if (/ReadFile|ViewFile/i.test(m)) {
          const reqPath = String((payload && (payload.path || payload.uri || payload.filePath)) || '');
          if (companionsInstalled && reqPath.includes('statusbar_autoinject.js')) {
            return { content: combinedBundleB64 };
          }
          return { content: '' };
        }
        if (/GetAllPlugins/i.test(m)) {
          return {
            plugins: companionsInstalled
              ? [
                  { name: 'antigravity-statusbar', enabled: true, path: 'C:/Users/e2euser/.gemini/config/plugins/antigravity-statusbar' },
                  { name: 'antigravity-mcp-manager', enabled: true, path: 'C:/Users/e2euser/.gemini/config/plugins/antigravity-mcp-manager' },
                  { name: 'ko-thought-translator', enabled: true, path: 'C:/Users/e2euser/.gemini/config/plugins/ko-thought-translator' },
                ]
              : [],
          };
        }
        if (/GetCustomizationStates/i.test(m)) {
          return {
            states: companionsInstalled
              ? [
                  { id: 'antigravity-statusbar', enabled: true },
                  { id: 'antigravity-mcp-manager', enabled: true },
                  { id: 'ko-thought-translator', enabled: true },
                ]
              : [],
          };
        }
        if (/GetAllSkills/i.test(m)) {
          return { skills: [] };
        }
        if (/GetMcpServerStates|ListMcpServers/i.test(m)) {
          return { servers: [] };
        }
        return { ok: true };
      }

      function syncDimState(inst) {
        if (!wrapperEl) return;
        const ready = Boolean(inst.iframeUiReady.value && !inst.iframeLoading.value);
        if (ready) wrapperEl.classList.remove('dimmed');
        else wrapperEl.classList.add('dimmed');
      }

      class RemoteControlComponent {
        constructor() {
          this.destroyed = false;
          this.csrfToken = ${JSON.stringify(REAL_CSRF_TOKEN)};
          this.initialChildPath = '';
          this.lastSyncedChildPath = '';
          this.navigatedChildPaths = [];
          const self = this;
          this.iframeLoading = {
            value: true,
            set(v) {
              this.value = Boolean(v);
              syncDimState(self);
            },
          };
          this.iframeUiReady = {
            value: false,
            set(v) {
              this.value = Boolean(v);
              syncDimState(self);
            },
          };
        }
        iframeSrc() {
          return rawSandboxSrc;
        }
        markIframeReady() {
          this.iframeLoading.set(false);
          this.iframeUiReady.set(true);
        }
        navigateIframeToChildPath(p) {
          this.navigatedChildPaths.push(String(p || ''));
          this.lastSyncedChildPath = String(p || '');
        }
        handleUrlChanged() {}
        handleIframeMessage(ev) {
          if (ev && ev.data && ev.data.type === 'SANDBOX_WORKBENCH_READY') {
            this.markIframeReady();
          }
        }
        proxyCommand(methodPath, payload) {
          return Promise.resolve(handleRpcMethod(methodPath, payload));
        }
        onIframeLoad() {
          window.__rcOnIframeLoadCalls += 1;
          const channel = new MessageChannel();
          channel.port1.onmessage = (ev) => {
            const msg = ev && ev.data;
            if (!msg) return;
            if (msg.type === 'WORKBENCH_UI_READY') {
              this.markIframeReady();
              channel.port1.postMessage({ type: 'ACK_READY' });
              return;
            }
            if (msg.type === 'RPC_REQUEST') {
              const result = handleRpcMethod(msg.method, msg.payload);
              channel.port1.postMessage({ type: 'RPC_RESPONSE', reqId: msg.reqId, result });
            }
          };
          channel.port1.start();
          try {
            if (iframeEl && iframeEl.contentWindow) {
              iframeEl.contentWindow.postMessage(
                { type: 'INITIAL_CONFIG', config: { hostTheme: ${JSON.stringify(hostTheme || 'light')} } },
                '*',
                [channel.port2]
              );
            }
          } catch (_err) {}
          return Promise.resolve();
        }
      }

      const rcInst = new RemoteControlComponent();
      // Attach authentic Angular 19 LView + window.ng.getComponent so both ko-thought-translator & mcp-manager resolve rcInst
      const lView = new Array(25).fill(null);
      lView[0] = hostEl;
      lView[1] = {
        data: [
          null,
          { directiveStart: 20, directiveEnd: 22, componentOffset: 1 },
        ],
      };
      lView[8] = rcInst;
      lView[21] = rcInst;
      window.__e2eLViewStore = lView;
      hostEl.__ngContext__ = lView;
      window.ng = {
        getComponent: (el) => (el === hostEl ? rcInst : null),
      };
      window.__e2eRcInst = rcInst;

      window.addEventListener('message', (ev) => rcInst.handleIframeMessage(ev));
      iframeEl.addEventListener('load', () => {
        rcInst.onIframeLoad();
      });
    })();
  </script>
</body>
</html>`;
}

function buildCrossOriginSandboxHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Sandbox Workbench</title></head>
<body>
  <div id="sandbox-root">Cross-Origin Native Workbench</div>
  <script>
    window.addEventListener('message', (ev) => {
      if (ev && ev.data && ev.data.type === 'INITIAL_CONFIG' && ev.ports && ev.ports[0]) {
        ev.ports[0].postMessage({ type: 'WORKBENCH_UI_READY' });
      }
    });
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'SANDBOX_WORKBENCH_READY' }, '*');
    }
  </script>
</body>
</html>`;
}

function buildPromotedWorkbenchMainJs() {
  return `'use strict';
(() => {
  window.__e2eChildCspViolations = [];
  window.addEventListener('securitypolicyviolation', (e) => {
    window.__e2eChildCspViolations.push({
      scope: 'child',
      violatedDirective: e.violatedDirective,
      blockedURI: e.blockedURI,
      sample: e.sample || '',
    });
  });

  window.__workbenchMainBooted = true;
  window.__workerResults = { classic: null, esm: null };
  window.__initialConfigPortDelivered = false;

  // Register INITIAL_CONFIG listener AFTER main.js boots to prove early MessagePort capture & replay!
  window.addEventListener('message', (ev) => {
    if (ev && ev.data && ev.data.type === 'INITIAL_CONFIG' && ev.ports && ev.ports[0]) {
      window.__initialConfigPortDelivered = true;
      const port = ev.ports[0];
      let nextReqId = 1;
      const pending = new Map();
      port.onmessage = (pEv) => {
        const d = pEv && pEv.data;
        if (d && d.type === 'RPC_RESPONSE' && pending.has(d.reqId)) {
          const resolve = pending.get(d.reqId);
          pending.delete(d.reqId);
          resolve(d.result);
        }
      };
      if (typeof port.start === 'function') port.start();
      port.postMessage({ type: 'WORKBENCH_UI_READY' });

      const sendRpc = (method, payload) =>
        new Promise((resolve) => {
          const reqId = nextReqId++;
          pending.set(reqId, resolve);
          port.postMessage({ type: 'RPC_REQUEST', reqId, method, payload: payload || {} });
        });

      const lsClient = {
        getLocalUserInfo: (req) => sendRpc('GetLocalUserInfo', req),
        readFile: (req) => sendRpc('ReadFile', req),
        getAllPlugins: (req) => sendRpc('GetAllPlugins', req),
        getCustomizationStates: (req) => sendRpc('GetCustomizationStates', req),
        getAllSkills: (req) => sendRpc('GetAllSkills', req),
        getMcpServerStates: (req) => sendRpc('GetMcpServerStates', req),
      };
      if (typeof window.__JETSKI_LS_CLIENT_DECORATOR__ === 'function') {
        window.__JETSKI_LS_CLIENT_DECORATOR__(lsClient);
      }
    }
  });

  // Populate realistic workbench DOM inside #root
  const root = document.getElementById('root') || document.body;
  const shell = document.createElement('div');

  // 1) Static UI button ('Send feedback' -> '피드백 보내기') + Thinking trigger button ('Thought for 12s' -> '12초 동안 생각함' with data-agy-orig-label="1")
  const fbBtn = document.createElement('button');
  fbBtn.id = 'e2e-send-feedback-btn';
  const fbSpan = document.createElement('span');
  fbSpan.textContent = 'Send feedback';
  fbBtn.appendChild(fbSpan);
  shell.appendChild(fbBtn);

  const trigBtn = document.createElement('button');
  trigBtn.id = 'e2e-thought-trigger-btn';
  trigBtn.setAttribute('data-testid', 'thinking-collapsible-trigger');
  const trigSpan = document.createElement('span');
  trigSpan.textContent = 'Thought for 12s';
  trigBtn.appendChild(trigSpan);
  shell.appendChild(trigBtn);

  // 2) D-0011 & Rev7-F5 #2: Lexical [data-testid="agent-input-box"] placeholder vs editable user prose
  const agentBox = document.createElement('div');
  agentBox.setAttribute('data-testid', 'agent-input-box');
  const editable = document.createElement('div');
  editable.id = 'e2e-lexical-editable';
  editable.setAttribute('contenteditable', 'true');
  editable.setAttribute('role', 'textbox');
  const editableP = document.createElement('p');
  editableP.textContent = 'Change';
  editable.appendChild(editableP);
  const placeholderP = document.createElement('p');
  placeholderP.id = 'e2e-lexical-placeholder';
  placeholderP.textContent = 'Ask anything, @ to mention, / for actions';
  agentBox.appendChild(editable);
  agentBox.appendChild(placeholderP);
  shell.appendChild(agentBox);

  // 3) D-0042 CRITICAL REGRESSION GUARD: Java import inside .font-mono AND data-line-index MUST NEVER become '...변경;'
  const codeMono = document.createElement('div');
  codeMono.id = 'e2e-code-mono';
  codeMono.className = 'font-mono text-xs';
  const s1 = document.createElement('span');
  s1.textContent = 'import org.pgledger.application.history.';
  const s2 = document.createElement('span');
  s2.textContent = 'Change';
  const s3 = document.createElement('span');
  s3.textContent = ';';
  codeMono.appendChild(s1);
  codeMono.appendChild(s2);
  codeMono.appendChild(s3);
  shell.appendChild(codeMono);

  const codeLineAttr = document.createElement('div');
  codeLineAttr.id = 'e2e-code-data-line';
  codeLineAttr.setAttribute('data-line-number', '42');
  const ls1 = document.createElement('span');
  ls1.textContent = 'import org.pgledger.application.history.';
  const ls2 = document.createElement('span');
  ls2.textContent = 'Change';
  const ls3 = document.createElement('span');
  ls3.textContent = ';';
  codeLineAttr.appendChild(ls1);
  codeLineAttr.appendChild(ls2);
  codeLineAttr.appendChild(ls3);
  shell.appendChild(codeLineAttr);

  // 4) Statusbar host footer
  const statusFooter = document.createElement('footer');
  statusFooter.id = 'workbench.parts.statusbar';
  statusFooter.className = 'part statusbar';
  const rightItems = document.createElement('div');
  rightItems.className = 'right-items items-container';
  statusFooter.appendChild(rightItems);
  shell.appendChild(statusFooter);

  root.appendChild(shell);

  // 5) Dynamic <script> via setAttribute('src', '/static/...') + dynamic <link> + dynamic <style>
  const dynStyle = document.createElement('style');
  dynStyle.textContent = '.e2e-dyn-style { color: rgb(12, 34, 56); }';
  document.head.appendChild(dynStyle);

  const dynLink = document.createElement('link');
  dynLink.setAttribute('rel', 'stylesheet');
  dynLink.setAttribute('href', './extra_theme.css');
  document.head.appendChild(dynLink);

  const dynScript = document.createElement('script');
  dynScript.setAttribute('src', '/web/${APP_VERSION}/lazy_chunk.js');
  document.head.appendChild(dynScript);

  // 6) Classic Worker + relative importScripts + nested sub-Worker
  try {
    const classicWorker = new Worker('/web/${APP_VERSION}/__e2e_classic_worker.js');
    classicWorker.onmessage = (ev) => {
      window.__workerResults.classic = ev.data;
    };
    classicWorker.postMessage({ ping: 'classic-init' });
  } catch (err) {
    window.__workerResults.classicError = String(err && err.message ? err.message : err);
  }

  // 7) ESM Module Worker + live binding import
  try {
    const esmWorker = new Worker('/web/${APP_VERSION}/__e2e_esm_worker.js', { type: 'module' });
    esmWorker.onmessage = (ev) => {
      window.__workerResults.esm = ev.data;
    };
    esmWorker.postMessage({ ping: 'esm-init' });
  } catch (err) {
    window.__workerResults.esmError = String(err && err.message ? err.message : err);
  }
})();
`;
}

async function setupInterceptedPage(cdp, options = {}) {
  const {
    cspHeader = DEFAULT_V2_CSP,
    hostTheme = 'light',
    prependEmptyNonceDecoy = false,
    companionsInstalled = true,
    failMainJs = false,
    koBundle,
    combinedHostBundleB64,
  } = options;

  const exceptions = [];
  const securityLogs = [];
  const cspReports = [];
  const pausedUrls = [];
  const requestCounts = {
    aboutBlankNavs: 0,
    mainJsFetches: 0,
    sandboxIndexFetches: 0,
  };

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');

  cdp.on('Runtime.exceptionThrown', (params) => {
    const d = params && params.exceptionDetails;
    const text = d ? `${d.text || ''} ${(d.exception && d.exception.description) || ''}`.trim() : 'unknown';
    exceptions.push(text);
  });

  cdp.on('Log.entryAdded', (params) => {
    const e = params && params.entry;
    if (!e) return;
    if (
      e.source === 'security' ||
      /Content Security Policy|TrustedScript|TrustedTypes|Refused to/i.test(String(e.text || ''))
    ) {
      securityLogs.push({ source: e.source, level: e.level, text: e.text, url: e.url || '' });
    }
  });

  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params && params.type === 'error' && Array.isArray(params.args)) {
      const joined = params.args.map((a) => a.value || a.description || '').join(' ');
      if (/Content Security Policy|TrustedScript|TrustedTypes|Refused to/i.test(joined)) {
        securityLogs.push({ source: 'console.error', level: 'error', text: joined });
      }
    }
  });

  const patterns = [
    { urlPattern: 'https://antigravity.google.com/*' },
    { urlPattern: 'https://antigravity.static.usercontent.goog/*' },
    { urlPattern: 'https://www.gstatic.com/*' },
    { urlPattern: 'https://raw.githubusercontent.com/*' },
    { urlPattern: 'https://translate.googleapis.com/*' },
  ];

  const fetchClient = cdp.browserCdp || cdp;
  await fetchClient.send('Fetch.enable', { patterns });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });

  cdp.on('Target.attachedToTarget', (params) => {
    const sid = params && params.sessionId;
    if (!sid) return;
    Promise.all([
      cdp.send('Runtime.enable', {}, sid).catch(() => {}),
      cdp.send('Log.enable', {}, sid).catch(() => {}),
    ]).finally(() => {
      if (params.waitingForDebugger) {
        cdp.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {});
      }
    });
  });

  const fulfill = (requestId, status, contentType, bodyStr, extraHeaders = [], sessionId = null) => {
    const headers = [
      { name: 'Content-Type', value: contentType },
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Cache-Control', value: 'no-store' },
      ...extraHeaders,
    ];
    fetchClient
      .send(
        'Fetch.fulfillRequest',
        {
          requestId,
          responseCode: status,
          responseHeaders: headers,
          body: Buffer.from(bodyStr, 'utf8').toString('base64'),
        },
        sessionId
      )
      .catch(() => {});
  };

  fetchClient.on('Fetch.requestPaused', (params, sessionId) => {
    const reqId = params.requestId;
    const rawUrl = params.request && params.request.url ? params.request.url : '';
    pausedUrls.push(rawUrl);
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (_err) {
      fulfill(reqId, 404, 'text/plain; charset=utf-8', 'Not Found', [], sessionId);
      return;
    }

    if (parsed.pathname === '/_/GoogleAntigravity/cspreport') {
      cspReports.push(params.request.postData || 'cspreport');
      fulfill(reqId, 204, 'text/plain; charset=utf-8', '', [], sessionId);
      return;
    }

    if (parsed.origin === HOST_ORIGIN && parsed.pathname.startsWith('/r/')) {
      const html = buildHostShellHtml({
        hostTheme,
        prependEmptyNonceDecoy,
        companionsInstalled,
        combinedHostBundleB64,
      });
      const extra = cspHeader ? [{ name: 'Content-Security-Policy', value: cspHeader }] : [];
      fulfill(reqId, 200, 'text/html; charset=utf-8', html, extra, sessionId);
      return;
    }

    if (parsed.origin === SANDBOX_ORIGIN && parsed.pathname.startsWith('/web/')) {
      requestCounts.sandboxIndexFetches += 1;
      fulfill(reqId, 200, 'text/html; charset=utf-8', buildCrossOriginSandboxHtml(), [], sessionId);
      return;
    }

    if (parsed.hostname === 'raw.githubusercontent.com' && parsed.pathname.endsWith('/ko_thought_autoinject.js')) {
      fulfill(reqId, 200, 'application/javascript; charset=utf-8', koBundle, [], sessionId);
      return;
    }

    if (parsed.hostname === 'translate.googleapis.com') {
      fulfill(reqId, 200, 'application/json; charset=utf-8', JSON.stringify([[['번역됨', 'Translated', null, null, 1]]]), [], sessionId);
      return;
    }

    if (parsed.origin === CDN_ORIGIN) {
      if (parsed.pathname.endsWith('.css')) {
        fulfill(
          reqId,
          200,
          'text/css; charset=utf-8',
          '.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }\nbody { margin: 0; }',
          [],
          sessionId
        );
        return;
      }
      if (parsed.pathname.endsWith('/prism_bundle.js')) {
        fulfill(reqId, 200, 'application/javascript; charset=utf-8', 'window.__prismLoaded = true;', [], sessionId);
        return;
      }
      if (parsed.pathname.endsWith('/main.js')) {
        requestCounts.mainJsFetches += 1;
        if (failMainJs) {
          fulfill(reqId, 503, 'text/plain; charset=utf-8', 'Service Unavailable', [], sessionId);
          return;
        }
        fulfill(reqId, 200, 'application/javascript; charset=utf-8', buildPromotedWorkbenchMainJs(), [], sessionId);
        return;
      }
      if (parsed.pathname.endsWith('/lazy_chunk.js')) {
        fulfill(reqId, 200, 'application/javascript; charset=utf-8', 'window.__lazyChunkExecuted = true;', [], sessionId);
        return;
      }
      if (parsed.pathname.endsWith('/__e2e_worker_helper.js')) {
        fulfill(
          reqId,
          200,
          'application/javascript; charset=utf-8',
          'function helperGlobalFn() { return "helper-ok"; }\nself.helperGlobalFn = helperGlobalFn;',
          [],
          sessionId
        );
        return;
      }
      if (parsed.pathname.endsWith('/__e2e_nested_worker.js')) {
        fulfill(
          reqId,
          200,
          'application/javascript; charset=utf-8',
          'self.onmessage = (e) => { self.postMessage("nested:" + (e.data && e.data.val)); };',
          [],
          sessionId
        );
        return;
      }
      if (parsed.pathname.endsWith('/__e2e_classic_worker.js')) {
        fulfill(
          reqId,
          200,
          'application/javascript; charset=utf-8',
          `importScripts('./__e2e_worker_helper.js');
self.onmessage = (ev) => {
  const h = helperGlobalFn();
  const sub = new Worker('./__e2e_nested_worker.js');
  sub.onmessage = (sEv) => {
    self.postMessage({ helper: h, nested: sEv.data, echo: ev.data && ev.data.ping });
  };
  sub.postMessage({ val: 'sub-ok' });
};`,
          [],
          sessionId
        );
        return;
      }
      if (parsed.pathname.endsWith('/__e2e_esm_dep.js')) {
        fulfill(
          reqId,
          200,
          'application/javascript; charset=utf-8',
          'export let liveCounter = 10;\nexport function bumpCounter() { liveCounter += 5; return liveCounter; }\nexport default function tagFn(v) { return `esm:${v}:${liveCounter}`; }',
          [],
          sessionId
        );
        return;
      }
      if (parsed.pathname.endsWith('/__e2e_esm_worker.js')) {
        fulfill(
          reqId,
          200,
          'application/javascript; charset=utf-8',
          `import tagFn, { liveCounter, bumpCounter } from './__e2e_esm_dep.js';
self.onmessage = (ev) => {
  const before = liveCounter;
  const after = bumpCounter();
  self.postMessage({ before, after, liveRead: liveCounter, tagged: tagFn(ev.data && ev.data.ping) });
};`,
          [],
          sessionId
        );
        return;
      }
    }

    fulfill(reqId, 404, 'text/plain; charset=utf-8', `Unhandled E2E URL: ${rawUrl}`, [], sessionId);
  });

  return { exceptions, securityLogs, cspReports, requestCounts, pausedUrls };
}

async function evalInPage(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res && res.exceptionDetails) {
    throw new Error(
      `Runtime.evaluate exception: ${res.exceptionDetails.text} ${
        (res.exceptionDetails.exception && res.exceptionDetails.exception.description) || ''
      }`
    );
  }
  return res && res.result ? res.result.value : undefined;
}

async function waitForCondition(cdp, predicateExpr, timeoutMs = 12000, pollMs = 80, diag = null) {
  const deadline = Date.now() + timeoutMs;
  let lastVal = null;
  while (Date.now() < deadline) {
    lastVal = await evalInPage(cdp, predicateExpr);
    if (lastVal && lastVal.done) return lastVal;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const extra = diag
    ? ` | pausedUrls=${JSON.stringify(diag.pausedUrls)} | exceptions=${JSON.stringify(diag.exceptions)} | securityLogs=${JSON.stringify(diag.securityLogs)}`
    : '';
  throw new Error(`Timed out waiting for E2E condition. Last snapshot: ${JSON.stringify(lastVal)}${extra}`);
}

const BROWSER_BIN = resolveBrowserBinary();
const KO_BUNDLE = fs.readFileSync(KO_BUNDLE_PATH, 'utf8');
const STATUSBAR_BUNDLE = fs.readFileSync(SIBLING_STATUSBAR_PATH, 'utf8');
const MCP_BUNDLE = fs.readFileSync(SIBLING_MCP_PATH, 'utf8');
const COMBINED_HOST_BUNDLE_B64 = Buffer.from(
  buildCombinedHostBundle({
    koBundle: KO_BUNDLE,
    statusbarBundle: STATUSBAR_BUNDLE,
    mcpBundle: MCP_BUNDLE,
  }),
  'utf8'
).toString('base64');
const README_BOOKMARKLET = extractReadmeBookmarklet();

test('S0 (S0a + S0b): default live -v2 CSP promotion, 0-arg cd.open/close, MessagePort replay, classic/ESM/nested Workers, D-0042 code guard, D-0011 Lexical placeholder, 3-plugin companion sync, and v1.2.39 bookmarklet compatibility', async () => {
  assert.ok(BROWSER_BIN, 'Real Chromium/Chrome/Edge binary is required for E2E verification (0 skipped tests allowed)');

  // --- S0a: Current README v2.0.0 1-click bookmarklet ---
  {
    const session = await launchHeadlessChromium(BROWSER_BIN);
    try {
      const diag = await setupInterceptedPage(session.cdp, {
        cspHeader: DEFAULT_V2_CSP,
        hostTheme: 'light',
        companionsInstalled: true,
        koBundle: KO_BUNDLE,
        combinedHostBundleB64: COMBINED_HOST_BUNDLE_B64,
      });

      await session.cdp.send('Page.navigate', {
        url: `${HOST_ORIGIN}/r/e2e-s0a-v2?p=${encodeURIComponent('chat?tab=1')}`,
      });

      await waitForCondition(
        session.cdp,
        `(() => ({ done: Boolean(window.__e2eRcInst && window.__e2eRcInst.iframeUiReady.value) }))()`
      );

      // Verify genuine cross-origin SOP throws SecurityError before promotion
      const preCrossOriginBlocked = await evalInPage(
        session.cdp,
        `(() => {
          const ifr = document.getElementById('rc-workbench-iframe');
          try {
            void ifr.contentWindow.document.body;
            return false;
          } catch (_err) {
            return true;
          }
        })()`
      );
      assert.equal(preCrossOriginBlocked, true, 'Sandbox iframe must be genuinely cross-origin prior to promotion');

      // Click README v2.0.0 bookmarklet
      const bmBody = README_BOOKMARKLET.replace(/^javascript:/, '');
      await evalInPage(session.cdp, bmBody);

      const state = await waitForCondition(
        session.cdp,
        `(() => {
          try {
            const ifr = document.getElementById('rc-workbench-iframe');
            const cw = ifr && ifr.contentWindow;
            const cd = ifr && ifr.contentDocument;
            if (!cw || !cd || !cd.body) {
              return { done: false, stage: 'cross-origin-or-blank', parentVer: window.__agyKoLocalizerActive || null };
            }
            const wr = cw.__workerResults;
            const fbText = cd.getElementById('e2e-send-feedback-btn') ? cd.getElementById('e2e-send-feedback-btn').textContent : '';
            const lexPh = cd.getElementById('e2e-lexical-placeholder') ? cd.getElementById('e2e-lexical-placeholder').textContent : '';
            const companionsReady = Boolean(window.__agyKoCompanionsSynced && window.agyStatusBar && window.agyMcpManager);
            const done = Boolean(
              window.__agyKoLocalizerActive === 'v2.0.0' &&
              cw.__agyKoLocalizerActive === 'v2.0.0' &&
              cw.__workbenchMainBooted &&
              cw.__lazyChunkExecuted &&
              cw.__initialConfigPortDelivered &&
              wr &&
              wr.classic &&
              wr.esm &&
              fbText.includes('피드백 보내기') &&
              lexPh.includes('무엇이든 물어보세요') &&
              companionsReady
            );
            if (!done) {
              return {
                done: false,
                parentVer: window.__agyKoLocalizerActive || null,
                childVer: cw.__agyKoLocalizerActive || null,
                booted: Boolean(cw.__workbenchMainBooted),
                lazy: Boolean(cw.__lazyChunkExecuted),
                port: Boolean(cw.__initialConfigPortDelivered),
                wr,
                fbText,
                lexPh,
                companionsReady,
              };
            }
            const origSpan = cd.querySelector('#e2e-thought-trigger-btn [data-agy-orig-label="1"]');
            const koTrigSpan = cd.querySelector('#e2e-thought-trigger-btn .agy-ko-trigger-label');
              if (!cd.getElementById('agy-ko-translator-modal') && typeof cw.__agyOpenTranslatorSettingsModal === 'function') {
                cw.__agyOpenTranslatorSettingsModal();
              }
              return {
              done: true,
              parentVer: window.__agyKoLocalizerActive,
              childVer: cw.__agyKoLocalizerActive,
              childOrigin: cw.location.origin,
              childHref: cw.location.href,
              childReferrer: cd.referrer,
              childCsrf: cw.__APP_CONFIG__ && cw.__APP_CONFIG__.csrfToken,
              spoofedSrc: ifr.src,
              promotionOwner: ifr.__agyRemotePromotionOwner,
              promotionState: ifr.__agyRemotePromotionState,
              initialChildPath: window.__e2eRcInst.initialChildPath,
              dimmed: document.getElementById('rc-frame-wrapper').classList.contains('dimmed'),
              uiReady: window.__e2eRcInst.iframeUiReady.value,
              fbVisibleText: fbText,
              origSpanPreserved: Boolean(
                origSpan && origSpan.textContent === 'Thought for 12s' && koTrigSpan && koTrigSpan.textContent === '12초 동안 생각함'
              ),
              lexicalPlaceholder: lexPh,
              lexicalEditable: cd.getElementById('e2e-lexical-editable').textContent,
              codeMonoText: cd.getElementById('e2e-code-mono').textContent,
              codeDataLineText: cd.getElementById('e2e-code-data-line').textContent,
              classicWorker: wr.classic,
              esmWorker: wr.esm,
              parentViolations: window.__e2eCspViolations,
              childViolations: cw.__e2eChildCspViolations,
              hasKoModalAndStatusbar: Boolean(
                cd.getElementById('agy-ko-translator-modal') &&
                window.agyStatusBar &&
                window.agyMcpManager
              ),
            };
          } catch (_e) {
            return { done: false, stage: 'security-err' };
          }
        })()`,
        15000,
        80,
        diag
      );

      assert.equal(state.parentVer, 'v2.0.0');
      assert.equal(state.childVer, 'v2.0.0');
      assert.equal(state.childOrigin, HOST_ORIGIN, '0-arg cd.open/close must inherit parent https: origin');
      assert.match(state.childHref, /\/chat\?tab=1&hostTheme=light&iframe=true$/);
      assert.equal(state.initialChildPath, 'chat?tab=1');
      assert.ok(state.childReferrer.startsWith(`${HOST_ORIGIN}/r/e2e-s0a-v2`));
      assert.equal(state.childCsrf, REAL_CSRF_TOKEN);
      assert.equal(state.promotionOwner, 'ko-thought-translator');
      assert.ok(
        state.promotionState === 'ready' || state.promotionState === 'passive_attached',
        `Expected promotionState ready or passive_attached, got ${state.promotionState}`
      );
      assert.equal(state.uiReady, true);
      assert.equal(state.dimmed, false);
      assert.equal(state.origSpanPreserved, true);
      assert.equal(state.lexicalPlaceholder, '무엇이든 물어보세요 (@로 멘션, /로 작업 실행)');
      assert.equal(state.lexicalEditable, 'Change');
      assert.equal(state.codeMonoText, 'import org.pgledger.application.history.Change;');
      assert.equal(state.codeDataLineText, 'import org.pgledger.application.history.Change;');
      assert.deepEqual(state.classicWorker, { helper: 'helper-ok', nested: 'nested:sub-ok', echo: 'classic-init' });
      assert.deepEqual(state.esmWorker, { before: 10, after: 15, liveRead: 15, tagged: 'esm:esm-init:15' });
      assert.equal(state.hasKoModalAndStatusbar, true);
      assert.deepEqual(state.parentViolations, []);
      assert.deepEqual(state.childViolations, []);
      assert.deepEqual(diag.exceptions, []);
      assert.deepEqual(diag.securityLogs, []);
      assert.deepEqual(diag.cspReports, []);
    } finally {
      await session.cleanup();
    }
  }

  // --- S0b: Previously saved v1.2.39 bookmarklet backward compatibility ---
  {
    const session = await launchHeadlessChromium(BROWSER_BIN);
    try {
      const diag = await setupInterceptedPage(session.cdp, {
        cspHeader: DEFAULT_V2_CSP,
        hostTheme: 'light',
        companionsInstalled: false,
        koBundle: KO_BUNDLE,
        combinedHostBundleB64: '',
      });

      await session.cdp.send('Page.navigate', { url: `${HOST_ORIGIN}/r/e2e-s0b-v2` });
      await waitForCondition(
        session.cdp,
        `(() => ({ done: Boolean(window.__e2eRcInst && window.__e2eRcInst.iframeUiReady.value) }))()`
      );

      await evalInPage(session.cdp, SAVED_V1_2_39_BOOKMARKLET.replace(/^javascript:/, ''));

      const state = await waitForCondition(
        session.cdp,
        `(() => {
          try {
            const ifr = document.getElementById('rc-workbench-iframe');
            const cw = ifr && ifr.contentWindow;
            const cd = ifr && ifr.contentDocument;
            if (!cw || !cd) return { done: false };
            const done = Boolean(
              window.__agyKoLocalizerActive === 'v2.0.0' &&
              cw.__agyKoLocalizerActive === 'v2.0.0' &&
              cd.getElementById('e2e-code-mono')
            );
            return done
              ? {
                  done: true,
                  codeText: cd.getElementById('e2e-code-mono').textContent,
                }
              : { done: false };
          } catch (_e) {
            return { done: false };
          }
        })()`
      );

      assert.equal(state.codeText, 'import org.pgledger.application.history.Change;');
      assert.deepEqual(diag.exceptions, []);
      assert.deepEqual(diag.securityLogs, []);
      assert.deepEqual(diag.cspReports, []);
    } finally {
      await session.cleanup();
    }
  }
});

test('S1 (D-0041): hostTheme=dark + real HTTP CSP3 nonce-hiding + prepended empty nonce="" decoy <script>', async () => {
  assert.ok(BROWSER_BIN, 'Real Chromium/Chrome/Edge binary is required');
  const session = await launchHeadlessChromium(BROWSER_BIN);
  try {
    const diag = await setupInterceptedPage(session.cdp, {
      cspHeader: DEFAULT_V2_CSP,
      hostTheme: 'dark',
      prependEmptyNonceDecoy: true,
      companionsInstalled: true,
      koBundle: KO_BUNDLE,
      combinedHostBundleB64: COMBINED_HOST_BUNDLE_B64,
    });

    await session.cdp.send('Page.navigate', { url: `${HOST_ORIGIN}/r/e2e-s1-v2` });
    await waitForCondition(
      session.cdp,
      `(() => ({ done: Boolean(window.__e2eRcInst && window.__e2eRcInst.iframeUiReady.value) }))()`
    );

    // Confirm real Chromium CSP3 nonce-hiding stripped content attribute while keeping IDL .nonce, AND decoy is first!
    const nonceCheck = await evalInPage(
      session.cdp,
      `(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        const first = scripts[0];
        const real = scripts[scripts.length - 1];
        return {
          firstNonceProp: first.nonce,
          firstNonceAttr: first.getAttribute('nonce'),
          realNonceProp: real.nonce,
          realNonceAttr: real.getAttribute('nonce'),
        };
      })()`
    );
    assert.equal(nonceCheck.firstNonceProp, '');
    assert.equal(nonceCheck.realNonceProp, HOST_NONCE);
    assert.equal(nonceCheck.realNonceAttr, '', 'Real Chromium CSP3 nonce-hiding must blank getAttribute("nonce")');

    await evalInPage(session.cdp, README_BOOKMARKLET.replace(/^javascript:/, ''));

    const state = await waitForCondition(
      session.cdp,
      `(() => {
        try {
          const ifr = document.getElementById('rc-workbench-iframe');
          const cw = ifr && ifr.contentWindow;
          const cd = ifr && ifr.contentDocument;
          if (!cw || !cd || !cd.documentElement) return { done: false };
          const done = Boolean(
            window.__agyKoLocalizerActive === 'v2.0.0' &&
            cw.__agyKoLocalizerActive === 'v2.0.0' &&
            cw.__workbenchMainBooted &&
            window.__agyKoCompanionsSynced
          );
          return done
            ? {
                done: true,
                colorScheme: cd.documentElement.style.colorScheme,
                childHref: cw.location.href,
              }
            : { done: false };
        } catch (_e) {
          return { done: false };
        }
      })()`
    );

    assert.equal(state.colorScheme, 'dark');
    assert.match(state.childHref, /hostTheme=dark&iframe=true$/);
    assert.deepEqual(diag.exceptions, []);
    assert.deepEqual(diag.securityLogs, []);
    assert.deepEqual(diag.cspReports, []);
  } finally {
    await session.cleanup();
  }
});

test('S2 (S2a + S2b): explicit trusted-types allowlist succeeds (S2a) and restrictive trusted-types angular fails closed preserving native cross-origin workbench (S2b)', async () => {
  assert.ok(BROWSER_BIN, 'Real Chromium/Chrome/Edge binary is required');

  // --- S2a: Explicit trusted-types allowlist ---
  {
    const session = await launchHeadlessChromium(BROWSER_BIN);
    try {
      const s2aCsp =
        `script-src 'nonce-${HOST_NONCE}' 'unsafe-inline' 'strict-dynamic' https: http:; ` +
        `object-src 'none'; base-uri 'self'; worker-src 'self'; require-trusted-types-for 'script'; ` +
        `trusted-types angular goog#html agy-ko-translator agy-ko-translator-bm; ` +
        `report-uri /_/GoogleAntigravity/cspreport`;

      const diag = await setupInterceptedPage(session.cdp, {
        cspHeader: s2aCsp,
        hostTheme: 'light',
        companionsInstalled: false,
        koBundle: KO_BUNDLE,
        combinedHostBundleB64: '',
      });

      await session.cdp.send('Page.navigate', { url: `${HOST_ORIGIN}/r/e2e-s2a-v2` });
      await waitForCondition(
        session.cdp,
        `(() => ({ done: Boolean(window.__e2eRcInst && window.__e2eRcInst.iframeUiReady.value) }))()`
      );

      await evalInPage(session.cdp, README_BOOKMARKLET.replace(/^javascript:/, ''));

      const state = await waitForCondition(
        session.cdp,
        `(() => {
          try {
            const ifr = document.getElementById('rc-workbench-iframe');
            const cw = ifr && ifr.contentWindow;
            const cd = ifr && ifr.contentDocument;
            if (!cw || !cd) return { done: false };
            const done = Boolean(
              window.__agyKoLocalizerActive === 'v2.0.0' &&
              cw.__agyKoLocalizerActive === 'v2.0.0' &&
              cw.__workbenchMainBooted &&
              cw.__workerResults &&
              cw.__workerResults.classic &&
              cw.__workerResults.esm
            );
            return done ? { done: true, owner: ifr.__agyRemotePromotionOwner } : { done: false };
          } catch (_e) {
            return { done: false };
          }
        })()`
      );

      assert.equal(state.owner, 'ko-thought-translator');
      assert.deepEqual(diag.exceptions, []);
      assert.deepEqual(diag.securityLogs, []);
      assert.deepEqual(diag.cspReports, []);
    } finally {
      await session.cleanup();
    }
  }

  // --- S2b: Disallowed trusted-types angular -> fail-closed with 0 sink violations & native workbench intact ---
  {
    const session = await launchHeadlessChromium(BROWSER_BIN);
    try {
      const s2bCsp =
        `script-src 'nonce-${HOST_NONCE}' 'unsafe-inline' 'strict-dynamic' https: http:; ` +
        `object-src 'none'; base-uri 'self'; worker-src 'self'; require-trusted-types-for 'script'; ` +
        `trusted-types angular; ` +
        `report-uri /_/GoogleAntigravity/cspreport`;

      const diag = await setupInterceptedPage(session.cdp, {
        cspHeader: s2bCsp,
        hostTheme: 'light',
        companionsInstalled: false,
        koBundle: KO_BUNDLE,
        combinedHostBundleB64: '',
      });

      await session.cdp.send('Page.navigate', { url: `${HOST_ORIGIN}/r/e2e-s2b-v2` });
      await waitForCondition(
        session.cdp,
        `(() => ({ done: Boolean(window.__e2eRcInst && window.__e2eRcInst.iframeUiReady.value) }))()`
      );

      // Direct bundle evaluation via Page.addScriptTag / nonced host bundle simulation AND bookmarklet fail-closed check:
      await evalInPage(session.cdp, README_BOOKMARKLET.replace(/^javascript:/, ''));
      await new Promise((r) => setTimeout(r, 450));

      const afterState = await evalInPage(
        session.cdp,
        `(() => {
          const ifr = document.getElementById('rc-workbench-iframe');
          let stillCrossOrigin = false;
          try {
            void ifr.contentWindow.document.body;
          } catch (_e) {
            stillCrossOrigin = true;
          }
          const sinkViolations = (window.__e2eCspViolations || []).filter(
            (v) => v.violatedDirective && v.violatedDirective.includes('require-trusted-types-for')
          );
          return {
            stillCrossOrigin,
            uiReady: window.__e2eRcInst.iframeUiReady.value,
            dimmed: document.getElementById('rc-frame-wrapper').classList.contains('dimmed'),
            sinkViolations,
          };
        })()`
      );

      assert.equal(afterState.stillCrossOrigin, true, 'Native cross-origin iframe must remain untouched when policy creation is disallowed');
      assert.equal(afterState.uiReady, true);
      assert.equal(afterState.dimmed, false);
      assert.deepEqual(afterState.sinkViolations, [], 'Must produce 0 TrustedScript sink violations');
      assert.deepEqual(diag.exceptions, []);
      assert.equal(diag.requestCounts.mainJsFetches, 0);
    } finally {
      await session.cleanup();
    }
  }
});

test('S3: CDN main.js HTTP 503 rolls back cleanly to native cross-origin workbench with single-attempt failedSrc lock (0 retry loop)', async () => {
  assert.ok(BROWSER_BIN, 'Real Chromium/Chrome/Edge binary is required');
  const session = await launchHeadlessChromium(BROWSER_BIN);
  try {
    const diag = await setupInterceptedPage(session.cdp, {
      cspHeader: DEFAULT_V2_CSP,
      hostTheme: 'light',
      companionsInstalled: false,
      failMainJs: true,
      koBundle: KO_BUNDLE,
      combinedHostBundleB64: '',
    });

    await session.cdp.send('Page.navigate', { url: `${HOST_ORIGIN}/r/e2e-s3-v2` });
    await waitForCondition(
      session.cdp,
      `(() => ({ done: Boolean(window.__e2eRcInst && window.__e2eRcInst.iframeUiReady.value) }))()`
    );

    await evalInPage(session.cdp, README_BOOKMARKLET.replace(/^javascript:/, ''));

    // Wait for promotion attempt -> main.js 503 -> rollback -> native cross-origin sandbox reload -> uiReady
    const rolledBack = await waitForCondition(
      session.cdp,
      `(() => {
        const ifr = document.getElementById('rc-workbench-iframe');
        let isCrossOrigin = false;
        try {
          void ifr.contentWindow.document.body;
        } catch (_e) {
          isCrossOrigin = true;
        }
        const done = Boolean(
          window.__agyKoLocalizerActive === 'v2.0.0' &&
          ifr &&
          ifr.__agyRemotePromotionState === 'rolled_back' &&
          isCrossOrigin &&
          window.__e2eRcInst.iframeUiReady.value &&
          !document.getElementById('rc-frame-wrapper').classList.contains('dimmed')
        );
        return done
          ? {
              done: true,
              promotionState: ifr.__agyRemotePromotionState,
              promotionOwner: ifr.__agyRemotePromotionOwner || null,
              suppressionCount: window.__e2eRcInst.__agySuppressAutoIframeLoadCount || 0,
            }
          : { done: false, state: ifr ? ifr.__agyRemotePromotionState : null, isCrossOrigin };
      })()`
    );

    assert.equal(rolledBack.promotionState, 'rolled_back');
    assert.equal(rolledBack.promotionOwner, null);
    assert.equal(rolledBack.suppressionCount, 0);
    assert.equal(
      diag.requestCounts.mainJsFetches,
      1,
      `Must attempt main.js only once before locking failedSrc (pausedUrls=${JSON.stringify(diag.pausedUrls)})`
    );

    // Trigger multiple DOM mutations & explicit __agyForceRescanAll() over 500ms to prove 0 retry loops!
    await evalInPage(
      session.cdp,
      `(() => {
        for (let i = 0; i < 5; i++) {
          const d = document.createElement('div');
          d.textContent = 'Settings';
          document.body.appendChild(d);
          if (typeof window.__agyForceRescanAll === 'function') window.__agyForceRescanAll();
        }
      })()`
    );
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(diag.requestCounts.mainJsFetches, 1, 'Single-attempt failedSrc lock must prevent any retry loop');
    assert.deepEqual(diag.exceptions, []);
  } finally {
    await session.cleanup();
  }
});

test('S4: companion-first coexistence (real antigravity-statusbar + antigravity-mcp-manager loaded before ko-thought-translator)', async () => {
  assert.ok(BROWSER_BIN, 'Real Chromium/Chrome/Edge binary is required');
  const session = await launchHeadlessChromium(BROWSER_BIN);
  try {
    const diag = await setupInterceptedPage(session.cdp, {
      cspHeader: DEFAULT_V2_CSP,
      hostTheme: 'light',
      companionsInstalled: false,
      koBundle: KO_BUNDLE,
      combinedHostBundleB64: '',
    });

    await session.cdp.send('Page.navigate', { url: `${HOST_ORIGIN}/r/e2e-s4-v2` });
    await waitForCondition(
      session.cdp,
      `(() => ({ done: Boolean(window.__e2eRcInst && window.__e2eRcInst.iframeUiReady.value) }))()`
    );

    // Step 1: Inject real sibling antigravity-statusbar + antigravity-mcp-manager FIRST using host nonce + TrustedTypes
    await evalInPage(
      session.cdp,
      `((sbCode, mcpCode) => {
        const nonce = [...document.querySelectorAll('script,style')].map((e) => e.nonce).find(Boolean);
        const pol = window.trustedTypes.createPolicy('e2e-peer-loader', { createScript: (s) => s });
        for (const code of [sbCode, mcpCode]) {
          const s = document.createElement('script');
          s.nonce = nonce;
          s.text = pol.createScript(code);
          document.head.appendChild(s);
        }
      })(${JSON.stringify(STATUSBAR_BUNDLE)}, ${JSON.stringify(MCP_BUNDLE)})`
    );

    // Wait until mcp-manager promotes the workbench iframe (`__agyMcpPromoted === true`, `cw.Worker.__agyWorkerAdapted === true`)
    await waitForCondition(
      session.cdp,
      `(() => {
        try {
          const ifr = document.getElementById('rc-workbench-iframe');
          const cw = ifr && ifr.contentWindow;
          const cd = ifr && ifr.contentDocument;
          if (!ifr || !cw || !cd) return { done: false };
          const done = Boolean(
            ifr.__agyMcpPromoted &&
            ifr.__agyRemotePromotionOwner === 'mcp-manager' &&
            ifr.__agyRemotePromotionState === 'ready' &&
            cw.__workbenchMainBooted &&
            cw.Worker &&
            cw.Worker.__agyWorkerAdapted === true
          );
          return {
            done,
            mcpPromoted: Boolean(ifr.__agyMcpPromoted),
            owner: ifr.__agyRemotePromotionOwner || null,
            state: ifr.__agyRemotePromotionState || null,
            booted: Boolean(cw.__workbenchMainBooted),
            workerAdapted: Boolean(cw.Worker && cw.Worker.__agyWorkerAdapted),
            workerType: typeof cw.Worker,
            workerOwnDesc: Boolean(Object.getOwnPropertyDescriptor(cw, 'Worker')),
            cwIsExtensible: Object.isExtensible(cw),
          };
        } catch (_e) {
          return { done: false };
        }
      })()`
    );

    // Simulate an active peer suppression lease on rcInst before ko-thought-translator loads
    await evalInPage(session.cdp, `window.__e2eRcInst.__agySuppressAutoIframeLoadCount = 1;`);

    // Step 2: Now click the ko-thought-translator README bookmarklet AFTER companions already promoted the frame!
    await evalInPage(session.cdp, README_BOOKMARKLET.replace(/^javascript:/, ''));

    const coexisted = await waitForCondition(
      session.cdp,
      `(() => {
        try {
          const ifr = document.getElementById('rc-workbench-iframe');
          const cw = ifr && ifr.contentWindow;
          const cd = ifr && ifr.contentDocument;
          if (!cw || !cd) return { done: false };
          const fb = cd.getElementById('e2e-send-feedback-btn') ? cd.getElementById('e2e-send-feedback-btn').textContent : '';
          const done = Boolean(
            window.__agyKoLocalizerActive === 'v2.0.0' &&
            cw.__agyKoLocalizerActive === 'v2.0.0' &&
            fb.includes('피드백 보내기')
          );
          return done
            ? {
                done: true,
                promotionOwner: ifr.__agyRemotePromotionOwner,
                mcpPromoted: Boolean(ifr.__agyMcpPromoted),
                cwWorkerAdapted: Boolean(cw.Worker && cw.Worker.__agyWorkerAdapted),
                cwWorkerPatched: Boolean(cw.Worker && cw.Worker.__agyWorkerPatched),
                codeMonoText: cd.getElementById('e2e-code-mono').textContent,
              }
            : { done: false };
        } catch (_e) {
          return { done: false };
        }
      })()`
    );

    assert.equal(coexisted.promotionOwner, 'mcp-manager', 'Must attach as EXTERNAL_PROMOTED without stealing peer ownership');
    assert.equal(coexisted.mcpPromoted, true);
    assert.equal(coexisted.cwWorkerAdapted, true);
    assert.equal(coexisted.cwWorkerPatched, false, 'Must preserve peer AdaptedWorker without double-wrapping');
    assert.equal(coexisted.codeMonoText, 'import org.pgledger.application.history.Change;');
    assert.equal(diag.requestCounts.mainJsFetches, 1, 'Must NOT re-promote or re-boot main.js');

    // Verify hot-swap cleanup (`__agyKoThoughtCleanup(false)`) preserves peer's suppression refcount!
    const peerSuppressionAfterCleanup = await evalInPage(
      session.cdp,
      `(() => {
        window.__agyKoThoughtCleanup(false);
        return window.__e2eRcInst.__agySuppressAutoIframeLoadCount;
      })()`
    );
    assert.equal(peerSuppressionAfterCleanup, 1, 'Must preserve peer __agySuppressAutoIframeLoadCount on cleanup');
    assert.deepEqual(diag.exceptions, []);
    assert.deepEqual(diag.securityLogs, []);
  } finally {
    await session.cleanup();
  }
});

test('S5: live https://antigravity.google.com real unintercepted HTTPS & Chromium CSP/bookmarklet smoke check', async () => {
  assert.ok(BROWSER_BIN, 'Real Chromium/Chrome/Edge binary is required');

  // 1) Direct real HTTPS probe to https://antigravity.google.com/ (verifying real TLS + live response headers)
  const liveHead = await new Promise((resolve, reject) => {
    const req = https.get(
      `${HOST_ORIGIN}/`,
      { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' } },
      (res) => {
        res.resume();
        resolve({
          statusCode: res.statusCode,
          location: res.headers.location || '',
          csp: res.headers['content-security-policy'] || '',
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Live HTTPS probe timed out')));
    req.on('error', reject);
  });

  assert.ok(
    liveHead.statusCode >= 200 && liveHead.statusCode < 400,
    `Expected live https://antigravity.google.com/ HTTP 2xx/3xx, got ${liveHead.statusCode}`
  );

  // 2) Real Chromium navigation to https://antigravity.google.com/ (only intercepting raw.githubusercontent.com so the local v2.0.0 bundle under test is served)
  const session = await launchHeadlessChromium(BROWSER_BIN);
  try {
    const exceptions = [];
    await session.cdp.send('Page.enable');
    await session.cdp.send('Runtime.enable');
    session.cdp.on('Runtime.exceptionThrown', (params) => {
      const d = params && params.exceptionDetails;
      exceptions.push(d ? d.text || 'exception' : 'exception');
    });

    await session.cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: 'https://raw.githubusercontent.com/*' }],
    });
    session.cdp.on('Fetch.requestPaused', (params) => {
      session.cdp
        .send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
          body: Buffer.from(KO_BUNDLE, 'utf8').toString('base64'),
        })
        .catch(() => {});
    });

    await session.cdp.send('Page.navigate', { url: `${HOST_ORIGIN}/` });
    await waitForCondition(
      session.cdp,
      `(() => ({ done: document.readyState === 'complete', href: location.href }))()`,
      15000
    );

    // Execute README bookmarklet on the live loaded page: must produce 0 uncaught exceptions regardless of auth redirect/CSP
    await evalInPage(session.cdp, README_BOOKMARKLET.replace(/^javascript:/, ''));
    await new Promise((r) => setTimeout(r, 600));

    assert.deepEqual(exceptions, [], 'Bookmarklet on live https://antigravity.google.com/ must produce 0 uncaught exceptions');
  } finally {
    await session.cleanup();
  }
});
