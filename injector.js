/**
 * Antigravity App 简体中文动态注入与翻译引擎
 * - 零依赖、不修改任何原生文件（app.asar / 签名）
 * - 仅在拥有 electronNative / agent 桥接的 Hub 主界面窗口激活
 * - 严格隔离 Markdown 正文、代码块、编辑器与输入框内容
 * - 跟踪 React 重渲染，支持 Ctrl + Alt + L 实时中英文切换与词库热更新
 */

function buildRegexRules() {
  function formatDuration(raw) {
    let text = String(raw || '').trim();
    if (!text) return text;
    if (/^(?:less than a second|<\s*1\s*s)$/i.test(text)) {
      return '不到 1 秒';
    }
    if (/^less than a minute$/i.test(text)) {
      return '不到 1 分钟';
    }
    if (/^less than an hour$/i.test(text)) {
      return '不到 1 小时';
    }
    text = text
      .replace(/,/g, ' ')
      .replace(/(\d+)\s*(?:weeks?|wks?|w)\b/gi, '$1 周')
      .replace(/(\d+)\s*(?:days?|d)\b/gi, '$1 天')
      .replace(/(\d+)\s*(?:hours?|hrs?|h)\b/gi, '$1 小时')
      .replace(/(\d+)\s*(?:minutes?|mins?|m)\b(?=\s*\d)/gi, '$1 分')
      .replace(/(\d+)\s*(?:minutes?|mins?|m)\b/gi, '$1 分钟')
      .replace(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/gi, '$1 秒')
      .replace(/(\d+)\s*(?:milliseconds?|ms)\b/gi, '$1 毫秒');
    return text.replace(/\s+/g, ' ').trim();
  }

  function formatQuotaPeriod(period) {
    const p = String(period || '').toLowerCase();
    if (p === 'weekly') return '本周';
    if (p === '5-hour' || p === 'five-hour') return ' 5 小时';
    if (p === 'daily') return '每日';
    if (p === 'hourly') return '每小时';
    if (p === 'monthly') return '每月';
    return period;
  }

  return [
    {
      name: 'seconds_ago',
      pattern: /^(\d+)\s+seconds?\s+ago$/i,
      replace: (m) => `${m[1]} 秒前`
    },
    {
      name: 'minutes_ago',
      pattern: /^(\d+)\s+minutes?\s+ago$/i,
      replace: (m) => `${m[1]} 分钟前`
    },
    {
      name: 'hours_ago',
      pattern: /^(\d+)\s+hours?\s+ago$/i,
      replace: (m) => `${m[1]} 小时前`
    },
    {
      name: 'days_ago',
      pattern: /^(\d+)\s+days?\s+ago$/i,
      replace: (m) => `${m[1]} 天前`
    },
    {
      name: 'weeks_ago',
      pattern: /^(\d+)\s+weeks?\s+ago$/i,
      replace: (m) => `${m[1]} 周前`
    },
    {
      name: 'months_ago',
      pattern: /^(\d+)\s+months?\s+ago$/i,
      replace: (m) => `${m[1]} 个月前`
    },
    {
      name: 'years_ago',
      pattern: /^(\d+)\s+years?\s+ago$/i,
      replace: (m) => `${m[1]} 年前`
    },
    {
      name: 'in_seconds',
      pattern: /^in\s+(\d+)\s+seconds?$/i,
      replace: (m) => `${m[1]} 秒后`
    },
    {
      name: 'in_minutes',
      pattern: /^in\s+(\d+)\s+minutes?$/i,
      replace: (m) => `${m[1]} 分钟后`
    },
    {
      name: 'in_hours',
      pattern: /^in\s+(\d+)\s+hours?$/i,
      replace: (m) => `${m[1]} 小时后`
    },
    {
      name: 'in_days',
      pattern: /^in\s+(\d+)\s+days?$/i,
      replace: (m) => `${m[1]} 天后`
    },
    {
      name: 'thought_for',
      pattern: /^Thought for (.+)$/i,
      replace: (m) => `思考了 ${formatDuration(m[1])}`
    },
    {
      name: 'thinking_for',
      pattern: /^Thinking for (.+)$/i,
      replace: (m) => `正在思考（${formatDuration(m[1])}）`
    },
    {
      name: 'files_changed',
      pattern: /^(\d+)\s+files?\s+changed$/i,
      replace: (m) => `已更改 ${m[1]} 个文件`
    },
    {
      name: 'changes_count',
      pattern: /^(\d+)\s+changes?$/i,
      replace: (m) => `${m[1]} 处更改`
    },
    {
      name: 'tasks_count',
      pattern: /^(\d+)\s+tasks?$/i,
      replace: (m) => `${m[1]} 个任务`
    },
    {
      name: 'subagents_count',
      pattern: /^(\d+)\s+subagents?$/i,
      replace: (m) => `${m[1]} 个子代理`
    },
    {
      name: 'artifacts_count',
      pattern: /^(\d+)\s+artifacts?$/i,
      replace: (m) => `${m[1]} 个产物`
    },
    {
      name: 'terminals_count',
      pattern: /^(\d+)\s+terminals?$/i,
      replace: (m) => `${m[1]} 个终端`
    },
    {
      name: 'results_count',
      pattern: /^(\d+)\s+results?$/i,
      replace: (m) => `${m[1]} 条结果`
    },
    {
      name: 'selected_count',
      pattern: /^(\d+)\s+selected$/i,
      replace: (m) => `已选择 ${m[1]} 项`
    },
    {
      name: 'items_count',
      pattern: /^(\d+)\s+items?$/i,
      replace: (m) => `${m[1]} 项`
    },
    {
      name: 'show_more',
      pattern: /^Show (\d+) more$/i,
      replace: (m) => `显示另外 ${m[1]} 项`
    },
    {
      name: 'view_all_count',
      pattern: /^View all (\d+)(?:\s+[A-Za-z ]+)?$/i,
      replace: (m) => `查看全部 ${m[1]} 项`
    },
    {
      name: 'step_of',
      pattern: /^Step (\d+) of (\d+)$/i,
      replace: (m) => `第 ${m[1]} 步，共 ${m[2]} 步`
    },
    {
      name: 'n_of_m',
      pattern: /^(\d+)\s+of\s+(\d+)$/i,
      replace: (m) => `${m[1]} / ${m[2]}`
    },
    {
      name: 'search_placeholder',
      pattern: /^Search (.+?)(?:\.\.\.|…)$/i,
      replace: (m, sub) => `搜索 ${sub(m[1])}...`
    },
    {
      name: 'filter_placeholder',
      pattern: /^Filter (.+?)(?:\.\.\.|…)$/i,
      replace: (m, sub) => `筛选 ${sub(m[1])}...`
    },
    {
      name: 'updated_at',
      pattern: /^Updated (.+)$/i,
      replace: (m, sub) => `更新于 ${sub(m[1])}`
    },
    {
      name: 'created_at',
      pattern: /^Created (.+)$/i,
      replace: (m, sub) => `创建于 ${sub(m[1])}`
    },
    {
      name: 'last_run',
      pattern: /^Last run:?\s+(.+)$/i,
      replace: (m, sub) => `上次运行：${sub(m[1])}`
    },
    {
      name: 'next_run',
      pattern: /^Next run:?\s+(.+)$/i,
      replace: (m, sub) => `下次运行：${sub(m[1])}`
    },
    {
      name: 'version_num',
      pattern: /^Version\s+([vV]?[\d.]+.*)$/i,
      replace: (m) => `版本 ${m[1]}`
    },
    {
      name: 'version_available',
      pattern: /^v([\d.]+)\s+available$/i,
      replace: (m) => `发现新版本 v${m[1]}`
    },
    {
      name: 'select_sidebar_item',
      pattern: /^Select Sidebar Item (\d+)$/i,
      replace: (m) => `选择侧边栏第 ${m[1]} 项`
    },
    {
      name: 'overrides_count',
      pattern: /^(\d+)\s+overrides?$/i,
      replace: (m) => `${m[1]} 项覆盖`
    },
    {
      name: 'rules_count',
      pattern: /^(\d+)\s+rules?$/i,
      replace: (m) => `${m[1]} 条规则`
    },
    {
      name: 'skills_count',
      pattern: /^(\d+)\s+skills?$/i,
      replace: (m) => `${m[1]} 个技能`
    },
    {
      name: 'plugins_count',
      pattern: /^(\d+)\s+plugins?$/i,
      replace: (m) => `${m[1]} 个插件`
    },
    {
      name: 'servers_count',
      pattern: /^(\d+)\s+servers?$/i,
      replace: (m) => `${m[1]} 个服务器`
    },
    {
      name: 'conversations_count',
      pattern: /^(\d+)\s+conversations?$/i,
      replace: (m) => `${m[1]} 个对话`
    },
    {
      name: 'projects_count',
      pattern: /^(\d+)\s+projects?$/i,
      replace: (m) => `${m[1]} 个项目`
    },
    {
      name: 'inherits_global_permissions_on',
      pattern: /^Inherits your Global Permissions when working on (.+)\.$/i,
      replace: (m) => `在 ${m[1]} 上工作时继承你的全局权限。`
    },
    {
      name: 'inherits_global_permissions',
      pattern: /^Inherits your Global Permissions when working (.+)\.$/i,
      replace: (m, sub) => `在 ${sub(m[1])} 工作时继承你的全局权限。`
    },
    {
      name: 'quota_used_refresh_some_all',
      pattern: /^You have used (some|all) of your (weekly|5-hour|five-hour|daily|hourly|monthly) limit, it will (fully )?refresh in (.+)\.$/i,
      replace: (m) => `你已使用${m[1].toLowerCase() === 'all' ? '全部' : '部分'}${formatQuotaPeriod(m[2])}限额，将在 ${formatDuration(m[4])}后${m[3] ? '完全' : ''}刷新。`
    },
    {
      name: 'quota_used_refresh_pct',
      pattern: /^You have used (\d+%?) of your (weekly|5-hour|five-hour|daily|hourly|monthly) limit, it will (fully )?refresh in (.+)\.$/i,
      replace: (m) => `你已使用 ${m[1]} 的${formatQuotaPeriod(m[2]).trimStart()}限额，将在 ${formatDuration(m[4])}后${m[3] ? '完全' : ''}刷新。`
    },
    {
      name: 'quota_reached_refresh',
      pattern: /^You have reached your (weekly|5-hour|five-hour|daily|hourly|monthly) limit, it will (fully )?refresh in (.+)\.$/i,
      replace: (m) => `你已用完${formatQuotaPeriod(m[1]).trimStart()}限额，将在 ${formatDuration(m[3])}后${m[2] ? '完全' : ''}刷新。`
    },
    {
      name: 'quota_unused',
      pattern: /^You have not used any of your (weekly|5-hour|five-hour|daily|hourly|monthly) limit\.?$/i,
      replace: (m) => `你尚未使用${formatQuotaPeriod(m[1]).trimStart()}限额。`
    },
    {
      name: 'upgrade_plan_rate_limits',
      pattern: /^You can upgrade to a (.+?) plan to receive higher rate limits\.$/i,
      replace: (m) => `你可以升级到 ${m[1]} 方案以获得更高的速率限制。`
    },
    {
      name: 'model_weekly_limit',
      pattern: /^(.+?)\s+Weekly Limit$/i,
      replace: (m) => `${m[1]} 每周限额`
    },
    {
      name: 'model_five_hour_limit',
      pattern: /^(.+?)\s+(?:Five Hour|5-Hour) Limit$/i,
      replace: (m) => `${m[1]} 5 小时限额`
    },
    {
      name: 'model_daily_limit',
      pattern: /^(.+?)\s+Daily Limit$/i,
      replace: (m) => `${m[1]} 每日限额`
    },
    {
      name: 'model_limit_remaining',
      pattern: /^(.+?)\s+Limit Remaining$/i,
      replace: (m) => `${m[1]} 剩余限额`
    },
    {
      name: 'available_ai_credits',
      pattern: /^Available AI Credits:\s*(.+)$/i,
      replace: (m) => `可用 AI 额度：${m[1]}`
    },
    {
      name: 'your_plan_name',
      pattern: /^Your Plan:\s*(.+)$/i,
      replace: (m) => `当前方案：${m[1]}`
    },
    {
      name: 'project_id_val',
      pattern: /^Project ID:\s*(.+)$/i,
      replace: (m) => `项目 ID：${m[1]}`
    },
    {
      name: 'manage_app_settings',
      pattern: /^Manage (.+?) app settings\.$/i,
      replace: (m) => `管理 ${m[1]} 应用设置。`
    },
    {
      name: 'telemetry_toggled_on',
      pattern: /^When toggled on, (.+?) collects usage data to help Google enhance performance and features\.$/i,
      replace: (m) => `开启后，${m[1]} 将收集使用数据，帮助 Google 改进性能与功能。`
    },
    {
      name: 'marketing_emails_product',
      pattern: /^Receive product updates, tips, and promotions from Google (.+?) via email\.$/i,
      replace: (m) => `通过电子邮件接收来自 Google ${m[1]} 的产品更新、使用技巧和优惠活动。`
    },
    {
      name: 'ai_credits_overage_desc',
      pattern: /^When toggled on, (.+?) will use your AI credits to fulfill model requests once you're out of model quota\. \1 will always use your model quota first before using AI credits\.$/i,
      replace: (m) => `开启后，当模型配额用尽时，${m[1]} 将使用你的 AI 额度来处理模型请求。${m[1]} 始终会优先使用模型配额，再消耗 AI 额度。`
    },
    {
      name: 'label_tokens_count',
      pattern: /^(.+?):\s*([\d,]+)\s+tokens$/i,
      replace: (m, sub) => `${sub(m[1])}：${m[2]} tokens`
    },
    {
      name: 'worked_for_duration',
      pattern: /^Worked for (.+?)(?:\s*[·•]\s*(\d+)\s+updates?)?$/i,
      replace: (m) => `已工作 ${formatDuration(m[1])}${m[2] ? ` · ${m[2]} 条进展` : ''}`
    },
    {
      name: 'working_for_duration',
      pattern: /^Working for (.+)$/i,
      replace: (m) => `正在工作（${formatDuration(m[1])}）`
    },
    {
      name: 'updates_count',
      pattern: /^(\d+)\s+updates?$/i,
      replace: (m) => `${m[1]} 条进展`
    },
    {
      name: 'compact_duration_chip',
      pattern: /^(?:<\s*1s|(?:\d+h\s+)?(?:\d+m\s+)?\d+s|(?:\d+h\s+)?\d+m|\d+h)$/,
      replace: (m) => formatDuration(m[0])
    }
  ];
}

