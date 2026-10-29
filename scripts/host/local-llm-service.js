/**
 * Module: scripts/host/local-llm-service.js
 * Responsibility: Local LLM server process lifecycle management (env resolution, HTTP health probe,
 * headless GPU startup, and port-based process tree termination on adapter switch).
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
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
  } catch {}
  return null;
}

function resolveLocalLlmCommand() {
  const bin = process.env.AGY_LOCAL_LLM_SERVER_BIN || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_BIN');
  if (!bin) return null;
  const rawArgs = process.env.AGY_LOCAL_LLM_SERVER_ARGS || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_ARGS') || 'serve';
  return {
    bin,
    args: rawArgs.split(/\s+/).filter(Boolean),
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
    if (process.platform === 'win32') {
      const vbsPath = path.join(os.tmpdir(), 'agy_start_local_llm_headless.vbs');
      const escapedBin = cmd.bin.replace(/"/g, '""');
      const escapedArgs = cmd.args.join(' ').replace(/"/g, '""');
      const vbsContent = [
        'Set sh = CreateObject("WScript.Shell")',
        `sh.Run """${escapedBin}"" ${escapedArgs}", 0, False`,
      ].join('\r\n');
      fs.writeFileSync(vbsPath, vbsContent, 'utf8');
      const psScript = [
        '$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly',
        '$si.ShowWindow = [uint16]0',
        '$envList = [System.Collections.Generic.List[string]]::new()',
        'foreach ($de in [Environment]::GetEnvironmentVariables("Machine").GetEnumerator()) { $envList.Add("$($de.Key)=$($de.Value)") }',
        'foreach ($de in [Environment]::GetEnvironmentVariables("User").GetEnumerator()) { $envList.Add("$($de.Key)=$($de.Value)") }',
        '$si.EnvironmentVariables = $envList.ToArray()',
        `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'wscript.exe //B //NoLogo "${vbsPath.replace(/'/g, "''")}"'; ProcessStartupInformation = $si } | Out-Null`,
      ].join('; ');
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      const child = spawn(cmd.bin, cmd.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env },
      });
      child.unref();
    }
  } catch {}
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
      const pids = new Set();
      if (res.stdout) {
        const lines = res.stdout.split(/\r?\n/);
        for (const line of lines) {
          if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
            const parts = line.trim().split(/\s+/);
            const pid = Number(parts[parts.length - 1]);
            if (pid > 0 && pid !== process.pid) {
              pids.add(pid);
            }
          }
        }
      }
      for (const pid of pids) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
        stoppedCount++;
      }
      const cmd = resolveLocalLlmCommand();
      if (cmd && cmd.bin) {
        const exeName = path.basename(cmd.bin);
        if (exeName && /\.exe$/i.test(exeName)) {
          spawnSync('taskkill', ['/F', '/T', '/IM', exeName], {
            stdio: 'ignore',
            windowsHide: true,
          });
        }
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
  } catch {}
  return { stoppedCount };
}

module.exports = {
  readWindowsUserEnv,
  resolveLocalLlmCommand,
  probeLocalLlmServer,
  ensureLocalLlmServer,
  stopLocalLlmServer,
};
