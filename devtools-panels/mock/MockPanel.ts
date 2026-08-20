// Mock面板

import * as Common from '../../core/common/common.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as Logs from '../../models/logs/logs.js';
import * as CodeMirror from '../../third_party/codemirror.next/codemirror.next.js';
import * as CodeHighlighter from '../../ui/components/code_highlighter/code_highlighter.js';
import * as TextEditor from '../../ui/components/text_editor/text_editor.js';
import * as UI from '../../ui/legacy/legacy.js';

interface MockRule {
  id: string;
  enabled: boolean;
  urlIncludes: string;
  urlRegex?: string;
  urlExcludes?: string;
  method?: string;
  status?: number;
  delayMs?: number;
  requestHeaders?: {[k: string]: string};
  responseHeaders?: {[k: string]: string};
  responseBody?: string;
  requestBody?: string;
  /** sendBeacon 专用：命中时阻断上报（对 fetch/XHR 无效） */
  block?: boolean;
}

interface NetLimits {
  keepFullCount: number;
  maxBodyBytes: number;
}

interface NetState {
  mockEnabled: boolean;
  rules: MockRule[];
  limits?: NetLimits;
}

interface CapturedRequest {
  id: string;
  method: string;
  url: string;
  status: number;
  requestBody: string|null;
  responseBody: string|null;
  request: SDK.NetworkRequest.NetworkRequest|null;
  // 该请求命中了 mock 规则（true=被替换/短路的 mock 请求）
  mocked?: boolean;
  // 命中的规则 id（mocked 条目才有）
  ruleId?: string;
  // 命中记录在 target 侧的唯一标识，用于按需拉取请求/响应体
  hitUid?: string;
  hasReqBody?: boolean;
  hasRespBody?: boolean;
  // 命中体是否已按需拉取过
  bodiesLoaded?: boolean;
  // 真实请求的 requestFormData 是否已按需拉取过
  formDataLoaded?: boolean;
  // 截断前的原始长度，与已拿到的文本长度不等说明还有后续内容
  reqLen?: number;
  respLen?: number;
  // 原文已移出保留窗口
  bodyReleased?: boolean;
}

// target 侧记录的一次 mock 命中（window.__chiiNet.getHits()）
interface MockHit {
  id: number;
  url: string;
  method: string;
  ruleId: string;
  replaced: boolean;
  blocked: boolean;
  status: number|null;
  reqBody?: string;
  respBody?: string;
  ts: number;
}

// 精简命中，供高频增量轮询，不含请求/响应体
interface MockHitLite {
  uid: string;
  seq: number;
  url: string;
  method: string;
  ruleId: string;
  replaced: boolean;
  blocked: boolean;
  status: number|null;
  ts: number;
  hasReqBody: boolean;
  hasRespBody: boolean;
  reqLen?: number;
  respLen?: number;
  released?: boolean;
}

interface MockHitBodies {
  reqBody?: string;
  respBody?: string;
  reqLen?: number;
  respLen?: number;
  reqKept?: number;
  respKept?: number;
  released?: boolean;
}

interface MockBodyFull {
  text?: string;
  len: number;
  kept: number;
  released: boolean;
}

// 代码块底部续拉入口所需信息
interface TruncInfo {
  shownLen: number;
  fullLen: number;
  load: () => Promise<MockBodyFull|null>;
}

interface MockHitsDelta {
  tag: string;
  seq: number;
  hits: MockHitLite[];
  // 旧版 target.js 无增量接口时的降级标记
  legacy?: boolean;
}

interface MockDiagnostics {
  installedAt: number;
  installedAfterMs: number;
  preInstallCount: number;
  preInstallSamples: string[];
}

let mockPanelInstance: MockPanel;

// 取被调试页面的 target：优先 primaryPageTarget，回退 mainFrameTarget / 首个 target。
function getPageTarget(): SDK.Target.Target|null {
  const tm = SDK.TargetManager.TargetManager.instance();
  return tm.primaryPageTarget() || tm.rootTarget() || tm.targets()[0] || null;
}

async function evalInPage<T>(rawExpr: string): Promise<T|null> {
  const target = getPageTarget();
  if (!target) {
    return null;
  }
  try {
    const response = await target.runtimeAgent().invoke_evaluate({
      expression: 'JSON.stringify(' + rawExpr + ')',
      returnByValue: true,
      awaitPromise: true,
      silent: true,
    });
    if (response.getError() || response.exceptionDetails || !response.result) {
      return null;
    }
    const v = response.result.value;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    }
    return (v ?? null) as T | null;
  } catch {
    return null;
  }
}

let idSeq = 0;
function genId(): string {
  idSeq += 1;
  return 'r' + Date.now().toString(36) + '_' + idSeq.toString(36);
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}

function urlHostPath(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url;
  }
}

// 仅路由部分，用于同域名下的列表与详情展示
function urlPath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

// 完整链接去掉 query，用于详情展示
function urlWithoutParams(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

// query 解析为键值数组，值已解码
function urlQueryEntries(url: string): Array<{name: string, value: string}> {
  try {
    const u = new URL(url);
    const out: Array<{name: string, value: string}> = [];
    u.searchParams.forEach((v, k) => {
      out.push({name: k, value: v});
    });
    return out;
  } catch {
    return [];
  }
}

function urlParams(url: string): string {
  try {
    const u = new URL(url);
    if (!u.search) {
      return '';
    }
    const parts: string[] = [];
    u.searchParams.forEach((v, k) => {
      parts.push(k + '=' + v);
    });
    return parts.join('  ');
  } catch {
    return '';
  }
}

// 取完整 host（含端口），用于「完整 host 相同」过滤
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// 尝试把文本格式化为缩进 JSON；非 JSON 或解析失败则原样返回。
function tryFormatJson(text: string): string {
  const t = (text || '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) {
    return text;
  }
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return text;
  }
}

// header 记录 → 多行文本（每行 "Name: Value"）
function headersToText(rec?: {[k: string]: string}): string {
  if (!rec) {
    return '';
  }
  return Object.keys(rec).map(k => k + ': ' + rec[k]).join('\n');
}

function fmtSize(n: number): string {
  if (n < 1024) {
    return n + ' B';
  }
  if (n < 1024 * 1024) {
    return (n / 1024).toFixed(1) + ' KB';
  }
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

// header 记录 → 键值数组
function recToEntries(rec?: {[k: string]: string}|null): Array<{name: string, value: string}> {
  if (!rec) {
    return [];
  }
  return Object.keys(rec).map(k => ({name: k, value: rec[k]}));
}

// 记录 → 有序行
function recToRows(rec?: {[k: string]: string}): Array<{k: string, v: string}> {
  if (!rec) {
    return [];
  }
  return Object.keys(rec).map(k => ({k, v: rec[k]}));
}

// NameValue 数组 → header 记录
function entriesToRec(entries?: Array<{name: string, value: string}>): {[k: string]: string}|undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const out: {[k: string]: string} = {};
  let has = false;
  for (const e of entries) {
    const k = (e.name || '').trim();
    if (!k) {
      continue;
    }
    out[k] = e.value;
    has = true;
  }
  return has ? out : undefined;
}

// 多行文本 → header 记录
function parseHeaders(text: string): {[k: string]: string}|undefined {
  const out: {[k: string]: string} = {};
  let has = false;
  const lines = (text || '').split('\n');
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k) {
      continue;
    }
    out[k] = v;
    has = true;
  }
  return has ? out : undefined;
}


