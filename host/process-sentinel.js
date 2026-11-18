'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SYNC_WAIT_INT32 =
  typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(4)) : null;

function sleepSyncMs(ms) {
  if (ms <= 0) return;
  if (SYNC_WAIT_INT32 && typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function') {
    try {
      Atomics.wait(SYNC_WAIT_INT32, 0, 0, ms);
      return;
    } catch (_err) {}
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Fallback short wait only when Atomics.wait is unavailable
  }
}

function isZombieProcStatContent(statRaw) {
  if (typeof statRaw !== 'string' || !statRaw) return false;
  const closeParen = statRaw.lastIndexOf(')');
  if (closeParen === -1) return false;
  const stateChar = statRaw.slice(closeParen + 1).trimStart()[0];
  return stateChar === 'Z' || stateChar === 'X' || stateChar === 'x';
}

// Pure liveness probe (`process.kill(pid, 0)` ONLY — NEVER sends SIGTERM/SIGKILL/taskkill!)
function isProcessAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
  if (process.platform === 'linux') {
    try {
      const statRaw = fs.readFileSync(`/proc/${num}/stat`, 'utf8');
      if (isZombieProcStatContent(statRaw)) return false;
    } catch (_err) {
      return false;
    }
  } else if (process.platform === 'darwin' || process.platform === 'freebsd') {
    try {
      const res = spawnSync('ps', ['-o', 'state=', '-p', String(num)], { encoding: 'utf8' });
      const stateStr = String(res.stdout || '').trim();
      if (!stateStr || stateStr.startsWith('Z')) return false;
    } catch (_err) {}
  }
  return true;
}

function waitForProcessExitSync(pid, timeoutMs = 1500) {
  if (!isProcessAlive(pid)) return true;
  const deadline = Date.now() + Math.max(20, timeoutMs);
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    sleepSyncMs(20);
  }
  return !isProcessAlive(pid);
}

async function waitForProcessExitAsync(pid, timeoutMs = 1500) {
  if (!isProcessAlive(pid)) return true;
  const deadline = Date.now() + Math.max(20, timeoutMs);
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return !isProcessAlive(pid);
}

function timingSafeTokenMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  if (!candidate || candidate.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch (_err) {
    return false;
  }
}

function writeFileAtomicSync(targetPath, content, options = null) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const mode = options && typeof options.mode === 'number' ? options.mode : undefined;
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    if (mode !== undefined) {
      fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode });
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(tmpPath, mode);
        } catch (_err) {}
      }
    } else {
      fs.writeFileSync(tmpPath, content, 'utf8');
    }
    fs.renameSync(tmpPath, targetPath);
    if (mode !== undefined && process.platform !== 'win32') {
      try {
        fs.chmodSync(targetPath, mode);
      } catch (_err) {}
    }
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_err) {}
    }
  }
}

function restoreDisplacedExclusiveLock(relPath, lockPath) {
  try {
    fs.linkSync(relPath, lockPath);
    return true;
  } catch (linkErr) {
    if (linkErr && linkErr.code === 'EEXIST') return true;
    try {
      const rawBytes = fs.readFileSync(relPath);
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, rawBytes);
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (wxErr) {
      return Boolean(wxErr && wxErr.code === 'EEXIST');
    }
  }
}

