// target 侧 hook console 与全局错误，富文本上报日志，设计说明见 ./README.md

import { getTargetScriptEl } from './util';

type Sender = (raw: string) => void;

// 定位日志来源时据此跳过 chii 内部栈帧
let TARGET_SCRIPT_URL = '';
try {
  const el = getTargetScriptEl();
  if (el && el.src) {
    TARGET_SCRIPT_URL = el.src.split('?')[0].split('#')[0];
  }
} catch (e) {
  // ignore
}

// 开发态按文件名判断，生产态按 target.js URL 判断
function isInternalFrame(url: string, fn: string): boolean {
  const u = url || '';
  const f = fn || '';
  if (/\bchobitsu\b|\bconsoleLogger\b/.test(u) || /\bchobitsu\b|\bconsoleLogger\b/.test(f)) {
    return true;
  }
  if (TARGET_SCRIPT_URL && u.indexOf(TARGET_SCRIPT_URL) >= 0) {
    return true;
  }
  if (/\/target\.js(?:$|[?#:])/.test(u)) {
    return true;
  }
  return false;
}

const TYPES: Record<string, string> = {
  log: 'log',
  warn: 'warning',
  error: 'error',
  info: 'info',
  debug: 'debug',
};

// 单条 64KB 上限，避免巨大对象或自引用字符串撑爆 ws 缓冲与服务端内存
const MAX_TEXT_BYTES = 64 * 1024;

function clampText(s: string): string {
  if (!s) return '';
  if (s.length <= MAX_TEXT_BYTES) return s;
  return s.slice(0, MAX_TEXT_BYTES) + `…<truncated ${s.length - MAX_TEXT_BYTES} chars>`;
}

// 处理循环引用、函数、Error、DOM 节点。深度超过 4 层、数组超过 100 项、键超过 50 个即截断
function stringify(value: any, depth = 0, seen: WeakSet<any> = new WeakSet()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const t = typeof value;
  if (t === 'string') return value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'symbol') {
    try {
      return value.toString();
    } catch (e) {
      return 'Symbol()';
    }
  }
  if (t === 'function') {
    return value.name ? `[Function: ${value.name}]` : '[Function]';
  }

  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof Node !== 'undefined' && value instanceof Node) {
    try {
      if (value instanceof Element) {
        const tag = value.tagName.toLowerCase();
        const id = value.id ? `#${value.id}` : '';
        const cls = value.className && typeof value.className === 'string'
          ? `.${value.className.trim().replace(/\s+/g, '.')}`
          : '';
        return `<${tag}${id}${cls}>`;
      }
      return `[${value.nodeName}]`;
    } catch (e) {
      return '[Node]';
    }
  }

  if (t === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (depth > 4) return Array.isArray(value) ? '[Array]' : '[Object]';

    try {
      if (Array.isArray(value)) {
        const parts: string[] = [];
        const len = Math.min(value.length, 100);
        for (let i = 0; i < len; i++) {
          parts.push(stringify(value[i], depth + 1, seen));
        }
        if (value.length > len) parts.push(`…(+${value.length - len})`);
        return `[${parts.join(', ')}]`;
      }

      if (value instanceof Map) {
        const entries: string[] = [];
        let i = 0;
        value.forEach((v, k) => {
          if (i++ >= 50) return;
          entries.push(`${stringify(k, depth + 1, seen)} => ${stringify(v, depth + 1, seen)}`);
        });
        return `Map(${value.size}) {${entries.join(', ')}}`;
      }
      if (value instanceof Set) {
        const items: string[] = [];
        let i = 0;
        value.forEach(v => {
          if (i++ >= 50) return;
          items.push(stringify(v, depth + 1, seen));
        });
        return `Set(${value.size}) {${items.join(', ')}}`;
      }
      if (value instanceof Date) return value.toISOString();
      if (value instanceof RegExp) return value.toString();

      const keys = Object.keys(value);
      const max = 50;
      const limit = Math.min(keys.length, max);
      const parts: string[] = [];
      for (let i = 0; i < limit; i++) {
        const k = keys[i];
        parts.push(`${k}: ${stringify((value as any)[k], depth + 1, seen)}`);
      }
      if (keys.length > limit) parts.push(`…(+${keys.length - limit})`);

      const ctor =
        value.constructor && value.constructor.name && value.constructor.name !== 'Object'
          ? `${value.constructor.name} `
          : '';
      return `${ctor}{${parts.join(', ')}}`;
    } finally {
      seen.delete(value);
    }
  }

  return String(value);
}