const STYLE_TEXT = `
.chii-mock-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 12px; }
.chii-mock-toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--sys-color-divider, #ccc); flex-shrink: 0; flex-wrap: wrap; }
.chii-mock-toolbar label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.chii-mock-hint { color: var(--sys-color-token-subtle, #888); }
.chii-mock-warn { color: #b06000; background: rgba(230,145,56,0.12); border: 1px solid rgba(230,145,56,0.45); border-radius: 4px; padding: 1px 8px; cursor: help; }
.chii-mock-filter { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-bottom: 1px solid var(--sys-color-divider, #eee); flex-shrink: 0; }
.chii-mock-filter input { flex: 1; min-width: 0; box-sizing: border-box; border: 1px solid var(--sys-color-neutral-outline, #bbb); border-radius: 4px; padding: 3px 8px; background: var(--sys-color-cdt-base-container, var(--color-background, #fff)); color: var(--sys-color-on-surface, inherit); outline: none; font-size: 12px; }
.chii-mock-filter input:focus { border-color: var(--sys-color-primary, #1a73e8); box-shadow: 0 0 0 1px var(--sys-color-primary, #1a73e8); }
.chii-mock-filter .cnt { color: var(--sys-color-token-subtle, #888); white-space: nowrap; }
.chii-mock-kv .row .act { flex: 0 0 auto; }
.chii-mock-hostbadge { font-weight: normal; font-family: monospace; color: var(--sys-color-token-subtle, #888); background: var(--sys-color-surface2, rgba(0,0,0,0.05)); border-radius: 3px; padding: 1px 6px; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chii-mock-body { flex: 1; display: flex; min-height: 0; }
.chii-mock-left { width: 44%; min-width: 260px; max-width: 60%; display: flex; flex-direction: column; border-right: 1px solid var(--sys-color-divider, #ccc); }
.chii-mock-section { flex: 1 1 50%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.chii-mock-section.top { border-bottom: 1px solid var(--sys-color-divider, #ccc); }
.chii-mock-section-hd { display: flex; align-items: center; gap: 8px; padding: 5px 10px; background: var(--sys-color-cdt-base-container, var(--color-background, #fff)); border-bottom: 1px solid var(--sys-color-divider, #eee); font-weight: 600; flex-shrink: 0; }
.chii-mock-section-hd .grow { flex: 1; }
.chii-mock-scroll { flex: 1; overflow: auto; }
.chii-mock-right { flex: 1; overflow: auto; min-width: 0; }
.chii-mock-empty { text-align: center; color: var(--sys-color-token-subtle, #888); padding: 30px 12px; }
.chii-mock-item { padding: 5px 10px; border-bottom: 1px solid var(--sys-color-divider, #eee); cursor: pointer; }
.chii-mock-item:hover { background: var(--sys-color-state-hover-on-subtle, rgba(0,0,0,0.05)); }
.chii-mock-item.selected { background: var(--sys-color-tonal-container, rgba(26,115,232,0.15)); }
.chii-mock-item .l1 { display: flex; align-items: center; gap: 8px; }
.chii-mock-item .method { font-size: 10px; font-weight: 700; letter-spacing: 0.3px; border-radius: 3px; padding: 1px 6px; flex-shrink: 0; color: #fff; min-width: 42px; text-align: center; }
.chii-mock-item .method.m-GET { background: #1a73e8; }
.chii-mock-item .method.m-POST { background: #188038; }
.chii-mock-item .method.m-PUT { background: #e37400; }
.chii-mock-item .method.m-DELETE { background: #c5221f; }
.chii-mock-item .method.m-PATCH { background: #9334e6; }
.chii-mock-item .method.m-HEAD, .chii-mock-item .method.m-OPTIONS, .chii-mock-item .method.m-ANY { background: #80868b; }
.chii-mock-item .u { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
.chii-mock-item .l2 { margin-top: 3px; padding-left: 50px; color: var(--sys-color-token-subtle, #888); font-family: monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chii-mock-item .tag { font-size: 10px; flex-shrink: 0; padding: 0 4px; border-radius: 3px; }
.chii-mock-item .tag.on { color: #137333; border: 1px solid #13733355; }
.chii-mock-item .tag.off { color: var(--sys-color-token-subtle, #888); border: 1px solid var(--sys-color-divider, #ccc); }
.chii-mock-item .tag.mock { color: #fff; background: #9334e6; border: 1px solid #9334e6; font-weight: 700; letter-spacing: 0.3px; }
.chii-mock-item.mocked { background: rgba(147,52,230,0.06); }
.chii-mock-item.mocked.selected { background: var(--sys-color-tonal-container, rgba(26,115,232,0.15)); }
.chii-mock-item.mocked .u { color: #9334e6; }
.chii-mock-form { padding: 12px; }
.chii-mock-form .frow { margin-bottom: 10px; }
.chii-mock-form .frow > label { display: block; color: var(--sys-color-token-subtle, #888); margin-bottom: 3px; }
.chii-mock-form input[type=text], .chii-mock-form input[type=number], .chii-mock-form textarea { box-sizing: border-box; border: 1px solid var(--sys-color-neutral-outline, #bbb); border-radius: 4px; padding: 4px 8px; background: var(--sys-color-cdt-base-container, var(--color-background, #fff)); color: var(--sys-color-on-surface, inherit); outline: none; font-size: 12px; }
.chii-mock-form input:focus, .chii-mock-form textarea:focus { border-color: var(--sys-color-primary, #1a73e8); box-shadow: 0 0 0 1px var(--sys-color-primary, #1a73e8); }
.chii-mock-form input.full { width: 100%; }
.chii-mock-form .inline { display: flex; gap: 10px; flex-wrap: wrap; }
.chii-mock-form .inline .frow { flex: 1; min-width: 90px; }
.chii-mock-form textarea { width: 100%; min-height: 120px; font-family: monospace; resize: vertical; }
.chii-mock-form textarea.chii-mock-headers { min-height: 52px; white-space: pre; }
.chii-mock-collap { margin: 6px 0; }
.chii-mock-collap .chd, .chii-mock-hgroup > .chd, .chii-mock-form .body-hd { display: flex; align-items: center; gap: 8px; padding: 8px 0 5px; font-weight: 600; }
.chii-mock-collap .chd, .chii-mock-hgroup > .chd { cursor: pointer; user-select: none; }
.chii-mock-collap .chd .arrow, .chii-mock-hgroup > .chd .arrow { color: var(--sys-color-token-subtle, #999); font-size: 9px; line-height: 1; display: inline-block; transition: transform 0.18s ease; }
.chii-mock-collap .chd.open .arrow, .chii-mock-hgroup > .chd.open .arrow { transform: rotate(90deg); }
.chii-mock-collap .cbd { padding: 2px 0 4px; }
.chii-mock-hbody { padding: 2px 0 6px; }
.chii-mock-hgroup > .chd .chint { color: var(--sys-color-token-subtle, #999); font-weight: normal; font-size: 11px; }
.chii-mock-hgroup > .chd .spacer, .chii-mock-collap .chd .spacer, .chii-mock-form .body-hd .grow { flex: 1; min-width: 0; margin: 0; }
.chii-mock-collap .chd .chii-mock-btn, .chii-mock-hgroup > .chd .chii-mock-btn { font-weight: normal; }
.chii-mock-copy { border: none; background: transparent; color: var(--sys-color-token-subtle, #888); cursor: pointer; font-size: 11px; font-weight: normal; padding: 2px 6px; }
.chii-mock-copy:hover { color: var(--sys-color-primary, #1a73e8); }
.chii-mock-hbar { display: inline-flex; flex: 0 0 auto; border: 1px solid var(--sys-color-divider, #ccc); border-radius: 6px; overflow: hidden; }
.chii-mock-btn.hmode { padding: 2px 12px; border: none; border-radius: 0; background: transparent; font-weight: normal; }
.chii-mock-btn.hmode + .hmode { border-left: 1px solid var(--sys-color-divider, #ccc); }
.chii-mock-btn.hmode.active { background: var(--sys-color-primary, #1a73e8); color: #fff; }
.chii-mock-htable { border: 1px solid var(--sys-color-divider, #ddd); overflow: hidden; margin-bottom: 8px; }
.chii-mock-htable .hrow { display: flex; }
.chii-mock-htable .hrow + .hrow { border-top: 1px solid var(--sys-color-divider, #eee); }
.chii-mock-htable .cell-k { flex: 0 0 38%; min-width: 0; border-right: 1px solid var(--sys-color-divider, #eee); }
.chii-mock-htable .cell-v { flex: 1; min-width: 0; }
.chii-mock-htable .cell-act { flex: 0 0 30px; display: flex; align-items: center; justify-content: center; border-left: 1px solid var(--sys-color-divider, #eee); }
.chii-mock-htable input.hk, .chii-mock-htable input.hv { border: none; border-radius: 0; width: 100%; background: transparent; padding: 5px 8px; font-family: monospace; }
.chii-mock-htable input.hk:focus, .chii-mock-htable input.hv:focus { box-shadow: inset 0 0 0 2px var(--sys-color-primary, #1a73e8); }
.chii-mock-btn.hdel { border: none; background: transparent; color: #c5221f; padding: 2px 6px; font-size: 12px; }
.chii-mock-hadd { border: none; background: transparent; color: var(--sys-color-primary, #1a73e8); cursor: pointer; padding: 4px 2px; font-size: 12px; }
.chii-mock-form .actions { display: flex; gap: 8px; margin-top: 6px; }
.chii-mock-btn { border: 1px solid var(--sys-color-neutral-outline, #bbb); border-radius: 4px; padding: 4px 12px; background: var(--sys-color-cdt-base-container, var(--color-background, #fff)); color: var(--sys-color-on-surface, inherit); cursor: pointer; font-size: 12px; }
.chii-mock-btn.primary { background: var(--sys-color-primary, #1a73e8); border-color: var(--sys-color-primary, #1a73e8); color: #fff; }
.chii-mock-btn.danger { color: #c5221f; border-color: #c5221f55; }
.chii-mock-btn:hover { filter: brightness(0.97); }
.chii-mock-detail-hint { color: var(--sys-color-token-subtle, #888); padding: 40px 12px; text-align: center; }
.chii-mock-kv { padding: 0 12px 8px; }
.chii-mock-kv .gt { font-weight: 600; padding: 10px 0 4px; }
.chii-mock-kv .row { display: flex; gap: 10px; padding: 3px 0; border-bottom: 1px dotted var(--sys-color-divider, #eee); }
.chii-mock-kv .k { width: 34%; max-width: 200px; flex-shrink: 0; color: var(--sys-color-token-subtle, #888); font-family: monospace; word-break: break-all; }
.chii-mock-kv .v { flex: 1; min-width: 0; word-break: break-all; font-family: monospace; white-space: pre-wrap; user-select: text; }
.chii-mock-code { margin: 4px 0 0; padding: 8px; background: var(--sys-color-surface2, rgba(0,0,0,0.03)); border: 1px solid var(--sys-color-divider, #eee); border-radius: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 320px; overflow: auto; user-select: text; }
.chii-mock-more { display: flex; align-items: center; gap: 8px; padding: 4px 0 0; color: var(--sys-color-token-subtle, #888); }
.chii-mock-editor { display: block; border: 1px solid var(--sys-color-neutral-outline, #bbb); border-radius: 4px; overflow: hidden; }
.chii-mock-toolbar .spacer { flex: 1; }
.chii-mock-form .fhint { color: var(--sys-color-token-subtle, #888); margin-top: 3px; }
`;

let stylesAdopted = false;
function ensureStyles(): void {
  if (stylesAdopted) {
    return;
  }
  stylesAdopted = true;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLE_TEXT);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

type Selection = {kind: 'request', id: string}|{kind: 'rule', id: string}|{kind: 'editor'}|{kind: 'settings'}|null;

// 与 target 侧默认值一致，读不到 state 时用它兜住表单
const DEFAULT_LIMITS: NetLimits = {keepFullCount: 20, maxBodyBytes: 512 * 1024};

export class MockPanel extends UI.Panel.Panel {
  private rules: MockRule[] = [];
  private mockEnabled = false;
  private limits: NetLimits = {...DEFAULT_LIMITS};
  private captured: CapturedRequest[] = [];
  private capturedSeen = new Set<string>();
  private listening = false;
  // 截获请求默认只显示与被调试页 host 完全相同的请求；勾选后显示全部
  private showAllRequests = false;
  private pageHost = '';
  // 轮询 target 的 mock 命中记录（短路的 mock 请求不会经过 chobitsu，需主动拉取）
  private hitTimer: number|null = null;
  // 已合并的命中指纹（id+ts），跨页面刷新 target 的 hits 会从 1 重新计数，故不能用单调 id
  private seenHits = new Set<string>();
  // 是否已建立命中基线：面板打开时把「已存在的历史命中」标记为已读，只展示此后新增的
  private hitsBaselined = false;

