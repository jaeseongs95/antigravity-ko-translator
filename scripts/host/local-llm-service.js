/**
 * Module: scripts/host/local-llm-service.js
 * Responsibility: Local LLM server process lifecycle management (env resolution, HTTP health probe,
 * headless GPU startup via `windowsHide: true` / `CREATE_NO_WINDOW`, and port-based process tree termination).
 */

const fs = require('fs');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { LLM_BASE_URL, DEVTOOLS_PORT_FILE } = require('./paths');

function readWindowsUserEnv(varName) {
  if (process.platform !== 'win32') return null;
  try {
    const res = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', varName], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.status === 0 && res.stdout) {
      const m = res.stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/i);
      if (m && m[1]) return m[1].trim();
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] readWindowsUserEnv(${varName}) error: ${err.message}\n`);
  }
  return null;
}

function parseCommandArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== 'string') return [];
  const args = [];
  let current = '';
  let quoteChar = null;
  let hasToken = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const ch = rawArgs[i];
    if (ch === '\\') {
      let slashCount = 1;
      while (i + slashCount < rawArgs.length && rawArgs[i + slashCount] === '\\') {
        slashCount++;
      }
      const nextCh = rawArgs[i + slashCount];
      if (nextCh === '"' && quoteChar !== "'") {
        current += '\\'.repeat(Math.floor(slashCount / 2));
        hasToken = true;
        if (slashCount % 2 === 1) {
          current += '"';
        } else {
          quoteChar = quoteChar === '"' ? null : '"';
        }
        i += slashCount;
        continue;
      }
      if (nextCh === "'" && quoteChar === "'") {
        current += '\\'.repeat(Math.floor(slashCount / 2));
        hasToken = true;
        if (slashCount % 2 === 1) {
          current += "'";
          i += slashCount;
          continue;
        }
      }
      current += '\\'.repeat(slashCount);
      hasToken = true;
      i += slashCount - 1;
      continue;
    }
    if (quoteChar) {
      if (ch === quoteChar) {
        quoteChar = null;
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) {
    args.push(current);
  }
  return args;
}

function extractListeningPidsFromNetstat(stdout, port, selfPid = process.pid) {
  const pids = new Set();
  const targetPort = Number(port);
  if (!stdout || !Number.isInteger(targetPort) || targetPort <= 0) return pids;
  const lines = String(stdout).split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (!/^TCP$/i.test(parts[0])) continue;
    if (!/^LISTENING$/i.test(parts[3])) continue;
    const localAddr = parts[1];
    const colonIdx = localAddr.lastIndexOf(':');
    if (colonIdx < 0) continue;
    const portPart = localAddr.slice(colonIdx + 1);
    if (!/^\d+$/.test(portPart) || Number(portPart) !== targetPort) continue;
    const pid = Number(parts[4]);
    if (Number.isInteger(pid) && pid > 0 && pid !== selfPid) {
      pids.add(pid);
    }
  }
  return pids;
}

function resolveLocalLlmCommand() {
  const bin = process.env.AGY_LOCAL_LLM_SERVER_BIN || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_BIN');
  if (!bin) return null;
  const rawArgs = process.env.AGY_LOCAL_LLM_SERVER_ARGS || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_ARGS') || 'serve';
  return {
    bin,
    args: parseCommandArgs(rawArgs),
  };
}

async function resolveProbeOrigin(options = {}) {
  if (options && typeof options.probeOrigin === 'string' && options.probeOrigin.trim()) {
    return options.probeOrigin.trim();
  }
  const envOrigin = (
    process.env.AGY_FRONTEND_ORIGIN ||
    readWindowsUserEnv('AGY_FRONTEND_ORIGIN') ||
    ''
  ).trim();
  if (envOrigin) return envOrigin;

  try {
    if (DEVTOOLS_PORT_FILE && fs.existsSync(DEVTOOLS_PORT_FILE)) {
      const lines = fs.readFileSync(DEVTOOLS_PORT_FILE, 'utf8').trim().split(/\r?\n/);
      const dtPort = parseInt(lines[0], 10);
      if (dtPort && !Number.isNaN(dtPort)) {
        const discovered = await new Promise((resolve) => {
          const req = http.get(
            { host: '127.0.0.1', port: dtPort, path: '/json/list', timeout: 120 },
            (res) => {
              let raw = '';
              res.on('data', (c) => {
                raw += c;
              });
              res.on('end', () => {
                try {
                  const list = JSON.parse(raw);
                  const wb = Array.isArray(list)
                    ? list.find((t) => t && t.type === 'page' && /^https?:\/\//i.test(String(t.url || '')))
                    : null;
                  resolve(wb ? new URL(wb.url).origin : null);
                } catch {
                  resolve(null);
                }
              });
            }
          );
          req.on('timeout', () => {
            req.destroy();
            resolve(null);
          });
          req.on('error', () => resolve(null));
        });
        if (discovered) return discovered;
      }
    }
  } catch {}

  return 'https://127.0.0.1';
}

async function probeLocalLlmServer(timeoutMs = 500, options = {}) {
  const probeOrigin = await resolveProbeOrigin(options);
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const url = new URL('/v1/models', LLM_BASE_URL);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: url.pathname,
          method: 'GET',
          headers: { Origin: probeOrigin },
          timeout: timeoutMs,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const corsOrigin = res.headers['access-control-allow-origin'] || '';
            let models = [];
            try {
              const parsed = JSON.parse(body);
              models = Array.isArray(parsed?.data) ? parsed.data.map((m) => m.id) : [];
            } catch {}
            const corsAllowed =
              corsOrigin === '*' ||
              corsOrigin === probeOrigin ||
              (probeOrigin === 'https://127.0.0.1' && corsOrigin.includes('127.0.0.1'));
            done({
              reachable: true,
              statusCode: res.statusCode,
              corsAllowed,
              corsOrigin,
              probeOrigin,
              models,
            });
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        done({ reachable: false, corsAllowed: false, probeOrigin, models: [] });
      });
      req.on('error', () => done({ reachable: false, corsAllowed: false, probeOrigin, models: [] }));
      req.end();
    } catch {
      done({ reachable: false, corsAllowed: false, probeOrigin, models: [] });
    }
  });
}

async function ensureLocalLlmServer(pluginEnabled = true, options = {}) {
  if (!pluginEnabled) return { skipped: true };
  const probe = await probeLocalLlmServer(450, options);
  if (probe.reachable) {
    return probe;
  }
  const cmd = resolveLocalLlmCommand();
  if (!cmd) return probe;
  const spawnImpl = options && typeof options.spawnFn === 'function' ? options.spawnFn : spawn;
  try {
    const child = spawnImpl(cmd.bin, cmd.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env },
    });
    child.unref();
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] ensureLocalLlmServer error: ${err.message}\n`);
  }
  return probe;
}

