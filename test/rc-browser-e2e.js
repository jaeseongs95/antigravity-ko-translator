'use strict';

/**
 * Real Chromium (CDP) E2E Verification for Remote Control Web (/r/...-v2) Bookmarklet
 *
 * Runs real Google Chrome / Microsoft Edge (--headless=new) against:
 *  - Exact live https://antigravity.google.com/r/...-v2 HTTP CSP & TrustedTypes headers
 *  - Real live 2.33.0 workbench assets (https://antigravity.static.usercontent.goog/web/2.33.0/* & https://www.gstatic.com/antigravity/web/2.33.0/*)
 *  - Authentic Angular 19 <ga-remote-control> RemoteControlComponent (-v2 MessageChannel protocol)
 *  - Standalone bookmarklet execution + co-loading with antigravity-statusbar & antigravity-mcp-manager
 *  - Strict CSP / TrustedTypes allowlist & promotion failure rollback safety
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const KO_AUTOINJECT_PATH = path.join(REPO_ROOT, 'scripts', 'ko_thought_autoinject.js');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const SIBLING_STATUSBAR_DIST = path.resolve(REPO_ROOT, '..', 'antigravity-statusbar', 'dist', 'statusbar_autoinject.js');
const SIBLING_MCP_DIST = path.resolve(REPO_ROOT, '..', 'antigravity-mcp-manager', 'dist', 'mcp_manager_autoinject.js');

function findBrowserBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) return bin;
    } catch {}
  }
  return null;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
  });
}

const upstreamAssetCache = new Map();

function fetchUpstreamBuffer(targetUrl) {
  if (upstreamAssetCache.has(targetUrl)) {
    return Promise.resolve(upstreamAssetCache.get(targetUrl));
  }
  return new Promise((resolve, reject) => {
    const req = https.get(targetUrl, { timeout: 25000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirected = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        fetchUpstreamBuffer(redirected).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const entry = {
          statusCode: res.statusCode || 200,
          headers: res.headers,
          body: Buffer.concat(chunks),
        };
        if (entry.statusCode === 200 && entry.body.length > 0) {
          upstreamAssetCache.set(targetUrl, entry);
        }
        resolve(entry);
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout fetching ${targetUrl}`));
    });
    req.on('error', reject);
  });
}

class MiniCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
    this.recvBuf = Buffer.alloc(0);
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.wsUrl);
      const key = crypto.randomBytes(16).toString('base64');
      const socket = net.connect(Number(parsed.port), parsed.hostname, () => {
        const req = [
          `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
          `Host: ${parsed.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n');
        socket.write(req);
      });
      this.socket = socket;
      let upgraded = false;
      socket.on('data', (chunk) => {
        this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
        if (!upgraded) {
          const sep = this.recvBuf.indexOf('\r\n\r\n');
          if (sep < 0) return;
          const headerStr = this.recvBuf.slice(0, sep).toString('utf8');
          if (!headerStr.startsWith('HTTP/1.1 101')) {
            reject(new Error(`WebSocket upgrade failed: ${headerStr.split('\r\n')[0]}`));
            socket.destroy();
            return;
          }
          upgraded = true;
          this.recvBuf = this.recvBuf.slice(sep + 4);
          resolve();
        }
        this._drainFrames();
      });
      socket.on('error', (err) => {
        if (!upgraded) reject(err);
        this._rejectAll(err);
      });
      socket.on('close', () => {
        this.closed = true;
        this._rejectAll(new Error('CDP socket closed'));
      });
    });
  }

  _rejectAll(err) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  _drainFrames() {
    while (this.recvBuf.length >= 2) {
      const b0 = this.recvBuf[0];
      const b1 = this.recvBuf[1];
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
      if (opcode === 0x01) {
        const text = payload.toString('utf8');
        try {
          const msg = JSON.parse(text);
          if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
            else p.resolve(msg.result);
          } else if (msg.method) {
            const arr = this.listeners.get(msg.method) || [];
            for (const fn of arr) {
              try { fn(msg.params, msg.sessionId); } catch {}
            }
          }
        } catch {}
      }
    }
  }

  _sendFrame(opcode, payloadBuf) {
    if (this.closed || !this.socket) return;
    const mask = crypto.randomBytes(4);
    const len = payloadBuf.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | len;
      mask.copy(header, 2);
    } else if (len < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
      mask.copy(header, 10);
    }
    const maskedPayload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) maskedPayload[i] = payloadBuf[i] ^ mask[i & 3];
    this.socket.write(Buffer.concat([header, maskedPayload]));
  }

  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('CDP closed'));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this._sendFrame(0x01, Buffer.from(JSON.stringify(payload), 'utf8'));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.socket) this.socket.destroy();
    } catch {}
    this._rejectAll(new Error('CDP closed'));
  }
}

function extractBookmarkletBodyFromReadme() {
  const md = fs.readFileSync(README_PATH, 'utf8');
  const m = md.match(/javascript:(\(\(\)=>\{[^\r\n]+\}\)\(\);?)/);
  if (!m) throw new Error('Could not find javascript: bookmarklet in README.md');
  return m[1];
}

function buildRemoteControlHostHtml({ nonce, iframeUrl, instanceUuid, includeEmptyNonceDecoyScript, companionInstalled }) {
  const decoyScript = includeEmptyNonceDecoyScript
    ? `<script nonce="${nonce}">window.__hostBootMark = 1;</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Google Antigravity</title>
  <style nonce="${nonce}">
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background: #0f0f10; color: #e5e7eb; font-family: system-ui, sans-serif;
      overflow: hidden;
    }
    ga-remote-control {
      display: block; position: relative; width: 100vw; height: 100vh; background: #0f0f10;
    }
    .rc-topbar {
      position: fixed; top: 8px; right: 12px; z-index: 50;
      display: flex; align-items: center; gap: 10px;
    }
    .rc-menu-btn {
      background: #1f2023; color: #e5e7eb; border: 1px solid #333; border-radius: 6px;
      padding: 4px 10px; font-size: 12px; cursor: pointer;
    }
    iframe.hub-frame {
      width: 100%; height: 100%; border: 0; display: block; background: transparent;
      transition: opacity 120ms ease;
    }
    iframe.hub-frame.dimmed {
      opacity: 0;
      pointer-events: none;
    }
  </style>
  ${decoyScript}
</head>
<body class="dark-theme">
  <ga-remote-control>
    <div class="rc-topbar">
      <button class="rc-menu-btn" type="button">Install as App</button>
      <button class="rc-menu-btn" type="button">Send feedback</button>
    </div>
    <iframe class="hub-frame dimmed" src="${iframeUrl}"></iframe>
  </ga-remote-control>
  <script nonce="${nonce}">
    (function () {
      const rcEl = document.querySelector('ga-remote-control');
      const iframe = rcEl.querySelector('iframe');
      const makeSignal = (initial) => {
        let val = initial;
        const fn = () => val;
        fn.set = (next) => {
          val = next;
          syncDimmedState();
        };
        fn.update = (updater) => {
          val = updater(val);
          syncDimmedState();
        };
        return fn;
      };

      function connectEnvelope(bytes) {
        const out = new Uint8Array(5 + bytes.length);
        new DataView(out.buffer).setUint32(1, bytes.length, false);
        out.set(bytes, 5);
        return out;
      }

      function encodeJsonBytes(obj) {
        return new TextEncoder().encode(JSON.stringify(obj));
      }

      let syncDimmedState = () => {};

      class RemoteControlComponent {
        constructor() {
          this.hubFrame = { nativeElement: iframe };
          this.iframeSrc = makeSignal(${JSON.stringify(iframeUrl)});
          this.iframeLoading = makeSignal(true);
          this.iframeUiReady = makeSignal(false);
          this.iframeReportedReady = makeSignal(false);
          this.selectedInstanceUuid = makeSignal(${JSON.stringify(instanceUuid)});
          this.instances = makeSignal([{
            uuid: ${JSON.stringify(instanceUuid)},
            status: 1,
            metadata: { name: 'Lenovo-PC', version: '2.33.0-v2' }
          }]);
          this.initialChildPath = '';
          this.lastSyncedChildPath = null;
          this.proxyPort = undefined;
          this.proxyPortSessionId = undefined;
          this.proxyPortSessionCounter = 0;
          this.onIframeLoadCalls = 0;
          this.portRequests = [];
          this.postedMessages = [];
        }

        iframeInitializing() {
          return this.iframeSrc() !== null && (this.iframeLoading() || !this.iframeUiReady());
        }

        markIframeReady() {
          this.iframeLoading.set(false);
          this.iframeUiReady.set(true);
          this.iframeReportedReady.set(true);
        }

        teardownProxyPort() {
          if (this.proxyPort) {
            this.proxyPort.onmessage = null;
            this.proxyPort.onmessageerror = null;
            try { this.proxyPort.close(); } catch {}
            this.proxyPort = undefined;
          }
          this.proxyPortSessionId = undefined;
        }

        async initXChannelServer() {
          await new Promise((r) => setTimeout(r, 15));
        }

        async proxyCommand(rpcPath, bodyBytes, headers) {
          this.portRequests.push({ kind: 'unary', path: rpcPath, ct: headers?.['content-type'] || '' });
          const p = String(rpcPath || '');
          if (p.endsWith('/GetStatus')) {
            return { payload: encodeJsonBytes({ status: 'OK' }), headers: { 'content-type': 'application/json' } };
          }
          if (p.endsWith('/GetMendelFlags')) {
            return { payload: encodeJsonBytes({ flags: [] }), headers: { 'content-type': 'application/json' } };
          }
          if (p.endsWith('/GetUserStatus')) {
            return {
              payload: encodeJsonBytes({
                userStatus: {
                  name: 'Jaeseong',
                  email: 'jaeseong@example.com',
                  planStatus: { planInfo: { teamsTier: 'TEAMS_TIER_PRO' } },
                  cascadeModelConfigData: {
                    clientModelConfigs: [
                      { label: 'Gemini 2.5 Pro', modelOrAlias: { model: 'MODEL_PLACEHOLDER_M1' } }
                    ]
                  }
                }
              }),
              headers: { 'content-type': 'application/json' }
            };
          }
          if (p.endsWith('/GetAllPlugins')) {
            return {
              payload: encodeJsonBytes({
                plugins: ${companionInstalled ? `[
                  { id: 'antigravity-statusbar', installPath: 'C:/Users/Lenovo/.gemini/config/plugins/antigravity-statusbar' },
                  { id: 'antigravity-mcp-manager', installPath: 'C:/Users/Lenovo/.gemini/config/plugins/antigravity-mcp-manager' },
                  { id: 'ko-thought-translator', installPath: 'C:/Users/Lenovo/.gemini/config/plugins/ko-thought-translator' }
                ]` : '[]'}
              }),
              headers: { 'content-type': 'application/json' }
            };
          }
          if (p.endsWith('/ReadFile')) {
            return { payload: encodeJsonBytes({ content: '' }), headers: { 'content-type': 'application/json' } };
          }
          if (p.endsWith('/GetLocalUserInfo')) {
            return {
              payload: encodeJsonBytes({ homeDirUri: 'file:///C:/Users/Lenovo', username: 'Lenovo' }),
              headers: { 'content-type': 'application/json' }
            };
          }
          if (p.endsWith('/GetServerConfiguration')) {
            return {
              payload: encodeJsonBytes({ config: { appDataDir: 'antigravity' } }),
              headers: { 'content-type': 'application/json' }
            };
          }
          if (p.endsWith('/GetAllSkills')) {
            return { payload: encodeJsonBytes({ skills: [] }), headers: { 'content-type': 'application/json' } };
          }
          if (p.endsWith('/GetCustomizationStates')) {
            return { payload: encodeJsonBytes({ states: [] }), headers: { 'content-type': 'application/json' } };
          }
          return { payload: encodeJsonBytes({}), headers: { 'content-type': 'application/json' } };
        }

        handlePortRequest(a) {
          if (!a || typeof a !== 'object' || a.sessionId !== this.proxyPortSessionId) return;
          if (a.kind === 'cancel') return;
          if (a.kind === 'unary') {
            this.proxyCommand(a.path, a.body, a.headers).then(({ payload, headers }) => {
              if (this.proxyPort && a.sessionId === this.proxyPortSessionId) {
                this.proxyPort.postMessage({
                  sessionId: a.sessionId,
                  id: a.id,
                  kind: 'data',
                  chunk: payload,
                  headers
                });
              }
            }).catch((err) => {
              if (this.proxyPort && a.sessionId === this.proxyPortSessionId) {
                this.proxyPort.postMessage({
                  sessionId: a.sessionId,
                  id: a.id,
                  kind: 'error',
                  status: 500,
                  errorText: String(err)
                });
              }
            });
          } else if (a.kind === 'stream') {
            this.portRequests.push({ kind: 'stream', path: a.path, ct: a.headers?.['content-type'] || '' });
            const streamPath = String(a.path || '');
            let protoBytes = new Uint8Array(0);
            if (streamPath.toLowerCase().includes('subscribetostate')) {
              // Binary protobuf JetboxSubscribeToStateResponse:
              // field 1 (appState, tag 0x0a) -> { field 4 (agentOnboardingCompleted = 2): 0x20, 0x02 }
              // field 2 (userConfig, tag 0x12) -> empty message (length 0)
              protoBytes = new Uint8Array([0x0a, 0x02, 0x20, 0x02, 0x12, 0x00]);
            }
            const initialFrame = connectEnvelope(protoBytes);
            if (this.proxyPort && a.sessionId === this.proxyPortSessionId) {
              this.proxyPort.postMessage({
                sessionId: a.sessionId,
                id: a.id,
                kind: 'data',
                chunk: initialFrame,
                headers: { 'content-type': 'application/connect+proto' }
              });
            }
          }
        }

        async onIframeLoad() {
          this.onIframeLoadCalls += 1;
          this.iframeLoading.set(false);
          const c = this.hubFrame?.nativeElement;
          if (!c) return;
          await this.initXChannelServer();
          const d = window.location.origin;
          const f = new URL(c.src).origin;
          const g = this.initialChildPath ? '/' + this.initialChildPath : '/';
          const k = this.instances().find((p) => p.uuid === this.selectedInstanceUuid());
          const a = (k?.metadata?.version || 'dev').endsWith('-v2') ? 'v2' : 'v1';
          this.teardownProxyPort();
          const m = new MessageChannel();
          this.proxyPort = m.port1;
          this.proxyPortSessionId = 'rc-' + (++this.proxyPortSessionCounter);
          this.proxyPort.onmessage = (p) => this.handlePortRequest(p.data);
          const n = {
            type: 'INITIAL_CONFIG',
            parentOrigin: d,
            instanceId: this.selectedInstanceUuid(),
            initialPath: g,
            latencyDebugEnabled: false,
            verboseLoggingEnabled: false,
            remoteControlHostname: 'Lenovo-PC',
            isByoa: false,
            remoteControlVersion: a,
            binaryUnaryEnabled: false,
            supportsRcCompression: false,
            messagePortEnabled: true,
            portSessionId: this.proxyPortSessionId
          };
          c.contentWindow?.postMessage(n, f, [m.port2]);
        }

        handleIframeMessage(ev) {
          const b = this.hubFrame?.nativeElement;
          const c = b?.contentWindow;
          if (!b || !c || ev.source !== c) return;
          try {
            if (ev.origin !== new URL(b.src).origin) return;
          } catch {
            return;
          }
          this.postedMessages.push(typeof ev.data === 'string' ? ev.data.slice(0, 120) : JSON.stringify(ev.data)?.slice(0, 120));
          // Any valid guest->host message from main.js (JSPB array/string UiReady, InstancesQuery, StorageGetItems, etc.)
          if (ev.data) {
            this.markIframeReady();
          }
        }
      }

      const rcInst = new RemoteControlComponent();
      syncDimmedState = () => {
        iframe.classList.toggle('dimmed', rcInst.iframeInitializing());
      };
      syncDimmedState();

      // Authentic Angular 19 LView layout: numeric __ngContext__ on host, LView array with CONTEXT at [8] on child
      const fakeLView = new Array(25).fill(null);
      fakeLView[0] = rcEl;
      fakeLView[8] = rcInst;
      rcEl.__ngContext__ = 42;
      rcEl.firstElementChild.__ngContext__ = fakeLView;
      iframe.__ngContext__ = fakeLView;
      window.default_GoogleAntigravity = { cF: { RemoteControlComponent } };
      window.__testRcInst = rcInst;

      iframe.addEventListener('load', () => {
        rcInst.onIframeLoad();
      });
      window.addEventListener('message', (ev) => {
        rcInst.handleIframeMessage(ev);
      });
    })();
  </script>
</body>
</html>`;
}

async function runScenario(browserBin, scenario) {
  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ko-rc-e2e-'));
  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    '--window-size=1440,900',
    'about:blank',
  ];

  const proc = spawn(browserBin, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeStderr = '';
  if (proc.stderr) {
    proc.stderr.on('data', (chunk) => {
      if (chromeStderr.length < 4096) chromeStderr += chunk.toString('utf8');
    });
  }
  let cdp = null;
  let browserCdp = null;
  const consoleErrors = [];
  const pageExceptions = [];
  const cspViolations = [];
  const failedAssetUrls = [];

  try {
    let targets = null;
    for (let i = 0; i < 80; i++) {
      if (proc.exitCode !== null) {
        throw new Error(`Headless Chrome exited early (code=${proc.exitCode}): ${chromeStderr.trim()}`);
      }
      try {
        targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
        if (Array.isArray(targets) && targets.length > 0) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!targets || targets.length === 0) {
      throw new Error(`Failed to connect to headless Chrome DevTools JSON endpoint: ${chromeStderr.trim()}`);
    }
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    cdp = new MiniCdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');

    const fetchPatterns = [
      { urlPattern: 'https://antigravity.google.com/*' },
      { urlPattern: 'https://raw.githubusercontent.com/*' },
      { urlPattern: 'https://www.gstatic.com/antigravity/*' },
      { urlPattern: 'https://antigravity.static.usercontent.goog/*' },
      { urlPattern: 'https://translate.googleapis.com/*' },
    ];
    let fetchClient = cdp;
    try {
      const versionInfo = await httpGetJson(`http://127.0.0.1:${port}/json/version`);
      if (versionInfo && versionInfo.webSocketDebuggerUrl) {
        browserCdp = new MiniCdpClient(versionInfo.webSocketDebuggerUrl);
        await browserCdp.connect();
        await browserCdp.send('Fetch.enable', { patterns: fetchPatterns });
        fetchClient = browserCdp;
      }
    } catch {
      if (browserCdp) {
        browserCdp.close();
        browserCdp = null;
      }
      fetchClient = cdp;
    }
    if (fetchClient === cdp) {
      await cdp.send('Fetch.enable', { patterns: fetchPatterns });
    }

    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const text = (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        consoleErrors.push(text);
      }
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Exception';
      pageExceptions.push(desc);
    });
    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      if (entry.level === 'error') {
        const text = String(entry.text || '');
        if (/Content Security Policy|TrustedScript|TrustedHTML|TrustedTypes/i.test(text)) {
          cspViolations.push(text);
        }
        consoleErrors.push(`[Log.${entry.source}] ${text}`);
      }
    });

    const nonce = 'testNonce' + crypto.randomBytes(8).toString('hex');
    const instanceUuid = '547d3ff8-7d19-415f-a68a-9bbf28c06f6f-v2';
    const hostPageUrl = `https://antigravity.google.com/r/${instanceUuid}`;

    fetchClient.on('Fetch.requestPaused', async (params, sessionId) => {
      const reqUrl = params.request.url;
      const requestId = params.requestId;
      try {
        if (reqUrl.startsWith('https://antigravity.google.com/r/')) {
          const html = buildRemoteControlHostHtml({
            nonce,
            iframeUrl: scenario.iframeUrl,
            instanceUuid,
            includeEmptyNonceDecoyScript: true,
            companionInstalled: Boolean(scenario.companionInstalled),
          });
          const responseHeaders = [
            { name: 'Content-Type', value: 'text/html; charset=utf-8' },
            { name: 'Content-Security-Policy', value: scenario.cspHeader1.replace(/__NONCE__/g, nonce) },
            { name: 'Content-Security-Policy', value: scenario.cspHeader2.replace(/__NONCE__/g, nonce) },
          ];
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders,
            body: Buffer.from(html, 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://antigravity.google.com/_/GoogleAntigravity/cspreport')) {
          cspViolations.push(`CSP_REPORT:${params.request.postData || ''}`);
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 204,
            responseHeaders: [],
            body: '',
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/')) {
          const bodyBuf = fs.readFileSync(KO_AUTOINJECT_PATH);
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: bodyBuf.toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/')) {
          if (!fs.existsSync(SIBLING_STATUSBAR_DIST)) {
            throw new Error(`Missing required real companion bundle: ${SIBLING_STATUSBAR_DIST}`);
          }
          const bodyBuf = fs.readFileSync(SIBLING_STATUSBAR_DIST);
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: bodyBuf.toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/')) {
          if (!fs.existsSync(SIBLING_MCP_DIST)) {
            throw new Error(`Missing required real companion bundle: ${SIBLING_MCP_DIST}`);
          }
          const bodyBuf = fs.readFileSync(SIBLING_MCP_DIST);
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: bodyBuf.toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_worker_helper.js')) {
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from("self.__agyHelperTag = 'HELPER_IMPORTED';", 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_worker.js')) {
          const workerCode =
            "importScripts('./__e2e_worker_helper.js');\nself.addEventListener('message', function(ev) { self.postMessage({ echoed: ev.data, origin: String((self.location && self.location.origin) || ''), href: String((self.location && self.location.href) || ''), helper: self.__agyHelperTag || '' }); });";
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from(workerCode, 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_mod_dep.js')) {
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from("export const modDepTag = 'ESM_DEP_OK';\n", 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_mod_worker.js')) {
          const modWorkerCode =
            "import { modDepTag } from './__e2e_mod_dep.js';\nself.addEventListener('message', function(ev) { self.postMessage({ echoed: ev.data, modDepTag, href: String((self.location && self.location.href) || '') }); });";
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from(modWorkerCode, 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/shared/__e2e_parent_worker.js')) {
          const parentWorkerCode =
            "self.addEventListener('message', function(ev) { self.postMessage({ echoed: ev.data, href: String((self.location && self.location.href) || '') }); });";
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from(parentWorkerCode, 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/shared/__e2e_parent_chunk.js')) {
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from('window.__agyE2eParentRelChunkLoaded = true;', 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_chunk.js')) {
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from('window.__agyE2eSetAttrChunkLoaded = true;', 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_rel_chunk.js')) {
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from('window.__agyE2eRelChunkLoaded = true;', 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_dyn.css')) {
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'text/css; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from('#agy-e2e-probe { --agy-dyn-css-loaded: 1; }', 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (reqUrl.startsWith('https://translate.googleapis.com/')) {
          const u = new URL(reqUrl);
          const q = u.searchParams.get('q') || '';
          const koText = `[번역됨] ${q}`;
          const payload = JSON.stringify([[[koText, q, null, null, 10]], null, 'en']);
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/json; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body: Buffer.from(payload, 'utf8').toString('base64'),
          }, sessionId);
          return;
        }

        if (scenario.failCdnMainJs && reqUrl.includes('www.gstatic.com/antigravity/') && reqUrl.endsWith('/main.js')) {
          await fetchClient.send('Fetch.failRequest', {
            requestId,
            errorReason: 'BlockedByClient',
          }, sessionId);
          return;
        }

        if (
          reqUrl.startsWith('https://www.gstatic.com/antigravity/') ||
          reqUrl.startsWith('https://antigravity.static.usercontent.goog/')
        ) {
          const upstream = await fetchUpstreamBuffer(reqUrl);
          if (upstream.statusCode >= 400) {
            failedAssetUrls.push(`${upstream.statusCode}:${reqUrl}`);
          }
          const respHeaders = [];
          for (const [k, v] of Object.entries(upstream.headers)) {
            if (v === undefined) continue;
            if (Array.isArray(v)) {
              for (const item of v) respHeaders.push({ name: k, value: String(item) });
            } else {
              respHeaders.push({ name: k, value: String(v) });
            }
          }
          await fetchClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: upstream.statusCode,
            responseHeaders: respHeaders,
            body: upstream.body.toString('base64'),
          }, sessionId);
          return;
        }

        await fetchClient.send('Fetch.continueRequest', { requestId }, sessionId);
      } catch (err) {
        try {
          await fetchClient.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }, sessionId);
        } catch {}
      }
    });

    await cdp.send('Page.navigate', { url: hostPageUrl });

    // Wait for initial cross-origin iframe workbench to boot before clicking bookmarklet
    const waitStart = Date.now();
    let preState = null;
    while (Date.now() - waitStart < 15000) {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const rc = window.__testRcInst;
          const f = document.querySelector('ga-remote-control iframe');
          return {
            uiReady: Boolean(rc && rc.iframeUiReady()),
            dimmed: Boolean(f && f.classList.contains('dimmed')),
            portRequests: rc ? rc.portRequests.length : 0,
            sampleRpcs: rc ? rc.portRequests.slice(0, 8) : [],
            postedMessages: rc ? rc.postedMessages.slice(0, 5) : [],
            src: f ? f.getAttribute('src') : ''
          };
        })()`,
        returnByValue: true,
      });
      preState = res.result?.value;
      if (preState && preState.uiReady && !preState.dimmed) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (scenario.injectEmptyNonceScriptBeforeBookmarklet) {
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          // Simulate browser extension / prior tag in <head> with nonce="" attribute
          const emptyNonceEl = document.createElement('script');
          emptyNonceEl.setAttribute('nonce', '');
          document.head.insertBefore(emptyNonceEl, document.head.firstChild);
        })()`,
      });
    }

    if (scenario.screenshotBeforePath) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) fs.writeFileSync(scenario.screenshotBeforePath, Buffer.from(shot.data, 'base64'));
    }

    if (scenario.failCdnMainJs) {
      await cdp.send('Network.setBlockedURLs', {
        urls: ['https://www.gstatic.com/antigravity/*/main.js'],
      });
    }

    if (scenario.companionFirst) {
      // Execute real antigravity-statusbar & antigravity-mcp-manager companion bundles BEFORE ko-thought-translator
      const injectCompanionExpr = `(() => {
        const urls = [
          'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js?t=' + Date.now(),
          'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t=' + Date.now()
        ];
        return Promise.all(urls.map(u => fetch(u).then(r => r.text()))).then(codes => {
          const n = [...document.querySelectorAll('script,style,link')].map(e => e.nonce || e.getAttribute('nonce')).find(Boolean);
          const p = window.trustedTypes?.createPolicy('agy-e2e-companion-seed', { createScript: x => x });
          for (const c of codes) {
            const s = document.createElement('script');
            if (n) { s.nonce = n; s.setAttribute('nonce', n); }
            s.text = p ? p.createScript(c) : c;
            document.head.appendChild(s);
          }
          return { sb: Boolean(window.agyStatusBar), mcp: Boolean(window.agyMcpManager) };
        });
      })()`;
      await cdp.send('Runtime.evaluate', {
        expression: injectCompanionExpr,
        awaitPromise: true,
        returnByValue: true,
      });
      // Give companion promoters time to hook RC prototype and promote or attach
      await new Promise((r) => setTimeout(r, 1200));
    }

    // Execute exact README bookmarklet (or scenario override such as user's saved v1.2.39 bookmarklet) in main world
    const bookmarkletCode = scenario.customBookmarkletCode || extractBookmarkletBodyFromReadme();
    const evalBm = await cdp.send('Runtime.evaluate', {
      expression: bookmarkletCode,
      awaitPromise: false,
      returnByValue: true,
    });
    if (evalBm.exceptionDetails) {
      pageExceptions.push(`BookmarkletSyncException: ${evalBm.exceptionDetails.exception?.description || evalBm.exceptionDetails.text}`);
    }

    // Wait up to 14s for promotion + workbench mount + companion sync + localization
    let postState = null;
    const postStart = Date.now();
    while (Date.now() - postStart < 14000) {
      await new Promise((r) => setTimeout(r, 400));
      const res = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const rc = window.__testRcInst;
          const f = document.querySelector('ga-remote-control iframe');
          const topBtns = Array.from(document.querySelectorAll('.rc-menu-btn')).map(b => b.textContent.trim());
          let sameOriginAccessible = false;
          let childHref = '';
          let rootChildCount = 0;
          let rootTextLen = 0;
          let rootSampleText = '';
          let koLocalizerActive = '';
          let hasKoreanInChild = false;
          try {
            const cw = f && f.contentWindow;
            const cd = f && f.contentDocument;
            if (cw && cd) {
              sameOriginAccessible = true;
              childHref = cw.location ? cw.location.href : '';
              const root = cd.getElementById('root');
              rootChildCount = root ? root.childElementCount : -1;
              const txt = root ? (root.innerText || root.textContent || '').trim() : '';
              rootTextLen = txt.length;
              rootSampleText = txt.slice(0, 180);
              koLocalizerActive = cw.__agyKoLocalizerActive || '';
              hasKoreanInChild = /[가-힣]/.test(txt);
            }
          } catch (e) {
            sameOriginAccessible = false;
          }
          const rect = f ? f.getBoundingClientRect() : { width: 0, height: 0 };
          const compStyle = f ? window.getComputedStyle(f) : null;
          const hasRealStatusBar = Boolean(
            window.agyStatusBar &&
              window.agyStatusBar.version !== 'stub' &&
              typeof window.agyStatusBar.registerAdapter === 'function'
          );
          const hasRealMcpManager = Boolean(
            window.agyMcpManager &&
              window.agyMcpManager.version !== 'stub' &&
              typeof window.__agyMountMcpManager === 'function'
          );
          const manifest = window.__agyHostInstalledPlugins || null;
          return {
            hostLocalizerActive: window.__agyKoLocalizerActive || '',
            topBtns,
            iframeAttrSrc: f ? f.getAttribute('src') : '',
            iframePropSrc: f ? f.src : '',
            promotionOwner: f ? (f.__agyRemotePromotionOwner || '') : '',
            dimmed: Boolean(f && f.classList.contains('dimmed')),
            opacity: compStyle ? compStyle.opacity : '',
            display: compStyle ? compStyle.display : '',
            width: rect.width,
            height: rect.height,
            uiReady: Boolean(rc && rc.iframeUiReady()),
            iframeLoading: Boolean(rc && rc.iframeLoading()),
            onIframeLoadCalls: rc ? rc.onIframeLoadCalls : 0,
            portRequests: rc ? rc.portRequests.length : 0,
            sampleRpcs: rc ? rc.portRequests.slice(0, 12).map(r => r.kind + ':' + r.path) : [],
            sameOriginAccessible,
            childHref,
            rootChildCount,
            rootTextLen,
            rootSampleText,
            koLocalizerActive,
            hasKoreanInChild,
            hasRealStatusBar,
            hasRealMcpManager,
            manifestResolved: Boolean(manifest && manifest.resolved === true),
            manifestHasCompanions: Boolean(manifest && manifest.hasStatusbar && manifest.hasMcpManager),
          };
        })()`,
        returnByValue: true,
      });
      postState = res.result?.value;
      const companionsReady = !scenario.companionInstalled || (postState && postState.hasRealStatusBar && postState.hasRealMcpManager);
      if (
        postState &&
        postState.sameOriginAccessible &&
        postState.rootChildCount > 0 &&
        postState.koLocalizerActive &&
        !postState.dimmed &&
        companionsReady
      ) {
        // Inject a synthetic English UI + Thinking block inside the promoted real workbench to verify live Korean translation!
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const cd = document.querySelector('ga-remote-control iframe')?.contentDocument;
            const root = cd?.getElementById('root');
            if (cd && root && !cd.getElementById('agy-e2e-probe')) {
              const probe = cd.createElement('div');
              probe.id = 'agy-e2e-probe';
              const navBtn = cd.createElement('button');
              navBtn.setAttribute('data-testid', 'settings-nav-item-General');
              navBtn.textContent = 'General';
              const thoughtWrap = cd.createElement('div');
              thoughtWrap.className = 'cursor-edit';
              const innerContainer = cd.createElement('div');
              const p = cd.createElement('p');
              p.textContent = 'Checking the remote workbench configuration before applying updates.';
              innerContainer.appendChild(p);
              thoughtWrap.appendChild(innerContainer);
              probe.appendChild(navBtn);
              probe.appendChild(thoughtWrap);
              root.appendChild(probe);
            }
          })()`,
        });
        const probeDeadline = Date.now() + 4500;
        while (Date.now() < probeDeadline) {
          await new Promise((r) => setTimeout(r, 200));
          const verifyRes = await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const cd = document.querySelector('ga-remote-control iframe')?.contentDocument;
              const navBtn = cd?.querySelector('[data-testid="settings-nav-item-General"]');
              const thoughtWrapEl = cd?.querySelector('#agy-e2e-probe .cursor-edit .agy-ko-thought-wrap p') || cd?.querySelector('#agy-e2e-probe .cursor-edit .agy-ko-thought-wrap');
              const origContainerEl = cd?.querySelector('#agy-e2e-probe .cursor-edit > div:not(.agy-ko-thought-wrap)');
              const origHidden = origContainerEl ? cd.defaultView.getComputedStyle(origContainerEl).display === 'none' : false;
              const root = cd?.getElementById('root');
              return {
                navBtnText: navBtn ? navBtn.textContent.trim() : '',
                thoughtText: thoughtWrapEl ? thoughtWrapEl.textContent.trim() : '',
                origPreservedAndHidden: Boolean(origContainerEl && origHidden),
                rootChildCount: root ? root.childElementCount : 0,
              };
            })()`,
            returnByValue: true,
          });
          postState.probe = verifyRes.result?.value || null;
          if (postState.probe && postState.probe.navBtnText === '일반' && /[가-힣]/.test(postState.probe.thoughtText || '')) {
            break;
          }
        }

        if (scenario.verifyWorkerAndDynamicDom) {
          const dynRes = await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const f = document.querySelector('ga-remote-control iframe');
              const cw = f.contentWindow;
              const cd = f.contentDocument;
              const roundTripWorker = (arg, payload, opts) => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Worker timeout for ' + payload)), 4000);
                try {
                  const w = opts !== undefined ? new cw.Worker(arg, opts) : new cw.Worker(arg);
                  w.onerror = (err) => { clearTimeout(timer); w.terminate(); reject(new Error(err?.message || 'worker error')); };
                  w.addEventListener('message', (ev) => {
                    clearTimeout(timer);
                    w.terminate();
                    resolve(ev.data);
                  });
                  w.postMessage(payload);
                } catch (e) {
                  clearTimeout(timer);
                  reject(e);
                }
              });

              let untrustedRejected = false;
              try {
                new cw.Worker('https://evil.example/untrusted.js');
              } catch (e) {
                untrustedRejected = e && e.name === 'TypeError';
              }

              const loadDynScript = (srcVal, flagName) => new Promise((resolve) => {
                const s = cd.createElement('script');
                s.onload = () => resolve(Boolean(cw[flagName]));
                s.onerror = () => resolve(false);
                s.setAttribute('src', srcVal);
                cd.head.appendChild(s);
              });

              const loadDynCss = () => new Promise((resolve) => {
                const l = cd.createElement('link');
                l.setAttribute('rel', 'stylesheet');
                l.onload = () => {
                  const probeEl = cd.getElementById('agy-e2e-probe');
                  const val = probeEl ? cw.getComputedStyle(probeEl).getPropertyValue('--agy-dyn-css-loaded').trim() : '';
                  resolve(val === '1');
                };
                l.onerror = () => resolve(false);
                l.setAttribute('href', '/web/2.33.0/__e2e_dyn.css');
                cd.head.appendChild(l);
              });

              return Promise.all([
                roundTripWorker('/web/2.33.0/__e2e_worker.js', 'ping-path'),
                roundTripWorker(new cw.URL('/web/2.33.0/__e2e_worker.js', cw.location.href), 'ping-url'),
                roundTripWorker('https://www.gstatic.com/antigravity/web/2.33.0/__e2e_worker.js', 'ping-abs'),
                roundTripWorker('./__e2e_worker.js', 'ping-rel'),
                roundTripWorker('/web/2.33.0/__e2e_mod_worker.js', 'ping-mod', { type: 'module' }),
                roundTripWorker('../shared/__e2e_parent_worker.js', 'ping-parent-rel'),
                loadDynScript('/web/2.33.0/__e2e_chunk.js', '__agyE2eSetAttrChunkLoaded'),
                loadDynScript('./__e2e_rel_chunk.js', '__agyE2eRelChunkLoaded'),
                loadDynScript('../shared/__e2e_parent_chunk.js', '__agyE2eParentRelChunkLoaded'),
                loadDynCss(),
              ]).then(([wPath, wUrl, wAbs, wRel, wMod, wParentRel, chunkAbsOk, chunkRelOk, chunkParentRelOk, cssOk]) => {
                const hostStyle = document.getElementById('agy-ko-thought-style');
                const childStyle = cd.getElementById('agy-ko-thought-style');
                return {
                  wPathEcho: wPath?.echoed || '',
                  wUrlEcho: wUrl?.echoed || '',
                  wAbsEcho: wAbs?.echoed || '',
                  wRelEcho: wRel?.echoed || '',
                  wHref: wPath?.href || '',
                  wHelper: wPath?.helper || '',
                  wModEcho: wMod?.echoed || '',
                  wModTag: wMod?.modDepTag || '',
                  wModHref: wMod?.href || '',
                  wParentRelEcho: wParentRel?.echoed || '',
                  untrustedRejected,
                  chunkAbsOk,
                  chunkRelOk,
                  chunkParentRelOk,
                  cssOk,
                  styleNoncePresent: Boolean((hostStyle && hostStyle.nonce) || (childStyle && childStyle.nonce)),
                };
              }).catch((err) => ({
                error: String(err && (err.stack || err.message || err)),
              }));
            })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          postState.dynamicChecks = dynRes.result?.value || { error: dynRes.exceptionDetails?.text || 'dynRes failed' };
        }

        if (scenario.verifyPeerLockOnHotReload) {
          const lockRes = await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const rc = window.__testRcInst;
              rc.__agySuppressAutoIframeLoad = true;
              rc.__agySuppressAutoIframeLoadCount = 1;
              if (typeof window.__agyKoThoughtCleanup === 'function') {
                window.__agyKoThoughtCleanup(false);
              }
              const preserved = rc.__agySuppressAutoIframeLoad === true && rc.__agySuppressAutoIframeLoadCount === 1;
              delete rc.__agySuppressAutoIframeLoad;
              delete rc.__agySuppressAutoIframeLoadCount;
              return preserved;
            })()`,
            returnByValue: true,
          });
          postState.hotReloadPreservedPeerLock = Boolean(lockRes.result?.value);
        }

        break;
      }
      if (scenario.expectNativePreserved && Date.now() - postStart >= 2400 && postState && postState.uiReady && !postState.dimmed) {
        break;
      }
    }

    if (scenario.screenshotAfterPath) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) fs.writeFileSync(scenario.screenshotAfterPath, Buffer.from(shot.data, 'base64'));
    }

    return {
      name: scenario.name,
      preState,
      postState,
      consoleErrors,
      pageExceptions,
      cspViolations,
      failedAssetUrls,
    };
  } finally {
    if (browserCdp) browserCdp.close();
    if (cdp) cdp.close();
    try { proc.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

async function runAllBrowserE2E(options = {}) {
  const browserBin = findBrowserBinary();
  if (!browserBin) {
    return { skipped: true, reason: 'No Chrome/Edge binary found on host' };
  }
  if (!fs.existsSync(SIBLING_STATUSBAR_DIST)) {
    throw new Error(`Real sibling companion bundle missing: ${SIBLING_STATUSBAR_DIST}`);
  }
  if (!fs.existsSync(SIBLING_MCP_DIST)) {
    throw new Error(`Real sibling companion bundle missing: ${SIBLING_MCP_DIST}`);
  }

  const artifactDir = options.artifactDir || null;
  const legacySavedV1239Bookmarklet =
    "(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js?t='+Date.now()).then(r=>r.text()).then(c=>{const s=document.createElement('script'),n=document.querySelector('script[nonce]')?.nonce,p=window.trustedTypes?.createPolicy('agy-ko-'+Date.now(),{createScript:x=>x});if(n)s.nonce=n;s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();";
  const scenarios = [
    {
      name: 'S0_pure_live_v2_default_csp_with_companions',
      iframeUrl: 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true',
      cspHeader1: "script-src 'nonce-__NONCE__' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'",
      cspHeader2: "require-trusted-types-for 'script';report-uri /_/GoogleAntigravity/cspreport",
      injectEmptyNonceScriptBeforeBookmarklet: false,
      companionInstalled: true,
      verifyWorkerAndDynamicDom: true,
    },
    {
      name: 'S0b_legacy_v1239_saved_bookmarklet_compatibility',
      iframeUrl: 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true',
      cspHeader1: "script-src 'nonce-__NONCE__' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'",
      cspHeader2: "require-trusted-types-for 'script';report-uri /_/GoogleAntigravity/cspreport",
      injectEmptyNonceScriptBeforeBookmarklet: false,
      companionInstalled: true,
      customBookmarkletCode: legacySavedV1239Bookmarklet,
    },
    {
      name: 'S1_live_v2_hostTheme_and_empty_nonce_script_with_companions',
      iframeUrl: 'https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true',
      cspHeader1: "script-src 'nonce-__NONCE__' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'",
      cspHeader2: "require-trusted-types-for 'script';report-uri /_/GoogleAntigravity/cspreport",
      injectEmptyNonceScriptBeforeBookmarklet: true,
      companionInstalled: true,
      screenshotBeforePath: artifactDir ? path.join(artifactDir, `${options.prefix || 'rc'}_s1_before.png`) : null,
      screenshotAfterPath: artifactDir ? path.join(artifactDir, `${options.prefix || 'rc'}_s1_after.png`) : null,
    },
    {
      name: 'S2a_explicit_trusted_types_allowlist_allowing_agy_ko',
      iframeUrl: 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true',
      cspHeader1: "script-src 'nonce-__NONCE__' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'",
      cspHeader2: "require-trusted-types-for 'script';trusted-types angular goog#html agy-ko-translator agy-ko-translator-bm;report-uri /_/GoogleAntigravity/cspreport",
      injectEmptyNonceScriptBeforeBookmarklet: false,
      companionInstalled: false,
      screenshotAfterPath: artifactDir ? path.join(artifactDir, `${options.prefix || 'rc'}_s2a_after.png`) : null,
    },
    {
      name: 'S2b_disallowed_trusted_types_graceful_no_black_screen',
      iframeUrl: 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true',
      cspHeader1: "script-src 'nonce-__NONCE__' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'",
      cspHeader2: "require-trusted-types-for 'script';trusted-types angular;report-uri /_/GoogleAntigravity/cspreport",
      injectEmptyNonceScriptBeforeBookmarklet: false,
      companionInstalled: false,
      expectNativePreserved: true,
    },
    {
      name: 'S3_promotion_network_failure_clean_native_rollback_no_black_loop',
      iframeUrl: 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true',
      cspHeader1: "script-src 'nonce-__NONCE__' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'",
      cspHeader2: "require-trusted-types-for 'script';report-uri /_/GoogleAntigravity/cspreport",
      failCdnMainJs: true,
      companionInstalled: false,
      expectNativePreserved: true,
      screenshotAfterPath: artifactDir ? path.join(artifactDir, `${options.prefix || 'rc'}_s3_after.png`) : null,
    },
    {
      name: 'S4_companion_first_statusbar_and_mcp_coexistence_with_ko_bookmarklet',
      iframeUrl: 'https://antigravity.static.usercontent.goog/web/2.33.0/?iframe=true',
      cspHeader1: "script-src 'nonce-__NONCE__' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'",
      cspHeader2: "require-trusted-types-for 'script';report-uri /_/GoogleAntigravity/cspreport",
      injectEmptyNonceScriptBeforeBookmarklet: false,
      companionInstalled: true,
      companionFirst: true,
      verifyWorkerAndDynamicDom: true,
      verifyPeerLockOnHotReload: true,
    },
  ];

  const results = [];
  const failures = [];

  for (const sc of scenarios) {
    const res = await runScenario(browserBin, sc);
    results.push(res);

    const ps = res.postState || {};
    if (sc.name.startsWith('S0') || sc.name.startsWith('S1_') || sc.name.startsWith('S2a_') || sc.name.startsWith('S4_')) {
      if (!ps.hostLocalizerActive && !sc.verifyPeerLockOnHotReload) failures.push(`${sc.name}: hostLocalizerActive is empty`);
      if (!ps.sameOriginAccessible) failures.push(`${sc.name}: iframe not promoted to same-origin (childHref=${ps.childHref})`);
      if (!(ps.rootChildCount > 0)) failures.push(`${sc.name}: black screen! #root childElementCount=${ps.rootChildCount}`);
      if (ps.dimmed || ps.opacity === '0') failures.push(`${sc.name}: iframe remained dimmed/invisible (dimmed=${ps.dimmed}, opacity=${ps.opacity})`);
      if (!ps.koLocalizerActive) failures.push(`${sc.name}: child __agyKoLocalizerActive not mounted`);
      if (!ps.topBtns || !ps.topBtns.includes('앱으로 설치')) failures.push(`${sc.name}: host topbar UI not localized (${JSON.stringify(ps.topBtns)})`);
      if (!ps.probe || ps.probe.navBtnText !== '일반') failures.push(`${sc.name}: child static UI 'General' not localized (${JSON.stringify(ps.probe)})`);
      if (!ps.probe || !/[가-힣]/.test(ps.probe.thoughtText || '')) failures.push(`${sc.name}: child Thinking block not translated (${JSON.stringify(ps.probe)})`);
      if (sc.companionInstalled) {
        if (!ps.hasRealStatusBar) failures.push(`${sc.name}: real antigravity-statusbar bundle did not mount on window.agyStatusBar`);
        if (!ps.hasRealMcpManager) failures.push(`${sc.name}: real antigravity-mcp-manager bundle did not mount on window.agyMcpManager`);
        if (!ps.manifestResolved || !ps.manifestHasCompanions) {
          failures.push(`${sc.name}: window.__agyHostInstalledPlugins manifest not populated (${JSON.stringify(ps)})`);
        }
      }
      if (sc.verifyWorkerAndDynamicDom) {
        const dc = ps.dynamicChecks || {};
        if (
          dc.wPathEcho !== 'ping-path' ||
          dc.wUrlEcho !== 'ping-url' ||
          dc.wAbsEcho !== 'ping-abs' ||
          dc.wRelEcho !== 'ping-rel' ||
          dc.wHref !== 'https://www.gstatic.com/antigravity/web/2.33.0/__e2e_worker.js' ||
          dc.wHelper !== 'HELPER_IMPORTED' ||
          dc.wModEcho !== 'ping-mod' ||
          dc.wModTag !== 'ESM_DEP_OK' ||
          dc.wModHref !== 'https://www.gstatic.com/antigravity/web/2.33.0/__e2e_mod_worker.js' ||
          dc.wParentRelEcho !== 'ping-parent-rel' ||
          !dc.untrustedRejected ||
          !dc.chunkAbsOk ||
          !dc.chunkRelOk ||
          !dc.chunkParentRelOk ||
          !dc.cssOk ||
          !dc.styleNoncePresent
        ) {
          failures.push(`${sc.name}: Worker/setAttribute/link/styleNonce checks failed: ${JSON.stringify(dc)}`);
        }
      }
      if (sc.verifyPeerLockOnHotReload && !ps.hotReloadPreservedPeerLock) {
        failures.push(`${sc.name}: __agyKoThoughtCleanup(false) clobbered peer __agySuppressAutoIframeLoadCount`);
      }
      if (res.failedAssetUrls.length > 0) failures.push(`${sc.name}: failed asset HTTP requests=${JSON.stringify(res.failedAssetUrls)}`);
      if (res.cspViolations.length > 0) failures.push(`${sc.name}: CSP/TrustedTypes violations=${JSON.stringify(res.cspViolations)}`);
      if (res.pageExceptions.length > 0) failures.push(`${sc.name}: uncaught exceptions=${JSON.stringify(res.pageExceptions)}`);
    } else if (sc.name.startsWith('S2b_')) {
      if (ps.iframeAttrSrc === 'about:blank' || !ps.iframeAttrSrc.includes('antigravity.static.usercontent.goog')) {
        failures.push(`${sc.name}: disallowed TrustedTypes blanked native iframe (${ps.iframeAttrSrc})`);
      }
      if (!ps.uiReady || ps.dimmed) {
        failures.push(`${sc.name}: native workbench was disrupted under strict TrustedTypes (uiReady=${ps.uiReady}, dimmed=${ps.dimmed})`);
      }
      if (ps.hostLocalizerActive) {
        failures.push(`${sc.name}: bookmarklet did not fail closed under disallowed TrustedTypes`);
      }
      const sinkViolations = res.cspViolations.filter((v) =>
        /TrustedScript assignment|TrustedScriptURL assignment|"violated-directive"\s*:\s*"require-trusted-types-for"|"violated-directive"\s*:\s*"script-src/i.test(
          v
        )
      );
      if (sinkViolations.length > 0) {
        failures.push(`${sc.name}: bookmarklet triggered plaintext TrustedScript sink violation (${JSON.stringify(sinkViolations)})`);
      }
      if (res.pageExceptions.length > 0) {
        failures.push(`${sc.name}: bookmarklet threw uncaught exception (${JSON.stringify(res.pageExceptions)})`);
      }
    } else if (sc.name.startsWith('S3_')) {
      // When CDN main.js 503s, rollback MUST restore native cross-origin iframe (uiReady=true, dimmed=false, NOT stuck on about:blank!)
      if (ps.iframeAttrSrc === 'about:blank' || !ps.iframeAttrSrc.includes('antigravity.static.usercontent.goog')) {
        failures.push(`${sc.name}: failed promotion left iframe stranded at src=${ps.iframeAttrSrc}`);
      }
      if (!ps.uiReady || ps.dimmed) {
        failures.push(`${sc.name}: native workbench did not recover after rollback (uiReady=${ps.uiReady}, dimmed=${ps.dimmed}, onIframeLoadCalls=${ps.onIframeLoadCalls})`);
      }
      if (res.cspViolations.length > 0) {
        failures.push(`${sc.name}: CSP violations during rollback=${JSON.stringify(res.cspViolations)}`);
      }
    }
  }

  return { skipped: false, browserBin, results, failures };
}

if (require.main === module || process.execArgv.includes('--test') || process.argv.includes('--test')) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  test('Remote Control (/r/...-v2) real Chromium CDP bookmarklet E2E', async (t) => {
    const summary = await runAllBrowserE2E();
    console.log('[RC-BROWSER-E2E-SUMMARY]\n' + JSON.stringify(summary, null, 2));
    if (summary.skipped) {
      t.skip(summary.reason);
      return;
    }
    assert.deepEqual(summary.failures, [], `Real browser E2E failed:\n${summary.failures.join('\n')}`);
  });
}

module.exports = { runAllBrowserE2E, findBrowserBinary };