  // CodeMirror JSON 语言扩展（异步加载后缓存）与当前请求体/响应体编辑器引用
  private jsonLang: CodeMirror.Extension|null = null;
  private requestBodyEditor: TextEditor.TextEditor.TextEditor|null = null;
  private responseEditor: TextEditor.TextEditor.TextEditor|null = null;

  private selection: Selection = null;
  // 正在编辑的规则草稿（未保存前不写入 this.rules / 不下发）
  private draft: MockRule|null = null;
  private draftIsNew = false;

  // 截获请求的关键字筛选（对完整 URL 做大小写不敏感子串匹配）
  private reqFilter = '';
  // 增量拉取命中的游标：tag 变化说明页面已刷新
  private hitsTag = '';
  private hitsSeq = 0;
  // 旧版 target.js 无增量接口时降级为全量拉取
  private legacyHits = false;
  // 列表重绘合并，避免请求密集时逐条重建 DOM
  private renderReqScheduled = false;

  private enableCheckbox!: HTMLInputElement;
  private reqListEl!: HTMLElement;
  private ruleListEl!: HTMLElement;
  private rightEl!: HTMLElement;
  private warnEl!: HTMLElement;
  private reqCountEl!: HTMLElement;
  private hostBadgeEl!: HTMLElement;

  private readonly onRequest = (event: Common.EventTarget.EventTargetEvent<SDK.NetworkRequest.NetworkRequest>):
      void => {
        void this.processRequest(event.data);
      };

  // 被调试页 URL 变化（导航/刷新）：更新主 host 并重渲染，修复首次 URL 未就绪导致的筛选不稳
  private readonly onInspectedURLChanged = (): void => {
    this.updatePageHost();
    this.renderRequests();
  };

  constructor() {
    super('mock');
    ensureStyles();

    const root = document.createElement('div');
    root.className = 'chii-mock-root';
    this.contentElement.appendChild(root);

    // 顶部工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'chii-mock-toolbar';
    root.appendChild(toolbar);

    const enableLabel = document.createElement('label');
    this.enableCheckbox = document.createElement('input');
    this.enableCheckbox.type = 'checkbox';
    this.enableCheckbox.addEventListener('change', () => {
      this.mockEnabled = this.enableCheckbox.checked;
      void evalInPage(
          'window.__chiiNet && window.__chiiNet.setMockEnabled(' + (this.mockEnabled ? 'true' : 'false') + ')');
    });
    enableLabel.appendChild(this.enableCheckbox);
    enableLabel.appendChild(document.createTextNode('启用 Mock'));
    toolbar.appendChild(enableLabel);

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'chii-mock-btn';
    reloadBtn.textContent = '刷新规则';
    reloadBtn.addEventListener('click', () => {
      void this.reload();
    });
    toolbar.appendChild(reloadBtn);

    const hint = document.createElement('span');
    hint.className = 'chii-mock-hint';
    hint.textContent = '拦截 fetch/XHR：URL 子串或正则匹配；填响应体则整体替换（短路不发真实请求），仅填状态码/头则改真实响应';
    toolbar.appendChild(hint);

    // 注入时机告警：target.js 晚于业务请求加载时提示
    this.warnEl = document.createElement('span');
    this.warnEl.className = 'chii-mock-warn';
    this.warnEl.style.display = 'none';
    toolbar.appendChild(this.warnEl);

    const toolbarSpacer = document.createElement('span');
    toolbarSpacer.className = 'spacer';
    toolbar.appendChild(toolbarSpacer);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'chii-mock-btn';
    settingsBtn.textContent = '高级设置';
    settingsBtn.addEventListener('click', () => {
      this.selection = {kind: 'settings'};
      this.draft = null;
      this.renderRequests();
      this.renderRules();
      this.renderRight();
      void this.reload();
    });
    toolbar.appendChild(settingsBtn);

    // 主体：左（上下两栏）+ 右
    const body = document.createElement('div');
    body.className = 'chii-mock-body';
    root.appendChild(body);

    const left = document.createElement('div');
    left.className = 'chii-mock-left';
    body.appendChild(left);

    // 左上：截获请求
    const topSec = document.createElement('div');
    topSec.className = 'chii-mock-section top';
    const topHd = document.createElement('div');
    topHd.className = 'chii-mock-section-hd';
    const topTitle = document.createElement('span');
    topTitle.className = 'grow';
    topTitle.textContent = '截获的请求';
    topHd.appendChild(topTitle);
    // 当前业务主域名，未勾「显示全部」时列表只显示路由，主域名在这里展示
    this.hostBadgeEl = document.createElement('span');
    this.hostBadgeEl.className = 'chii-mock-hostbadge';
    topHd.appendChild(this.hostBadgeEl);
    const allLabel = document.createElement('label');
    allLabel.style.fontWeight = 'normal';
    allLabel.title = '默认仅显示与当前页面 host 完全相同的请求';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.checked = this.showAllRequests;
    allCb.addEventListener('change', () => {
      this.showAllRequests = allCb.checked;
      this.renderRequests();
    });
    allLabel.appendChild(allCb);
    allLabel.appendChild(document.createTextNode('显示全部'));
    topHd.appendChild(allLabel);
    const clearReqBtn = document.createElement('button');
    clearReqBtn.className = 'chii-mock-btn';
    clearReqBtn.textContent = '清空';
    clearReqBtn.addEventListener('click', () => {
      this.captured = [];
      this.capturedSeen.clear();
      this.renderRequests();
    });
    topHd.appendChild(clearReqBtn);
    topSec.appendChild(topHd);
    // 筛选行
    const filterRow = document.createElement('div');
    filterRow.className = 'chii-mock-filter';
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.placeholder = '筛选请求，输入 URL 关键字';
    filterInput.addEventListener('input', () => {
      this.reqFilter = filterInput.value.trim();
      this.renderRequests();
    });
    filterRow.appendChild(filterInput);
    this.reqCountEl = document.createElement('span');
    this.reqCountEl.className = 'cnt';
    filterRow.appendChild(this.reqCountEl);
    const clearFilterBtn = document.createElement('button');
    clearFilterBtn.className = 'chii-mock-btn';
    clearFilterBtn.textContent = '清除';
    clearFilterBtn.title = '清除筛选';
    clearFilterBtn.addEventListener('click', () => {
      filterInput.value = '';
      this.reqFilter = '';
      this.renderRequests();
    });
    filterRow.appendChild(clearFilterBtn);
    topSec.appendChild(filterRow);
    this.reqListEl = document.createElement('div');
    this.reqListEl.className = 'chii-mock-scroll';
    topSec.appendChild(this.reqListEl);
    left.appendChild(topSec);

    // 左下：规则列表
    const botSec = document.createElement('div');
    botSec.className = 'chii-mock-section';
    const botHd = document.createElement('div');
    botHd.className = 'chii-mock-section-hd';
    const botTitle = document.createElement('span');
    botTitle.className = 'grow';
    botTitle.textContent = 'Mock 规则';
    botHd.appendChild(botTitle);
    const addBtn = document.createElement('button');
    addBtn.className = 'chii-mock-btn';
    addBtn.textContent = '新增规则';
    addBtn.addEventListener('click', () => {
      this.openEditor({id: genId(), enabled: true, urlIncludes: ''}, true);
    });
    botHd.appendChild(addBtn);
    botSec.appendChild(botHd);
    this.ruleListEl = document.createElement('div');
    this.ruleListEl.className = 'chii-mock-scroll';
    botSec.appendChild(this.ruleListEl);
    left.appendChild(botSec);

    // 右侧
    this.rightEl = document.createElement('div');
    this.rightEl.className = 'chii-mock-right';
    body.appendChild(this.rightEl);

    this.renderRequests();
    this.renderRules();
    this.renderRight();
  }

  static instance(opts: {forceNew: boolean|null} = {forceNew: null}): MockPanel {
    const {forceNew} = opts;
    if (!mockPanelInstance || forceNew) {
      mockPanelInstance = new MockPanel();
    }
    return mockPanelInstance;
  }

  override wasShown(): void {
    super.wasShown();
    this.updatePageHost();
    void this.ensureJsonLang();
    void this.reload();
    void this.loadDiagnostics();
    const networkLog = Logs.NetworkLog.NetworkLog.instance();
    if (!this.listening) {
      this.listening = true;
      networkLog.addEventListener(Logs.NetworkLog.Events.RequestAdded, this.onRequest);
      networkLog.addEventListener(Logs.NetworkLog.Events.RequestUpdated, this.onRequest);
      SDK.TargetManager.TargetManager.instance().addEventListener(
          SDK.TargetManager.Events.InspectedURLChanged, this.onInspectedURLChanged);
    }
    // 轮询 target 的 mock 命中
    if (this.hitTimer === null) {
      this.hitTimer = window.setInterval(() => {
        void this.pollHits();
      }, 1500);
    }
    void this.pollHits();
  }

  override willHide(): void {
    if (this.listening) {
      this.listening = false;
      const networkLog = Logs.NetworkLog.NetworkLog.instance();
      networkLog.removeEventListener(Logs.NetworkLog.Events.RequestAdded, this.onRequest);
      networkLog.removeEventListener(Logs.NetworkLog.Events.RequestUpdated, this.onRequest);
      SDK.TargetManager.TargetManager.instance().removeEventListener(
          SDK.TargetManager.Events.InspectedURLChanged, this.onInspectedURLChanged);
    }
    if (this.hitTimer !== null) {
      window.clearInterval(this.hitTimer);
      this.hitTimer = null;
    }
    super.willHide();
  }