async function stopLocalLlmServer(forceProcessScan = false) {
  let stoppedCount = 0;
  try {
    if (!forceProcessScan) {
      const probe = await probeLocalLlmServer(150);
      if (!probe.reachable) {
        return { stoppedCount: 0 };
      }
    }
    const url = new URL('/v1/models', LLM_BASE_URL);
    const port = Number(url.port) || 11434;
    if (process.platform === 'win32') {
      const res = spawnSync('netstat', ['-ano'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const pids = extractListeningPidsFromNetstat(res.stdout, port, process.pid);
      for (const pid of pids) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
        stoppedCount++;
      }
    } else {
      const pidSet = new Set();
      const lsofRes = spawnSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
      });
      if (lsofRes && lsofRes.stdout) {
        for (const line of lsofRes.stdout.split(/\r?\n/)) {
          const parsed = Number(line.trim());
          if (parsed > 0 && parsed !== process.pid) pidSet.add(parsed);
        }
      }
      if (pidSet.size === 0) {
        const ssRes = spawnSync('ss', ['-lptn', `sport = :${port}`], {
          encoding: 'utf8',
        });
        if (ssRes && ssRes.stdout) {
          for (const m of ssRes.stdout.matchAll(/pid=(\d+)/g)) {
            const parsed = Number(m[1]);
            if (parsed > 0 && parsed !== process.pid) pidSet.add(parsed);
          }
        }
      }
      for (const pid of pidSet) {
        try {
          process.kill(pid, 'SIGTERM');
          stoppedCount++;
        } catch {}
      }
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] stopLocalLlmServer error: ${err.message}\n`);
  }
  return { stoppedCount };
}

module.exports = {
  parseCommandArgs,
  extractListeningPidsFromNetstat,
  readWindowsUserEnv,
  resolveLocalLlmCommand,
  probeLocalLlmServer,
  ensureLocalLlmServer,
  stopLocalLlmServer,
};