function buildApprovalRegexRules() {
  const PERMISSION_VERBS = {
    read: '读取',
    write: '写入',
    'run (unsandboxed)': '在沙盒外运行',
    run: '运行',
    use: '使用',
    'download from': '下载自',
    access: '访问'
  };

  return [
    {
      name: 'yes_allow_downloads_run',
      pattern: /^Yes, allow downloads from (.+) for this run$/i,
      replace: (m) => `是，本次运行允许从 ${m[1]} 下载`
    },
    {
      name: 'yes_allow_downloads_conv',
      pattern: /^Yes, allow downloads from (.+) in this conversation$/i,
      replace: (m) => `是，在当前对话中允许从 ${m[1]} 下载`
    },
    {
      name: 'yes_always_allow_downloads',
      pattern: /^Yes, always allow downloads from (.+)$/i,
      replace: (m) => `是，始终允许从 ${m[1]} 下载`
    },
    {
      name: 'yes_save_rule_conv',
      pattern: /^Yes, save rule for '(.+)' in this conversation$/i,
      replace: (m) => `是，在当前对话中保存 '${m[1]}' 的允许规则`
    },
    {
      name: 'yes_save_rule_global',
      pattern: /^Yes, save rule for '(.+)' globally$/i,
      replace: (m) => `是，保存 '${m[1]}' 的全局允许规则`
    },
    {
      name: 'yes_always_allow_quoted_conv',
      pattern: /^Yes, and always allow '(.+)' in this conversation$/i,
      replace: (m) => `是，且在当前对话中始终允许 '${m[1]}'`
    },
    {
      name: 'yes_always_allow_quoted',
      pattern: /^Yes, and always allow '(.+)'$/i,
      replace: (m) => `是，且始终允许 '${m[1]}'`
    },
    {
      name: 'yes_allow_target_conv',
      pattern: /^Yes, allow (.+) in this conversation$/i,
      replace: (m) => `是，在当前对话中允许 ${m[1]}`
    },
    {
      name: 'yes_always_allow_target',
      pattern: /^Yes, always allow (.+)$/i,
      replace: (m) => `是，始终允许 ${m[1]}`
    },
    {
      name: 'save_rule_always_allow_question',
      pattern: /^Save rule to always allow (.+)\?$/i,
      replace: (m) => `保存规则以始终允许 ${m[1]} 吗？`
    },
    {
      name: 'allow_question',
      pattern: /^Allow (.+)\?$/i,
      replace: (m) => `允许 ${m[1]} 吗？`
    },
    {
      name: 'requesting_permission_to',
      pattern: /^Requesting permission to (read|write|run \(unsandboxed\)|run|use|download from|access) (.+)$/i,
      replace: (m) => {
        const verb = PERMISSION_VERBS[m[1].toLowerCase()] || m[1];
        return `请求权限以${verb} ${m[2]}`;
      }
    }
  ];
}