  // 读取注入时机诊断
  private async loadDiagnostics(): Promise<void> {
    const diag = await evalInPage<MockDiagnostics>(
        'window.__chiiNet && window.__chiiNet.getDiagnostics ? window.__chiiNet.getDiagnostics() : null');
    if (!diag || !diag.preInstallCount) {
      this.warnEl.style.display = 'none';
      return;
    }
    this.warnEl.style.display = '';
    this.warnEl.textContent = '⚠ Mock 注入前已有 ' + diag.preInstallCount + ' 个 XHR/fetch 发出，未被拦截';
    this.warnEl.title = 'target.js 在页面加载 ' + diag.installedAfterMs + 'ms 后才注入，早于它的请求无法 mock。' +
        '请把 chii 的 target.js 放在 <head> 最前面、同步加载。\n' +
        diag.preInstallSamples.join('\n');
  }

  // 列表重绘合并：请求密集时避免逐条全量重建 DOM
  private scheduleRenderRequests(): void {
    if (this.renderReqScheduled) {
      return;
    }
    this.renderReqScheduled = true;
    window.setTimeout(() => {
      this.renderReqScheduled = false;
      this.renderRequests();
    }, 80);
  }

  // 增量拉取 target 侧 mock 命中，合并成截获条目（请求/响应体在查看详情时才拉）
  private async pollHits(): Promise<void> {
    if (this.legacyHits) {
      await this.pollHitsLegacy();
      return;
    }
    const expr = 'window.__chiiNet ? (window.__chiiNet.getHitsSince ? window.__chiiNet.getHitsSince(' +
        this.hitsSeq + ', ' + JSON.stringify(this.hitsTag) + ') : {legacy: true}) : null';
    const delta = await evalInPage<MockHitsDelta>(expr);
    if (!delta) {
      return;  // 求值失败：不建立基线，下次重试
    }
    if (delta.legacy) {
      this.legacyHits = true;
      await this.pollHitsLegacy();
      return;
    }
    const tagChanged = delta.tag !== this.hitsTag;
    this.hitsTag = delta.tag;
    this.hitsSeq = delta.seq;
    // 首次打开渲染缓冲里的全部命中，之后再打开只拉增量
    if (!this.hitsBaselined) {
      this.hitsBaselined = true;
    }
    // tag 变化说明页面已刷新，target 序号重新计数，delta.hits 为全量
    if (tagChanged) {
      this.seenHits.clear();
    }
    let changed = false;
    for (const h of delta.hits) {
      if (this.seenHits.has(h.uid)) {
        continue;
      }
      this.seenHits.add(h.uid);
      // 仅把「被替换/阻断」的短路命中作为独立条目
      if (!h.replaced && !h.blocked) {
        continue;
      }
      this.captured.unshift({
        id: 'hit-' + h.uid,
        method: (h.method || 'GET').toUpperCase(),
        url: h.url,
        status: h.status || 0,
        requestBody: null,
        responseBody: null,
        request: null,
        mocked: true,
        ruleId: h.ruleId,
        hitUid: h.uid,
        hasReqBody: h.hasReqBody,
        hasRespBody: h.hasRespBody,
        reqLen: h.reqLen,
        respLen: h.respLen,
        bodyReleased: h.released,
      });
      changed = true;
    }
    if (this.seenHits.size > 1000) {
      this.seenHits.clear();
    }
    if (changed) {
      if (this.captured.length > 300) {
        this.captured.length = 300;
      }
      this.scheduleRenderRequests();
    }
  }

  private async pollHitsLegacy(): Promise<void> {
    const hits = await evalInPage<MockHit[]>('window.__chiiNet ? window.__chiiNet.getHits() : []');
    if (!hits) {
      return;
    }
    // 首次打开渲染缓冲里的全部命中，之后再打开只拉新增
    if (!this.hitsBaselined) {
      this.hitsBaselined = true;
    }
    let changed = false;
    for (const h of hits) {
      const key = h.id + '-' + h.ts;
      if (this.seenHits.has(key)) {
        continue;
      }
      this.seenHits.add(key);
      if (!h.replaced && !h.blocked) {
        continue;
      }
      this.captured.unshift({
        id: 'hit-' + key,
        method: (h.method || 'GET').toUpperCase(),
        url: h.url,
        status: h.status || 0,
        requestBody: h.reqBody != null ? h.reqBody : null,
        responseBody: h.respBody != null ? h.respBody : null,
        request: null,
        mocked: true,
        ruleId: h.ruleId,
        bodiesLoaded: true,
      });
      changed = true;
    }
    if (this.seenHits.size > 1000) {
      this.seenHits.clear();
    }
    if (changed) {
      if (this.captured.length > 300) {
        this.captured.length = 300;
      }
      this.scheduleRenderRequests();
    }
  }

  // ============ 截获请求 ============

  private async processRequest(request: SDK.NetworkRequest.NetworkRequest): Promise<void> {
    const url = request.url();
    // 仅收 XHR/Fetch 请求，避免文档/图片等噪声
    const type = request.resourceType().name();
    if (type !== 'xhr' && type !== 'fetch') {
      return;
    }
    const key = request.requestId();
    if (this.capturedSeen.has(key)) {
      // 已存在则更新状态码
      const exist = this.captured.find(c => c.id === key);
      if (exist) {
        exist.status = request.statusCode || exist.status;
      }
      return;
    }
    this.capturedSeen.add(key);

    // 请求体不在此处拉取：requestFormData 会向被调试页发一次 CDP 往返，
    // 请求密集时明显拖慢页面，改为查看详情时按需拉取。
    this.captured.unshift({
      id: key,
      method: (request.requestMethod || 'GET').toUpperCase(),
      url,
      status: request.statusCode || 0,
      requestBody: null,
      responseBody: null,
      request,
    });
    if (this.captured.length > 300) {
      this.captured.length = 300;
    }
    this.scheduleRenderRequests();
  }

  private updatePageHost(): void {
    try {
      const target = getPageTarget();
      const url = target ? target.inspectedURL() : '';
      this.pageHost = hostOf(url);
    } catch {
      this.pageHost = '';
    }
  }

  private renderRequests(): void {
    this.reqListEl.removeChildren();
    // pageHost 兜底：首次 wasShown 时 inspectedURL 可能未就绪，渲染时再取一次
    if (!this.pageHost) {
      this.updatePageHost();
    }
    const sameHostOnly = !this.showAllRequests && Boolean(this.pageHost);
    // 只看当前域名时行内不显示 host，这里把主域名标出来
    if (sameHostOnly) {
      this.hostBadgeEl.style.display = '';
      this.hostBadgeEl.textContent = this.pageHost;
      this.hostBadgeEl.title = '当前业务主域名，列表仅显示该域名下的请求，行内只展示路由';
    } else {
      this.hostBadgeEl.style.display = 'none';
    }
    let list = sameHostOnly ? this.captured.filter(req => hostOf(req.url) === this.pageHost) : this.captured;
    const kw = this.reqFilter.toLowerCase();
    if (kw) {
      list = list.filter(req => req.url.toLowerCase().includes(kw) || req.method.toLowerCase().includes(kw));
    }
    this.reqCountEl.textContent = list.length + '/' + this.captured.length;
    if (list.length === 0) {
      const e = document.createElement('div');
      e.className = 'chii-mock-empty';
      if (this.captured.length === 0) {
        e.textContent = '暂无截获请求，在页面发起请求后出现';
      } else if (kw) {
        e.textContent = '没有匹配「' + this.reqFilter + '」的请求';
      } else {
        e.textContent = '当前 host 下无请求，勾选「显示全部」查看其它域名';
      }
      this.reqListEl.appendChild(e);
      return;
    }
    for (const req of list) {
      const selected = this.selection && this.selection.kind === 'request' && this.selection.id === req.id;
      const mocked = req.mocked === true || this.matchesEnabledRule(req.url, req.method);
      // 只看当前业务域名时 host 冗余，只显示路由子串
      const primary = sameHostOnly ? urlPath(req.url) : urlHostPath(req.url);
      this.reqListEl.appendChild(this.renderItem(req.method, primary, selected, null, () => {
        this.selection = {kind: 'request', id: req.id};
        this.draft = null;
        this.renderRequests();
        this.renderRules();
        this.renderRight();
      }, urlParams(req.url), mocked));
    }
  }

  // 该 url/method 是否命中某条启用中的 mock 规则
  private matchesEnabledRule(url: string, method: string): boolean {
    return this.findMatchedRule(url, method) !== null;
  }

  // 返回命中的第一条启用规则
  private findMatchedRule(url: string, method: string): MockRule|null {
    if (!this.mockEnabled) {
      return null;
    }
    return this.findRuleForRequest(url, method, true);
  }

  // 查找匹配该请求的规则
  private findRuleForRequest(url: string, method: string, requireEnabled: boolean): MockRule|null {
    const m = (method || 'GET').toUpperCase();
    for (const r of this.rules) {
      if (requireEnabled && !r.enabled) {
        continue;
      }
      const hasInclude = Boolean(r.urlIncludes);
      const hasRegex = Boolean(r.urlRegex);
      if (!hasInclude && !hasRegex) {
        continue;
      }
      if (hasInclude && url.indexOf(r.urlIncludes) < 0) {
        continue;
      }
      if (hasRegex) {
        try {
          if (!new RegExp(r.urlRegex as string).test(url)) {
            continue;
          }
        } catch {
          continue;
        }
      }
      if (r.urlExcludes && url.indexOf(r.urlExcludes) >= 0) {
        continue;
      }
      if (r.method && m !== r.method.toUpperCase()) {
        continue;
      }
      return r;
    }
    return null;
  }

  // ============ 规则列表 ============

  private renderRules(): void {
    this.ruleListEl.removeChildren();
    if (this.rules.length === 0) {
      const e = document.createElement('div');
      e.className = 'chii-mock-empty';
      e.textContent = '暂无规则，点「新增规则」或从截获请求添加';
      this.ruleListEl.appendChild(e);
      return;
    }
    for (const rule of this.rules) {
      const selected = this.selection && this.selection.kind === 'rule' && this.selection.id === rule.id;
      this.ruleListEl.appendChild(
          this.renderItem(rule.method || 'ANY', rule.urlIncludes || '(未设置)', selected, rule.enabled, () => {
            this.openEditor(JSON.parse(JSON.stringify(rule)) as MockRule, false, rule.id);
          }));
    }
  }

