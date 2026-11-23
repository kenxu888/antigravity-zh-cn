import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { buildInjectedScript } from './injector.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_PORT = Number(process.env.ANTIGRAVITY_ZH_PORT || 19222);

const EXCLUDED_URL_PREFIXES = [
  'devtools://',
  'chrome-devtools://',
  'data:',
  'chrome-extension://',
  'agy-browser-stream://',
  'agy-favicon://'
];

const ALLOWED_TYPES = new Set(['page', 'webview', 'app', 'iframe', 'other']);
const ALLOWED_PROTOCOLS = new Set(['plugin:', 'file:', 'agy:', 'antigravity:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function createLogger(logPath) {
  return function log(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      fs.appendFileSync(logPath, line, 'utf8');
    } catch {
      // Ignore logging errors
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findAntigravityExe() {
  const candidates = [];
  if (process.env.ANTIGRAVITY_EXE) {
    candidates.push(process.env.ANTIGRAVITY_EXE);
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe'));
  }
  candidates.push(
    'C:\\Program Files\\Antigravity\\Antigravity.exe',
    'C:\\Program Files (x86)\\Antigravity\\Antigravity.exe'
  );

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Continue checking next candidate
    }
  }

  try {
    const psCmd = [
      '$sh = New-Object -ComObject WScript.Shell;',
      '$dirs = @([Environment]::GetFolderPath("Desktop"), "$env:PUBLIC\\Desktop", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs");',
      'foreach ($d in $dirs) {',
      '  if (-not (Test-Path $d)) { continue }',
      '  Get-ChildItem -Path $d -Recurse -Filter "*Antigravity*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {',
      '    $t = $sh.CreateShortcut($_.FullName).TargetPath;',
      '    if ($t -and ($t -like "*Antigravity.exe") -and (Test-Path $t)) { Write-Output $t; exit 0 }',
      '  }',
      '}'
    ].join(' ');
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      psCmd
    ], { encoding: 'utf8', windowsHide: true, timeout: 4000 }).trim();
    const firstLine = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {
    // Ignore shortcut lookup failure
  }

  return null;
}

export function isTargetEligible(target) {
  if (!target || typeof target.webSocketDebuggerUrl !== 'string' || !target.webSocketDebuggerUrl) {
    return false;
  }
  if (target.type && !ALLOWED_TYPES.has(target.type)) {
    return false;
  }

  const rawUrl = String(target.url || '').trim();
  const lowerUrl = rawUrl.toLowerCase();
  for (const prefix of EXCLUDED_URL_PREFIXES) {
    if (lowerUrl.startsWith(prefix)) return false;
  }

  if (!rawUrl || lowerUrl === 'about:blank') {
    return true;
  }

  try {
    const parsed = new URL(rawUrl);
    if (ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return true;
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
    }
  } catch {
    return false;
  }

  return false;
}

export function loadMergedDictionary(baseDir = __dirname) {
  const basePath = path.join(baseDir, 'dict.zh-CN.json');
  const customPath = path.join(baseDir, 'dict.custom.json');
  let merged = {};

  if (fs.existsSync(basePath)) {
    const baseData = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    if (baseData && typeof baseData === 'object') {
      merged = { ...baseData };
    }
  }

  if (fs.existsSync(customPath)) {
    try {
      const rawCustom = fs.readFileSync(customPath, 'utf8').trim();
      if (rawCustom) {
        const customData = JSON.parse(rawCustom);
        if (customData && typeof customData === 'object') {
          merged = { ...merged, ...customData };
        }
      }
    } catch {
      // Ignore partial edits in custom dict while user is typing
    }
  }

  return merged;
}