function format(args: any[]): string {
  if (args.length > 0 && typeof args[0] === 'string' && /%[sdifoO]/.test(args[0])) {
    let i = 1;
    const formatted = args[0].replace(/%[sdifoO]/g, m => {
      if (i >= args.length) return m;
      const v = args[i++];
      switch (m) {
        case '%s':
          return typeof v === 'string' ? v : stringify(v);
        case '%d':
        case '%i':
          return String(parseInt(v as any, 10));
        case '%f':
          return String(parseFloat(v as any));
        case '%o':
        case '%O':
          return stringify(v);
        default:
          return m;
      }
    });
    const rest = args.slice(i).map(a => stringify(a));
    return rest.length ? `${formatted} ${rest.join(' ')}` : formatted;
  }
  return args.map(a => stringify(a)).join(' ');
}

interface Source {
  url: string;
  line: number;
  column: number;
  function?: string;
}

// 兼容 V8 与 SpiderMonkey、WebKit 两种栈格式
function parseStackLine(line: string): Source | null {
  if (!line) return null;
  // V8 形如 at fnName (http://x/a.js:1:2) 或 at http://x/a.js:1:2
  let m = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
  if (m) {
    return {
      function: m[1] || '',
      url: m[2],
      line: parseInt(m[3], 10),
      column: parseInt(m[4], 10),
    };
  }
  // Firefox 与 Safari 形如 fnName@http://x/a.js:1:2
  m = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(line);
  if (m) {
    return {
      function: m[1] || '',
      url: m[2],
      line: parseInt(m[3], 10),
      column: parseInt(m[4], 10),
    };
  }
  return null;
}

function captureSource(): Source | null {
  const err: any = {};
  try {
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(err, captureSource);
    } else {
      err.stack = new Error().stack;
    }
  } catch (e) {
    return null;
  }
  const raw: string = err.stack || '';
  if (!raw) return null;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseStackLine(lines[i]);
    if (!parsed) continue;
    // 返回第一个业务调用方
    if (isInternalFrame(parsed.url || '', parsed.function || '')) {
      continue;
    }
    return parsed;
  }
  return null;
}

function sourceToShort(s: Source | null): string {
  if (!s) return '';
  try {
    const u = s.url;
    const idx = Math.max(u.lastIndexOf('/'), u.lastIndexOf('\\'));
    const tail = idx >= 0 ? u.slice(idx + 1) : u;
    const cleaned = tail.split('?')[0].split('#')[0];
    return `${cleaned}:${s.line}:${s.column}`;
  } catch (e) {
    return '';
  }
}

// hook 只装一次，sender 随重连切换
let hooked = false;
let currentSender: Sender | null = null;

function emit(params: Record<string, any>) {
  const sender = currentSender;
  if (!sender) return;
  try {
    sender(
      JSON.stringify({
        method: 'ChiiLog.entry',
        params,
      })
    );
  } catch (e) {
    // ignore
  }
}

function installHooks() {
  if (hooked) return;
  hooked = true;

  Object.keys(TYPES).forEach(name => {
    const original = (console as any)[name];
    if (typeof original !== 'function') return;
    (console as any)[name] = function (...args: any[]) {
      let source: Source | null = null;
      try {
        source = captureSource();
      } catch (e) {
        // ignore
      }
      emit({
        type: TYPES[name],
        text: clampText(format(args)),
        timestamp: Date.now(),
        source: source || undefined,
        sourceLabel: sourceToShort(source),
      });
      return original.apply(console, args);
    };
  });

  const onError = (e: ErrorEvent) => {
    const err = (e as any).error;
    let text: string;
    let source: Source | null = null;

    if (err && err.stack) {
      text = err.stack;
      const lines = String(err.stack).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const p = parseStackLine(lines[i]);
        if (p) {
          source = p;
          break;
        }
      }
    } else {
      // 跨源脚本只能拿到 message 与 filename、lineno、colno
      const loc =
        e.filename || e.lineno
          ? ` at ${e.filename || '<anonymous>'}:${e.lineno || 0}:${e.colno || 0}`
          : '';
      text = (e.message || 'Uncaught error') + loc;
      if (e.filename) {
        source = {
          url: e.filename,
          line: e.lineno || 0,
          column: e.colno || 0,
        };
      }
    }

    emit({
      type: 'error',
      text: clampText(text),
      timestamp: Date.now(),
      source: source || undefined,
      sourceLabel: sourceToShort(source),
    });
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    let text: string;
    let source: Source | null = null;
    if (reason && reason.stack) {
      text = 'Unhandled rejection: ' + reason.stack;
      const lines = String(reason.stack).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const p = parseStackLine(lines[i]);
        if (p) {
          source = p;
          break;
        }
      }
    } else {
      text = 'Unhandled rejection: ' + stringify(reason);
    }
    emit({
      type: 'error',
      text: clampText(text),
      timestamp: Date.now(),
      source: source || undefined,
      sourceLabel: sourceToShort(source),
    });
  };

  try {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  } catch (e) {
    // ignore
  }
}

// send 传 null 可停止上报，hook 仍然保留
export function installConsoleLogger(send: Sender | null) {
  currentSender = send;
  installHooks();
}