  private renderItem(
      method: string, url: string, selected: boolean|null|undefined, enabled: boolean|null, onClick: () => void,
      secondLine?: string, mockBadge?: boolean): HTMLElement {
    const item = document.createElement('div');
    item.className = 'chii-mock-item' + (selected ? ' selected' : '') + (mockBadge ? ' mocked' : '');
    item.addEventListener('click', onClick);
    const l1 = document.createElement('div');
    l1.className = 'l1';
    const m = document.createElement('span');
    const mUpper = (method || 'ANY').toUpperCase();
    m.className = 'method m-' + mUpper;
    m.textContent = mUpper;
    l1.appendChild(m);
    const u = document.createElement('span');
    u.className = 'u';
    u.textContent = url;
    u.title = url;
    l1.appendChild(u);
    if (mockBadge) {
      const mk = document.createElement('span');
      mk.className = 'tag mock';
      mk.textContent = 'MOCK';
      l1.appendChild(mk);
    }
    if (enabled !== null) {
      const tag = document.createElement('span');
      tag.className = 'tag ' + (enabled ? 'on' : 'off');
      tag.textContent = enabled ? '启用' : '停用';
      l1.appendChild(tag);
    }
    item.appendChild(l1);
    if (secondLine) {
      const l2 = document.createElement('div');
      l2.className = 'l2';
      l2.textContent = secondLine;
      l2.title = secondLine;
      item.appendChild(l2);
    }
    return item;
  }

  // ============ 右侧：详情 / 编辑 ============

  private renderRight(): void {
    this.rightEl.removeChildren();
    if (this.selection && this.selection.kind === 'settings') {
      this.rightEl.appendChild(this.renderSettings());
      return;
    }
    if (this.selection && this.selection.kind === 'editor' && this.draft) {
      this.rightEl.appendChild(this.renderEditor(this.draft));
      return;
    }
    if (this.selection && this.selection.kind === 'request') {
      const selId = this.selection.id;
      const found = this.captured.find(c => c.id === selId);
      if (found) {
        this.rightEl.appendChild(this.renderRequestDetail(found));
        return;
      }
    }
    const hint = document.createElement('div');
    hint.className = 'chii-mock-detail-hint';
    hint.textContent = '选择左侧的请求或规则查看详情';
    this.rightEl.appendChild(hint);
  }

  private renderRequestDetail(req: CapturedRequest): HTMLElement {
    // 请求体/mock 体按需拉取，拉到后若仍选中同一条则重绘
    void this.loadDetailLazy(req);
    const wrap = document.createElement('div');
    wrap.className = 'chii-mock-form';

    const actions = document.createElement('div');
    actions.className = 'actions';
    // 命中 mock 规则的条目：按钮改为「修改规则」。优先按记录的 ruleId 找；否则按 url/method 匹配（忽略启用状态）。
    const hitRule = (req.ruleId ? this.rules.find(r => r.id === req.ruleId) : undefined) ||
        this.findRuleForRequest(req.url, req.method, false) || undefined;
    const btn = document.createElement('button');
    btn.className = 'chii-mock-btn primary';
    if (hitRule) {
      btn.textContent = '修改规则';
      btn.addEventListener('click', () => {
        this.openEditor(JSON.parse(JSON.stringify(hitRule)) as MockRule, false, hitRule.id);
      });
    } else {
      btn.textContent = '添加为规则';
      btn.addEventListener('click', () => {
        void this.addRequestAsRule(req);
      });
    }
    actions.appendChild(btn);
    const copyInfoBtn = document.createElement('button');
    copyInfoBtn.className = 'chii-mock-btn';
    copyInfoBtn.textContent = '复制信息';
    copyInfoBtn.title = '复制该请求的完整信息（方法/URL/状态/请求头体/响应头体）';
    copyInfoBtn.addEventListener('click', () => {
      copyInfoBtn.textContent = '复制中…';
      void this.buildRequestInfoText(req, hitRule).then(text => {
        try {
          void navigator.clipboard.writeText(text);
        } catch {
          // ignore
        }
        copyInfoBtn.textContent = '已复制';
        window.setTimeout(() => {
          copyInfoBtn.textContent = '复制信息';
        }, 1000);
      });
    });
    actions.appendChild(copyInfoBtn);
    wrap.appendChild(actions);

    const kv = document.createElement('div');
    kv.className = 'chii-mock-kv';
    this.appendRequestSummary(kv, req);
    // 请求头（默认折叠）
    const reqHeaderEntries = req.request ? req.request.requestHeaders() : recToEntries(hitRule && hitRule.requestHeaders);
    this.appendCollapsible(kv, '请求头', reqHeaderEntries);
    if (req.requestBody) {
      this.appendCodeGroup(kv, '请求体', req.requestBody, true, this.mkTrunc(req, 'req', req.requestBody));
    }
    // 响应头（默认折叠）
    const respHeaderEntries = req.request ? req.request.responseHeaders : recToEntries(hitRule && hitRule.responseHeaders);
    this.appendCollapsible(kv, '响应头', respHeaderEntries);
    // 命中规则的 responseBody > 记录的 respBody > 真实响应
    if (hitRule && hitRule.responseBody != null && hitRule.responseBody.length > 0) {
      this.appendCodeGroup(kv, '响应体（Mock）', hitRule.responseBody);
      wrap.appendChild(kv);
      return wrap;
    }
    if (req.responseBody != null) {
      this.appendCodeGroup(
          kv, req.mocked ? '响应体（Mock）' : '响应体', req.responseBody, true,
          this.mkTrunc(req, 'resp', req.responseBody));
      wrap.appendChild(kv);
      return wrap;
    }
    // 普通请求：异步拉取真实响应体后追加
    const respHolder = document.createElement('div');
    kv.appendChild(respHolder);
    void this.fetchResponseText(req).then(text => {
      if (!respHolder.isConnected) {
        return;
      }
      if (text) {
        this.appendCodeGroup(respHolder, '响应体', text);
      }
    });
    wrap.appendChild(kv);
    return wrap;
  }

  // 汇总该请求的完整信息为纯文本（用于「复制信息」）。响应体优先取命中规则/记录，否则异步拉取真实响应。
  private async buildRequestInfoText(req: CapturedRequest, hitRule?: MockRule): Promise<string> {
    await this.ensureRequestBody(req);
    await this.ensureHitBodies(req);
    const lines: string[] = [];
    lines.push(req.method + ' ' + req.url);
    if (req.status) {
      lines.push('Status: ' + req.status);
    }
    const reqHeaderEntries = req.request ? req.request.requestHeaders() : recToEntries(hitRule && hitRule.requestHeaders);
    if (reqHeaderEntries && reqHeaderEntries.length > 0) {
      lines.push('', '# 请求头');
      for (const e of reqHeaderEntries) {
        lines.push(e.name + ': ' + e.value);
      }
    }
    if (req.requestBody) {
      lines.push('', '# 请求体', req.requestBody);
    }
    const respHeaderEntries = req.request ? req.request.responseHeaders : recToEntries(hitRule && hitRule.responseHeaders);
    if (respHeaderEntries && respHeaderEntries.length > 0) {
      lines.push('', '# 响应头');
      for (const e of respHeaderEntries) {
        lines.push(e.name + ': ' + e.value);
      }
    }
    // 响应体：命中规则 responseBody > 记录 respBody > 真实响应(异步)
    let respBody = '';
    let respLabel = '响应体';
    if (hitRule && hitRule.responseBody != null && hitRule.responseBody.length > 0) {
      respBody = hitRule.responseBody;
      respLabel = '响应体（Mock）';
    } else if (req.responseBody != null) {
      respBody = req.responseBody;
      respLabel = req.mocked ? '响应体（Mock）' : '响应体';
    } else {
      respBody = await this.fetchResponseText(req);
    }
    if (respBody) {
      lines.push('', '# ' + respLabel, respBody);
    }
    return lines.join('\n');
  }

  // 按需补齐详情所需的体内容，有更新且仍选中该条时重绘右侧
  private async loadDetailLazy(req: CapturedRequest): Promise<void> {
    const a = await this.ensureRequestBody(req);
    const b = await this.ensureHitBodies(req);
    if (!a && !b) {
      return;
    }
    if (this.selection && this.selection.kind === 'request' && this.selection.id === req.id) {
      this.renderRight();
    }
  }

