import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION, REGEX_PATTERNS, buildInjectedScript, translateText } from './injector.js';
import { attachTarget, isTargetEligible, loadMergedDictionary } from './launcher.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createMockDom({ withHubBridge = true } = {}) {
  class MockNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentNode = null;
      this.childNodes = [];
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
  }

  class MockText extends MockNode {
    constructor(value) {
      super(3);
      this._nodeValue = value;
    }
    get nodeValue() {
      return this._nodeValue;
    }
    set nodeValue(val) {
      this._nodeValue = val;
    }
  }

  class MockElement extends MockNode {
    constructor(tagName, attrs = {}) {
      super(1);
      this.tagName = tagName.toUpperCase();
      this.attrs = new Map(Object.entries(attrs));
      this.id = attrs.id || '';
      this.className = attrs.class || '';
      this.value = attrs.value || '';
      this.style = {};
      this.textContent = '';
    }
    hasAttribute(name) {
      if (name === 'id' && this.id) return true;
      if (name === 'class' && this.className) return true;
      return this.attrs.has(name);
    }
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      if (name === 'class') return this.className || null;
      return this.attrs.has(name) ? this.attrs.get(name) : null;
    }
    setAttribute(name, value) {
      if (name === 'id') this.id = value;
      else if (name === 'class') this.className = value;
      else this.attrs.set(name, String(value));
    }
    matches(selector) {
      const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
      for (const sel of parts) {
        if (sel === '[contenteditable]:not([contenteditable="false"])') {
          if (this.attrs.has('contenteditable') && this.attrs.get('contenteditable') !== 'false') return true;
          continue;
        }
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          if (this.className.split(/\s+/).includes(cls)) return true;
        } else if (sel.startsWith('[') && sel.endsWith(']')) {
          const inner = sel.slice(1, -1);
          const eqIdx = inner.indexOf('=');
          if (eqIdx === -1) {
            if (this.hasAttribute(inner)) return true;
          } else {
            const k = inner.slice(0, eqIdx);
            const v = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
            if (this.getAttribute(k) === v) return true;
          }
        } else if (this.tagName.toLowerCase() === sel.toLowerCase()) {
          return true;
        }
      }
      return false;
    }
    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
  }

  const documentElement = new MockElement('html');
  const body = new MockElement('body');
  documentElement.appendChild(body);

  const listeners = new Map();
  const docListeners = new Map();
  const observerInstances = [];

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      observerInstances.push(this);
    }
    observe() {}
    disconnect() {}
    trigger(mutations) {
      this.cb(mutations);
    }
  }

  const document = {
    readyState: 'complete',
    documentElement,
    body,
    createElement(tag) {
      return new MockElement(tag);
    },
    getElementById(id) {
      function find(node) {
        if (node.nodeType === 1 && node.id === id) return node;
        for (const c of node.childNodes || []) {
          const hit = find(c);
          if (hit) return hit;
        }
        return null;
      }
      return find(documentElement);
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent(type) {
      for (const fn of docListeners.get(type) || []) fn();
    }
  };

  const windowObj = {
    document,
    MutationObserver: MockMutationObserver,
    setTimeout,
    clearTimeout,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchKeydown(evt) {
      for (const fn of listeners.get('keydown') || []) fn(evt);
    }
  };
  if (withHubBridge) {
    windowObj.electronNative = {};
  }

  const context = vm.createContext({
    window: windowObj,
    document,
    MutationObserver: MockMutationObserver,
    setTimeout,
    clearTimeout,
    console
  });

  return {
    context,
    window: windowObj,
    document,
    body,
    MockElement,
    MockText,
    observerInstances,
    listeners
  };
}