function getDictMtimeSignature(baseDir = __dirname) {
  const parts = [];
  for (const name of ['dict.zh-CN.json', 'dict.custom.json', 'injector.js']) {
    const p = path.join(baseDir, name);
    try {
      const st = fs.statSync(p);
      parts.push(`${name}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  return parts.join('|');
}

export async function attachTarget(target, scriptSource, logOrOptions = {}) {
  const log = typeof logOrOptions === 'function'
    ? logOrOptions
    : (typeof logOrOptions?.log === 'function' ? logOrOptions.log : () => {});
  const onClose = typeof logOrOptions === 'object' && logOrOptions ? logOrOptions.onClose : undefined;

  const wsUrl = target.webSocketDebuggerUrl;
  const targetId = target.id || wsUrl;
  const ws = new WebSocket(wsUrl);

  let nextId = 1;
  let scriptIdentifier = null;
  let closed = false;
  const pending = new Map();

  function cleanupPending(reason) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  function sendCmd(method, params = {}) {
    if (closed || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`WebSocket closed before ${method}`));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  }

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      const text = typeof event.data === 'string'
        ? event.data
        : Buffer.from(event.data).toString('utf8');
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        entry.resolve(msg.result);
      }
    }
  });

  ws.addEventListener('close', () => {
    closed = true;
    cleanupPending('WebSocket closed');
    if (typeof onClose === 'function') onClose(targetId);
  });

  ws.addEventListener('error', (err) => {
    log(`WebSocket error on ${targetId}: ${err?.message || 'unknown'}`);
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out connecting to ${targetId}`));
    }, 5000);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`Failed connecting to ${targetId}`));
    }, { once: true });
  });

  await sendCmd('Page.enable').catch(() => {});
  await sendCmd('Runtime.enable').catch(() => {});
  const added = await sendCmd('Page.addScriptToEvaluateOnNewDocument', { source: scriptSource }).catch(() => null);
  if (added && added.identifier) {
    scriptIdentifier = added.identifier;
  }
  await sendCmd('Runtime.evaluate', { expression: scriptSource, awaitPromise: false }).catch((err) => {
    log(`Initial Runtime.evaluate error on ${targetId}: ${err.message}`);
  });

  log(`Attached target ${targetId} (${target.url || 'blank'})`);

  return {
    targetId,
    isOpen: () => !closed && ws.readyState === WebSocket.OPEN,
    async pushUpdate(newScriptSource) {
      if (closed || ws.readyState !== WebSocket.OPEN) return false;
      if (scriptIdentifier) {
        await sendCmd('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptIdentifier }).catch(() => {});
      }
      const nextAdded = await sendCmd('Page.addScriptToEvaluateOnNewDocument', { source: newScriptSource }).catch(() => null);
      if (nextAdded && nextAdded.identifier) {
        scriptIdentifier = nextAdded.identifier;
      }
      await sendCmd('Runtime.evaluate', { expression: newScriptSource, awaitPromise: false });
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      cleanupPending('Closed by caller');
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
    }
  };
}

async function fetchJson(url, timeoutMs = 1500) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function isCdpActive(port) {
  try {
    await fetchJson(`http://127.0.0.1:${port}/json/version`, 1200);
    return true;
  } catch {
    return false;
  }
}

async function isAntigravityRunning() {
  try {
    const { stdout } = await execFileAsync('tasklist.exe', [
      '/FI',
      'IMAGENAME eq Antigravity.exe',
      '/FO',
      'CSV',
      '/NH'
    ], { windowsHide: true, timeout: 4000 });
    return /^"Antigravity\.exe"/im.test(stdout);
  } catch {
    return false;
  }
}

function runPowerShellEncoded(scriptText) {
  const encoded = Buffer.from(scriptText, 'utf16le').toString('base64');
  return execFileAsync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded
  ], { windowsHide: true });
}

function buildPsStringLiteral(text) {
  return `'${String(text).replace(/'/g, "''")}'`
    .replace(/\r?\n/g, "' + [Environment]::NewLine + '");
}