function createTranslatorCore(dict, rulesBuilder, approvalRulesBuilder) {
  const exactMap = new Map();
  const lowerMap = new Map();

  function loadDict(sourceDict) {
    exactMap.clear();
    lowerMap.clear();
    if (!sourceDict || typeof sourceDict !== 'object') return;
    for (const [k, v] of Object.entries(sourceDict)) {
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      const key = k.trim();
      if (!key || !v) continue;
      exactMap.set(key, v);
      const lowerKey = key.toLowerCase();
      if (!lowerMap.has(lowerKey)) {
        lowerMap.set(lowerKey, v);
      }
    }
  }

  loadDict(dict);
  const regexRules = rulesBuilder();
  const approvalRules = typeof approvalRulesBuilder === 'function' ? approvalRulesBuilder() : [];

  function isNonTranslatableText(trimmed) {
    if (!trimmed || trimmed.length > 500) return true;
    if (/[\u4e00-\u9fff]/.test(trimmed)) return true;
    if (!/[A-Za-z]/.test(trimmed)) return true;
    if (/^(?:https?|wss?|file|plugin|agy-[\w-]+|mailto|data|blob):/i.test(trimmed)) return true;
    const isApprovalCandidate = /^(?:Yes,\s|Allow\s|Save rule to always allow\s|Requesting permission to\s)/i.test(trimmed);
    if (!isApprovalCandidate && /\bhttps?:\/\/\S+/i.test(trimmed)) return true;
    if (/^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\[^\\]/.test(trimmed) || /^~[\\/]/.test(trimmed)) return true;
    if (/^\/[\w.-]+(?:\/[\w.-]+)*$/.test(trimmed)) return true;
    if (/^[\[{][\s\S]*[\]}]$/.test(trimmed)) return true;
    if (/^`[^`]+`$/.test(trimmed)) return true;
    return false;
  }

  function isLikelyCodeOrFilename(trimmed) {
    if (/^[\w.-]+\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|py|go|rs|css|html|htm|bat|vbs|sh|ps1|yml|yaml|toml|xml|exe|dll|asar|lnk|png|jpg|jpeg|svg|webp|txt|log|lock)$/i.test(trimmed)) {
      return true;
    }
    if (/^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(trimmed)) return true;
    if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(trimmed)) return true;
    if (/(?:=>|\b(?:const|let|var|function|import|export|return)\b)/.test(trimmed)) return true;
    return false;
  }

  function lookupDirect(str) {
    if (exactMap.has(str)) return exactMap.get(str);
    const lower = str.toLowerCase();
    if (lowerMap.has(lower)) return lowerMap.get(lower);
    return null;
  }

  function lookupExact(trimmed) {
    const direct = lookupDirect(trimmed);
    if (direct) return direct;
    if (trimmed.endsWith(':') && trimmed.length >= 3) {
      const base = trimmed.slice(0, -1).trim();
      if (base) {
        const baseHit = lookupDirect(base);
        if (baseHit) return `${baseHit}：`;
      }
    }
    return null;
  }

  function translateSub(part) {
    const t = String(part || '').trim();
    if (!t) return part;
    const direct = lookupExact(t);
    if (direct) return direct;
    for (const rule of regexRules) {
      const m = t.match(rule.pattern);
      if (m) return rule.replace(m, translateSub);
    }
    return t;
  }

  function translateText(trimmed) {
    if (isNonTranslatableText(trimmed)) return null;
    const direct = lookupExact(trimmed);
    if (direct) return direct;
    for (const rule of approvalRules) {
      const m = trimmed.match(rule.pattern);
      if (m) return rule.replace(m, translateSub);
    }
    if (trimmed.length > 260) return null;
    if (isLikelyCodeOrFilename(trimmed)) return null;
    for (const rule of regexRules) {
      const m = trimmed.match(rule.pattern);
      if (m) return rule.replace(m, translateSub);
    }
    return null;
  }

  function translatePreservingWhitespace(raw) {
    if (typeof raw !== 'string') return null;
    const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m || !m[2]) return null;
    const translated = translateText(m[2]);
    if (!translated || translated === m[2]) return null;
    return m[1] + translated + m[3];
  }

  return {
    loadDict,
    translateText,
    translatePreservingWhitespace
  };
}

export const ENGINE_VERSION = 2;
export const REGEX_PATTERNS = buildRegexRules();

export function translateText(text, dict = {}) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return null;
  return createTranslatorCore(dict, buildRegexRules, buildApprovalRegexRules).translateText(trimmed);
}

export function buildInjectedScript(dict = {}, options = {}) {
  const serializedDict = JSON.stringify(dict);
  const defaultEnabled = options.enabled !== false;

  return `(function(INITIAL_DICT, DEFAULT_ENABLED, ENGINE_VERSION) {
  'use strict';

  var ROOT_KEY = '__agyZhCn';
  var PENDING_KEY = '__agyZhCnPending';
  var ATTRS = ['placeholder', 'title', 'aria-label', 'data-placeholder'];
  var SKIP_TEXT_SELECTOR = [
    'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option',
    'code', 'pre', 'kbd', 'samp', 'svg', 'canvas', 'math',
    '[contenteditable]:not([contenteditable="false"])',
    '.monaco-editor', '.cm-editor', '.xterm', '.ProseMirror', '.CodeMirror',
    '[data-markdown-root]', '[data-code-block]', '[data-message-content]',
    '.markdown-body', '.prose', '[data-no-translate]'
  ].join(',');
  var SKIP_ATTR_SELECTOR = [
    'script', 'style', 'noscript',
    'code', 'pre', 'kbd', 'samp', 'svg', 'canvas', 'math',
    '.monaco-editor', '.cm-editor', '.xterm', '.ProseMirror', '.CodeMirror',
    '[data-markdown-root]', '[data-code-block]', '[data-message-content]',
    '.markdown-body', '.prose', '[data-no-translate]'
  ].join(',');

  function isHubWindow() {
    return typeof window !== 'undefined' && Boolean(window.electronNative || window.agent);
  }

  var existing = window[ROOT_KEY];
  if (existing) {
    if (existing.version === ENGINE_VERSION) {
      if (typeof existing.updateDict === 'function') {
        existing.updateDict(INITIAL_DICT);
      }
      return;
    }
    var prevEnabled = existing.enabled !== false;
    if (typeof existing.destroy === 'function') {
      existing.destroy();
    } else {
      if (existing.observer && typeof existing.observer.disconnect === 'function') {
        existing.observer.disconnect();
      }
      if (typeof existing.updateDict === 'function') {
        existing.updateDict({});
      }
      delete window[ROOT_KEY];
    }
    DEFAULT_ENABLED = prevEnabled;
  }

  var pending = window[PENDING_KEY] || { dict: INITIAL_DICT, scheduled: false };
  pending.dict = INITIAL_DICT;
  window[PENDING_KEY] = pending;

  function bootIfReady() {
    if (window[ROOT_KEY]) return true;
    if (!isHubWindow()) return false;
    initRuntime(pending.dict);
    return true;
  }

  if (!bootIfReady()) {
    if (!pending.scheduled) {
      pending.scheduled = true;
      if (typeof document !== 'undefined' && document.readyState === 'loading' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', bootIfReady, { once: true });
      }
      setTimeout(bootIfReady, 500);
    }
    return;
  }

  function initRuntime(initialDict) {
    ${buildRegexRules.toString()}
    ${buildApprovalRegexRules.toString()}
    ${createTranslatorCore.toString()}

    var core = createTranslatorCore(initialDict, buildRegexRules, buildApprovalRegexRules);
    var textRecords = new WeakMap();
    var attrRecords = new WeakMap();
    var pendingNodes = new Set();
    var fullRescanPending = false;
    var flushScheduled = false;
    var toastTimer = null;

    var state = {
      version: ENGINE_VERSION,
      enabled: DEFAULT_ENABLED,
      observer: null,
      rescan: rescanAll,
      toggle: toggleLanguage,
      updateDict: updateDictionary,
      destroy: destroyRuntime
    };
    window[ROOT_KEY] = state;

    var scheduleFlush = typeof requestAnimationFrame === 'function'
      ? function(fn) { return requestAnimationFrame(fn); }
      : function(fn) { return setTimeout(fn, 16); };

    function closestMatch(el, selector) {
      if (!el) return null;
      if (typeof el.closest === 'function') return el.closest(selector);
      return null;
    }

    function processTextNode(node) {
      if (!node || node.nodeType !== 3) return;
      var parent = node.parentElement || node.parentNode;
      if (!parent || parent.nodeType !== 1) return;
      if (closestMatch(parent, SKIP_TEXT_SELECTOR)) return;

      var current = node.nodeValue;
      var rec = textRecords.get(node);
      if (!rec) {
        rec = { orig: current, last: current };
        textRecords.set(node, rec);
      } else if (current !== rec.last) {
        rec.orig = current;
        rec.last = current;
      }

      var targetValue = rec.orig;
      if (state.enabled) {
        var translated = core.translatePreservingWhitespace(rec.orig);
        if (translated !== null) {
          targetValue = translated;
        }
      }

      if (node.nodeValue !== targetValue) {
        rec.last = targetValue;
        node.nodeValue = targetValue;
      }
    }

    function processElementAttrs(el) {
      if (!el || el.nodeType !== 1) return;
      if (closestMatch(el, SKIP_ATTR_SELECTOR)) return;

      var map = attrRecords.get(el);
      if (!map) {
        map = new Map();
        attrRecords.set(el, map);
      }

      for (var i = 0; i < ATTRS.length; i++) {
        var attr = ATTRS[i];
        if (typeof el.hasAttribute === 'function' && !el.hasAttribute(attr)) continue;
        var current = typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null;
        if (current === null) continue;

        var rec = map.get(attr);
        if (!rec) {
          rec = { orig: current, last: current };
          map.set(attr, rec);
        } else if (current !== rec.last) {
          rec.orig = current;
          rec.last = current;
        }

        var targetValue = rec.orig;
        if (state.enabled) {
          var translated = core.translatePreservingWhitespace(rec.orig);
          if (translated !== null) {
            targetValue = translated;
          }
        }

        if (current !== targetValue && typeof el.setAttribute === 'function') {
          rec.last = targetValue;
          el.setAttribute(attr, targetValue);
        }
      }
    }

    function walkSubtree(root) {
      if (!root) return;
      if (root.nodeType === 3) {
        processTextNode(root);
        return;
      }
      if (root.nodeType === 1) {
        if (closestMatch(root, SKIP_ATTR_SELECTOR)) return;
        processElementAttrs(root);
      }
      var children = root.childNodes;
      if (!children) return;
      for (var i = 0; i < children.length; i++) {
        walkSubtree(children[i]);
      }
    }

    function flushQueue() {
      flushScheduled = false;
      if (fullRescanPending) {
        fullRescanPending = false;
        pendingNodes.clear();
        if (document.body) walkSubtree(document.body);
        return;
      }
      var items = Array.from(pendingNodes);
      pendingNodes.clear();
      for (var i = 0; i < items.length; i++) {
        walkSubtree(items[i]);
      }
    }

    function queueNode(node, isFull) {
      if (isFull) {
        fullRescanPending = true;
      } else if (node) {
        pendingNodes.add(node);
      }
      if (!flushScheduled) {
        flushScheduled = true;
        scheduleFlush(flushQueue);
      }
    }

    function rescanAll() {
      var target = document.body || document.documentElement;
      if (target) walkSubtree(target);
    }

    function showToast(message) {
      if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return;
      var id = '__agy_zh_cn_toast';
      var toast = typeof document.getElementById === 'function' ? document.getElementById(id) : null;
      if (!toast) {
        toast = document.createElement('div');
        toast.id = id;
        if (typeof toast.setAttribute === 'function') {
          toast.setAttribute('data-no-translate', 'true');
        }
        if (toast.style) {
          toast.style.position = 'fixed';
          toast.style.right = '20px';
          toast.style.bottom = '20px';
          toast.style.zIndex = '2147483647';
          toast.style.padding = '8px 14px';
          toast.style.borderRadius = '8px';
          toast.style.fontSize = '13px';
          toast.style.fontWeight = '500';
          toast.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
          toast.style.background = 'rgba(24, 24, 27, 0.92)';
          toast.style.color = '#f4f4f5';
          toast.style.border = '1px solid rgba(255, 255, 255, 0.14)';
          toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.28)';
          toast.style.pointerEvents = 'none';
          toast.style.transition = 'opacity 0.2s ease';
        }
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      if (toast.style) {
        toast.style.opacity = '1';
      }
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function() {
        if (toast.style) toast.style.opacity = '0';
      }, 1500);
    }

    function toggleLanguage() {
      state.enabled = !state.enabled;
      rescanAll();
      showToast(state.enabled ? '已切换为简体中文' : '已切换为英文原版');
      return state.enabled;
    }

    function updateDictionary(newDict) {
      core.loadDict(newDict);
      rescanAll();
    }

    function attachObserver() {
      if (state.observer || typeof MutationObserver !== 'function') return;
      var root = document.documentElement || document.body;
      if (!root) return;
      var obs = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'characterData') {
            queueNode(m.target, false);
          } else if (m.type === 'attributes') {
            queueNode(m.target, false);
          } else if (m.type === 'childList' && m.addedNodes) {
            for (var j = 0; j < m.addedNodes.length; j++) {
              queueNode(m.addedNodes[j], false);
            }
          }
        }
      });
      obs.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS
      });
      state.observer = obs;
    }

    var onKeyDown = function(e) {
      if (
        e && e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey &&
        (e.key === 'l' || e.key === 'L' || e.code === 'KeyL')
      ) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        toggleLanguage();
      }
    };

    function destroyRuntime() {
      if (state.observer && typeof state.observer.disconnect === 'function') {
        state.observer.disconnect();
        state.observer = null;
      }
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('keydown', onKeyDown, true);
      }
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      state.enabled = false;
      rescanAll();
      if (window[ROOT_KEY] === state) {
        delete window[ROOT_KEY];
      }
    }

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', onKeyDown, true);
    }

    if (typeof document !== 'undefined') {
      if (document.body) {
        rescanAll();
        attachObserver();
      } else if (typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', function() {
          rescanAll();
          attachObserver();
        }, { once: true });
      }
    }
  }
})(${serializedDict}, ${JSON.stringify(defaultEnabled)}, ${ENGINE_VERSION});`;
}