function acquireExclusiveFileLock(lockPath, staleMs = 15000) {
  const token = `${process.pid}:${Date.now()}:${crypto.randomBytes(6).toString('hex')}`;
  const tryOpenWx = () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, token, ts: Date.now(), startedAt: new Date().toISOString() }),
        'utf8'
      );
    } finally {
      fs.closeSync(fd);
    }
    return token;
  };

  try {
    return tryOpenWx();
  } catch (err) {
    if (!err || err.code !== 'EEXIST') return null;
  }

  let reclaimPath = null;
  try {
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    let staleRaw = '';
    let staleToken = null;
    let ownerPid = 0;
    try {
      staleRaw = fs.readFileSync(lockPath, 'utf8');
      const parsed = JSON.parse(staleRaw);
      ownerPid = Number((parsed && parsed.pid) || 0);
      staleToken = parsed && typeof parsed.token === 'string' ? parsed.token : null;
    } catch (_err) {}
    const ownerAlive = ownerPid > 0 && isProcessAlive(ownerPid);
    const isStale = (ownerPid > 0 && !ownerAlive) || (!ownerAlive && ageMs > staleMs) || ageMs > staleMs * 10;
    if (!isStale) return null;

    reclaimPath = `${lockPath}.reclaim.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockPath, reclaimPath);
    } catch (_err) {
      reclaimPath = null;
      return null;
    }

    let displacedNewLock = false;
    try {
      const movedRaw = fs.readFileSync(reclaimPath, 'utf8');
      let moved = null;
      try {
        moved = JSON.parse(movedRaw);
      } catch (_err) {}
      if (staleToken !== null) {
        if (!moved || moved.token !== staleToken) displacedNewLock = true;
      } else if (movedRaw !== staleRaw) {
        displacedNewLock = true;
      }
      if (!displacedNewLock && moved) {
        const movedPid = Number(moved.pid || 0);
        const movedStat = fs.statSync(reclaimPath);
        const movedAgeMs = Date.now() - movedStat.mtimeMs;
        const movedAlive = movedPid > 0 && isProcessAlive(movedPid);
        const stillStale = (movedPid > 0 && !movedAlive) || (!movedAlive && movedAgeMs > staleMs) || movedAgeMs > staleMs * 10;
        if (!stillStale) displacedNewLock = true;
      }
    } catch (_err) {
      displacedNewLock = true;
    }

    if (displacedNewLock) {
      restoreDisplacedExclusiveLock(reclaimPath, lockPath);
      try {
        fs.unlinkSync(reclaimPath);
      } catch (_err) {}
      reclaimPath = null;
      return null;
    }

    try {
      fs.unlinkSync(reclaimPath);
    } catch (_err) {}
    reclaimPath = null;
    return tryOpenWx();
  } catch (_err) {
    if (reclaimPath && fs.existsSync(reclaimPath)) {
      try {
        restoreDisplacedExclusiveLock(reclaimPath, lockPath);
        fs.unlinkSync(reclaimPath);
      } catch (_err2) {}
    }
    return null;
  }
}

function acquireExclusiveFileLockWithWait(lockPath, waitTimeoutMs = 2000, staleMs = 15000) {
  const immediate = acquireExclusiveFileLock(lockPath, staleMs);
  if (immediate || waitTimeoutMs <= 0) return immediate;
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    sleepSyncMs(20);
    const tok = acquireExclusiveFileLock(lockPath, staleMs);
    if (tok) return tok;
  }
  return null;
}

function releaseExclusiveFileLock(lockPath, token) {
  if (!lockPath || !token) return false;
  let relPath = null;
  try {
    if (!fs.existsSync(lockPath)) return false;
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!parsed || parsed.token !== token) return false;
    relPath = `${lockPath}.rel.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.renameSync(lockPath, relPath);
    let moved = null;
    try {
      moved = JSON.parse(fs.readFileSync(relPath, 'utf8'));
    } catch (_err) {}
    if (!moved || moved.token !== token) {
      restoreDisplacedExclusiveLock(relPath, lockPath);
      try {
        fs.unlinkSync(relPath);
      } catch (_err) {}
      return false;
    }
    try {
      fs.unlinkSync(relPath);
    } catch (_err) {}
    return true;
  } catch (_err) {
    if (relPath && fs.existsSync(relPath)) {
      try {
        const moved = JSON.parse(fs.readFileSync(relPath, 'utf8'));
        if (!moved || moved.token !== token) {
          restoreDisplacedExclusiveLock(relPath, lockPath);
        }
        fs.unlinkSync(relPath);
      } catch (_err2) {}
    }
    return false;
  }
}