async function showMessageBox(title, message, buttons = 'OK', icon = 'Information') {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
    '$owner.ShowInTaskbar = $false',
    '$owner.Width = 1',
    '$owner.Height = 1',
    '$owner.Opacity = 0',
    '$owner.Show()',
    '$owner.Activate()',
    `$msg = ${buildPsStringLiteral(message)}`,
    `$ttl = ${buildPsStringLiteral(title)}`,
    `$res = [System.Windows.Forms.MessageBox]::Show($owner, $msg, $ttl, [System.Windows.Forms.MessageBoxButtons]::${buttons}, [System.Windows.Forms.MessageBoxIcon]::${icon})`,
    '$owner.Close()',
    '$owner.Dispose()',
    'Write-Output $res'
  ].join('\n');

  const { stdout } = await runPowerShellEncoded(ps);
  return stdout.trim();
}

async function promptRelaunchInChinese() {
  const msg = [
    '检测到 Antigravity（英文版）正在运行（可能在右下角系统托盘中）。',
    '',
    '是否关闭当前进程，并以“简体中文版”重新启动？',
    '（点击“是”将自动重启为中文界面；点击“否”取消）'
  ].join('\n');

  try {
    const res = await showMessageBox('Antigravity 简体中文版', msg, 'YesNo', 'Question');
    return res === 'Yes';
  } catch {
    return false;
  }
}

async function showErrorDialog(message) {
  await showMessageBox('Antigravity 简体中文版', message, 'OK', 'Error').catch(() => {});
}

async function stopRunningAntigravity(log) {
  log('Closing existing Antigravity.exe instance...');
  await execFileAsync('taskkill.exe', ['/IM', 'Antigravity.exe'], { windowsHide: true }).catch(() => {});

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await isAntigravityRunning())) {
      await sleep(500);
      return;
    }
    await sleep(250);
  }

  log('Graceful close timed out; forcing Antigravity.exe termination...');
  await execFileAsync('taskkill.exe', ['/F', '/IM', 'Antigravity.exe'], { windowsHide: true }).catch(() => {});

  const forceDeadline = Date.now() + 3000;
  while (Date.now() < forceDeadline) {
    if (!(await isAntigravityRunning())) break;
    await sleep(250);
  }
  await sleep(500);
}

async function buildCurrentScript(baseDir = __dirname, hotReload = false) {
  const dict = loadMergedDictionary(baseDir);
  let builder = buildInjectedScript;
  if (hotReload) {
    const injectorUrl = `${pathToFileURL(path.join(baseDir, 'injector.js')).href}?v=${Date.now()}`;
    const mod = await import(injectorUrl);
    if (typeof mod.buildInjectedScript === 'function') {
      builder = mod.buildInjectedScript;
    }
  }
  return {
    dictCount: Object.keys(dict).length,
    scriptSource: builder(dict)
  };
}