function createMockCdpWsServer() {
  const received = [];
  const sockets = new Set();

  function encodeWsText(str) {
    const payload = Buffer.from(str, 'utf8');
    if (payload.length < 126) {
      return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
    }
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n'));

    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < offset + 2) return;
          len = buf.readUInt16BE(offset);
          offset += 2;
        } else if (len === 127) {
          if (buf.length < offset + 8) return;
          len = Number(buf.readBigUInt64BE(offset));
          offset += 8;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + len) return;

        const maskKey = masked ? buf.subarray(offset, offset + 4) : null;
        offset += maskLen;
        const payload = Buffer.from(buf.subarray(offset, offset + len));
        buf = buf.subarray(offset + len);

        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (masked && maskKey) {
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= maskKey[i % 4];
          }
        }
        if (opcode === 0x1) {
          const msg = JSON.parse(payload.toString('utf8'));
          received.push(msg);
          let result = {};
          if (msg.method === 'Page.addScriptToEvaluateOnNewDocument') {
            result = { identifier: `id-${received.length}` };
          }
          socket.write(encodeWsText(JSON.stringify({ id: msg.id, result })));
        }
      }
    });
  });

  return {
    server,
    received,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    },
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test('dictionaries are valid UTF-8 JSON with >= 1200 entries, screenshot strings, and merge cleanly', () => {
  const baseDict = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict.zh-CN.json'), 'utf8'));
  const customDict = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict.custom.json'), 'utf8'));

  assert.equal(typeof baseDict, 'object');
  assert.equal(typeof customDict, 'object');
  const keys = Object.keys(baseDict);
  assert.ok(keys.length >= 1200, `Expected >= 1200 entries, got ${keys.length}`);
  for (const k of keys) {
    assert.equal(typeof baseDict[k], 'string');
    assert.ok(baseDict[k].length > 0, `Empty translation for ${k}`);
  }

  assert.equal(baseDict['Ask anything, @ to mention, / for actions'], '输入任何问题，输入 @ 提及上下文，输入 / 调用操作');
  assert.equal(baseDict['Interface Layout'], '界面布局');
  assert.equal(baseDict['Knowledge Work'], '知识工作');
  assert.equal(baseDict['Software Engineering'], '软件工程');
  assert.equal(baseDict['Global Permissions'], '全局权限');
  assert.equal(baseDict['Permission preset'], '权限预设');
  assert.equal(baseDict['Tool permissions'], '工具权限');
  assert.equal(baseDict['Network access rules'], '网络访问规则');
  assert.equal(baseDict['Queued messages'], '排队消息');
  assert.equal(baseDict['Send Immediately'], '立即发送');
  assert.equal(baseDict['Queue'], '排队发送');
  assert.equal(baseDict['Not set'], '未设置');
  assert.equal(baseDict['System default'], '系统默认');
  assert.equal(baseDict['Not in Project'], '未归属项目');
  assert.equal(baseDict['CLI Project'], 'CLI 项目');
  assert.equal(baseDict['Give Feedback'], '提供反馈');
  assert.equal(baseDict['Open'], '打开');
  assert.equal(baseDict['Change'], '更改');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-zh-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'dict.zh-CN.json'), JSON.stringify({ Settings: '设置', Cancel: '取消' }));
    fs.writeFileSync(path.join(tmpDir, 'dict.custom.json'), JSON.stringify({ Settings: '自定义设置', NewItem: '新项' }));
    const merged = loadMergedDictionary(tmpDir);
    assert.equal(merged.Settings, '自定义设置');
    assert.equal(merged.Cancel, '取消');
    assert.equal(merged.NewItem, '新项');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('translateText handles exact, case-insensitive, regex patterns, and isolation rules', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict.zh-CN.json'), 'utf8'));
  assert.ok(REGEX_PATTERNS.length >= 20);

  assert.equal(translateText('New Conversation', dict), '新建对话');
  assert.equal(translateText('new conversation', dict), '新建对话');
  assert.equal(translateText('5 minutes ago', dict), '5 分钟前');
  assert.equal(translateText('3 files changed', dict), '已更改 3 个文件');
  assert.equal(translateText('Thought for 12s', dict), '思考了 12 秒');
  assert.equal(translateText('Thought for 1m 20s', dict), '思考了 1 分 20 秒');
  assert.equal(translateText('Step 2 of 5', dict), '第 2 步，共 5 步');
  assert.equal(translateText('Updated 2 hours ago', dict), '更新于 2 小时前');
  assert.equal(translateText('Search projects...', dict), '搜索项目...');
  assert.equal(translateText('Search webhooks...', dict), '搜索 webhooks...');

  // Long exact match (>180 chars) works, while non-dict text >180 chars is still skipped
  const longDesc = 'The agent never asks for confirmation before executing terminal commands (except those in the Deny list). This provides the agent with the maximum ability to operate over long periods without intervention, but also has the highest risk of the agent executing an unsafe terminal command.';
  assert.ok(longDesc.length > 180);
  assert.equal(translateText(longDesc, dict), dict[longDesc]);
  assert.equal(translateText('Permission preset:', dict), '权限预设：');
  assert.equal(translateText('Select Sidebar Item 3', dict), '选择侧边栏第 3 项');
  assert.equal(translateText('2 overrides', dict), '2 项覆盖');
  assert.equal(translateText('5 rules', dict), '5 条规则');
  assert.equal(translateText('3 skills', dict), '3 个技能');
  assert.equal(translateText('4 plugins', dict), '4 个插件');
  assert.equal(translateText('2 servers', dict), '2 个服务器');
  assert.equal(translateText('7 conversations', dict), '7 个对话');
  assert.equal(translateText('2 projects', dict), '2 个项目');
  assert.equal(translateText('Inherits your Global Permissions when working locally.', dict), '在本地工作时继承你的全局权限。');
  assert.equal(translateText('Inherits your Global Permissions when working on remote-dev.', dict), '在 remote-dev 上工作时继承你的全局权限。');

  // Model names and tier badges must remain in English
  assert.equal(translateText('Gemini 4 Argon', dict), null);
  assert.equal(translateText('Gemini 4 Neon Extra High', dict), null);
  assert.equal(translateText('Gemini 4 Hydrogen Extra High', dict), null);
  assert.equal(translateText('Pro', dict), null);
  assert.equal(translateText('High', dict), null);
  assert.equal(translateText('Medium', dict), null);
  assert.equal(translateText('Low', dict), null);

  // Models & Notifications screenshots + dynamic quota templates
  assert.equal(
    translateText('Show system notifications when your action is needed or the agent finishes.', dict),
    '当需要你操作或智能体完成任务时显示系统通知。'
  );
  assert.equal(translateText('Upgrade', dict), '升级');
  assert.equal(
    translateText('You can upgrade to a Google AI Ultra plan to receive higher rate limits.', dict),
    '你可以升级到 Google AI Ultra 方案以获得更高的速率限制。'
  );
  assert.equal(
    translateText(
      "When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.",
      dict
    ),
    '开启后，当模型配额用尽时，Antigravity 将使用你的 AI 额度来处理模型请求。Antigravity 始终会优先使用模型配额，再消耗 AI 额度。'
  );
  assert.equal(translateText('Gemini Models', dict), 'Gemini 模型');
  assert.equal(translateText('Claude and GPT models', dict), 'Claude 与 GPT 模型');
  assert.equal(translateText('Weekly Limit Remaining', dict), '本周剩余限额');
  assert.equal(translateText('Five Hour Limit Remaining', dict), '5 小时剩余限额');
  assert.equal(translateText('Gemini 4 Argon Weekly Limit', dict), 'Gemini 4 Argon 每周限额');
  assert.equal(
    translateText('You have used some of your weekly limit, it will fully refresh in 5 days, 19 hours.', dict),
    '你已使用部分本周限额，将在 5 天 19 小时后完全刷新。'
  );
  assert.equal(
    translateText('You have used some of your 5-hour limit, it will fully refresh in 3 hours, 32 minutes.', dict),
    '你已使用部分 5 小时限额，将在 3 小时 32 分钟后完全刷新。'
  );
  assert.equal(
    translateText('You have used some of your 5-hour limit, it will refresh in less than a minute.', dict),
    '你已使用部分 5 小时限额，将在 不到 1 分钟后刷新。'
  );
  assert.equal(
    translateText('You have reached your weekly limit, it will fully refresh in less than an hour.', dict),
    '你已用完本周限额，将在 不到 1 小时后完全刷新。'
  );
  assert.equal(translateText('Available AI Credits: 250', dict), '可用 AI 额度：250');
  assert.equal(translateText('Your Plan: Google AI Pro', dict), '当前方案：Google AI Pro');

  // Fixed approval prompts & activity/duration indicators
  assert.equal(
    translateText('Allow run expanded test suite after polish?', dict),
    '允许 run expanded test suite after polish 吗？'
  );
  assert.equal(
    translateText('Allow running this command outside the sandbox?', dict),
    '允许在沙盒外运行此命令吗？'
  );
  assert.equal(translateText('Yes, allow this time', dict), '是，仅本次允许');
  assert.equal(
    translateText(
      "Yes, and always allow 'node --test C:\\Users\\demo\\.gemini\\antigravity\\scratch\\antigravity-zh-cn\\test.mjs' in this conversation",
      dict
    ),
    "是，且在当前对话中始终允许 'node --test C:\\Users\\demo\\.gemini\\antigravity\\scratch\\antigravity-zh-cn\\test.mjs'"
  );
  assert.equal(
    translateText(
      "Yes, and always allow 'node --test C:\\Users\\demo\\.gemini\\antigravity\\scratch\\antigravity-zh-cn\\test.mjs'",
      dict
    ),
    "是，且始终允许 'node --test C:\\Users\\demo\\.gemini\\antigravity\\scratch\\antigravity-zh-cn\\test.mjs'"
  );
  assert.equal(
    translateText(
      'Yes, and always allow \'curl https://example.com && node -e "const a = 1"\'',
      dict
    ),
    '是，且始终允许 \'curl https://example.com && node -e "const a = 1"\''
  );
  assert.equal(
    translateText('Yes, always allow https://example.com', dict),
    '是，始终允许 https://example.com'
  );
  assert.equal(
    translateText('Requesting permission to run (unsandboxed) npm test', dict),
    '请求权限以在沙盒外运行 npm test'
  );
  assert.equal(
    translateText('(tell the agent what to do instead)', dict),
    '（告诉智能体改用其他做法）'
  );
  assert.equal(translateText('Worked for 4m', dict), '已工作 4 分钟');
  assert.equal(translateText('Worked for 2m 15s · 3 updates', dict), '已工作 2 分 15 秒 · 3 条进展');
  assert.equal(translateText('2m 15s', dict), '2 分 15 秒');
  assert.equal(translateText('4m', dict), '4 分钟');
  assert.equal(translateText('5M', dict), null);

  assert.equal(translateText('新建对话', dict), null);
  assert.equal(translateText('https://antigravity.google/docs', dict), null);
  assert.equal(translateText('C:\\Users\\demo\\Desktop\\Antigravity.lnk', dict), null);
  assert.equal(translateText('/usr/local/bin/node', dict), null);
  assert.equal(translateText('package.json', dict), null);
  assert.equal(translateText('camelCaseIdentifier', dict), null);
  assert.equal(translateText('snake_case_identifier', dict), null);
  assert.equal(translateText('2.34.0', dict), null);
  assert.equal(translateText('a '.repeat(100), dict), null);
});

