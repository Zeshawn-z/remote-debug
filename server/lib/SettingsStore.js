// 全局设置持久化，文件 ~/.chii/settings.json

const fs = require('fs');
const os = require('os');
const path = require('path');
const Emitter = require('licia/Emitter');
const randomId = require('licia/randomId');

const SETTINGS_DIR = path.join(os.homedir(), '.chii');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  titleRules: [],
  debug: {
    enabled: false,
  },
  connLog: {
    enabled: true,
  },
  baseUrl: '',
  bizHosts: [],
};

function safeParse(raw) {
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

// 只识别 * 和 ?，其余字符全部转义
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

// 业务域名在设置里配置，未配置时恒为 false
function isBizHost(host, bizHosts) {
  if (!host || !bizHosts || !bizHosts.length) return false;
  const h = String(host).toLowerCase();
  for (let i = 0; i < bizHosts.length; i++) {
    const p = String(bizHosts[i] || '')
      .trim()
      .toLowerCase();
    if (!p) continue;
    try {
      if (globToRegExp(p).test(h)) return true;
    } catch (e) {
      // 无效 pattern 直接跳过
    }
  }
  return false;
}

// 业务域名下 pattern 当作 path 加 search 的子串匹配
function bizMatches(rule, url, bizHosts) {
  try {
    const u = new URL(url);
    if (!isBizHost(u.hostname, bizHosts)) return false;
    const sub = String(rule.pattern || '').toLowerCase();
    if (!sub) return false;
    return (u.pathname + u.search).toLowerCase().indexOf(sub) >= 0;
  } catch (e) {
    return false;
  }
}

function ruleMatches(rule, url, bizHosts) {
  if (!rule || !rule.enabled || !rule.pattern || !url) return false;
  if (rule.bizDomain) return bizMatches(rule, url, bizHosts);
  try {
    return globToRegExp(rule.pattern).test(url);
  } catch (e) {
    return false;
  }
}

class SettingsStore extends Emitter {
  constructor() {
    super();
    this._settings = this._load();
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    const parsed = safeParse(raw);
    if (!parsed) {
      console.warn(
        `[chii] settings file is not valid JSON, using defaults: ${SETTINGS_FILE}`
      );
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return this._normalize(parsed);
  }

  _normalize(data) {
    const ret = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (Array.isArray(data.titleRules)) {
      ret.titleRules = data.titleRules
        .map(r => this._normalizeRule(r))
        .filter(Boolean);
    }
    if (data.debug && typeof data.debug === 'object') {
      ret.debug.enabled = !!data.debug.enabled;
    }
    if (data.connLog && typeof data.connLog === 'object') {
      ret.connLog.enabled = !!data.connLog.enabled;
    }
    if (typeof data.baseUrl === 'string') {
      ret.baseUrl = data.baseUrl.trim();
    } else if (typeof data.bindBaseUrl === 'string') {
      // 兼容旧字段名 bindBaseUrl
      ret.baseUrl = data.bindBaseUrl.trim();
    }
    if (Array.isArray(data.bizHosts)) {
      ret.bizHosts = data.bizHosts
        .map(h => (typeof h === 'string' ? h.trim() : ''))
        .filter((h, i, arr) => h && arr.indexOf(h) === i);
    }
    return ret;
  }

  _normalizeRule(r) {
    if (!r || typeof r !== 'object') return null;
    const pattern = typeof r.pattern === 'string' ? r.pattern : '';
    const title = typeof r.title === 'string' ? r.title : '';
    if (!pattern || !title) return null;
    return {
      id: typeof r.id === 'string' && r.id ? r.id : randomId(8),
      pattern,
      title,
      enabled: r.enabled !== false,
      // 开启后 pattern 按路径子串匹配，只在 bizHosts 命中的域名下生效
      bizDomain: !!r.bizDomain,
    };
  }

  get() {
    // 深拷贝，避免外部修改污染内部状态
    return JSON.parse(JSON.stringify(this._settings));
  }

  // 全量替换，返回归一化后的最新设置
  replace(next) {
    const normalized = this._normalize(next || {});
    this._settings = normalized;
    this._save();
    this.emit('change', this.get());
    return this.get();
  }

  _save() {
    try {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    } catch (e) {
      // ignore
    }
    const json = JSON.stringify(this._settings, null, 2);
    const tmp = SETTINGS_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, SETTINGS_FILE);
    } catch (e) {
      // 写盘失败不影响内存设置生效
      // eslint-disable-next-line no-console
      console.error('[chii] failed to save settings:', e && e.message);
    }
  }

  // 未命中规则时返回原 title
  applyTitle(url, originalTitle) {
    const rules = this._settings.titleRules || [];
    const bizHosts = this._settings.bizHosts || [];
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], url, bizHosts)) {
        return rules[i].title;
      }
    }
    return originalTitle || '';
  }

  isDebugEnabled() {
    return !!(this._settings.debug && this._settings.debug.enabled);
  }

  isConnLogEnabled() {
    return !!(this._settings.connLog && this._settings.connLog.enabled);
  }
}

module.exports = new SettingsStore();
