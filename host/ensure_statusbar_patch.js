#!/usr/bin/env node
'use strict';

/**
 * Antigravity Statusbar & UI Auto-Sync Coordinator (V6 R1)
 * Self-contained standalone Node.js module (built-in modules only: fs, os, path, crypto, http, vm, child_process).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const vm = require('vm');
const { spawn, spawnSync } = require('child_process');

function resolvePaths(env = process.env) {
  const homeDir = env.USERPROFILE || env.HOME || os.homedir();
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const appData = env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

  const asarPath = env.AGY_KO_ASAR_PATH || path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar');
  const agyDir = env.AGY_KO_AGY_DIR || path.join(homeDir, '.gemini', 'antigravity');
  const autoinjectPath = env.AGY_KO_AUTOINJECT_PATH || path.join(agyDir, 'statusbar_autoinject.js');
  const statusbarAutoinjectLockPath = path.join(agyDir, 'statusbar_autoinject.lock');
  const lockPath = path.join(agyDir, 'statusbar_patch.lock');
  const appStorageLockPath = path.join(agyDir, 'app_storage_sync.lock');
  const statusPath = path.join(agyDir, 'statusbar_patch_status.json');
  const devtoolsPortFile = env.AGY_KO_DEVTOOLS_PORT_FILE || path.join(appData, 'Antigravity', 'DevToolsActivePort');
  const appStoragePath = env.AGY_KO_APP_STORAGE_PATH || path.join(appData, 'Antigravity', 'app_storage.json');

  return {
    HOME_DIR: homeDir,
    LOCAL_APPDATA: localAppData,
    APPDATA: appData,
    ASAR_PATH: asarPath,
    AGY_DIR: agyDir,
    AUTOINJECT_PATH: autoinjectPath,
    STATUSBAR_AUTOINJECT_LOCK_PATH: statusbarAutoinjectLockPath,
    LOCK_PATH: lockPath,
    APP_STORAGE_LOCK_PATH: appStorageLockPath,
    STATUS_PATH: statusPath,
    DEVTOOLS_PORT_FILE: devtoolsPortFile,
    APP_STORAGE_PATH: appStoragePath,
  };
}

const DEFAULT_PATHS = resolvePaths(process.env);
const ASAR_PATH = DEFAULT_PATHS.ASAR_PATH;
const AGY_DIR = DEFAULT_PATHS.AGY_DIR;
const AUTOINJECT_PATH = DEFAULT_PATHS.AUTOINJECT_PATH;
const STATUSBAR_AUTOINJECT_LOCK_PATH = DEFAULT_PATHS.STATUSBAR_AUTOINJECT_LOCK_PATH;
const LOCK_PATH = DEFAULT_PATHS.LOCK_PATH;
const APP_STORAGE_LOCK_PATH = DEFAULT_PATHS.APP_STORAGE_LOCK_PATH;
const STATUS_PATH = DEFAULT_PATHS.STATUS_PATH;
const DEVTOOLS_PORT_FILE = DEFAULT_PATHS.DEVTOOLS_PORT_FILE;
const APP_STORAGE_PATH = DEFAULT_PATHS.APP_STORAGE_PATH;

const PATCH_MARKER = 'AGY_STATUSBAR_AUTOINJECT_V6';
const PATCHER_CAPABILITY_REVISION = 'AGY_STATUSBAR_PATCHER_V6_R1';
const LEGACY_MARKERS = Object.freeze([
  'statusbar_autoinject.js',
  'AGY_STATUSBAR_AUTOINJECT_V2',
  'AGY_STATUSBAR_AUTOINJECT_V3',
  'AGY_STATUSBAR_AUTOINJECT_V4',
  'AGY_STATUSBAR_AUTOINJECT_V5',
]);
const EARLIER_UNSUPPORTED_MARKERS = Object.freeze([
  'AGY_STATUSBAR_AUTOINJECT_V2',
  'AGY_STATUSBAR_AUTOINJECT_V3',
  'AGY_STATUSBAR_AUTOINJECT_V4',
]);

const STORAGE_CODE_KEY = 'agy-statusbar-code';
const LOCK_STALE_MS = 60000;
const SHORT_LOCK_STALE_MS = 15000;
const BLOCK_SIZE = 4 * 1024 * 1024;
const MAX_WS_BUFFER_BYTES = 16 * 1024 * 1024;

const ALLOWED_PAGE_URL_REGEX =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|(?:[a-z0-9-]+\.)*antigravity\.google\.com)(?::\d+)?(?:\/|$)/i;

const UTILS_ANCHOR_TARGET = '    void win.loadURL(url);';
const UTILS_ANCHOR_REPLACEMENT =
  '    // AGY_STATUSBAR_AUTOINJECT_V6\n' +
  '    const _injectAgyStatusBar = () => {\n' +
  '        try {\n' +
  "            if (win.isDestroyed() || win.webContents.isDestroyed() || !/^https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|(?:[a-z0-9-]+\\.)*antigravity\\.google\\.com)(?::\\d+)?(?:\\/|$)/i.test(win.webContents.getURL())) return;\n" +
  "            const _p = require('path').join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');\n" +
  "            if (require('fs').existsSync(_p)) void win.webContents.executeJavaScript(require('fs').readFileSync(_p, 'utf8')).catch(() => {});\n" +
  '        } catch (_e) {}\n' +
  '    };\n' +
  "    win.webContents.on('dom-ready', _injectAgyStatusBar);\n" +
  "    win.webContents.on('did-finish-load', _injectAgyStatusBar);\n" +
  '    void win.loadURL(url);';

const MAIN_ANCHOR_TARGET = "electron_1.app.on('web-contents-created', (_event, contents) => {";
const MAIN_ANCHOR_REPLACEMENT =
  "electron_1.app.on('web-contents-created', (_event, contents) => {\n" +
  '    // AGY_STATUSBAR_AUTOINJECT_V6\n' +
  "    if (contents.getType() === 'window' && !(typeof scriptJail_1 !== 'undefined' && scriptJail_1.isScriptJailSession && scriptJail_1.isScriptJailSession(contents.session))) {\n" +
  '        const _injectAgyMain = () => {\n' +
  '            try {\n' +
  "                if (contents.isDestroyed() || !/^https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|(?:[a-z0-9-]+\\.)*antigravity\\.google\\.com)(?::\\d+)?(?:\\/|$)/i.test(contents.getURL())) return;\n" +
  "                const _p = require('path').join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');\n" +
  "                if (require('fs').existsSync(_p)) void contents.executeJavaScript(require('fs').readFileSync(_p, 'utf8')).catch(() => {});\n" +
  '            } catch (_e) {}\n' +
  '        };\n' +
  "        contents.on('dom-ready', _injectAgyMain);\n" +
  "        contents.on('did-finish-load', _injectAgyMain);\n" +
  '    }';

const PRELOAD_ANCHOR_TARGET = "electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);";
const PRELOAD_ANCHOR_REPLACEMENT =
  "electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);\n" +
  '// AGY_STATUSBAR_AUTOINJECT_V6\n' +
  "if (/^https?:$/i.test(globalThis.location?.protocol || '') && /^(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|(?:[a-z0-9-]+\\.)*antigravity\\.google\\.com)$/i.test(globalThis.location?.hostname || '')) {\n" +
  "    electron_1.ipcRenderer.invoke('storage:get-items').then((r) => {\n" +
  "        if (r && r['agy-statusbar-code']) {\n" +
  "            void electron_1.webFrame.executeJavaScript(r['agy-statusbar-code']).catch(() => {});\n" +
  '        }\n' +
  '    }).catch(() => {});\n' +
  '}';

// Exact V5 blocks from v1.2.39 for Case C (`V5 -> V6` upgrade without `.orig`)
const LEGACY_UTILS_V5_BLOCK =
  '    // AGY_STATUSBAR_AUTOINJECT_V5\n' +
  '    const _injectAgyStatusBar = () => {\n' +
  '        try {\n' +
  "            const _fs = require('fs');\n" +
  "            const _path = require('path');\n" +
  "            const _p = _path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');\n" +
  '            if (_fs.existsSync(_p) && !win.isDestroyed() && !win.webContents.isDestroyed()) {\n' +
  "                void win.webContents.executeJavaScript(_fs.readFileSync(_p, 'utf8')).catch(() => {});\n" +
  '            }\n' +
  '        } catch (_e) {}\n' +
  '    };\n' +
  "    win.webContents.on('dom-ready', _injectAgyStatusBar);\n" +
  "    win.webContents.on('did-finish-load', _injectAgyStatusBar);\n" +
  '    void win.loadURL(url);';

const LEGACY_MAIN_V5_BLOCK =
  "electron_1.app.on('web-contents-created', (_event, contents) => {\n" +
  '    // AGY_STATUSBAR_AUTOINJECT_V5\n' +
  "    if (contents.getType() === 'window') {\n" +
  '        const _injectAgyMain = () => {\n' +
  '            try {\n' +
  "                const _fs = require('fs');\n" +
  "                const _path = require('path');\n" +
  "                const _p = _path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');\n" +
  '                if (_fs.existsSync(_p) && !contents.isDestroyed()) {\n' +
  "                    void contents.executeJavaScript(_fs.readFileSync(_p, 'utf8')).catch(() => {});\n" +
  '                }\n' +
  '            } catch (_e) {}\n' +
  '        };\n' +
  "        contents.on('dom-ready', _injectAgyMain);\n" +
  "        contents.on('did-finish-load', _injectAgyMain);\n" +
  '    }';

const LEGACY_PRELOAD_V5_BLOCK =
  "electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);\n" +
  '// AGY_STATUSBAR_AUTOINJECT_V5\n' +
  "electron_1.ipcRenderer.invoke('storage:get-items').then((r) => {\n" +
  "    if (r && r['agy-statusbar-code']) {\n" +
  "        void electron_1.webFrame.executeJavaScript(r['agy-statusbar-code']).catch(() => {});\n" +
  '    }\n' +
  '}).catch(() => {});';

const FALLBACK_DID_FINISH_LOAD_TARGET = 'this.mainWindow.webContents.on("did-finish-load", () => {});';
const FALLBACK_DID_FINISH_LOAD_REPLACEMENT =
  `// ${PATCH_MARKER}\n` +
  'this.mainWindow.webContents.on("did-finish-load", () => { void 0; });';

function sha256Hex(bufferOrString) {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
}

function writeFileAtomicSync(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, targetPath);
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_err) {}
    }
  }
}

// Atomic binary writer with fsync + SHA-256 readback + fs.renameSync ONLY (ZERO copyFileSync fallback!)
function writeBinaryVerifiedAtomicSync(targetPath, expectedBuf) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const expectedHash = sha256Hex(expectedBuf);
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(fd, expectedBuf);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const readBack = fs.readFileSync(tmpPath);
    if (readBack.length !== expectedBuf.length || sha256Hex(readBack) !== expectedHash) {
      throw new Error('Staging buffer readback SHA-256 mismatch');
    }
    fs.renameSync(tmpPath, targetPath);
    return expectedHash;
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_err) {}
    }
  }
}

// Rev5-F4 #1: Fast `<0.1ms` write-capability probe BEFORE reading ASAR or staging `.tmp`!
function probeAsarReplaceableFast(asarPath = resolvePaths(process.env).ASAR_PATH) {
  try {
    if (!asarPath || !fs.existsSync(asarPath)) {
      return { replaceable: false, code: 'ENOENT' };
    }
    const fd = fs.openSync(asarPath, 'r+');
    fs.closeSync(fd);
    return { replaceable: true, code: null };
  } catch (err) {
    return { replaceable: false, code: (err && err.code) || 'LOCKED' };
  }
}

function computeIntegrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(sha256Hex(buf.subarray(i, Math.min(i + BLOCK_SIZE, buf.length))));
  }
  if (blocks.length === 0) {
    blocks.push(sha256Hex(Buffer.alloc(0)));
  }
  return {
    algorithm: 'SHA256',
    hash: sha256Hex(buf),
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

const REGEX_KEYWORDS = new Set([
  'return', 'throw', 'case', 'delete', 'void', 'typeof',
  'instanceof', 'in', 'of', 'new', 'yield', 'await', 'else', 'do',
]);

function countTrailingBackslashes(str) {
  let count = 0;
  for (let i = str.length - 1; i >= 0 && str[i] === '\\'; i--) {
    count += 1;
  }
  return count;
}

function stripPureCommentLinesLexical(lines) {
  const out = [];
  const stack = [
    { mode: 'CODE', braceDepth: 0, regexAllowed: true, prevWasDot: false, lastControlKw: false, parenStack: [] },
  ];
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;

  for (const line of lines) {
    const startsInTemplate = stack[stack.length - 1].mode === 'TEMPLATE';
    const startsInString = inSingle || inDouble;
    const startsInBlockComment = inBlockComment;
    const trimmed = line.trim();

    if (!startsInTemplate && !startsInString && !startsInBlockComment && trimmed.includes(PATCH_MARKER)) {
      out.push(line);
      continue;
    }

    let i = 0;
    let inRegex = false;
    let inRegexCharClass = false;
    let hasCodeTokenOnLine = false;

    while (i < line.length) {
      const ch = line[i];
      const next = line[i + 1] || '';
      const top = stack[stack.length - 1];

      if (top.mode === 'TEMPLATE') {
        hasCodeTokenOnLine = true;
        if (ch === '\\') { i += 2; continue; }
        if (ch === '`') {
          stack.pop();
          const outer = stack[stack.length - 1];
          outer.regexAllowed = false;
          outer.prevWasDot = false;
          outer.lastControlKw = false;
          i += 1;
          continue;
        }
        if (ch === '$' && next === '{') {
          stack.push({ mode: 'TEMPLATE_EXPR', braceDepth: 1, regexAllowed: true, prevWasDot: false, lastControlKw: false, parenStack: [] });
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }

      if (inSingle) {
        hasCodeTokenOnLine = true;
        if (ch === '\\') { i += 2; continue; }
        if (ch === "'") {
          inSingle = false;
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
        }
        i += 1;
        continue;
      }

      if (inDouble) {
        hasCodeTokenOnLine = true;
        if (ch === '\\') { i += 2; continue; }
        if (ch === '"') {
          inDouble = false;
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
        }
        i += 1;
        continue;
      }

      if (inRegex) {
        hasCodeTokenOnLine = true;
        if (ch === '\\') { i += 2; continue; }
        if (inRegexCharClass) {
          if (ch === ']') inRegexCharClass = false;
          i += 1;
          continue;
        }
        if (ch === '[') { inRegexCharClass = true; i += 1; continue; }
        if (ch === '/') {
          inRegex = false;
          i += 1;
          while (i < line.length && /[A-Za-z]/.test(line[i])) i += 1;
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
          continue;
        }
        i += 1;
        continue;
      }

      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
        i += 1;
        continue;
      }
      if (ch === '/' && next === '/') {
        break;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }

      hasCodeTokenOnLine = true;
      if (ch === '/' && top.regexAllowed) {
        inRegex = true;
        inRegexCharClass = false;
        i += 1;
        continue;
      }
      if (ch === "'") { inSingle = true; i += 1; continue; }
      if (ch === '"') { inDouble = true; i += 1; continue; }
      if (ch === '`') { stack.push({ mode: 'TEMPLATE' }); i += 1; continue; }

      if (/[A-Za-z_$]/.test(ch)) {
        let end = i + 1;
        while (end < line.length && /[A-Za-z0-9_$]/.test(line[end])) end += 1;
        const word = line.slice(i, end);
        const wasDot = top.prevWasDot;
        top.regexAllowed = !wasDot && REGEX_KEYWORDS.has(word);
        top.lastControlKw = !wasDot && (word === 'if' || word === 'while' || word === 'for' || word === 'with');
        top.prevWasDot = false;
        i = end;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next))) {
        let end = i + 1;
        while (end < line.length && /[0-9A-Za-z_.]/.test(line[end])) end += 1;
        top.regexAllowed = false;
        top.prevWasDot = false;
        top.lastControlKw = false;
        i = end;
        continue;
      }
      if (ch === '(') {
        top.parenStack.push(top.lastControlKw);
        top.regexAllowed = true;
        top.prevWasDot = false;
        top.lastControlKw = false;
        i += 1;
        continue;
      }
      if (ch === ')') {
        top.regexAllowed = Boolean(top.parenStack.pop());
        top.prevWasDot = false;
        top.lastControlKw = false;
        i += 1;
        continue;
      }
      if (ch === '[') { top.regexAllowed = true; top.prevWasDot = false; top.lastControlKw = false; i += 1; continue; }
      if (ch === ']') { top.regexAllowed = false; top.prevWasDot = false; top.lastControlKw = false; i += 1; continue; }
      if (ch === '{') {
        if (top.mode === 'TEMPLATE_EXPR') top.braceDepth += 1;
        top.regexAllowed = true;
        top.prevWasDot = false;
        top.lastControlKw = false;
        i += 1;
        continue;
      }
      if (ch === '}') {
        if (top.mode === 'TEMPLATE_EXPR') {
          top.braceDepth -= 1;
          if (top.braceDepth === 0) {
            stack.pop();
            i += 1;
            continue;
          }
        }
        top.regexAllowed = true;
        top.prevWasDot = false;
        top.lastControlKw = false;
        i += 1;
        continue;
      }
      if ((ch === '+' && next === '+') || (ch === '-' && next === '-')) {
        top.regexAllowed = false;
        top.prevWasDot = false;
        top.lastControlKw = false;
        i += 2;
        continue;
      }
      if (ch === '.' && next === '.' && line[i + 2] === '.') {
        top.regexAllowed = true;
        top.prevWasDot = false;
        top.lastControlKw = false;
        i += 3;
        continue;
      }
      if (ch === '.') {
        top.regexAllowed = false;
        top.prevWasDot = true;
        top.lastControlKw = false;
        i += 1;
        continue;
      }
      top.regexAllowed = true;
      top.prevWasDot = false;
      top.lastControlKw = false;
      i += 1;
    }

    if (inSingle && countTrailingBackslashes(line) % 2 === 0) inSingle = false;
    if (inDouble && countTrailingBackslashes(line) % 2 === 0) inDouble = false;

    if (startsInTemplate || startsInString) {
      out.push(line);
      continue;
    }
    if (!hasCodeTokenOnLine && (startsInBlockComment || trimmed.startsWith('//') || trimmed.startsWith('/*'))) {
      continue;
    }
    out.push(line);
  }
  return out;
}

function transformExactSize(origBuf, anchorTarget, anchorReplacement) {
  const origSize = origBuf.length;
  const origStr = origBuf.toString('utf8');
  const hasCrlf = origStr.includes('\r\n');
  let normalized = origStr.replace(/\r\n/g, '\n');
  normalized = normalized.replace(/\/\/[ ]*\n$/, '');

  let effTarget = anchorTarget;
  let effReplacement = anchorReplacement;
  if (!effTarget) {
    if (normalized.includes(MAIN_ANCHOR_TARGET)) {
      effTarget = MAIN_ANCHOR_TARGET;
      effReplacement = MAIN_ANCHOR_REPLACEMENT;
    } else if (normalized.includes(UTILS_ANCHOR_TARGET)) {
      effTarget = UTILS_ANCHOR_TARGET;
      effReplacement = UTILS_ANCHOR_REPLACEMENT;
    } else {
      effTarget = FALLBACK_DID_FINISH_LOAD_TARGET;
      effReplacement = FALLBACK_DID_FINISH_LOAD_REPLACEMENT;
    }
  }

  const occ = normalized.split(effTarget).length - 1;
  if (occ !== 1) {
    throw new Error(`Anchor occurrences=${occ}`);
  }

  const modified = normalized.replace(effTarget, () => effReplacement);
  const strippedLines = stripPureCommentLinesLexical(modified.split('\n'));

  let candidate = strippedLines.join(hasCrlf ? '\r\n' : '\n');
  const candBytes = Buffer.byteLength(candidate, 'utf8');
  if (candBytes > origSize) {
    throw new Error(`Patched content exceeds original byte size: ${candBytes} > ${origSize}`);
  }

  const diff = origSize - candBytes;
  if (diff > 0) {
    if (diff >= 3) {
      candidate += '//' + ' '.repeat(diff - 3) + '\n';
    } else {
      candidate += ' '.repeat(diff);
    }
  }

  const outBuf = Buffer.from(candidate, 'utf8');
  if (outBuf.length !== origSize) {
    throw new Error(`Exact size mismatch: ${outBuf.length} !== ${origSize}`);
  }

  new vm.Script(outBuf.toString('utf8'));
  return outBuf;
}

function isAsarPatchedFast(asarPath = resolvePaths(process.env).ASAR_PATH) {
  let fd = null;
  try {
    // Rev5-F4 #1: Missing ASAR returns `false` (not `true`)!
    if (!asarPath || !fs.existsSync(asarPath)) return false;
    fd = fs.openSync(asarPath, 'r');
    const prefixBuf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, prefixBuf, 0, 16, 0);
    if (bytesRead < 16) return false;

    const u4 = prefixBuf.readUInt32LE(4);
    const strSize = prefixBuf.readUInt32LE(12);
    if (strSize <= 0 || strSize > 10 * 1024 * 1024) return false;

    const headerBuf = Buffer.alloc(strSize);
    fs.readSync(fd, headerBuf, 0, strSize, 16);
    const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));
    const dataOffset = 8 + u4;

    const distFiles = header && header.files && header.files.dist && header.files.dist.files;
    if (!distFiles) return false;

    const utilsNode = distFiles['utils.js'];
    const mainNode = distFiles['main.js'];
    const preloadNode = distFiles['preload.js'];
    if (!utilsNode || !mainNode || !preloadNode) return false;

    const utilsBuf = Buffer.alloc(utilsNode.size);
    fs.readSync(fd, utilsBuf, 0, utilsNode.size, dataOffset + Number(utilsNode.offset));

    const mainBuf = Buffer.alloc(mainNode.size);
    fs.readSync(fd, mainBuf, 0, mainNode.size, dataOffset + Number(mainNode.offset));

    const preloadBuf = Buffer.alloc(preloadNode.size);
    fs.readSync(fd, preloadBuf, 0, preloadNode.size, dataOffset + Number(preloadNode.offset));

    const utilsStr = utilsBuf.toString('utf8');
    const mainStr = mainBuf.toString('utf8');
    const preloadStr = preloadBuf.toString('utf8');

    return (
      utilsStr.includes(PATCH_MARKER) &&
      mainStr.includes(PATCH_MARKER) &&
      preloadStr.startsWith('"use strict";') &&
      preloadStr.includes(PATCH_MARKER)
    );
  } catch (_err) {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_err) {}
    }
  }
}

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
      const closeParen = statRaw.lastIndexOf(')');
      if (closeParen !== -1) {
        const stateChar = statRaw.slice(closeParen + 1).trimStart()[0];
        if (stateChar === 'Z' || stateChar === 'X' || stateChar === 'x') return false;
      }
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

function writeLockPayload(lockPath, token) {
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
}

function restoreDisplacedLockFile(relTmp, lockPath) {
  try {
    fs.linkSync(relTmp, lockPath);
    return true;
  } catch (linkErr) {
    if (linkErr && linkErr.code === 'EEXIST') return true;
    try {
      const rawBuf = fs.readFileSync(relTmp);
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, rawBuf);
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (wxErr) {
      return Boolean(wxErr && wxErr.code === 'EEXIST');
    }
  }
}

function acquireFileLock(lockPath, token, staleMs = LOCK_STALE_MS) {
  let staleTmp = null;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
      writeLockPayload(lockPath, token);
      return true;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') return false;
    }

    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    let staleRaw = '';
    let staleToken = null;
    let ownerPid = 0;
    try {
      staleRaw = fs.readFileSync(lockPath, 'utf8');
      const lockInfo = JSON.parse(staleRaw);
      ownerPid = Number((lockInfo && lockInfo.pid) || 0);
      staleToken = lockInfo && typeof lockInfo.token === 'string' ? lockInfo.token : null;
    } catch (_err) {}
    const ownerAlive = ownerPid > 0 && isProcessAlive(ownerPid);
    const isStale =
      (ownerPid > 0 && !ownerAlive) ||
      (!ownerAlive && ageMs > staleMs) ||
      ageMs > staleMs * 10;
    if (!isStale) return false;

    staleTmp = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockPath, staleTmp);
    } catch (_err) {
      staleTmp = null;
      return false;
    }

    let displacedNewLock = false;
    try {
      const movedRaw = fs.readFileSync(staleTmp, 'utf8');
      let movedInfo = null;
      try {
        movedInfo = JSON.parse(movedRaw);
      } catch (_err) {}
      if (staleToken !== null) {
        if (!movedInfo || movedInfo.token !== staleToken) displacedNewLock = true;
      } else if (movedRaw !== staleRaw) {
        displacedNewLock = true;
      }
      if (!displacedNewLock && movedInfo) {
        const movedPid = Number(movedInfo.pid || 0);
        const movedStat = fs.statSync(staleTmp);
        const movedAgeMs = Date.now() - movedStat.mtimeMs;
        const movedAlive = movedPid > 0 && isProcessAlive(movedPid);
        const stillStale =
          (movedPid > 0 && !movedAlive) ||
          (!movedAlive && movedAgeMs > staleMs) ||
          movedAgeMs > staleMs * 10;
        if (!stillStale) displacedNewLock = true;
      }
    } catch (_err) {
      displacedNewLock = true;
    }

    if (displacedNewLock) {
      restoreDisplacedLockFile(staleTmp, lockPath);
      try {
        fs.unlinkSync(staleTmp);
      } catch (_err) {}
      staleTmp = null;
      return false;
    }

    try {
      fs.unlinkSync(staleTmp);
    } catch (_err) {}
    staleTmp = null;
    writeLockPayload(lockPath, token);
    return true;
  } catch (_err) {
    if (staleTmp && fs.existsSync(staleTmp)) {
      try {
        restoreDisplacedLockFile(staleTmp, lockPath);
        fs.unlinkSync(staleTmp);
      } catch (_err2) {}
    }
    return false;
  }
}

function releaseFileLock(lockPath, token) {
  if (!lockPath || !token) return false;
  let relTmp = null;
  try {
    if (!fs.existsSync(lockPath)) return false;
    const raw = fs.readFileSync(lockPath, 'utf8');
    const lockInfo = JSON.parse(raw);
    if (!lockInfo || lockInfo.token !== token) return false;
    relTmp = `${lockPath}.rel.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    fs.renameSync(lockPath, relTmp);
    let movedInfo = null;
    try {
      movedInfo = JSON.parse(fs.readFileSync(relTmp, 'utf8'));
    } catch (_err) {}
    if (!movedInfo || movedInfo.token !== token) {
      restoreDisplacedLockFile(relTmp, lockPath);
      try {
        fs.unlinkSync(relTmp);
      } catch (_err) {}
      return false;
    }
    try {
      fs.unlinkSync(relTmp);
    } catch (_err) {}
    return true;
  } catch (_err) {
    if (relTmp && fs.existsSync(relTmp)) {
      try {
        const movedInfo = JSON.parse(fs.readFileSync(relTmp, 'utf8'));
        if (!movedInfo || movedInfo.token !== token) {
          restoreDisplacedLockFile(relTmp, lockPath);
        }
        fs.unlinkSync(relTmp);
      } catch (_err2) {}
    }
    return false;
  }
}

const heldLockTokensByPath = new Map();

function acquireLock(lockPath = resolvePaths(process.env).LOCK_PATH, staleMs = LOCK_STALE_MS) {
  const token = `${process.pid}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
  if (acquireFileLock(lockPath, token, staleMs)) {
    heldLockTokensByPath.set(lockPath, token);
    return true;
  }
  return false;
}

function releaseLock(lockPath = resolvePaths(process.env).LOCK_PATH) {
  const token = heldLockTokensByPath.get(lockPath);
  if (!token) return false;
  const released = releaseFileLock(lockPath, token);
  heldLockTokensByPath.delete(lockPath);
  return released;
}

// Acquires `STATUSBAR_AUTOINJECT_LOCK_PATH` when reading `statusbar_autoinject.js` and `APP_STORAGE_LOCK_PATH` when writing `app_storage.json`!
function syncAppStorageCode(customPaths = null) {
  const p = customPaths || resolvePaths(process.env);
  let autoinjectLockTok = null;
  let storageLockToken = null;
  try {
    if (!fs.existsSync(p.AUTOINJECT_PATH) || !fs.existsSync(p.APP_STORAGE_PATH)) {
      return false;
    }
    const autoToken = `${process.pid}:autoinject-read:${crypto.randomBytes(4).toString('hex')}`;
    if (acquireFileLock(p.STATUSBAR_AUTOINJECT_LOCK_PATH, autoToken, SHORT_LOCK_STALE_MS)) {
      autoinjectLockTok = autoToken;
    }
    const code = fs.readFileSync(p.AUTOINJECT_PATH, 'utf8');
    if (autoinjectLockTok) {
      releaseFileLock(p.STATUSBAR_AUTOINJECT_LOCK_PATH, autoinjectLockTok);
      autoinjectLockTok = null;
    }

    const fastData = JSON.parse(fs.readFileSync(p.APP_STORAGE_PATH, 'utf8'));
    const expectedVal = code.trim() ? code : undefined;
    if (fastData && typeof fastData === 'object') {
      if (expectedVal === undefined && fastData[STORAGE_CODE_KEY] === undefined) return false;
      if (expectedVal !== undefined && fastData[STORAGE_CODE_KEY] === expectedVal) return false;
    }

    const candToken = `${process.pid}:storage:${crypto.randomBytes(4).toString('hex')}`;
    if (!acquireFileLock(p.APP_STORAGE_LOCK_PATH, candToken, SHORT_LOCK_STALE_MS)) {
      return false;
    }
    storageLockToken = candToken;

    const data = JSON.parse(fs.readFileSync(p.APP_STORAGE_PATH, 'utf8'));
    if (!data || typeof data !== 'object') return false;
    if (expectedVal === undefined) {
      if (data[STORAGE_CODE_KEY] === undefined) return false;
      delete data[STORAGE_CODE_KEY];
    } else {
      if (data[STORAGE_CODE_KEY] === expectedVal) return false;
      data[STORAGE_CODE_KEY] = expectedVal;
    }
    writeFileAtomicSync(p.APP_STORAGE_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (_err) {
    return false;
  } finally {
    if (autoinjectLockTok) {
      releaseFileLock(p.STATUSBAR_AUTOINJECT_LOCK_PATH, autoinjectLockTok);
    }
    if (storageLockToken) {
      releaseFileLock(p.APP_STORAGE_LOCK_PATH, storageLockToken);
    }
  }
}

function writeStatus(statusObj, customPaths = null) {
  const p = customPaths || resolvePaths(process.env);
  try {
    fs.mkdirSync(p.AGY_DIR, { recursive: true });
    writeFileAtomicSync(p.STATUS_PATH, JSON.stringify(statusObj, null, 2) + '\n');
  } catch (_err) {}
}

function readDevToolsEndpoint(customPaths = null) {
  const p = customPaths || resolvePaths(process.env);
  try {
    if (!fs.existsSync(p.DEVTOOLS_PORT_FILE)) return null;
    const lines = fs.readFileSync(p.DEVTOOLS_PORT_FILE, 'utf8').trim().split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    if (!port || Number.isNaN(port)) return null;
    const rawWsLine = (lines[1] || '').trim();
    const browserWsUrl = rawWsLine
      ? rawWsLine.startsWith('ws://') || rawWsLine.startsWith('wss://')
        ? rawWsLine
        : `ws://127.0.0.1:${port}${rawWsLine.startsWith('/') ? rawWsLine : `/${rawWsLine}`}`
      : null;
    return { port, browserPath: rawWsLine, browserWsUrl };
  } catch (_err) {
    return null;
  }
}

function httpGetJson(port, reqPath, timeoutMs = 700) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: reqPath, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('HTTP timeout'));
    });
  });
}

function detectBundledPlugins(scriptCode) {
  const text = typeof scriptCode === 'string' ? scriptCode : '';
  const expectsStatusbar =
    /^(?:\/\/ @name[ \t]+Antigravity Custom Statusbar\b|\/\/ === BEGIN_AGY_STATUSBAR(?:_V\d+)? ===|\/\* === BEGIN_AGY_STATUSBAR(?:_V\d+)? === \*\/|[ \t]*function\s+mountStatusBar\s*\(|[ \t]*window\.__agyStatusBarActive\s*=)/m.test(
      text
    );
  const expectsMcp =
    /^(?:\/\/ @name[ \t]+Antigravity Custom MCP Server Manager\b|\/\/ === BEGIN_AGY_MCP_MANAGER(?:_V\d+)? ===|\/\* === BEGIN_AGY_MCP_MANAGER(?:_V\d+)? === \*\/|[ \t]*function\s+mountMcpManager\s*\()/m.test(
      text
    );
  const expectsKo =
    /^(?:\/\/ @name[ \t]+Antigravity Korean Thought & UI Translator\b|\/\/ === BEGIN_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? ===|\/\* === BEGIN_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? === \*\/|[ \t]*window\.__agyKoThoughtCleanup\s*=|[ \t]*const\s+KO_LOCALIZER_VERSION\s*=)/m.test(
      text
    );
  const koVerMatch = text.match(/const\s+KO_LOCALIZER_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return {
    expectsStatusbar,
    expectsMcp,
    expectsKo,
    expectedKoVersion: koVerMatch ? koVerMatch[1] : null,
  };
}

function buildImmediateEvalExpression(scriptCode, scriptHash) {
  const { expectsStatusbar, expectsMcp, expectsKo, expectedKoVersion } = detectBundledPlugins(scriptCode);
  const activeChecks = [];
  if (expectsStatusbar) {
    activeChecks.push(
      'Boolean((window.agyStatusBar && typeof window.__agyStatusBarCleanup === "function") || (window.__agyStatusBarActive && window.document && window.document.querySelector(".agy-ctx-statusbar")))'
    );
  }
  if (expectsMcp) {
    activeChecks.push('Boolean(window.agyMcpManager && typeof window.agyMcpManager.destroy === "function")');
  }
  if (expectsKo) {
    if (expectedKoVersion) {
      activeChecks.push(
        `Boolean(window.__agyKoLocalizerActive === ${JSON.stringify(expectedKoVersion)} && typeof window.__agyKoThoughtCleanup === "function")`
      );
    } else {
      activeChecks.push('Boolean(typeof window.__agyKoThoughtCleanup === "function" && window.__agyKoLocalizerActive)');
    }
  }
  const hasExplicitHashGuard = scriptHash !== undefined && scriptHash !== null;
  const activeGuardExpr = activeChecks.length > 0 ? activeChecks.join(' && ') : 'false';
  const hashCondExpr = hasExplicitHashGuard
    ? `(${activeGuardExpr}) && (!window.__agyStatusBarHash || window.__agyStatusBarHash === ${JSON.stringify(scriptHash)})`
    : activeGuardExpr;
  const hashAssignStmt = hasExplicitHashGuard
    ? `window.__agyStatusBarHash = ${JSON.stringify(scriptHash)};`
    : '';

  return `(() => {
      if (${hashCondExpr}) {
        return 'ALREADY_ACTIVE';
      }
      ${scriptCode}
      ${hashAssignStmt}
      return 'INJECTED_OK';
    })()`;
}

// D-0034: Strict loopback / `*.antigravity.google.com` page target filter (blocks data:, devtools:, file:, external sites!)
function isInjectablePageTarget(t) {
  if (!t || t.type !== 'page') return false;
  const url = String(t.url || '').trim();
  return ALLOWED_PAGE_URL_REGEX.test(url);
}

function createRfc6455WebSocketClient(wsUrl) {
  const parsed = new URL(wsUrl);
  const secKey = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto
    .createHash('sha1')
    .update(secKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  let sock = null;
  let closed = false;
  let closeNotified = false;
  const client = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      if (closed || !sock) throw new Error('WebSocket is not open');
      const payload = Buffer.from(String(data), 'utf8');
      const mask = crypto.randomBytes(4);
      let header;
      if (payload.length < 126) {
        header = Buffer.alloc(6);
        header[0] = 0x81;
        header[1] = 0x80 | payload.length;
        mask.copy(header, 2);
      } else if (payload.length < 65536) {
        header = Buffer.alloc(8);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
        mask.copy(header, 4);
      } else {
        header = Buffer.alloc(14);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
        mask.copy(header, 10);
      }
      const masked = Buffer.allocUnsafe(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ mask[i & 3];
      }
      sock.write(Buffer.concat([header, masked]));
    },
    close(code = 1000) {
      if (closed) return;
      closed = true;
      try {
        if (sock && !sock.destroyed) {
          const normalizedCode =
            Number.isInteger(code) &&
            code !== 1004 &&
            code !== 1005 &&
            code !== 1006 &&
            code !== 1015 &&
            ((code >= 1000 && code <= 1014) || (code >= 3000 && code <= 4999))
              ? code
              : 1000;
          const mask = crypto.randomBytes(4);
          const statusBuf = Buffer.alloc(2);
          statusBuf.writeUInt16BE(normalizedCode, 0);
          const maskedBody = Buffer.from([statusBuf[0] ^ mask[0], statusBuf[1] ^ mask[1]]);
          sock.end(Buffer.concat([Buffer.from([0x88, 0x82]), mask, maskedBody]));
          const destroyTimer = setTimeout(() => {
            try {
              if (sock && !sock.destroyed) sock.destroy();
            } catch (_err) {}
          }, 250);
          if (destroyTimer && typeof destroyTimer.unref === 'function') {
            destroyTimer.unref();
          }
        }
      } catch (_err) {}
    },
  };

  const notifyClose = (code = 1005, reason = '') => {
    if (closeNotified) return;
    closeNotified = true;
    closed = true;
    if (typeof client.onclose === 'function') {
      client.onclose({ code, reason });
    }
  };

  const req = http.request({
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port) || 80,
    path: (parsed.pathname || '/') + (parsed.search || ''),
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': secKey,
    },
  });

  const emitError = (err) => {
    if (closed) return;
    closed = true;
    closeNotified = true;
    try {
      req.destroy();
    } catch (_err) {}
    try {
      if (sock) sock.destroy();
    } catch (_err) {}
    if (typeof client.onerror === 'function') {
      client.onerror(err instanceof Error ? err : new Error(String(err)));
    }
  };

  req.on('error', emitError);
  req.on('response', (res) => {
    emitError(new Error(`Unexpected HTTP response ${res.statusCode} during WebSocket upgrade`));
  });
  req.on('upgrade', (res, socket, head) => {
    if (res.headers['sec-websocket-accept'] !== expectedAccept) {
      emitError(new Error('Invalid Sec-WebSocket-Accept header'));
      return;
    }
    sock = socket;
    let recvBuf = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
    let fragOpcode = 0;
    let fragChunks = [];
    let fragBytes = 0;

    const drainFrames = () => {
      while (!closed && recvBuf.length >= 2) {
        const rsv = recvBuf[0] & 0x70;
        if (rsv !== 0) {
          emitError(new Error('Non-zero WebSocket RSV bits'));
          return;
        }
        const fin = (recvBuf[0] & 0x80) !== 0;
        const opcode = recvBuf[0] & 0x0f;
        const isMasked = (recvBuf[1] & 0x80) !== 0;
        let len = recvBuf[1] & 0x7f;
        if (opcode >= 0x08) {
          if (!fin || len > 125) {
            emitError(new Error('Invalid WebSocket control frame'));
            return;
          }
        }
        let offset = 2;
        if (len === 126) {
          if (recvBuf.length < 4) return;
          len = recvBuf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (recvBuf.length < 10) return;
          const bigLen = recvBuf.readBigUInt64BE(2);
          if (bigLen > BigInt(MAX_WS_BUFFER_BYTES)) {
            emitError(new Error('WebSocket frame payload exceeds maximum buffer size'));
            return;
          }
          len = Number(bigLen);
          offset = 10;
        }
        if (len > MAX_WS_BUFFER_BYTES) {
          emitError(new Error('WebSocket frame payload exceeds maximum buffer size'));
          return;
        }
        const maskBytes = isMasked ? 4 : 0;
        if (recvBuf.length < offset + maskBytes + len) return;
        const body = Buffer.from(recvBuf.subarray(offset + maskBytes, offset + maskBytes + len));
        if (isMasked) {
          const m = recvBuf.subarray(offset, offset + 4);
          for (let i = 0; i < body.length; i++) body[i] ^= m[i & 3];
        }
        recvBuf = recvBuf.subarray(offset + maskBytes + len);

        if (opcode === 0x08) {
          if (body.length === 1) {
            emitError(new Error('Invalid 1-byte WebSocket Close frame payload'));
            return;
          }
          const closeCode = body.length >= 2 ? body.readUInt16BE(0) : 1005;
          const closeReason = body.length > 2 ? body.subarray(2).toString('utf8') : '';
          client.close(body.length >= 2 ? closeCode : 1000);
          notifyClose(closeCode, closeReason);
          return;
        }
        if (opcode === 0x09 && sock && !closed) {
          const pongPayload = body.length <= 125 ? body : body.subarray(0, 125);
          const pongMask = crypto.randomBytes(4);
          const pongHdr = Buffer.from([0x8a, 0x80 | pongPayload.length]);
          const maskedPong = Buffer.allocUnsafe(pongPayload.length);
          for (let i = 0; i < pongPayload.length; i++) {
            maskedPong[i] = pongPayload[i] ^ pongMask[i & 3];
          }
          sock.write(Buffer.concat([pongHdr, pongMask, maskedPong]));
          continue;
        }
        if (opcode === 0x0a) continue;
        if (opcode === 0x01 || opcode === 0x02) {
          if (fragOpcode !== 0) {
            emitError(new Error('Interleaved WebSocket data frame during fragmentation'));
            return;
          }
          if (fin) {
            if (opcode === 0x01 && typeof client.onmessage === 'function') {
              client.onmessage({ data: body.toString('utf8') });
            }
          } else {
            fragOpcode = opcode;
            fragChunks = [body];
            fragBytes = body.length;
          }
          continue;
        }
        if (opcode === 0x00) {
          if (!fragOpcode) {
            emitError(new Error('Unexpected WebSocket continuation frame'));
            return;
          }
          fragBytes += body.length;
          if (fragBytes > MAX_WS_BUFFER_BYTES) {
            emitError(new Error('WebSocket fragmented message exceeds maximum buffer size'));
            return;
          }
          fragChunks.push(body);
          if (fin) {
            const fullBuf = Buffer.concat(fragChunks, fragBytes);
            const completedOp = fragOpcode;
            fragOpcode = 0;
            fragChunks = [];
            fragBytes = 0;
            if (completedOp === 0x01 && typeof client.onmessage === 'function') {
              client.onmessage({ data: fullBuf.toString('utf8') });
            }
          }
          continue;
        }
        emitError(new Error(`Unsupported WebSocket opcode: ${opcode}`));
        return;
      }
    };

    socket.on('data', (chunk) => {
      if (recvBuf.length + chunk.length > MAX_WS_BUFFER_BYTES) {
        emitError(new Error('WebSocket receive buffer exceeded maximum size'));
        return;
      }
      recvBuf = Buffer.concat([recvBuf, chunk]);
      drainFrames();
    });
    socket.on('error', emitError);
    socket.on('end', () => notifyClose(1006, 'Socket ended'));
    socket.on('close', () => notifyClose(1006, 'Socket closed'));

    Promise.resolve().then(() => {
      if (!closed && typeof client.onopen === 'function') client.onopen();
      if (!closed && recvBuf.length > 0) drainFrames();
    });
  });
  req.end();
  return client;
}

function openCdpWebSocket(wsUrl) {
  if (typeof WebSocket === 'function') {
    return new WebSocket(wsUrl);
  }
  return createRfc6455WebSocketClient(wsUrl);
}

function evaluateExpressionOnTargetCdp(wsUrl, expression, timeoutMs = 900) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;
    try {
      ws = openCdpWebSocket(wsUrl);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch (_err) {}
      reject(new Error('WebSocket evaluation timeout'));
    }, timeoutMs);

    ws.onopen = () => {
      try {
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true },
          })
        );
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch (_err) {}
          reject(err);
        }
      }
    };

    ws.onmessage = (event) => {
      if (settled) return;
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (msg.id === 1) {
          settled = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch (_err) {}
          if (msg.error) {
            reject(new Error(msg.error.message || 'CDP Runtime.evaluate error'));
            return;
          }
          if (msg.result && msg.result.exceptionDetails) {
            const det = msg.result.exceptionDetails;
            const desc = (det.exception && det.exception.description) || det.text || 'CDP Runtime.evaluate exception';
            reject(new Error(desc));
            return;
          }
          resolve(msg.result && msg.result.result ? msg.result.result.value : null);
        }
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch (_err) {}
        reject(err);
      }
    };

    ws.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch (_err) {}
      reject(err instanceof Error ? err : new Error('WebSocket error'));
    };

    ws.onclose = (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`WebSocket closed before CDP response (code=${(ev && ev.code) || 'unknown'})`));
    };
  });
}

function configureTargetViaCdp(wsUrl, scriptCode, scriptHash, timeoutMs = 900) {
  const effHash = scriptHash || sha256Hex(String(scriptCode || '')).slice(0, 16);
  const immediateExpr = buildImmediateEvalExpression(scriptCode, effHash);
  return evaluateExpressionOnTargetCdp(wsUrl, immediateExpr, timeoutMs);
}

function injectViaBrowserCdpWs(wsUrl, scriptCode, scriptHash, timeoutMs = 1500) {
  if (typeof wsUrl === 'string' && wsUrl.includes('/devtools/page/')) {
    return configureTargetViaCdp(wsUrl, scriptCode, scriptHash, timeoutMs);
  }
  return new Promise((resolve, reject) => {
    let closed = false;
    let nextId = 1;
    const pending = new Map();
    let ws;
    try {
      ws = openCdpWebSocket(wsUrl);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const effHash = scriptHash || sha256Hex(String(scriptCode || '')).slice(0, 16);
    const immediateExpr = buildImmediateEvalExpression(scriptCode, effHash);

    const finish = (err, val) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      for (const [, p] of pending) {
        p.reject(err || new Error('Browser CDP socket closed'));
      }
      pending.clear();
      try {
        ws.close();
      } catch (_err) {}
      if (err) reject(err);
      else resolve(val);
    };

    const timer = setTimeout(() => finish(new Error('Browser CDP WebSocket timeout')), timeoutMs);

    const sendCdp = (method, params = {}, sessionId = undefined) =>
      new Promise((res, rej) => {
        if (closed) {
          rej(new Error('Browser CDP socket closed'));
          return;
        }
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
        try {
          ws.send(JSON.stringify(payload));
        } catch (err) {
          pending.delete(id);
          rej(err);
        }
      });

    ws.onmessage = (event) => {
      if (closed) return;
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
          const entry = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) {
            entry.reject(new Error(msg.error.message || `CDP ${msg.error.code || ''} error`));
          } else {
            entry.resolve(msg.result);
          }
        }
      } catch (_err) {}
    };

    ws.onerror = (err) => finish(err instanceof Error ? err : new Error('Browser CDP WebSocket error'));
    ws.onclose = (ev) =>
      finish(new Error(`Browser CDP WebSocket closed unexpectedly (code=${(ev && ev.code) || 'unknown'})`));

    ws.onopen = async () => {
      try {
        const targetsRes = await sendCdp('Target.getTargets', {});
        const targetInfos = Array.isArray(targetsRes && targetsRes.targetInfos) ? targetsRes.targetInfos : [];
        const pageTargets = targetInfos.filter((t) => t && t.targetId && isInjectablePageTarget(t));
        let injectedCount = 0;
        let skippedAlreadyActive = 0;

        for (const target of pageTargets) {
          let sessionId = null;
          try {
            const attachRes = await sendCdp('Target.attachToTarget', {
              targetId: target.targetId,
              flatten: true,
            });
            sessionId = (attachRes && attachRes.sessionId) || null;
            if (!sessionId) continue;
            const evalRes = await sendCdp(
              'Runtime.evaluate',
              { expression: immediateExpr, returnByValue: true },
              sessionId
            );
            if (evalRes && evalRes.exceptionDetails) {
              throw new Error(evalRes.exceptionDetails.text || 'CDP Runtime.evaluate exception');
            }
            const val = evalRes && evalRes.result ? evalRes.result.value : null;
            if (val === 'INJECTED_OK') injectedCount++;
            else if (val === 'ALREADY_ACTIVE') skippedAlreadyActive++;
          } catch (_err) {
          } finally {
            if (sessionId) {
              try {
                await sendCdp('Target.detachFromTarget', { sessionId });
              } catch (_err) {}
            }
          }
        }
        finish(null, { pageTargetCount: pageTargets.length, injectedCount, skippedAlreadyActive });
      } catch (err) {
        finish(err);
      }
    };
  });
}

async function injectViaCdpLive(customPaths = null) {
  const p = customPaths || resolvePaths(process.env);
  if (!fs.existsSync(p.AUTOINJECT_PATH)) {
    return { attempted: false, reason: 'autoinject_script_missing', injectedCount: 0 };
  }
  const endpoint = readDevToolsEndpoint(p);
  if (!endpoint) {
    return { attempted: false, reason: 'devtools_port_missing', injectedCount: 0 };
  }
  const { port, browserWsUrl } = endpoint;

  const scriptCode = fs.readFileSync(p.AUTOINJECT_PATH, 'utf8');
  const scriptHash = sha256Hex(scriptCode).slice(0, 16);
  let targets = [];
  try {
    targets = await httpGetJson(port, '/json/list', 700);
  } catch (_err) {}
  const pageTargets = (Array.isArray(targets) ? targets : []).filter(
    (t) => isInjectablePageTarget(t) && Boolean(t.webSocketDebuggerUrl)
  );

  let injectedCount = 0;
  let skippedAlreadyActive = 0;

  if (pageTargets.length > 0) {
    for (const target of pageTargets) {
      try {
        const val = await configureTargetViaCdp(target.webSocketDebuggerUrl, scriptCode, scriptHash, 900);
        if (val === 'INJECTED_OK') injectedCount++;
        else if (val === 'ALREADY_ACTIVE') skippedAlreadyActive++;
      } catch (_err) {}
    }
    return {
      attempted: true,
      port,
      pageTargetCount: pageTargets.length,
      injectedCount,
      skippedAlreadyActive,
    };
  }

  if (browserWsUrl) {
    try {
      const wsRes = await injectViaBrowserCdpWs(browserWsUrl, scriptCode, scriptHash, 1500);
      return {
        attempted: true,
        port,
        pageTargetCount: wsRes.pageTargetCount,
        injectedCount: wsRes.injectedCount,
        skippedAlreadyActive: wsRes.skippedAlreadyActive,
      };
    } catch (_err) {}
  }

  return {
    attempted: true,
    port,
    pageTargetCount: 0,
    injectedCount: 0,
    skippedAlreadyActive: 0,
  };
}

async function evaluateCleanupViaCdpLive(customPaths = null) {
  const p = customPaths || resolvePaths(process.env);
  const endpoint = readDevToolsEndpoint(p);
  if (!endpoint) return { attempted: false, cleanedCount: 0 };
  const cleanupExpr =
    '(() => { if (typeof window.__agyKoThoughtCleanup === "function") { window.__agyKoThoughtCleanup(true); return true; } return false; })()';
  let targets = [];
  try {
    targets = await httpGetJson(endpoint.port, '/json/list', 700);
  } catch (_err) {}
  const pageTargets = (Array.isArray(targets) ? targets : []).filter(
    (t) => isInjectablePageTarget(t) && Boolean(t.webSocketDebuggerUrl)
  );
  let cleanedCount = 0;
  for (const target of pageTargets) {
    try {
      const ok = await evaluateExpressionOnTargetCdp(target.webSocketDebuggerUrl, cleanupExpr, 900);
      if (ok) cleanedCount++;
    } catch (_err) {}
  }
  return { attempted: true, cleanedCount };
}

function readAsarArchive(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 16) {
    throw new Error('Truncated ASAR header (< 16 bytes)');
  }
  const u0 = buf.readUInt32LE(0);
  const u4 = buf.readUInt32LE(4);
  const strSize = buf.readUInt32LE(12);
  const dataOffset = 8 + u4;
  if (strSize <= 0 || 16 + strSize > buf.length || dataOffset > buf.length) {
    throw new Error('Corrupt ASAR header bounds');
  }
  const header = JSON.parse(buf.toString('utf8', 16, 16 + strSize).replace(/\0+$/, ''));

  const fileMap = new Map();
  const nodeMap = new Map();
  function extractNode(node, relPath) {
    if (!node || typeof node !== 'object') return;
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        extractNode(child, relPath ? `${relPath}/${name}` : name);
      }
    } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
      const offsetNum = Number(node.offset);
      const sizeNum = Number(node.size);
      if (!Number.isFinite(offsetNum) || !Number.isFinite(sizeNum) || offsetNum < 0 || sizeNum < 0) {
        throw new Error(`Invalid ASAR file entry bounds for ${relPath}`);
      }
      const start = dataOffset + offsetNum;
      const end = start + sizeNum;
      if (end > buf.length) {
        throw new Error(`ASAR file entry ${relPath} exceeds archive size (${end} > ${buf.length})`);
      }
      fileMap.set(relPath, buf.subarray(start, end));
      nodeMap.set(relPath, node);
    }
  }
  extractNode(header, '');

  let appVersion = 'unknown';
  try {
    const pkgBuf = fileMap.get('package.json');
    if (pkgBuf) {
      const pkg = JSON.parse(pkgBuf.toString('utf8'));
      if (pkg && pkg.version) appVersion = String(pkg.version);
    }
  } catch (_err) {}

  return { buf, u0, u4, strSize, dataOffset, header, fileMap, nodeMap, appVersion };
}

function hasAnyPatchMarker(text) {
  const s = String(text || '');
  return s.includes(PATCH_MARKER) || LEGACY_MARKERS.some((m) => s.includes(m));
}

function isPureUnpatchedArchive(archive) {
  if (!archive || !archive.fileMap) return false;
  const u = archive.fileMap.get('dist/utils.js');
  const m = archive.fileMap.get('dist/main.js');
  const p = archive.fileMap.get('dist/preload.js');
  if (!u || !m || !p) return false;
  return (
    !hasAnyPatchMarker(u.toString('utf8')) &&
    !hasAnyPatchMarker(m.toString('utf8')) &&
    !hasAnyPatchMarker(p.toString('utf8'))
  );
}

// Rev7-F4 #1: Full integrity check on `.orig`:
// Validates ASAR bounds, `appVersion`, pure unpatched `dist/{utils,main,preload}.js`, AND every packed file's
// `node.integrity.hash` SHA-256 against unpacked slice bytes inside `.orig` before trusting or backfilling `.orig.json`!
function verifyPureOrigArchive(backupPath, expectedAppVersion) {
  try {
    if (!backupPath || !fs.existsSync(backupPath)) {
      return { ok: false, reason: 'ORIG_MISSING' };
    }
    const backupArchive = readAsarArchive(backupPath);
    if (expectedAppVersion && backupArchive.appVersion !== expectedAppVersion) {
      return {
        ok: false,
        reason: `VERSION_MISMATCH:${backupArchive.appVersion}!=${expectedAppVersion}`,
      };
    }
    if (!isPureUnpatchedArchive(backupArchive)) {
      return { ok: false, reason: 'ORIG_CONTAINS_PATCH_MARKERS' };
    }
    // Verify packed file integrity hashes inside ASAR header
    for (const [relPath, sliceBuf] of backupArchive.fileMap.entries()) {
      const node = backupArchive.nodeMap.get(relPath);
      if (node && node.integrity && typeof node.integrity.hash === 'string' && node.integrity.hash) {
        const actualFileHash = sha256Hex(sliceBuf).toLowerCase();
        if (actualFileHash !== node.integrity.hash.toLowerCase()) {
          return { ok: false, reason: `FILE_INTEGRITY_MISMATCH:${relPath}` };
        }
      }
    }

    const archiveHash = sha256Hex(backupArchive.buf);
    const metaPath = `${backupPath}.json`;
    if (fs.existsSync(metaPath)) {
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch (_err) {
        return { ok: false, reason: 'ORIG_META_CORRUPT_JSON' };
      }
      if (
        !meta ||
        meta.appVersion !== backupArchive.appVersion ||
        Number(meta.size) !== backupArchive.buf.length ||
        String(meta.sha256 || '').toLowerCase() !== archiveHash.toLowerCase()
      ) {
        return { ok: false, reason: 'ORIG_META_HASH_OR_SIZE_MISMATCH' };
      }
    } else {
      // Backfill `.orig.json` atomically for verified pure v1.2.39 `.orig` backups
      writeFileAtomicSync(
        metaPath,
        JSON.stringify(
          {
            appVersion: backupArchive.appVersion,
            sha256: archiveHash,
            size: backupArchive.buf.length,
            createdAt: new Date().toISOString(),
            backfilledBy: PATCHER_CAPABILITY_REVISION,
          },
          null,
          2
        ) + '\n'
      );
    }

    return {
      ok: true,
      archive: backupArchive,
      sha256: archiveHash,
    };
  } catch (err) {
    return { ok: false, reason: `ORIG_PARSE_ERROR:${err && err.message ? err.message : String(err)}` };
  }
}

function rebuildAsarBuffer(archive, patchedUtilsBuf, patchedMainBuf, patchedPreloadBuf) {
  const origArchiveSize = archive.buf.length;
  const origPreloadOffset =
    archive.header &&
    archive.header.files &&
    archive.header.files.dist &&
    archive.header.files.dist.files &&
    archive.header.files.dist.files['preload.js'] &&
    archive.header.files.dist.files['preload.js'].offset;

  const headerClone = JSON.parse(JSON.stringify(archive.header));
  const fileMap = new Map(archive.fileMap);
  fileMap.set('dist/utils.js', patchedUtilsBuf);
  fileMap.set('dist/main.js', patchedMainBuf);
  fileMap.set('dist/preload.js', patchedPreloadBuf);

  const chunks = [];
  let currentOffset = 0n;

  function rebuildNode(node, relPath) {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        rebuildNode(child, relPath ? `${relPath}/${name}` : name);
      }
    } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
      const data = fileMap.get(relPath);
      node.size = data.length;
      node.offset = currentOffset.toString();
      node.integrity = computeIntegrity(data);
      chunks.push(data);
      currentOffset += BigInt(data.length);
    }
  }
  rebuildNode(headerClone, '');

  const newPreloadOffset =
    headerClone &&
    headerClone.files &&
    headerClone.files.dist &&
    headerClone.files.dist.files &&
    headerClone.files.dist.files['preload.js'] &&
    headerClone.files.dist.files['preload.js'].offset;
  if (origPreloadOffset !== newPreloadOffset) {
    return {
      ok: false,
      status: 'FAILED_OFFSET_DRIFT',
      detail: `preload.js offset drifted: ${origPreloadOffset} -> ${newPreloadOffset}`,
    };
  }

  const newHeaderStr = JSON.stringify(headerClone);
  const newHeaderStrBuf = Buffer.from(newHeaderStr, 'utf8');
  const newStrSize = newHeaderStrBuf.length;
  const alignedStrSize = Math.ceil(newStrSize / 4) * 4;
  const newU8 = 4 + alignedStrSize;
  const newU4 = 4 + newU8;
  const totalHeaderSize = 8 + newU4;

  const newHeaderBuf = Buffer.alloc(totalHeaderSize, 0);
  newHeaderBuf.writeUInt32LE(archive.u0, 0);
  newHeaderBuf.writeUInt32LE(newU4, 4);
  newHeaderBuf.writeUInt32LE(newU8, 8);
  newHeaderBuf.writeUInt32LE(newStrSize, 12);
  newHeaderStrBuf.copy(newHeaderBuf, 16);

  const outBuf = Buffer.concat([newHeaderBuf, ...chunks]);
  if (outBuf.length !== origArchiveSize) {
    return {
      ok: false,
      status: 'FAILED_ARCHIVE_SIZE_DRIFT',
      detail: `archive size drifted: ${origArchiveSize} -> ${outBuf.length}`,
    };
  }
  return {
    ok: true,
    outBuf,
    preloadOffset: newPreloadOffset,
  };
}

function patchAsarOnDisk(customPaths = null) {
  const p = customPaths || resolvePaths(process.env);
  syncAppStorageCode(p);

  if (!fs.existsSync(p.ASAR_PATH)) {
    return { status: 'SKIPPED_NO_ASAR' };
  }
  if (!fs.existsSync(p.AUTOINJECT_PATH)) {
    return { status: 'SKIPPED_NO_AUTOINJECT_SCRIPT' };
  }

  if (isAsarPatchedFast(p.ASAR_PATH)) {
    let currentArchive = null;
    try {
      currentArchive = readAsarArchive(p.ASAR_PATH);
    } catch (_err) {}
    return {
      status: 'ALREADY_PATCHED',
      patchVersion: PATCH_MARKER,
      capabilityRevision: PATCHER_CAPABILITY_REVISION,
      appVersion: (currentArchive && currentArchive.appVersion) || 'unknown',
    };
  }

  // Rev5-F4 #1: Check ASAR write/replace capability BEFORE reading 80MB+ ASAR or staging `.tmp`!
  const replaceProbe = probeAsarReplaceableFast(p.ASAR_PATH);
  if (!replaceProbe.replaceable) {
    return {
      status: 'DEFERRED_LOCKED',
      errorCode: replaceProbe.code,
    };
  }

  const curArchive = readAsarArchive(p.ASAR_PATH);
  const appVersion = curArchive.appVersion;
  const backupPath = `${p.ASAR_PATH}.v${appVersion}.orig`;
  const pureUnpatched = isPureUnpatchedArchive(curArchive);

  let baseArchive = null;
  let backupCreated = false;
  let isCaseCV5Upgrade = false;

  if (pureUnpatched) {
    // Case A: Pure unpatched ASAR -> create verified `.orig` + `.orig.json` before patching V6!
    if (!fs.existsSync(backupPath)) {
      const origHash = writeBinaryVerifiedAtomicSync(backupPath, curArchive.buf);
      writeFileAtomicSync(
        `${backupPath}.json`,
        JSON.stringify(
          {
            appVersion,
            sha256: origHash,
            size: curArchive.buf.length,
            createdAt: new Date().toISOString(),
          },
          null,
          2
        ) + '\n'
      );
      backupCreated = true;
    } else {
      const verifiedExisting = verifyPureOrigArchive(backupPath, appVersion);
      if (!verifiedExisting.ok) {
        return {
          status: 'FAILED_CORRUPT_ORIG_BACKUP',
          appVersion,
          detail: verifiedExisting.reason,
        };
      }
    }
    baseArchive = curArchive;
  } else if (fs.existsSync(backupPath)) {
    // Case B: Already patched/legacy ASAR with `.orig` present -> verify `.orig` (and backfill `.orig.json` if needed)
    const verified = verifyPureOrigArchive(backupPath, appVersion);
    if (!verified.ok) {
      return {
        status: 'FAILED_CORRUPT_ORIG_BACKUP',
        appVersion,
        detail: verified.reason,
      };
    }
    baseArchive = verified.archive;
  } else {
    // Case C: Patched ASAR WITHOUT `.orig` -> ONLY upgrade exact known `V5` blocks 1:1; fail closed on `V2`/`V3`/`V4`/unknown!
    const curUtilsStr = (curArchive.fileMap.get('dist/utils.js') || Buffer.alloc(0)).toString('utf8').replace(/\r\n/g, '\n');
    const curMainStr = (curArchive.fileMap.get('dist/main.js') || Buffer.alloc(0)).toString('utf8').replace(/\r\n/g, '\n');
    const curPreloadStr = (curArchive.fileMap.get('dist/preload.js') || Buffer.alloc(0)).toString('utf8').replace(/\r\n/g, '\n');

    const hasUnsupported = [curUtilsStr, curMainStr, curPreloadStr].some((s) =>
      EARLIER_UNSUPPORTED_MARKERS.some((m) => s.includes(m))
    );
    const utilsV5Occ = curUtilsStr.split(LEGACY_UTILS_V5_BLOCK).length - 1;
    const mainV5Occ = curMainStr.split(LEGACY_MAIN_V5_BLOCK).length - 1;
    const preloadV5Occ = curPreloadStr.split(LEGACY_PRELOAD_V5_BLOCK).length - 1;

    if (hasUnsupported || utilsV5Occ !== 1 || mainV5Occ !== 1 || preloadV5Occ !== 1) {
      return {
        status: 'FAILED_LEGACY_UNRECOGNIZED_NO_ORIG',
        appVersion,
      };
    }
    baseArchive = curArchive;
    isCaseCV5Upgrade = true;
  }

  const utilsBuf = baseArchive.fileMap.get('dist/utils.js');
  const mainBuf = baseArchive.fileMap.get('dist/main.js');
  const preloadBuf = baseArchive.fileMap.get('dist/preload.js');
  if (!utilsBuf || !mainBuf || !preloadBuf) {
    return { status: 'FAILED_TARGET_FILES_MISSING', appVersion };
  }

  let patchedUtilsBuf;
  let patchedMainBuf;
  let patchedPreloadBuf;
  try {
    if (isCaseCV5Upgrade) {
      patchedUtilsBuf = transformExactSize(utilsBuf, LEGACY_UTILS_V5_BLOCK, UTILS_ANCHOR_REPLACEMENT);
      patchedMainBuf = transformExactSize(mainBuf, LEGACY_MAIN_V5_BLOCK, MAIN_ANCHOR_REPLACEMENT);
      patchedPreloadBuf = transformExactSize(preloadBuf, LEGACY_PRELOAD_V5_BLOCK, PRELOAD_ANCHOR_REPLACEMENT);
    } else {
      patchedUtilsBuf = transformExactSize(utilsBuf, UTILS_ANCHOR_TARGET, UTILS_ANCHOR_REPLACEMENT);
      patchedMainBuf = transformExactSize(mainBuf, MAIN_ANCHOR_TARGET, MAIN_ANCHOR_REPLACEMENT);
      patchedPreloadBuf = transformExactSize(preloadBuf, PRELOAD_ANCHOR_TARGET, PRELOAD_ANCHOR_REPLACEMENT);
    }
  } catch (err) {
    return {
      status: 'FAILED_PATTERN_OR_SIZE',
      appVersion,
      detail: String((err && err.message) || err),
    };
  }

  const rebuilt = rebuildAsarBuffer(baseArchive, patchedUtilsBuf, patchedMainBuf, patchedPreloadBuf);
  if (!rebuilt.ok) {
    return {
      status: rebuilt.status,
      appVersion,
      detail: rebuilt.detail,
    };
  }

  // Write ASAR exclusively via `.tmp` + `fsyncSync` + SHA-256 readback + `fs.renameSync` ONLY (ZERO copyFileSync!)
  let outSha256;
  try {
    outSha256 = writeBinaryVerifiedAtomicSync(p.ASAR_PATH, rebuilt.outBuf);
  } catch (err) {
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
      return {
        status: 'DEFERRED_LOCKED',
        appVersion,
        errorCode: err.code,
      };
    }
    return {
      status: 'FAILED_ATOMIC_RENAME',
      appVersion,
      detail: String((err && err.message) || err),
    };
  }

  return {
    status: 'PATCHED',
    patchVersion: PATCH_MARKER,
    capabilityRevision: PATCHER_CAPABILITY_REVISION,
    appVersion,
    backupPath: fs.existsSync(backupPath) ? backupPath : null,
    backupCreated,
    upgradedFromV5WithoutOrig: isCaseCV5Upgrade,
    exactOffsetPreserved: true,
    preloadOffset: rebuilt.preloadOffset,
    bytes: rebuilt.outBuf.length,
    sha256: outSha256.toUpperCase(),
  };
}

async function runWorkerMode(customPaths = null) {
  const p = customPaths || resolvePaths(process.env);
  if (!acquireLock(p.LOCK_PATH, LOCK_STALE_MS)) {
    return null;
  }
  const statusReport = {
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    capabilityRevision: PATCHER_CAPABILITY_REVISION,
    cdp: null,
    asar: null,
  };

  try {
    try {
      statusReport.cdp = await injectViaCdpLive(p);
    } catch (err) {
      statusReport.cdp = { error: String((err && err.message) || err) };
    }

    try {
      statusReport.asar = patchAsarOnDisk(p);
    } catch (err) {
      statusReport.asar = { status: 'ERROR_EXCEPTION', error: String((err && err.message) || err) };
    }

    if (
      !fs.existsSync(p.STATUS_PATH) ||
      (statusReport.cdp && statusReport.cdp.injectedCount > 0) ||
      (statusReport.asar && statusReport.asar.status !== 'ALREADY_PATCHED')
    ) {
      writeStatus(statusReport, p);
    }
    return statusReport;
  } finally {
    releaseLock(p.LOCK_PATH);
  }
}

async function runHookFastPath() {
  if (process.stdin && !process.stdin.isTTY) {
    process.stdin.on('error', () => {});
    process.stdin.resume();
    if (typeof process.stdin.unref === 'function') {
      process.stdin.unref();
    }
  }
  try {
    const p = resolvePaths(process.env);
    syncAppStorageCode(p);
    if (!isAsarPatchedFast(p.ASAR_PATH)) {
      const child = spawn(process.execPath, [__filename, '--worker'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } else {
      await injectViaCdpLive(p);
    }
  } catch (_err) {}
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const p = resolvePaths(process.env);
  if (args.includes('--worker')) {
    await runWorkerMode(p);
    process.exit(0);
  } else if (args.includes('--cdp-only')) {
    syncAppStorageCode(p);
    await injectViaCdpLive(p);
    process.exit(0);
  } else if (args.includes('--status')) {
    const patched = isAsarPatchedFast(p.ASAR_PATH);
    let lastStatus = null;
    try {
      if (fs.existsSync(p.STATUS_PATH)) {
        lastStatus = JSON.parse(fs.readFileSync(p.STATUS_PATH, 'utf8'));
      }
    } catch (_err) {}
    process.stdout.write(
      JSON.stringify(
        {
          isAsarPatched: patched,
          patchVersion: PATCH_MARKER,
          capabilityRevision: PATCHER_CAPABILITY_REVISION,
          lastStatus,
        },
        null,
        2
      ) + '\n'
    );
    process.exit(0);
  } else {
    await runHookFastPath();
  }
}

module.exports = {
  LOCK_PATH,
  STATUSBAR_AUTOINJECT_LOCK_PATH,
  APP_STORAGE_LOCK_PATH,
  PATCH_MARKER,
  PATCHER_CAPABILITY_REVISION,
  LEGACY_MARKERS,
  LEGACY_UTILS_V5_BLOCK,
  LEGACY_MAIN_V5_BLOCK,
  LEGACY_PRELOAD_V5_BLOCK,
  UTILS_ANCHOR_TARGET,
  UTILS_ANCHOR_REPLACEMENT,
  MAIN_ANCHOR_TARGET,
  MAIN_ANCHOR_REPLACEMENT,
  PRELOAD_ANCHOR_TARGET,
  PRELOAD_ANCHOR_REPLACEMENT,
  resolvePaths,
  sha256Hex,
  writeFileAtomicSync,
  writeBinaryVerifiedAtomicSync,
  probeAsarReplaceableFast,
  computeIntegrity,
  stripPureCommentLinesLexical,
  transformExactSize,
  isAsarPatchedFast,
  readAsarArchive,
  isPureUnpatchedArchive,
  verifyPureOrigArchive,
  patchAsarOnDisk,
  detectBundledPlugins,
  buildImmediateEvalExpression,
  isInjectablePageTarget,
  createRfc6455WebSocketClient,
  openCdpWebSocket,
  configureTargetViaCdp,
  injectViaBrowserCdpWs,
  injectViaCdpLive,
  evaluateCleanupViaCdpLive,
  syncAppStorageCode,
  acquireFileLock,
  releaseFileLock,
  acquireLock,
  releaseLock,
  writeStatus,
  runWorkerMode,
};

if (require.main === module) {
  main().catch(() => process.exit(0));
}