  // 真实请求的请求体：requestFormData 是一次 CDP 往返，只在查看详情时拉一次
  private async ensureRequestBody(req: CapturedRequest): Promise<boolean> {
    if (req.formDataLoaded || !req.request) {
      return false;
    }
    req.formDataLoaded = true;
    try {
      const data = await req.request.requestFormData();
      if (data) {
        req.requestBody = data;
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  // mock 命中的请求/响应体：轮询时不带，查看详情时按 uid 单条拉取
  private async ensureHitBodies(req: CapturedRequest): Promise<boolean> {
    if (req.bodiesLoaded || !req.hitUid) {
      return false;
    }
    if (!req.hasReqBody && !req.hasRespBody) {
      req.bodiesLoaded = true;
      return false;
    }
    req.bodiesLoaded = true;
    const bodies = await evalInPage<MockHitBodies>(
        'window.__chiiNet && window.__chiiNet.getHitBodies ? window.__chiiNet.getHitBodies(' +
        JSON.stringify(req.hitUid) + ') : null');
    if (!bodies) {
      return false;
    }
    req.requestBody = bodies.reqBody != null ? bodies.reqBody : req.requestBody;
    req.responseBody = bodies.respBody != null ? bodies.respBody : req.responseBody;
    req.reqLen = bodies.reqLen != null ? bodies.reqLen : req.reqLen;
    req.respLen = bodies.respLen != null ? bodies.respLen : req.respLen;
    req.bodyReleased = bodies.released;
    return true;
  }

  // 把 preview 补成 target 侧当前保留的全文
  private async ensureFullBodies(req: CapturedRequest): Promise<void> {
    if (!req.hitUid) {
      return;
    }
    const pull = async (which: 'req'|'resp'): Promise<void> => {
      const r = await evalInPage<MockBodyFull>(
          'window.__chiiNet && window.__chiiNet.getHitBodyFull ? window.__chiiNet.getHitBodyFull(' +
          JSON.stringify(req.hitUid) + ', ' + JSON.stringify(which) + ') : null');
      if (!r || typeof r.text !== 'string') {
        return;
      }
      if (which === 'req') {
        req.requestBody = r.text;
      } else {
        req.responseBody = r.text;
      }
    };
    const jobs: Array<Promise<void>> = [];
    if ((req.reqLen || 0) > (req.requestBody || '').length) {
      jobs.push(pull('req'));
    }
    if ((req.respLen || 0) > (req.responseBody || '').length) {
      jobs.push(pull('resp'));
    }
    await Promise.all(jobs);
  }

  // 已展示文本短于原始长度时给出续拉入口，非 mock 命中条目不涉及 target 截断
  private mkTrunc(req: CapturedRequest, which: 'req'|'resp', shown: string): TruncInfo|undefined {
    if (!req.hitUid) {
      return undefined;
    }
    const fullLen = (which === 'req' ? req.reqLen : req.respLen) || 0;
    if (fullLen <= shown.length) {
      return undefined;
    }
    return {
      shownLen: shown.length,
      fullLen,
      load: async () => {
        const r = await evalInPage<MockBodyFull>(
            'window.__chiiNet && window.__chiiNet.getHitBodyFull ? window.__chiiNet.getHitBodyFull(' +
            JSON.stringify(req.hitUid) + ', ' + JSON.stringify(which) + ') : null');
        if (!r || typeof r.text !== 'string') {
          return null;
        }
        if (which === 'req') {
          req.requestBody = r.text;
        } else {
          req.responseBody = r.text;
        }
        return r;
      },
    };
  }

  // 设置写在被调试页 localStorage，刷新页面后仍生效
  private renderSettings(): HTMLElement {
    const form = document.createElement('div');
    form.className = 'chii-mock-form';

    const title = document.createElement('div');
    title.className = 'gt';
    title.style.fontWeight = '600';
    title.style.marginBottom = '10px';
    title.textContent = '高级设置';
    form.appendChild(title);

    const mkNum = (labelText: string, value: number, hint: string): HTMLInputElement => {
      const frow = document.createElement('div');
      frow.className = 'frow';
      const label = document.createElement('label');
      label.textContent = labelText;
      frow.appendChild(label);
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'full';
      input.min = '0';
      input.value = String(value);
      frow.appendChild(input);
      const h = document.createElement('div');
      h.className = 'fhint';
      h.textContent = hint;
      frow.appendChild(h);
      form.appendChild(frow);
      return input;
    };

    const keepInput = mkNum('保留原文的条目数量', this.limits.keepFullCount, '最近这么多条命中保留原文，更早的只留前 64 KB');
    const maxInput = mkNum(
        '单条原文上限（KB）', Math.round(this.limits.maxBodyBytes / 1024),
        '最小 64，最大 16384。超出部分在记录时即丢弃，不可恢复');

    const msg = document.createElement('div');
    msg.className = 'fhint';

    const actions = document.createElement('div');
    actions.className = 'actions';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'chii-mock-btn primary';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', () => {
      const keep = parseInt(keepInput.value, 10);
      const kb = parseInt(maxInput.value, 10);
      void this.pushLimits(
          {
            keepFullCount: isNaN(keep) ? this.limits.keepFullCount : keep,
            maxBodyBytes: isNaN(kb) ? this.limits.maxBodyBytes : kb * 1024,
          },
          msg);
    });
    actions.appendChild(saveBtn);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'chii-mock-btn';
    resetBtn.textContent = '恢复默认';
    resetBtn.addEventListener('click', () => {
      keepInput.value = String(DEFAULT_LIMITS.keepFullCount);
      maxInput.value = String(Math.round(DEFAULT_LIMITS.maxBodyBytes / 1024));
      void this.pushLimits({...DEFAULT_LIMITS}, msg);
    });
    actions.appendChild(resetBtn);
    const backBtn = document.createElement('button');
    backBtn.className = 'chii-mock-btn';
    backBtn.textContent = '返回';
    backBtn.addEventListener('click', () => {
      this.selection = null;
      this.renderRight();
    });
    actions.appendChild(backBtn);
    form.appendChild(actions);
    form.appendChild(msg);
    return form;
  }

  private async pushLimits(next: NetLimits, msg: HTMLElement): Promise<void> {
    const arg = JSON.stringify(JSON.stringify(next));
    const state = await evalInPage<NetState>(
        'window.__chiiNet && window.__chiiNet.setLimits ? window.__chiiNet.setLimits(' + arg + ') : null');
    if (!state || !state.limits) {
      msg.textContent = '页面里的 target.js 版本较旧，不支持该设置';
      return;
    }
    this.limits = state.limits;
    msg.textContent = '已保存，当前保留 ' + this.limits.keepFullCount + ' 条，单条上限 ' +
        fmtSize(this.limits.maxBodyBytes);
  }

  // 请求概要：方法、路由（右侧「复制全链接」）、状态，并把 query 解析成字段
  private appendRequestSummary(container: HTMLElement, req: CapturedRequest): void {
    const gt = document.createElement('div');
    gt.className = 'gt';
    gt.textContent = '请求';
    container.appendChild(gt);

    const mkRow = (k: string, v: string, act?: HTMLElement): void => {
      const row = document.createElement('div');
      row.className = 'row';
      const kEl = document.createElement('span');
      kEl.className = 'k';
      kEl.textContent = k;
      const vEl = document.createElement('span');
      vEl.className = 'v';
      vEl.textContent = v;
      row.appendChild(kEl);
      row.appendChild(vEl);
      if (act) {
        act.classList.add('act');
        row.appendChild(act);
      }
      container.appendChild(row);
    };

    mkRow('method', req.method);
    const copyUrl = this.mkCopyButton(() => req.url, '复制全链接');
    copyUrl.title = '复制包含域名与参数的完整 URL';
    // 路由展示完整链接去掉 query，参数在下方单独解析
    mkRow('路由', urlWithoutParams(req.url), copyUrl);
    if (req.status) {
      mkRow('status', String(req.status));
    }
    // query 参数解析为字段，提升可读性
    this.appendCollapsible(container, '查询参数', urlQueryEntries(req.url), true);
  }

  // 拉取请求的响应体文本（失败或无 NetworkRequest 返回空串）
  private async fetchResponseText(req: CapturedRequest): Promise<string> {
    if (!req.request) {
      return '';
    }
    try {
      const content = await req.request.contentData();
      const anyContent = content as {error?: string, text?: string};
      if (!anyContent.error && typeof anyContent.text === 'string') {
        return anyContent.text;
      }
    } catch {
      // ignore
    }
    return '';
  }

  // 拉取响应体后预填草稿并打开编辑器（仍需再点「保存规则」才生效）
  private async addRequestAsRule(req: CapturedRequest): Promise<void> {
    await this.ensureRequestBody(req);
    await this.ensureHitBodies(req);
    // 规则内容不能是 preview，否则保存下去的 mock 体是半截的
    await this.ensureFullBodies(req);
    const responseBody = tryFormatJson(req.responseBody != null ? req.responseBody : await this.fetchResponseText(req));
    const requestBody = req.requestBody ? tryFormatJson(req.requestBody) : '';
    // 带上请求头/响应头：真实请求取 NetworkRequest，无 NetworkRequest 时留空
    const requestHeaders = req.request ? entriesToRec(req.request.requestHeaders()) : undefined;
    const responseHeaders = req.request ? entriesToRec(req.request.responseHeaders) : undefined;
    this.openEditor(
        {
          id: genId(),
          enabled: true,
          urlIncludes: shortUrl(req.url),
          method: req.method,
          status: req.status || undefined,
          requestHeaders,
          responseHeaders,
          requestBody: requestBody || undefined,
          responseBody: responseBody || undefined,
        },
        true);
  }

  // 「复制」按钮：点击复制 getText() 返回的原始文本；不触发折叠，带短暂反馈
  private mkCopyButton(getText: () => string, label = '复制'): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chii-mock-copy';
    b.textContent = label;
    b.title = '复制原始内容';
    b.addEventListener('click', e => {
      e.stopPropagation();
      try {
        void navigator.clipboard.writeText(getText());
      } catch {
        // ignore
      }
      b.textContent = '已复制';
      window.setTimeout(() => {
        b.textContent = label;
      }, 1000);
    });
    return b;
  }

  // 可折叠的代码/JSON 分组（默认展开），标题行带复制（复制原始文本），展示格式化后的内容。
  private appendCodeGroup(
      container: HTMLElement, title: string, rawText: string, defaultOpen = true, trunc?: TruncInfo): void {
    const wrap = document.createElement('div');
    wrap.className = 'chii-mock-collap';
    const head = document.createElement('div');
    head.className = 'chd' + (defaultOpen ? ' open' : '');
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▶';
    const t = document.createElement('span');
    t.textContent = title;
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(arrow);
    head.appendChild(t);
    head.appendChild(spacer);
    let currentText = rawText;
    head.appendChild(this.mkCopyButton(() => currentText));

    const body = document.createElement('div');
    body.className = 'cbd';
    body.style.display = defaultOpen ? 'block' : 'none';
    const pre = document.createElement('pre');
    pre.className = 'chii-mock-code';
    pre.textContent = tryFormatJson(rawText);
    body.appendChild(pre);
    if (trunc) {
      body.appendChild(this.mkMoreBar(trunc, text => {
        currentText = text;
        pre.textContent = tryFormatJson(text);
      }));
    }

    head.addEventListener('click', () => {
      const open = body.style.display === 'none';
      body.style.display = open ? 'block' : 'none';
      head.classList.toggle('open', open);
    });
    wrap.appendChild(head);
    wrap.appendChild(body);
    container.appendChild(wrap);
  }

