/**
 * Module: scripts/host/local-llm-service.js
 * Responsibility: Local LLM server process lifecycle management (env resolution, HTTP health probe,
 * headless GPU startup via `windowsHide: true` / `CREATE_NO_WINDOW`, and port-based process tree termination).
 */

const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { LLM_BASE_URL } = require('./paths');

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

function probeLocalLlmServer(timeoutMs = 500) {
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
          headers: { Origin: 'https://127.0.0.1:58033' },
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
            done({
              reachable: true,
              statusCode: res.statusCode,
              corsAllowed: corsOrigin === '*' || corsOrigin.includes('127.0.0.1'),
              corsOrigin,
              models,
            });
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        done({ reachable: false, corsAllowed: false, models: [] });
      });
      req.on('error', () => done({ reachable: false, corsAllowed: false, models: [] }));
      req.end();
    } catch {
      done({ reachable: false, corsAllowed: false, models: [] });
    }
  });
}

async function ensureLocalLlmServer(pluginEnabled = true) {
  if (!pluginEnabled) return { skipped: true };
  const probe = await probeLocalLlmServer(450);
  if (probe.reachable && probe.corsAllowed) {
    return probe;
  }
  const cmd = resolveLocalLlmCommand();
  if (!cmd) return probe;
  try {
    const child = spawn(cmd.bin, cmd.args, {
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
      const res = spawnSync('lsof', ['-ti', `:${port}`], {
        encoding: 'utf8',
      });
      if (res.stdout) {
        const pids = res.stdout
          .split(/\r?\n/)
          .map((s) => Number(s.trim()))
          .filter((n) => n > 0 && n !== process.pid);
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGTERM');
            stoppedCount++;
          } catch {}
        }
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