function buildSentinelIpcEndpoint(prefix, instanceId) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\agy-ko-${prefix}-${instanceId}`;
  }
  const uidTag = typeof process.getuid === 'function' ? String(process.getuid()) : 'u';
  const sockDir = path.join(os.tmpdir(), `agy-ko-ipc-${uidTag}`);
  try {
    fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(sockDir, 0o700);
  } catch (_err) {}
  return path.join(sockDir, `${prefix}-${instanceId}.sock`);
}

function createSentinelCredentials(prefix = 'watch') {
  const instanceId = crypto.randomBytes(12).toString('hex');
  const authToken = crypto.randomBytes(24).toString('hex');
  const sentinelEndpoint = buildSentinelIpcEndpoint(prefix, instanceId);
  return { instanceId, authToken, sentinelEndpoint };
}

function sendSentinelIpcCommand(sentinelEndpoint, payloadObj, timeoutMs = 1500) {
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
      } catch (_err) {}
      resolve(val);
    };
    const timer = setTimeout(() => done(null), Math.max(120, timeoutMs));
    if (timer && typeof timer.unref === 'function') timer.unref();
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
        } catch (_err) {
          done(null);
        }
      });
      sock.on('error', () => done(null));
      sock.on('close', () => done(null));
    } catch (_err) {
      done(null);
    }
  });
}

function formatWatcherPidRecord(pid, sig, creds = null) {
  if (creds && creds.instanceId && creds.authToken && creds.sentinelEndpoint) {
    const endpointB64 = Buffer.from(creds.sentinelEndpoint, 'utf8').toString('base64url');
    return `${pid}:${sig}:${creds.instanceId}:${creds.authToken}:${endpointB64}`;
  }
  return `${pid}:${sig}`;
}

function readWatcherPidRecord(pidFilePath) {
  try {
    if (!pidFilePath || !fs.existsSync(pidFilePath)) {
      return { pid: null, sig: '', instanceId: '', authToken: '', sentinelEndpoint: '' };
    }
    const raw = fs.readFileSync(pidFilePath, 'utf8').trim();
    if (!raw) return { pid: null, sig: '', instanceId: '', authToken: '', sentinelEndpoint: '' };
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      return {
        pid: Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null,
        sig: String(parsed.sig || ''),
        instanceId: String(parsed.instanceId || ''),
        authToken: String(parsed.authToken || ''),
        sentinelEndpoint: String(parsed.sentinelEndpoint || ''),
      };
    }
    const parts = raw.split(':');
    const parsedPid = Number(parts[0]);
    const sig = parts[1] || '';
    const instanceId = parts[2] || '';
    const authToken = parts[3] || '';
    let sentinelEndpoint = '';
    if (parts[4]) {
      try {
        sentinelEndpoint = Buffer.from(parts[4], 'base64url').toString('utf8');
      } catch (_err) {
        sentinelEndpoint = '';
      }
    }
    return {
      pid: Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : null,
      sig,
      instanceId,
      authToken,
      sentinelEndpoint,
    };
  } catch (_err) {
    return { pid: null, sig: '', instanceId: '', authToken: '', sentinelEndpoint: '' };
  }
}

// v2.0.0 IPC Sentinel Server: accepts BOTH `op === 'shutdown'` AND `op === 'stop'` (replying `{ ok: true, stopped: true, ... }`)!
function createAuthenticatedSentinelServer({ creds, onShutdownRequest, getExtraStatus = null }) {
  if (!creds || !creds.sentinelEndpoint || !creds.authToken || !creds.instanceId) {
    throw new TypeError('Valid sentinel credentials are required');
  }
  if (process.platform !== 'win32' && fs.existsSync(creds.sentinelEndpoint)) {
    try {
      fs.unlinkSync(creds.sentinelEndpoint);
    } catch (_err) {}
  }

  const server = net.createServer((conn) => {
    let rawBuf = '';
    conn.setEncoding('utf8');
    conn.on('error', () => {});
    conn.on('data', (chunk) => {
      if (rawBuf.length + chunk.length > 4096) {
        conn.destroy();
        return;
      }
      rawBuf += chunk;
      const nlIdx = rawBuf.indexOf('\n');
      if (nlIdx === -1) return;
      const line = rawBuf.slice(0, nlIdx).trim();
      rawBuf = '';
      let msg = null;
      try {
        msg = JSON.parse(line);
      } catch (_err) {
        conn.destroy();
        return;
      }
      if (!msg || !timingSafeTokenMatch(msg.authToken, creds.authToken)) {
        try {
          conn.end(JSON.stringify({ ok: false, error: 'unauthorized' }) + '\n');
        } catch (_err) {}
        return;
      }
      // Rev6-F3: Accept BOTH `shutdown` and `stop`!
      if (msg.op === 'shutdown' || msg.op === 'stop') {
        let extra = {};
        try {
          if (typeof onShutdownRequest === 'function') {
            extra = onShutdownRequest(msg.op) || {};
          }
        } catch (_err) {}
        const replyPayload = {
          ok: true,
          stopped: true,
          instanceId: creds.instanceId,
          pid: process.pid,
          ...extra,
        };
        try {
          conn.end(JSON.stringify(replyPayload) + '\n');
        } catch (_err) {}
        return;
      }
      const statusExtra = typeof getExtraStatus === 'function' ? getExtraStatus() || {} : {};
      try {
        conn.end(
          JSON.stringify({
            ok: true,
            stopped: false,
            alive: true,
            instanceId: creds.instanceId,
            pid: process.pid,
            ...statusExtra,
          }) + '\n'
        );
      } catch (_err) {}
    });
  });

  server.on('error', () => {});
  server.listen(creds.sentinelEndpoint, () => {
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(creds.sentinelEndpoint, 0o600);
      } catch (_err) {}
    }
  });
  if (typeof server.unref === 'function') {
    server.unref();
  }

  const close = () => {
    try {
      server.close();
    } catch (_err) {}
    if (process.platform !== 'win32' && creds.sentinelEndpoint) {
      try {
        if (fs.existsSync(creds.sentinelEndpoint)) {
          fs.unlinkSync(creds.sentinelEndpoint);
        }
      } catch (_err) {}
    }
  };

  return { server, close };
}

// Rev6-F3: Watcher Shutdown Caller Contract:
// 1) Send `{ op: 'shutdown', authToken }` FIRST (v1.x watchers exit ONLY on `shutdown`; v2.0.0 exits on both).
// 2) If `reply?.stopped !== true` and `!waitForProcessExitSync(pid, 400)`, send `{ op: 'stop', authToken }` fallback!
// 3) Remove `ko_thought_watcher.pid` under `ko_thought_watcher.pid.lock` (triggering `hasWatcherOwnership()` self-exit).
async function stopWatcherSentinel({
  watcherPidPath,
  watcherLockPath,
  exitWaitTimeoutMs = 1500,
  ipcTimeoutMs = 1200,
} = {}) {
  const pidPath = watcherPidPath;
  const lockPath = watcherLockPath || (pidPath ? `${pidPath}.lock` : null);
  if (!pidPath) return { stopped: false, reason: 'no_pid_path' };

  const lockTok = lockPath ? acquireExclusiveFileLockWithWait(lockPath, 1500, 15000) : null;
  try {
    if (!fs.existsSync(pidPath)) {
      return { stopped: false, reason: 'no_pid_file' };
    }
    const rec = readWatcherPidRecord(pidPath);
    if (!rec.pid || !isProcessAlive(rec.pid)) {
      try {
        fs.unlinkSync(pidPath);
      } catch (_err) {}
      return { stopped: false, reason: 'already_exited' };
    }

    let exited = false;
    if (rec.sentinelEndpoint && rec.authToken && rec.instanceId) {
      const reply1 = await sendSentinelIpcCommand(
        rec.sentinelEndpoint,
        { op: 'shutdown', authToken: rec.authToken },
        ipcTimeoutMs
      );
      if (reply1 && reply1.ok === true && reply1.instanceId === rec.instanceId) {
        if (reply1.stopped === true) {
          exited = await waitForProcessExitAsync(rec.pid, exitWaitTimeoutMs);
        } else {
          exited = await waitForProcessExitAsync(rec.pid, 400);
          if (!exited) {
            await sendSentinelIpcCommand(
              rec.sentinelEndpoint,
              { op: 'stop', authToken: rec.authToken },
              ipcTimeoutMs
            );
            exited = await waitForProcessExitAsync(rec.pid, exitWaitTimeoutMs);
          }
        }
      }
    }

    // Revoke PID file ownership under lock so any live watcher immediately self-exits via `hasWatcherOwnership()`
    try {
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
      }
    } catch (_err) {}

    if (!exited && isProcessAlive(rec.pid)) {
      exited = await waitForProcessExitAsync(rec.pid, Math.min(600, exitWaitTimeoutMs));
    }
    return {
      stopped: exited,
      pid: rec.pid,
      reason: exited ? 'stopped_via_ipc' : 'ownership_revoked',
    };
  } finally {
    if (lockPath && lockTok) {
      releaseExclusiveFileLock(lockPath, lockTok);
    }
  }
}

module.exports = {
  sleepSyncMs,
  isZombieProcStatContent,
  isProcessAlive,
  waitForProcessExitSync,
  waitForProcessExitAsync,
  timingSafeTokenMatch,
  writeFileAtomicSync,
  acquireExclusiveFileLock,
  acquireExclusiveFileLockWithWait,
  releaseExclusiveFileLock,
  buildSentinelIpcEndpoint,
  createSentinelCredentials,
  sendSentinelIpcCommand,
  formatWatcherPidRecord,
  readWatcherPidRecord,
  createAuthenticatedSentinelServer,
  stopWatcherSentinel,
};