  // 截断提示与续拉按钮，放在代码块正下方
  private mkMoreBar(trunc: TruncInfo, onLoaded: (text: string) => void): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'chii-mock-more';
    const info = document.createElement('span');
    info.textContent = '已显示 ' + fmtSize(trunc.shownLen) + '，共 ' + fmtSize(trunc.fullLen);
    bar.appendChild(info);
    const btn = document.createElement('button');
    btn.className = 'chii-mock-btn';
    btn.textContent = '加载全部';
    btn.addEventListener('click', () => {
      btn.textContent = '加载中…';
      btn.disabled = true;
      void trunc.load().then(r => {
        if (!r || typeof r.text !== 'string') {
          btn.remove();
          info.textContent = '原文已释放，只剩前 ' + fmtSize(trunc.shownLen) + '，可调大高级设置后重新触发请求';
          return;
        }
        onLoaded(r.text);
        btn.remove();
        if (r.kept < r.len) {
          info.textContent = '已加载 ' + fmtSize(r.kept) + '，共 ' + fmtSize(r.len) +
              '，其余在记录时已超单条上限被丢弃';
        } else {
          info.textContent = '已全部加载 ' + fmtSize(r.len);
        }
      });
    });
    bar.appendChild(btn);
    return bar;
  }

  // 可折叠的键值分组，用于展示请求头/响应头。空则不渲染。标题行带复制原文
  private appendCollapsible(
      container: HTMLElement, title: string, entries: Array<{name: string, value: string}>,
      defaultOpen = false): void {
    if (!entries || entries.length === 0) {
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'chii-mock-collap';
    const head = document.createElement('div');
    head.className = 'chd' + (defaultOpen ? ' open' : '');
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▶';
    const t = document.createElement('span');
    t.textContent = title + ' (' + entries.length + ')';
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(arrow);
    head.appendChild(t);
    head.appendChild(spacer);
    head.appendChild(this.mkCopyButton(() => entries.map(e => e.name + ': ' + e.value).join('\n')));

    const body = document.createElement('div');
    body.className = 'chii-mock-kv cbd';
    body.style.display = defaultOpen ? 'block' : 'none';
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'row';
      const kEl = document.createElement('span');
      kEl.className = 'k';
      kEl.textContent = e.name;
      const vEl = document.createElement('span');
      vEl.className = 'v';
      vEl.textContent = e.value;
      row.appendChild(kEl);
      row.appendChild(vEl);
      body.appendChild(row);
    }
    head.addEventListener('click', () => {
      const open = body.style.display === 'none';
      body.style.display = open ? 'block' : 'none';
      head.classList.toggle('open', open);
    });
    wrap.appendChild(head);
    wrap.appendChild(body);
    container.appendChild(wrap);
  }

  // 异步加载并缓存 JSON 语言扩展（CodeMirror）
  private async ensureJsonLang(): Promise<void> {
    if (this.jsonLang) {
      return;
    }
    try {
      this.jsonLang = await CodeHighlighter.CodeHighlighter.languageFromMIME('application/json') as CodeMirror.Extension;
    } catch {
      this.jsonLang = null;
    }
  }

  // 编辑器扩展
  private buildEditorExtensions(text: string): CodeMirror.Extension[] {
    const extensions: CodeMirror.Extension[] = [
      TextEditor.Config.baseConfiguration(text),
      CodeMirror.lineNumbers(),
      CodeMirror.EditorView.lineWrapping,
      CodeMirror.syntaxHighlighting(CodeHighlighter.CodeHighlighter.highlightStyle),
      CodeMirror.EditorView.theme({
        '&': {maxHeight: '260px'},
        '.cm-scroller': {overflow: 'auto'},
      }),
    ];
    if (this.jsonLang) {
      extensions.push(this.jsonLang);
    }
    return extensions;
  }

  // 创建可编辑的 JSON 代码编辑器（请求体/响应体共用）
  private createBodyEditor(text: string): TextEditor.TextEditor.TextEditor {
    const editor = new TextEditor.TextEditor.TextEditor(
        CodeMirror.EditorState.create({doc: text, extensions: this.buildEditorExtensions(text)}));
    editor.className = 'chii-mock-editor';
    if (!this.jsonLang) {
      // 语言未就绪时异步补齐高亮
      void this.ensureJsonLang().then(() => {
        if (this.jsonLang && editor.isConnected) {
          const cur = editor.state.doc.toString();
          editor.state = CodeMirror.EditorState.create({
            doc: cur,
            extensions: this.buildEditorExtensions(cur),
          });
        }
      });
    }
    return editor;
  }

  // 打开编辑器（草稿模式，改动不立即生效，须点「保存规则」）
  private openEditor(draft: MockRule, isNew: boolean, ruleId?: string): void {
    this.draft = draft;
    this.draftIsNew = isNew;
    if (!isNew && ruleId) {
      this.draft.id = ruleId;
    }
    this.selection = {kind: 'editor'};
    this.renderRequests();
    this.renderRules();
    this.renderRight();
  }

  // Header编辑器
  private buildHeadersField(
      label: string, draft: MockRule, field: 'requestHeaders'|'responseHeaders', hint?: string): HTMLElement {
    const frow = document.createElement('div');
    frow.className = 'frow chii-mock-hgroup';

    const head = document.createElement('div');
    head.className = 'chd';
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▶';
    const titleEl = document.createElement('span');
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    // 视图切换分段控件（放在标题行右侧）
    const switchBar = document.createElement('div');
    switchBar.className = 'chii-mock-hbar';
    head.appendChild(arrow);
    head.appendChild(titleEl);
    if (hint) {
      const hintEl = document.createElement('span');
      hintEl.className = 'chint';
      hintEl.textContent = hint;
      head.appendChild(hintEl);
    }
    head.appendChild(spacer);
    head.appendChild(switchBar);
    frow.appendChild(head);

    const body = document.createElement('div');
    body.className = 'chii-mock-hbody';
    body.style.display = 'none';
    frow.appendChild(body);

    let expanded = false;
    let mode: 'table'|'raw' = 'table';
    let rows = recToRows(draft[field]);

    const updateCount = (): void => {
      const rec = draft[field];
      const n = rec ? Object.keys(rec).length : 0;
      titleEl.textContent = n > 0 ? label + ' (' + n + ')' : label;
    };

    // 表格行 → draft[field]（跳过空 key；无有效项则 undefined）
    const syncFromRows = (): void => {
      const out: {[k: string]: string} = {};
      let has = false;
      for (const r of rows) {
        const k = r.k.trim();
        if (!k) {
          continue;
        }
        out[k] = r.v;
        has = true;
      }
      draft[field] = has ? out : undefined;
      updateCount();
    };

    const renderBody = (): void => {
      body.removeChildren();
      if (mode === 'table') {
        if (rows.length > 0) {
          const table = document.createElement('div');
          table.className = 'chii-mock-htable';
          rows.forEach((r, i) => {
          const line = document.createElement('div');
          line.className = 'hrow';
          const ck = document.createElement('div');
          ck.className = 'cell-k';
          const kIn = document.createElement('input');
          kIn.type = 'text';
          kIn.className = 'hk';
          kIn.placeholder = 'Name';
          kIn.value = r.k;
          kIn.addEventListener('input', () => {
            r.k = kIn.value;
            syncFromRows();
          });
          ck.appendChild(kIn);
          const cv = document.createElement('div');
          cv.className = 'cell-v';
          const vIn = document.createElement('input');
          vIn.type = 'text';
          vIn.className = 'hv';
          vIn.placeholder = 'Value';
          vIn.value = r.v;
          vIn.addEventListener('input', () => {
            r.v = vIn.value;
            syncFromRows();
          });
          cv.appendChild(vIn);
          const ca = document.createElement('div');
          ca.className = 'cell-act';
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'chii-mock-btn hdel';
          del.textContent = '✕';
          del.title = '删除该行';
          del.addEventListener('click', () => {
            rows.splice(i, 1);
            syncFromRows();
            renderBody();
          });
          ca.appendChild(del);
          line.appendChild(ck);
          line.appendChild(cv);
          line.appendChild(ca);
          table.appendChild(line);
          });
          body.appendChild(table);
        }
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'chii-mock-hadd';
        addBtn.textContent = '+ 新增';
        addBtn.addEventListener('click', () => {
          rows.push({k: '', v: ''});
          renderBody();
        });
        body.appendChild(addBtn);
      } else {
        const ta = document.createElement('textarea');
        ta.className = 'chii-mock-headers';
        ta.placeholder = '每行一个，如：\nContent-Type: application/json\nX-Token: abc';
        ta.value = headersToText(draft[field]);
        ta.addEventListener('input', () => {
          draft[field] = parseHeaders(ta.value);
          updateCount();
        });
        body.appendChild(ta);
      }
    };

    const setExpanded = (v: boolean): void => {
      expanded = v;
      head.classList.toggle('open', expanded);
      body.style.display = expanded ? 'block' : 'none';
      if (expanded) {
        renderBody();
      }
    };

    const tableBtn = document.createElement('button');
    tableBtn.type = 'button';
    tableBtn.className = 'chii-mock-btn hmode active';
    tableBtn.textContent = '表格视图';
    const rawBtn = document.createElement('button');
    rawBtn.type = 'button';
    rawBtn.className = 'chii-mock-btn hmode';
    rawBtn.textContent = '原始视图';
    const updateModeBtns = (): void => {
      tableBtn.classList.toggle('active', mode === 'table');
      rawBtn.classList.toggle('active', mode === 'raw');
    };
    // 点切换：不触发折叠；若已折叠则顺带展开
    tableBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (mode !== 'table') {
        rows = recToRows(draft[field]);
        mode = 'table';
        updateModeBtns();
      }
      if (!expanded) {
        setExpanded(true);
      } else {
        renderBody();
      }
    });
    rawBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (mode !== 'raw') {
        syncFromRows();
        mode = 'raw';
        updateModeBtns();
      }
      if (!expanded) {
        setExpanded(true);
      } else {
        renderBody();
      }
    });
    switchBar.appendChild(tableBtn);
    switchBar.appendChild(rawBtn);

    head.addEventListener('click', () => {
      setExpanded(!expanded);
    });

    updateCount();
    return frow;
  }

  // 请求体/响应体编辑块：可折叠（默认展开），标题行 + 「格式化 JSON」按钮 + CodeMirror 编辑器
  private buildBodyField(
      labelText: string, initial: string, assign: (ed: TextEditor.TextEditor.TextEditor) => void,
      hint?: string): HTMLElement {
    const frow = document.createElement('div');
    frow.className = 'frow chii-mock-hgroup';

    const head = document.createElement('div');
    head.className = 'chd open';
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▶';
    const titleEl = document.createElement('span');
    titleEl.textContent = labelText;
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const fmtBtn = document.createElement('button');
    fmtBtn.className = 'chii-mock-btn';
    fmtBtn.type = 'button';
    fmtBtn.textContent = '格式化 JSON';
    head.appendChild(arrow);
    head.appendChild(titleEl);
    if (hint) {
      const hintEl = document.createElement('span');
      hintEl.className = 'chint';
      hintEl.textContent = hint;
      head.appendChild(hintEl);
    }
    head.appendChild(spacer);
    head.appendChild(fmtBtn);
    frow.appendChild(head);

    const body = document.createElement('div');
    body.className = 'chii-mock-hbody';
    frow.appendChild(body);

    const editor = this.createBodyEditor(initial);
    assign(editor);
    body.appendChild(editor);
    fmtBtn.addEventListener('click', e => {
      e.stopPropagation();
      const cur = editor.state.doc.toString();
      const formatted = tryFormatJson(cur);
      if (formatted !== cur) {
        editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: formatted}});
      }
    });
    head.addEventListener('click', () => {
      const open = body.style.display === 'none';
      body.style.display = open ? 'block' : 'none';
      head.classList.toggle('open', open);
    });
    return frow;
  }

  private renderEditor(draft: MockRule): HTMLElement {
    const form = document.createElement('div');
    form.className = 'chii-mock-form';

    const title = document.createElement('div');
    title.className = 'gt';
    title.style.fontWeight = '600';
    title.style.marginBottom = '10px';
    title.textContent = this.draftIsNew ? '新增规则' : '编辑规则';
    form.appendChild(title);

    const mkText = (labelText: string, value: string, placeholder: string, onInput: (v: string) => void):
        HTMLElement => {
          const frow = document.createElement('div');
          frow.className = 'frow';
          const label = document.createElement('label');
          label.textContent = labelText;
          frow.appendChild(label);
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'full';
          input.placeholder = placeholder;
          input.value = value;
          input.addEventListener('input', () => onInput(input.value));
          frow.appendChild(input);
          return frow;
        };

    // 启用
    const enRow = document.createElement('div');
    enRow.className = 'frow';
    const enLabel = document.createElement('label');
    enLabel.style.display = 'inline-flex';
    enLabel.style.alignItems = 'center';
    enLabel.style.gap = '6px';
    const enCb = document.createElement('input');
    enCb.type = 'checkbox';
    enCb.checked = draft.enabled;
    enCb.addEventListener('change', () => {
      draft.enabled = enCb.checked;
    });
    enLabel.appendChild(enCb);
    enLabel.appendChild(document.createTextNode('启用该规则'));
    enRow.appendChild(enLabel);

    const blockLabel = document.createElement('label');
    blockLabel.style.display = 'inline-flex';
    blockLabel.style.alignItems = 'center';
    blockLabel.style.gap = '6px';
    blockLabel.style.marginLeft = '16px';
    blockLabel.title = '仅对 navigator.sendBeacon 生效：命中则阻断上报';
    const blockCb = document.createElement('input');
    blockCb.type = 'checkbox';
    blockCb.checked = draft.block === true;
    blockCb.addEventListener('change', () => {
      draft.block = blockCb.checked ? true : undefined;
    });
    blockLabel.appendChild(blockCb);
    blockLabel.appendChild(document.createTextNode('阻断 sendBeacon 上报'));
    enRow.appendChild(blockLabel);

    form.appendChild(enRow);

    form.appendChild(mkText('URL 包含子串', draft.urlIncludes || '', '如 /api/user', v => {
      draft.urlIncludes = v;
    }));
    form.appendChild(mkText('URL 正则（可选）', draft.urlRegex || '', '如 \\/api\\/.*\\/list', v => {
      draft.urlRegex = v || undefined;
    }));
    form.appendChild(mkText('URL 排除子串（可选）', draft.urlExcludes || '', '命中则跳过', v => {
      draft.urlExcludes = v || undefined;
    }));

    // 方法 + 状态码 + 延迟
    const inline = document.createElement('div');
    inline.className = 'inline';
    const mkNum = (labelText: string, value: string, placeholder: string, onInput: (v: string) => void):
        HTMLElement => {
          const frow = document.createElement('div');
          frow.className = 'frow';
          const label = document.createElement('label');
          label.textContent = labelText;
          frow.appendChild(label);
          const input = document.createElement('input');
          input.type = 'number';
          input.className = 'full';
          input.placeholder = placeholder;
          input.value = value;
          input.addEventListener('input', () => onInput(input.value));
          frow.appendChild(input);
          return frow;
        };
    const methodRow = document.createElement('div');
    methodRow.className = 'frow';
    const methodLabel = document.createElement('label');
    methodLabel.textContent = '方法';
    methodRow.appendChild(methodLabel);
    const methodInput = document.createElement('input');
    methodInput.type = 'text';
    methodInput.className = 'full';
    methodInput.placeholder = 'ANY';
    methodInput.value = draft.method || '';
    methodInput.addEventListener('input', () => {
      draft.method = methodInput.value.trim() || undefined;
    });
    methodRow.appendChild(methodInput);
    inline.appendChild(methodRow);
    inline.appendChild(mkNum('状态码', typeof draft.status === 'number' ? String(draft.status) : '', '原值', v => {
      const n = parseInt(v, 10);
      draft.status = isNaN(n) ? undefined : n;
    }));
    inline.appendChild(mkNum('延迟(ms)', typeof draft.delayMs === 'number' ? String(draft.delayMs) : '', '0', v => {
      const n = parseInt(v, 10);
      draft.delayMs = isNaN(n) || n <= 0 ? undefined : n;
    }));
    form.appendChild(inline);

    // 请求头 → 请求体 → 响应头 → 响应体
    form.appendChild(this.buildHeadersField('请求头', draft, 'requestHeaders', '合并到请求，同名则覆盖'));
    form.appendChild(this.buildBodyField('请求体', draft.requestBody || '', ed => {
      this.requestBodyEditor = ed;
    }, '留空则不改写请求体'));
    form.appendChild(this.buildHeadersField('响应头', draft, 'responseHeaders', '合并到响应，同名则覆盖'));
    form.appendChild(this.buildBodyField('响应体', draft.responseBody || '', ed => {
      this.responseEditor = ed;
    }, '留空则不替换，仅改状态码/延迟'));

    // 操作：保存 / 取消 /（编辑态）删除
    const actions = document.createElement('div');
    actions.className = 'actions';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'chii-mock-btn primary';
    saveBtn.textContent = '保存规则';
    saveBtn.addEventListener('click', () => {
      void this.saveDraft();
    });
    actions.appendChild(saveBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'chii-mock-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
      this.draft = null;
      this.requestBodyEditor = null;
      this.responseEditor = null;
      this.selection = null;
      this.renderRules();
      this.renderRight();
    });
    actions.appendChild(cancelBtn);
    if (!this.draftIsNew) {
      const delBtn = document.createElement('button');
      delBtn.className = 'chii-mock-btn danger';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        void this.deleteDraft();
      });
      actions.appendChild(delBtn);
    }
    form.appendChild(actions);

    return form;
  }

  private async saveDraft(): Promise<void> {
    if (!this.draft) {
      return;
    }
    const d = this.draft;
    // 请求体/响应体从编辑器读取（CodeMirror 不实时回写 draft）
    if (this.requestBodyEditor) {
      const body = this.requestBodyEditor.state.doc.toString();
      d.requestBody = body.length > 0 ? body : undefined;
    }
    if (this.responseEditor) {
      const body = this.responseEditor.state.doc.toString();
      d.responseBody = body.length > 0 ? body : undefined;
    }
    const idx = this.rules.findIndex(r => r.id === d.id);
    if (idx >= 0) {
      this.rules[idx] = d;
    } else {
      this.rules.push(d);
    }
    await this.pushRules();
    this.draft = null;
    this.requestBodyEditor = null;
    this.responseEditor = null;
    this.selection = {kind: 'rule', id: d.id};
    this.renderRules();
    this.renderRight();
  }

  private async deleteDraft(): Promise<void> {
    if (!this.draft) {
      return;
    }
    const id = this.draft.id;
    this.rules = this.rules.filter(r => r.id !== id);
    await this.pushRules();
    this.draft = null;
    this.requestBodyEditor = null;
    this.responseEditor = null;
    this.selection = null;
    this.renderRules();
    this.renderRight();
  }

  // ============ 与 target 同步 ============

  private async reload(retries = 8): Promise<void> {
    const state = await evalInPage<NetState>('window.__chiiNet ? window.__chiiNet.getState() : null');
    if (state) {
      this.mockEnabled = Boolean(state.mockEnabled);
      this.rules = Array.isArray(state.rules) ? state.rules : [];
      if (state.limits) {
        this.limits = state.limits;
      }
      this.enableCheckbox.checked = this.mockEnabled;
      this.renderRules();
      this.renderRight();
      return;
    }
    // target / 页面 Runtime 尚未就绪
    if (retries > 0) {
      window.setTimeout(() => {
        void this.reload(retries - 1);
      }, 500);
    }
  }

  private async pushRules(): Promise<void> {
    const json = JSON.stringify(this.rules);
    await evalInPage('window.__chiiNet && window.__chiiNet.setRules(' + json + ')');
  }
}
