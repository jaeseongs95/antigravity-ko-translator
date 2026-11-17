/**
 * Module: scripts/host/local-llm-service.js
 * Responsibility: Local LLM server process lifecycle management (env resolution, dynamic-origin HTTP health probe,
 * headless GPU startup via `windowsHide: true` / `CREATE_NO_WINDOW`, and identity-verified termination restricted
 * strictly to plugin-spawned child processes).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { LLM_BASE_URL, LLM_PID_PATH, DEVTOOLS_PORT_FILE } = require('./paths');
const { writeFileAtomicSync, isProcessAlive, waitForProcessExitSync } = require('./settings-storage');

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

function parseCsvColumns(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function readProcessIdentityToken(pid) {
  const targetPid = Number(pid);
  if (!Number.isInteger(targetPid) || targetPid <= 0) return null;

  if (process.platform === 'linux') {
    try {
      const statRaw = fs.readFileSync(`/proc/${targetPid}/stat`, 'utf8');
      const closeParen = statRaw.lastIndexOf(')');
      if (closeParen === -1) return null;
      const fields = statRaw.slice(closeParen + 1).trim().split(/\s+/);
      // Field 3 (state) is index 0; field 22 (starttime) is index 19
      const starttime = fields[19];
      return starttime ? `linux-starttime:${starttime}` : null;
    } catch {
      return null;
    }
  }

  if (process.platform === 'win32') {
    try {
      const res = spawnSync(
        'tasklist',
        ['/FI', `PID eq ${targetPid}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', windowsHide: true, timeout: 1500 }
      );
      if (res && res.status === 0 && res.stdout) {
        const lines = String(res.stdout)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('"'));
        for (const line of lines) {
          const cols = parseCsvColumns(line);
          if (cols.length >= 2 && Number(cols[1]) === targetPid && cols[0]) {
            return `win32-image:${cols[0].trim().toLowerCase()}`;
          }
        }
      }
    } catch (err) {
      process.stderr.write(`[ko-thought-translator] readProcessIdentityToken(${targetPid}) error: ${err.message}\n`);
    }
    return null;
  }

  try {
    const res = spawnSync('ps', ['-o', 'lstart=,comm=', '-p', String(targetPid)], {
      encoding: 'utf8',
      timeout: 1500,
    });
    const out = String(res?.stdout || '').trim();
    return out ? `posix-ps:${out}` : null;
  } catch {
    return null;
  }
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
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] resolveProbeOrigin discovery error: ${err.message}\n`);
  }

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
            } catch {
              models = [];
            }
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
    } catch (err) {
      done({ reachable: false, corsAllowed: false, probeOrigin, models: [], error: err.message });
    }
  });
}

function resolveEffectiveLlmPidPath(options = {}) {
  return (options && options.llmPidPath) || process.env.AGY_KO_LLM_PID_PATH || LLM_PID_PATH;
}

function removeFileQuietly(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      process.stderr.write(`[ko-thought-translator] failed to unlink ${filePath}: ${err.message}\n`);
    }
  }
}

async function ensureLocalLlmServer(pluginEnabled = true, options = {}) {
  if (!pluginEnabled) return { skipped: true };
  const probe = await probeLocalLlmServer(450, options);
  if (probe.reachable) {
    // External server is already running; never claim ownership or write ko_thought_llm.pid
    return { ...probe, ownedByPlugin: false };
  }
  const cmd = resolveLocalLlmCommand();
  if (!cmd) return probe;
  const spawnImpl = options && typeof options.spawnFn === 'function' ? options.spawnFn : spawn;
  const llmPidPath = resolveEffectiveLlmPidPath(options);
  try {
    const child = spawnImpl(cmd.bin, cmd.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env },
    });
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
    if (child && Number.isInteger(child.pid) && child.pid > 0) {
      let port = 11434;
      try {
        port = Number(new URL('/v1/models', LLM_BASE_URL).port) || 11434;
      } catch {}
      const fallbackToken =
        process.platform === 'win32'
          ? `win32-image:${path.basename(cmd.bin).toLowerCase()}`
          : null;
      const identityToken = readProcessIdentityToken(child.pid) || fallbackToken;
      if (identityToken) {
        writeFileAtomicSync(
          llmPidPath,
          JSON.stringify(
            {
              pid: child.pid,
              port,
              bin: cmd.bin,
              imageName: path.basename(cmd.bin).toLowerCase(),
              identityToken,
              spawnedAt: Date.now(),
            },
            null,
            2
          ) + '\n'
        );
      }

      if (!options || typeof options.spawnFn !== 'function') {
        const waitBudgetMs = options && options.fastHook ? 250 : 1200;
        const deadline = Date.now() + waitBudgetMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
          const postProbe = await probeLocalLlmServer(200, options);
          if (postProbe.reachable) {
            return { ...postProbe, ownedByPlugin: true, pid: child.pid };
          }
          if (!isProcessAlive(child.pid)) break;
        }
      }
      return { ...probe, ownedByPlugin: true, pid: child.pid };
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] ensureLocalLlmServer error: ${err.message}\n`);
  }
  return probe;
}

/**
 * Terminates ONLY the local LLM server process explicitly spawned and recorded by this plugin
 * (`ko_thought_llm.pid`) after verifying OS process liveness and identity token match.
 * Unowned external servers (e.g., user's standalone Ollama on :11434) are NEVER signaled.
 */
