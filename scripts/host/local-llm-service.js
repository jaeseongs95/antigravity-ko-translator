/**
 * Module: scripts/host/local-llm-service.js
 * Responsibility: Local LLM server process lifecycle management (env resolution, dynamic-origin HTTP health probe,
 * headless GPU startup via `windowsHide: true` / `CREATE_NO_WINDOW`, and cryptographic IPC sentinel supervision so
 * direct child OS handles prevent PID-reuse mis-kills and unowned external servers receive zero signals).
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
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

function normalizeExecutableImageName(binPath) {
  const raw = String(binPath || '').trim();
  if (!raw) return '';
  const base = path.basename(raw);
  if (!base) return '';
  if (process.platform === 'win32') {
    const lower = base.toLowerCase();
    return /\.[a-z0-9]+$/i.test(lower) ? lower : `${lower}.exe`;
  }
  return base;
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

function timingSafeTokenMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  if (!candidate || candidate.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

function buildLlmSentinelEndpoint(instanceId) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\agy-ko-llm-${instanceId}`;
  }
  const uidTag = typeof process.getuid === 'function' ? String(process.getuid()) : 'u';
  const sockDir = path.join(os.tmpdir(), `agy-ko-ipc-${uidTag}`);
  try {
    fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(sockDir, 0o700);
  } catch {}
  return path.join(sockDir, `llm-${instanceId}.sock`);
}

function sendLlmSentinelCommand(sentinelEndpoint, payloadObj, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!sentinelEndpoint || typeof sentinelEndpoint !== 'string') {
      resolve(null);
      return;
    }
    let settled = false;
    let sock = null;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (sock && !sock.destroyed) sock.destroy();
      } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => done(null), Math.max(150, timeoutMs));
    try {
      sock = net.createConnection(sentinelEndpoint);
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('connect', () => {
        sock.write(JSON.stringify(payloadObj) + '\n');
      });
      sock.on('data', (chunk) => {
        if (buf.length + chunk.length > 8192) {
          done(null);
          return;
        }
        buf += chunk;
        const nl = buf.indexOf('\n');
        if (nl === -1) return;
        try {
          done(JSON.parse(buf.slice(0, nl).trim()));
        } catch {
          done(null);
        }
      });
      sock.on('error', () => done(null));
      sock.on('close', () => done(null));
    } catch {
      done(null);
    }
  });
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

  if (options && typeof options.spawnFn === 'function') {
    try {
      const child = options.spawnFn(cmd.bin, cmd.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env },
      });
      if (child && typeof child.unref === 'function') {
        child.unref();
      }
      return { ...probe, ownedByPlugin: Boolean(child && child.pid), pid: child?.pid || null };
    } catch (err) {
      process.stderr.write(`[ko-thought-translator] ensureLocalLlmServer custom spawnFn error: ${err.message}\n`);
      return probe;
    }
  }

  const llmPidPath = resolveEffectiveLlmPidPath(options);
  let port = 11434;
  try {
    port = Number(new URL('/v1/models', LLM_BASE_URL).port) || 11434;
  } catch {}

  const instanceId = crypto.randomBytes(16).toString('hex');
  const authToken = crypto.randomBytes(32).toString('hex');
  const sentinelEndpoint = buildLlmSentinelEndpoint(instanceId);

  try {
    const sentinel = spawn(process.execPath, [__filename, '--llm-sentinel'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        AGY_KO_LLM_SENTINEL_CFG: JSON.stringify({
          bin: cmd.bin,
          args: cmd.args,
          port,
          llmPidPath,
          instanceId,
          authToken,
          sentinelEndpoint,
        }),
      },
    });
    if (sentinel && typeof sentinel.unref === 'function') {
      sentinel.unref();
    }

    const waitBudgetMs = options && options.fastHook ? 350 : 1600;
    const deadline = Date.now() + waitBudgetMs;
    let ownedChildPid = null;

    const tryReadOwnedChildPid = () => {
      try {
        if (llmPidPath && fs.existsSync(llmPidPath)) {
          const meta = JSON.parse(fs.readFileSync(llmPidPath, 'utf8'));
          if (meta && meta.instanceId === instanceId && Number.isInteger(meta.pid) && meta.pid > 0) {
            return meta.pid;
          }
        }
      } catch {}
      return null;
    };

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 40));
      ownedChildPid = ownedChildPid || tryReadOwnedChildPid();
      const postProbe = await probeLocalLlmServer(200, options);
      if (postProbe.reachable) {
        if (!ownedChildPid) {
          for (let i = 0; i < 6 && !ownedChildPid; i++) {
            await new Promise((r) => setTimeout(r, 25));
            ownedChildPid = tryReadOwnedChildPid();
          }
        }
        return { ...postProbe, ownedByPlugin: true, pid: ownedChildPid };
      }
      if (sentinel && sentinel.pid && !isProcessAlive(sentinel.pid) && !ownedChildPid) {
        break;
      }
    }

    ownedChildPid = ownedChildPid || tryReadOwnedChildPid();
    return { ...probe, ownedByPlugin: Boolean(ownedChildPid), pid: ownedChildPid };
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] ensureLocalLlmServer error: ${err.message}\n`);
  }
  return probe;
}

/**
 * Terminates ONLY the local LLM server process held as a direct child by our live cryptographic
 * `--llm-sentinel` supervisor (`ko_thought_llm.pid`). Never sends raw `taskkill` or `process.kill`
 * to an unauthenticated or recycled PID.
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

    const sentinelEndpoint = typeof record?.sentinelEndpoint === 'string' ? record.sentinelEndpoint : '';
    const authToken = typeof record?.authToken === 'string' ? record.authToken : '';
    const instanceId = typeof record?.instanceId === 'string' ? record.instanceId : '';

    if (!sentinelEndpoint || !authToken || !instanceId) {
      process.stderr.write(
        `[ko-thought-translator] refusing to signal PID ${targetPid}: missing cryptographic sentinel credentials\n`
      );
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'identity_mismatch' };
    }

    const reply = await sendLlmSentinelCommand(
      sentinelEndpoint,
      { op: 'stop', authToken },
      2800
    );

    if (!reply || reply.ok !== true || reply.instanceId !== instanceId) {
      const stillAlive = isProcessAlive(targetPid);
      if (stillAlive) {
        process.stderr.write(
          `[ko-thought-translator] refusing to signal PID ${targetPid}: sentinel unreachable or instance mismatch (PID likely recycled)\n`
        );
      }
      removeFileQuietly(llmPidPath);
      return {
        stoppedCount: 0,
        skippedReason: stillAlive ? 'identity_mismatch' : 'already_exited',
      };
    }

    const stoppedPid = Number.isInteger(reply.terminatedPid) ? reply.terminatedPid : targetPid;
    waitForProcessExitSync(stoppedPid, 800);
    removeFileQuietly(llmPidPath);
    return { stoppedCount: 1, terminatedPid: stoppedPid };
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] stopLocalLlmServer error: ${err.message}\n`);
    return { stoppedCount: 0, skippedReason: 'unexpected_error' };
  }
}

function runLlmSentinelSupervisor() {
  let cfg = null;
  try {
    cfg = JSON.parse(process.env.AGY_KO_LLM_SENTINEL_CFG || '{}');
  } catch {
    process.exit(1);
    return;
  }
  delete process.env.AGY_KO_LLM_SENTINEL_CFG;

  const { bin, args = [], port = 11434, llmPidPath, instanceId, authToken, sentinelEndpoint } = cfg || {};
  if (!bin || !llmPidPath || !instanceId || !authToken || !sentinelEndpoint) {
    process.exit(1);
    return;
  }

  let server = null;
  let child = null;
  let childExited = false;
  let shuttingDown = false;

  const removeOwnedPidFile = () => {
    try {
      if (llmPidPath && fs.existsSync(llmPidPath)) {
        const cur = JSON.parse(fs.readFileSync(llmPidPath, 'utf8'));
        if (cur && cur.instanceId === instanceId) {
          fs.unlinkSync(llmPidPath);
        }
      }
    } catch {}
  };

  const cleanupAndExit = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    removeOwnedPidFile();
    if (server) {
      try {
        server.close();
      } catch {}
      server = null;
    }
    if (process.platform !== 'win32' && sentinelEndpoint) {
      try {
        if (fs.existsSync(sentinelEndpoint)) fs.unlinkSync(sentinelEndpoint);
      } catch {}
    }
    process.exit(exitCode);
  };

  const terminateDirectChild = () => {
    if (childExited || !child || !Number.isInteger(child.pid) || child.pid <= 0) {
      return;
    }
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 2500,
      });
      waitForProcessExitSync(child.pid, 700);
    } else {
      try {
        child.kill('SIGTERM');
      } catch {}
      if (!waitForProcessExitSync(child.pid, 500) && !childExited) {
        try {
          child.kill('SIGKILL');
        } catch {}
        waitForProcessExitSync(child.pid, 400);
      }
    }
  };

  if (process.platform !== 'win32' && fs.existsSync(sentinelEndpoint)) {
    try {
      fs.unlinkSync(sentinelEndpoint);
    } catch {}
  }

  server = net.createServer((conn) => {
    let raw = '';
    conn.setEncoding('utf8');
    conn.on('error', () => {});
    conn.on('data', (chunk) => {
      if (raw.length + chunk.length > 4096) {
        conn.destroy();
        return;
      }
      raw += chunk;
      const nl = raw.indexOf('\n');
      if (nl === -1) return;
      const line = raw.slice(0, nl).trim();
      raw = '';
      let msg = null;
      try {
        msg = JSON.parse(line);
      } catch {
        conn.destroy();
        return;
      }
      if (!msg || !timingSafeTokenMatch(msg.authToken, authToken)) {
        try {
          conn.end(JSON.stringify({ ok: false, error: 'unauthorized' }) + '\n');
        } catch {}
        return;
      }
      if (msg.op === 'stop') {
        const stoppedPid = child?.pid || 0;
        terminateDirectChild();
        removeOwnedPidFile();
        try {
          conn.end(JSON.stringify({ ok: true, instanceId, terminatedPid: stoppedPid }) + '\n', () => {
            cleanupAndExit(0);
          });
        } catch {
          cleanupAndExit(0);
        }
        setTimeout(() => cleanupAndExit(0), 120).unref();
        return;
      }
      try {
        conn.end(JSON.stringify({ ok: true, alive: !childExited, instanceId, pid: child?.pid || 0 }) + '\n');
      } catch {}
    });
  });

  server.on('error', () => cleanupAndExit(1));
  server.listen(sentinelEndpoint, () => {
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(sentinelEndpoint, 0o600);
      } catch {}
    }

    try {
      // Spawn as a non-detached direct child so the OS kernel preserves our child process handle
      // and guarantees `child.pid` can NEVER be recycled while this sentinel supervisor is alive.
      child = spawn(bin, Array.isArray(args) ? args : [], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env },
      });
    } catch {
      cleanupAndExit(1);
      return;
    }

    child.once('error', () => {
      childExited = true;
      cleanupAndExit(1);
    });

    child.once('exit', () => {
      childExited = true;
      cleanupAndExit(0);
    });

    if (!child.pid || !Number.isInteger(child.pid) || child.pid <= 0) {
      cleanupAndExit(1);
      return;
    }

    const normalizedImage = normalizeExecutableImageName(bin);
    const fallbackToken =
      process.platform === 'win32'
        ? `win32-image:${normalizedImage}`
        : `child-pid:${child.pid}`;
    const identityToken = readProcessIdentityToken(child.pid) || fallbackToken;

    try {
      writeFileAtomicSync(
        llmPidPath,
        JSON.stringify(
          {
            schema: 'agy-ko-llm-sentinel-v2',
            pid: child.pid,
            sentinelPid: process.pid,
            port,
            bin,
            imageName: normalizedImage,
            identityToken,
            instanceId,
            sentinelEndpoint,
            authToken,
            spawnedAt: Date.now(),
          },
          null,
          2
        ) + '\n',
        { mode: 0o600 }
      );
    } catch {
      terminateDirectChild();
      cleanupAndExit(1);
    }
  });

  process.on('SIGTERM', () => {
    terminateDirectChild();
    cleanupAndExit(0);
  });
  process.on('SIGINT', () => {
    terminateDirectChild();
    cleanupAndExit(0);
  });
}

if (require.main === module && process.argv.includes('--llm-sentinel')) {
  runLlmSentinelSupervisor();
}

module.exports = {
  parseCommandArgs,
  extractListeningPidsFromNetstat,
  normalizeExecutableImageName,
  readProcessIdentityToken,
  readWindowsUserEnv,
  resolveLocalLlmCommand,
  probeLocalLlmServer,
  ensureLocalLlmServer,
  stopLocalLlmServer,
};