test('injected runtime does NOT activate outside Hub windows', async () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict.zh-CN.json'), 'utf8'));
  const dom = createMockDom({ withHubBridge: false });
  const btn = new dom.MockElement('button');
  const txt = new dom.MockText('New Conversation');
  btn.appendChild(txt);
  dom.body.appendChild(btn);

  vm.runInContext(buildInjectedScript(dict), dom.context);
  dom.document.dispatchEvent('DOMContentLoaded');
  await new Promise((r) => setTimeout(r, 550));

  assert.equal(txt.nodeValue, 'New Conversation');
  assert.equal(dom.window.__agyZhCn, undefined);
});

test('injected runtime translates Hub UI, protects code/markdown, tracks React updates, toggles, and hot-reloads', async () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict.zh-CN.json'), 'utf8'));
  const dom = createMockDom({ withHubBridge: true });

  const sidebarBtn = new dom.MockElement('button');
  const sidebarTxt = new dom.MockText('  New Conversation  ');
  sidebarBtn.appendChild(sidebarTxt);

  const timeTxt = new dom.MockText('5 minutes ago');
  const filesTxt = new dom.MockText('3 files changed');
  const thoughtTxt = new dom.MockText('Thought for 12s');
  const stateSpan = new dom.MockElement('span', { id: 'react-state' });
  const stateTxt = new dom.MockText('Running');
  stateSpan.appendChild(stateTxt);

  const inputEl = new dom.MockElement('input', {
    placeholder: 'Search conversations...',
    'aria-label': 'Settings',
    value: 'do not touch'
  });
  const composerEl = new dom.MockElement('div', {
    'data-placeholder': 'Ask anything, @ to mention, / for actions'
  });
  const textareaEl = new dom.MockElement('textarea', {
    placeholder: 'Ask anything...',
    value: 'Running'
  });
  const textareaInner = new dom.MockText('Running');
  textareaEl.appendChild(textareaInner);

  const codeEl = new dom.MockElement('code');
  const codeTxt = new dom.MockText('Settings');
  codeEl.appendChild(codeTxt);

  const preEl = new dom.MockElement('pre');
  const preTxt = new dom.MockText('New Conversation');
  preEl.appendChild(preTxt);

  const mdRoot = new dom.MockElement('div', { 'data-markdown-root': 'true' });
  const mdP = new dom.MockElement('p');
  const mdTxt = new dom.MockText('Settings');
  mdP.appendChild(mdTxt);
  mdRoot.appendChild(mdP);

  const monaco = new dom.MockElement('div', { class: 'monaco-editor' });
  const monacoSpan = new dom.MockElement('span');
  const monacoTxt = new dom.MockText('Running');
  monacoSpan.appendChild(monacoTxt);
  monaco.appendChild(monacoSpan);

  const futureEl = new dom.MockElement('button');
  const futureTxt = new dom.MockText('Brand New UI Button');
  futureEl.appendChild(futureTxt);

  for (const el of [sidebarBtn, stateSpan, inputEl, composerEl, textareaEl, codeEl, preEl, mdRoot, monaco, futureEl]) {
    dom.body.appendChild(el);
  }
  const metaWrap = new dom.MockElement('div');
  metaWrap.appendChild(timeTxt);
  metaWrap.appendChild(filesTxt);
  metaWrap.appendChild(thoughtTxt);
  dom.body.appendChild(metaWrap);

  vm.runInContext(buildInjectedScript(dict), dom.context);

  assert.equal(sidebarTxt.nodeValue, '  新建对话  ');
  assert.equal(timeTxt.nodeValue, '5 分钟前');
  assert.equal(filesTxt.nodeValue, '已更改 3 个文件');
  assert.equal(thoughtTxt.nodeValue, '思考了 12 秒');
  assert.equal(stateTxt.nodeValue, '运行中');
  assert.equal(inputEl.getAttribute('placeholder'), '搜索对话...');
  assert.equal(inputEl.getAttribute('aria-label'), '设置');
  assert.equal(composerEl.getAttribute('data-placeholder'), '输入任何问题，输入 @ 提及上下文，输入 / 调用操作');
  assert.equal(inputEl.value, 'do not touch');
  assert.equal(textareaEl.getAttribute('placeholder'), '输入任何问题...');
  assert.equal(textareaEl.value, 'Running');
  assert.equal(textareaInner.nodeValue, 'Running');
  assert.equal(codeTxt.nodeValue, 'Settings');
  assert.equal(preTxt.nodeValue, 'New Conversation');
  assert.equal(mdTxt.nodeValue, 'Settings');
  assert.equal(monacoTxt.nodeValue, 'Running');
  assert.equal(futureTxt.nodeValue, 'Brand New UI Button');

  // Simulate React updating status text from "运行中" to "Completed"
  stateTxt.nodeValue = 'Completed';
  dom.observerInstances[0].trigger([{ type: 'characterData', target: stateTxt }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(stateTxt.nodeValue, '已完成');

  // Toggle Ctrl + Alt + L to English
  let prevented = false;
  dom.window.dispatchKeydown({
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
    key: 'l',
    code: 'KeyL',
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  assert.equal(sidebarTxt.nodeValue, '  New Conversation  ');
  assert.equal(stateTxt.nodeValue, 'Completed');
  assert.equal(inputEl.getAttribute('placeholder'), 'Search conversations...');
  const toast = dom.document.getElementById('__agy_zh_cn_toast');
  assert.ok(toast);
  assert.equal(toast.textContent, '已切换为英文原版');
  assert.equal(toast.getAttribute('data-no-translate'), 'true');

  // Toggle Ctrl + Alt + L back to Simplified Chinese
  dom.window.dispatchKeydown({
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
    key: 'L',
    code: 'KeyL',
    preventDefault() {}
  });
  assert.equal(sidebarTxt.nodeValue, '  新建对话  ');
  assert.equal(stateTxt.nodeValue, '已完成');
  assert.equal(toast.textContent, '已切换为简体中文');

  // Re-inject updated dictionary (hot-reload) without duplicating observer/listeners
  const updatedDict = { ...dict, 'Brand New UI Button': '全新按钮' };
  vm.runInContext(buildInjectedScript(updatedDict), dom.context);
  assert.equal(futureTxt.nodeValue, '全新按钮');
  assert.equal(dom.observerInstances.length, 1);
  assert.equal(dom.listeners.get('keydown').length, 1);
});

test('injected runtime cleanly hot-upgrades from legacy v1 engine and supports destroy()', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'dict.zh-CN.json'), 'utf8'));
  const dom = createMockDom({ withHubBridge: true });

  const creditsEl = new dom.MockElement('p');
  const creditsTxt = new dom.MockText(
    "When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits."
  );
  creditsEl.appendChild(creditsTxt);

  const weeklyEl = new dom.MockElement('p');
  const weeklyTxt = new dom.MockText('You have used some of your weekly limit, it will fully refresh in 5 days, 19 hours.');
  weeklyEl.appendChild(weeklyTxt);

  const fiveHrEl = new dom.MockElement('p');
  const fiveHrTxt = new dom.MockText('You have used some of your 5-hour limit, it will fully refresh in 3 hours, 18 minutes.');
  fiveHrEl.appendChild(fiveHrTxt);

  const legacyNode = new dom.MockElement('span');
  const legacyTxt = new dom.MockText('设置');
  legacyNode.appendChild(legacyTxt);

  for (const el of [creditsEl, weeklyEl, fiveHrEl, legacyNode]) {
    dom.body.appendChild(el);
  }

  let legacyDisconnected = false;
  let legacyUpdateArg = null;
  dom.window.__agyZhCn = {
    enabled: true,
    observer: {
      disconnect() {
        legacyDisconnected = true;
      }
    },
    updateDict(d) {
      legacyUpdateArg = d;
      if (d && Object.keys(d).length === 0) {
        legacyTxt.nodeValue = 'Settings';
      }
    }
  };

  vm.runInContext(buildInjectedScript(dict), dom.context);

  assert.equal(legacyDisconnected, true);
  assert.ok(legacyUpdateArg && typeof legacyUpdateArg === 'object');
  assert.equal(Object.keys(legacyUpdateArg).length, 0);
  assert.equal(dom.window.__agyZhCn.version, ENGINE_VERSION);
  assert.equal(typeof dom.window.__agyZhCn.destroy, 'function');
  assert.equal(
    creditsTxt.nodeValue,
    '开启后，当模型配额用尽时，Antigravity 将使用你的 AI 额度来处理模型请求。Antigravity 始终会优先使用模型配额，再消耗 AI 额度。'
  );
  assert.equal(weeklyTxt.nodeValue, '你已使用部分本周限额，将在 5 天 19 小时后完全刷新。');
  assert.equal(fiveHrTxt.nodeValue, '你已使用部分 5 小时限额，将在 3 小时 18 分钟后完全刷新。');
  assert.equal(legacyTxt.nodeValue, '设置');
  assert.equal(dom.listeners.get('keydown').length, 1);

  dom.window.__agyZhCn.destroy();
  assert.equal(dom.window.__agyZhCn, undefined);
  assert.equal(
    creditsTxt.nodeValue,
    "When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits."
  );
  assert.equal(weeklyTxt.nodeValue, 'You have used some of your weekly limit, it will fully refresh in 5 days, 19 hours.');
  assert.equal(fiveHrTxt.nodeValue, 'You have used some of your 5-hour limit, it will fully refresh in 3 hours, 18 minutes.');
  assert.equal(legacyTxt.nodeValue, 'Settings');
  assert.equal(dom.listeners.get('keydown').length, 0);
});