async function stopLocalLlmServer(_forceProcessScan = false, options = {}) {
  const llmPidPath = resolveEffectiveLlmPidPath(options);
  try {
    if (!llmPidPath || !fs.existsSync(llmPidPath)) {
      return { stoppedCount: 0, skippedReason: 'no_owned_pid_file' };
    }

    let record = null;
    try {
      record = JSON.parse(fs.readFileSync(llmPidPath, 'utf8'));
    } catch (parseErr) {
      process.stderr.write(`[ko-thought-translator] corrupt LLM PID file removed: ${parseErr.message}\n`);
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'corrupt_pid_file' };
    }

    const targetPid = Number(record?.pid);
    if (!Number.isInteger(targetPid) || targetPid <= 0 || targetPid === process.pid) {
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'invalid_pid_record' };
    }

    if (!isProcessAlive(targetPid)) {
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'already_exited' };
    }

    const expectedToken = typeof record.identityToken === 'string' ? record.identityToken : '';
    const currentToken = readProcessIdentityToken(targetPid);
    if (!expectedToken || !currentToken || currentToken !== expectedToken) {
      process.stderr.write(
        `[ko-thought-translator] refusing to signal PID ${targetPid}: identity mismatch (expected=${expectedToken}, actual=${currentToken})\n`
      );
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'identity_mismatch' };
    }

    if (process.platform === 'win32') {
      const killRes = spawnSync('taskkill', ['/F', '/T', '/PID', String(targetPid)], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 2500,
      });
      if (killRes && killRes.error) {
        process.stderr.write(`[ko-thought-translator] taskkill(${targetPid}) error: ${killRes.error.message}\n`);
      }
      waitForProcessExitSync(targetPid, 800);
    } else {
      try {
        process.kill(targetPid, 'SIGTERM');
      } catch (killErr) {
        if (killErr && killErr.code !== 'ESRCH') {
          process.stderr.write(`[ko-thought-translator] SIGTERM(${targetPid}) error: ${killErr.message}\n`);
          return { stoppedCount: 0, skippedReason: 'signal_error' };
        }
      }
      waitForProcessExitSync(targetPid, 800);
    }

    removeFileQuietly(llmPidPath);
    return { stoppedCount: 1, terminatedPid: targetPid };
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] stopLocalLlmServer error: ${err.message}\n`);
    return { stoppedCount: 0, skippedReason: 'unexpected_error' };
  }
}

module.exports = {
  parseCommandArgs,
  extractListeningPidsFromNetstat,
  readProcessIdentityToken,
  readWindowsUserEnv,
  resolveLocalLlmCommand,
  probeLocalLlmServer,
  ensureLocalLlmServer,
  stopLocalLlmServer,
};