async function main() {
  const logPath = path.join(__dirname, 'launcher.log');
  try {
    fs.writeFileSync(logPath, '', 'utf8');
  } catch {
    // Ignore log truncation errors
  }
  const log = createLogger(logPath);

  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
    log(`ERROR: Unsupported Node.js version ${process.version}; Node.js 22+ is required.`);
    await showErrorDialog(`当前 Node.js 版本（${process.version}）过低，本汉化包需要 Node.js 22 或更高版本。\n\n请前往 https://nodejs.org/ 安装最新版 Node.js (LTS) 后重试。`);
    process.exit(1);
  }

  const port = DEFAULT_PORT;
  const exePath = findAntigravityExe();
  if (!exePath) {
    log('ERROR: Antigravity.exe not found.');
    await showErrorDialog('未找到 Antigravity.exe，请确认已安装 Antigravity App，或设置环境变量 ANTIGRAVITY_EXE。');
    process.exit(1);
  }
  log(`Using executable: ${exePath}`);

  let currentMtimeSig = getDictMtimeSignature(__dirname);
  let { dictCount, scriptSource } = await buildCurrentScript(__dirname);
  log(`Loaded ${dictCount} dictionary entries.`);

  // Step A: If CDP mode is already running on port, refresh targets & focus window
  if (await isCdpActive(port)) {
    log(`CDP already active on port ${port}; refreshing targets and focusing existing window.`);
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, 2000);
      const handles = [];
      for (const t of targets) {
        if (isTargetEligible(t)) {
          const h = await attachTarget(t, scriptSource, log).catch(() => null);
          if (h) handles.push(h);
        }
      }
      await sleep(200);
      for (const h of handles) h.close();
    } catch (err) {
      log(`Refresh existing CDP targets failed: ${err.message}`);
    }
    const focusChild = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    focusChild.unref();
    process.exit(0);
  }

  // Step B: If English Antigravity is running without CDP, ask user before relaunching
  if (await isAntigravityRunning()) {
    log('Detected Antigravity.exe running without Chinese CDP mode; prompting user.');
    const confirmed = await promptRelaunchInChinese();
    if (!confirmed) {
      log('User chose not to restart running Antigravity instance.');
      process.exit(0);
    }
    await stopRunningAntigravity(log);
  }

  // Step C: Launch Antigravity with remote debugging port
  log(`Launching Antigravity with --remote-debugging-port=${port}`);
  const appChild = spawn(exePath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  appChild.unref();

  // Step D: Attach & watch loop with hot-reload
  const attached = new Map();
  const attaching = new Set();

  async function syncTargets() {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, 1800);
    for (const target of targets) {
      if (!isTargetEligible(target)) continue;
      const targetId = target.id || target.webSocketDebuggerUrl;
      if (attached.has(targetId) || attaching.has(targetId)) continue;

      attaching.add(targetId);
      attachTarget(target, scriptSource, {
        log,
        onClose: (id) => attached.delete(id)
      })
        .then((handle) => {
          attached.set(targetId, handle);
        })
        .catch((err) => {
          log(`Attach failed for ${targetId}: ${err.message}`);
        })
        .finally(() => {
          attaching.delete(targetId);
        });
    }
  }

  // Initial fast wait up to 30s
  const bootDeadline = Date.now() + 30000;
  let initialAttached = false;
  while (Date.now() < bootDeadline) {
    try {
      await syncTargets();
      if (attached.size > 0 || attaching.size > 0) {
        initialAttached = true;
        break;
      }
    } catch {
      // CDP endpoint still booting
    }
    await sleep(400);
  }

  if (!initialAttached) {
    log('Warning: No eligible CDP targets detected within 30s startup window; continuing monitor.');
  }

  let consecutiveFailures = 0;
  while (true) {
    await sleep(2000);

    try {
      const nextSig = getDictMtimeSignature(__dirname);
      if (nextSig !== currentMtimeSig) {
        currentMtimeSig = nextSig;
        const rebuilt = await buildCurrentScript(__dirname, true);
        dictCount = rebuilt.dictCount;
        scriptSource = rebuilt.scriptSource;
        log(`Dictionary changed on disk; hot-reloading ${dictCount} entries to ${attached.size} target(s).`);
        for (const [id, handle] of attached) {
          if (!handle.isOpen()) {
            attached.delete(id);
            continue;
          }
          await handle.pushUpdate(scriptSource).catch((err) => {
            log(`Hot-reload error on ${id}: ${err.message}`);
          });
        }
      }
    } catch (err) {
      log(`Dictionary watch error: ${err.message}`);
    }

    try {
      await syncTargets();
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 4) {
        const alive = await isAntigravityRunning();
        if (!alive) {
          log('Antigravity.exe is no longer running; exiting launcher.');
          for (const [, handle] of attached) {
            handle.close();
          }
          attached.clear();
          process.exit(0);
        }
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    const log = createLogger(path.join(__dirname, 'launcher.log'));
    log(`Fatal launcher error: ${err?.stack || err}`);
    process.exit(1);
  });
}