test('isTargetEligible filters CDP targets safely', () => {
  assert.equal(isTargetEligible({ type: 'page', url: 'http://127.0.0.1:5000/', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/1' }), true);
  assert.equal(isTargetEligible({ type: 'page', url: 'http://localhost:3000/app', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/2' }), true);
  assert.equal(isTargetEligible({ type: 'page', url: 'plugin://abc123/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/3' }), true);
  assert.equal(isTargetEligible({ type: 'page', url: 'file:///C:/app/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/4' }), true);
  assert.equal(isTargetEligible({ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/5' }), true);
  assert.equal(isTargetEligible({ type: 'page', url: '', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/6' }), true);

  assert.equal(isTargetEligible({ type: 'page', url: 'devtools://devtools/bundled/inspector.html', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/7' }), false);
  assert.equal(isTargetEligible({ type: 'page', url: 'chrome-extension://id/popup.html', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/8' }), false);
  assert.equal(isTargetEligible({ type: 'page', url: 'agy-browser-stream://view/1', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/9' }), false);
  assert.equal(isTargetEligible({ type: 'page', url: 'https://www.google.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/10' }), false);
  assert.equal(isTargetEligible({ type: 'page', url: 'data:text/html,hi', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/11' }), false);
  assert.equal(isTargetEligible({ type: 'service_worker', url: 'http://127.0.0.1:5000/sw.js', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/12' }), false);
  assert.equal(isTargetEligible({ type: 'page', url: 'http://127.0.0.1:5000/' }), false);
});

test('attachTarget communicates with mock CDP WebSocket server and pushes hot updates', async () => {
  const mock = createMockCdpWsServer();
  const port = await mock.start();
  try {
    const handle = await attachTarget({
      id: 'mock-page-1',
      url: 'http://127.0.0.1:5000/',
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/mock-page-1`
    }, 'window.__initial = 1;');

    assert.equal(handle.isOpen(), true);
    assert.deepEqual(
      mock.received.map((m) => m.method),
      ['Page.enable', 'Runtime.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.evaluate']
    );
    assert.equal(mock.received[2].params.source, 'window.__initial = 1;');
    assert.equal(mock.received[3].params.expression, 'window.__initial = 1;');

    const pushed = await handle.pushUpdate('window.__updated = 2;');
    assert.equal(pushed, true);
    assert.deepEqual(
      mock.received.slice(4).map((m) => m.method),
      ['Page.removeScriptToEvaluateOnNewDocument', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.evaluate']
    );
    assert.equal(mock.received[4].params.identifier, 'id-3');
    assert.equal(mock.received[5].params.source, 'window.__updated = 2;');
    assert.equal(mock.received[6].params.expression, 'window.__updated = 2;');

    handle.close();
  } finally {
    await mock.stop();
  }
});
