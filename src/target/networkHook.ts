// 注入被调试页面的网络 hook，拦截并改写请求与响应
export interface MockRule {
  id: string;
  enabled: boolean;
  /** 与 urlRegex 同时存在时须同时满足 */
  urlIncludes: string;
  urlRegex?: string;
  /** URL 包含该子串时跳过本规则 */
  urlExcludes?: string;
  /** 大小写不敏感，空表示不限 */
  method?: string;
  /** XHR 侧只能靠 defineProperty 覆写，不保证所有场景生效 */
  status?: number;
  delayMs?: number;
  requestHeaders?: { [k: string]: string };
  responseHeaders?: { [k: string]: string };
  /** 非空则短路真实请求，直接以 UTF-8 文本返回 */
  responseBody?: string;
  /** 非空则在请求发出前替换请求体 */
  requestBody?: string;
  /** sendBeacon 专用，仅 true 时阻断上报 */
  block?: boolean;
}

export interface NetLimits {
  /** 最近多少条命中保留原文，更早的压回 PREVIEW_BYTES */
  keepFullCount: number;
  /** 单条原文保留上限，超出部分不可恢复 */
  maxBodyBytes: number;
}

export interface NetState {
  version: number;
  mockEnabled: boolean;
  rules: MockRule[];
  limits: NetLimits;
}

export interface MockHit {
  id: number;
  /** 格式 tag:seq，页面刷新后 tag 变化，前端可直接用它去重 */
  uid: string;
  url: string;
  method: string;
  ruleId: string;
  /** true 表示未打真实请求 */
  replaced: boolean;
  blocked: boolean;
  status: number | null;
  /** 只有能同步读到的请求体才有值 */
  reqBody?: string;
  respBody?: string;
  /** 截断前的原始长度 */
  reqLen?: number;
  respLen?: number;
  /** 已移出保留窗口，原文不可再取 */
  released?: boolean;
  ts: number;
}

// 不含请求体与响应体，供前端高频轮询
export interface MockHitLite {
  uid: string;
  seq: number;
  url: string;
  method: string;
  ruleId: string;
  replaced: boolean;
  blocked: boolean;
  status: number | null;
  ts: number;
  hasReqBody: boolean;
  hasRespBody: boolean;
  reqLen: number;
  respLen: number;
  released: boolean;
}

// 详情首次下发的体，超出 PREVIEW_BYTES 的部分要再点「加载全部」才取
export interface MockHitBodies {
  reqBody?: string;
  respBody?: string;
  /** 请求体原始长度 */
  reqLen: number;
  respLen: number;
  /** target 侧当前还留着多少，等于原始长度说明可取到全文 */
  reqKept: number;
  respKept: number;
  released: boolean;
}

export interface MockBodyFull {
  text?: string;
  len: number;
  kept: number;
  released: boolean;
}

export interface MockHitsDelta {
  /** 与前端持有的不一致说明页面已刷新，此时返回全量 */
  tag: string;
  /** 前端下次以此作为 since */
  seq: number;
  hits: MockHitLite[];
}

// 判断 target 是否晚于业务请求加载
export interface MockDiagnostics {
  installedAt: number;
  installedAfterMs: number;
  /** 大于 0 说明这些请求无法被 mock */
  preInstallCount: number;
  preInstallSamples: string[];
}

const GLOBAL_KEY = '__chiiNet';
const STORE_KEY = 'chii-net';
const MAX_HITS = 300;
// 详情首次只下发这么多，剩下的点「加载全部」再拉，避免一次传输过大拖慢页面
const PREVIEW_BYTES = 64 * 1024;
const DEFAULT_KEEP_FULL_COUNT = 20;
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const MAX_KEEP_FULL_COUNT = 300;
const MAX_BODY_BYTES_CAP = 16 * 1024 * 1024;

interface ChiiNetApi {
  version: number;
  getState(): NetState;
  setState(patch: Partial<NetState>): NetState;
  setRules(rules: MockRule[] | string): NetState;
  setMockEnabled(v: boolean): NetState;
  setLimits(limits: Partial<NetLimits> | string): NetState;
  getHits(): MockHit[];
  getHitsSince(sinceSeq: number, tag: string): MockHitsDelta;
  getHitBodies(uid: string): MockHitBodies | null;
  getHitBodyFull(uid: string, which: string): MockBodyFull | null;
  getDiagnostics(): MockDiagnostics;
  clearHits(): void;
}

type RecordHitFn = (hit: {
  url: string;
  method: string;
  ruleId: string;
  replaced: boolean;
  blocked: boolean;
  status: number | null;
  reqBody?: string;
  respBody?: string;
}) => void;

// Blob 与 ArrayBuffer 无法同步读，返回 undefined
function bodyToText(body: any): string | undefined {
  if (typeof body === 'string') return body;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
  return undefined;
}

function loadState(): NetState {
  const base: NetState = {
    version: 1,
    mockEnabled: false,
    rules: [],
    limits: defaultLimits(),
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        if (typeof o.mockEnabled === 'boolean') base.mockEnabled = o.mockEnabled;
        if (Object.prototype.toString.call(o.rules) === '[object Array]') {
          base.rules = normalizeRules(o.rules);
        }
        base.limits = normalizeLimits(o.limits, base.limits);
      }
    }
  } catch {
    // ignore
  }
  return base;
}

function defaultLimits(): NetLimits {
  return {
    keepFullCount: DEFAULT_KEEP_FULL_COUNT,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
  };
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(v);
  if (!isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// 单条上限不低于 PREVIEW_BYTES，否则详情连首屏都凑不齐
function normalizeLimits(input: any, base: NetLimits): NetLimits {
  const out: NetLimits = {keepFullCount: base.keepFullCount, maxBodyBytes: base.maxBodyBytes};
  if (input && typeof input === 'object') {
    if (typeof input.keepFullCount === 'number') {
      out.keepFullCount = clampInt(input.keepFullCount, 0, MAX_KEEP_FULL_COUNT);
    }
    if (typeof input.maxBodyBytes === 'number') {
      out.maxBodyBytes = clampInt(input.maxBodyBytes, PREVIEW_BYTES, MAX_BODY_BYTES_CAP);
    }
  }
  return out;
}

function normalizeRules(input: any[]): MockRule[] {
  const out: MockRule[] = [];
  for (let i = 0; i < input.length; i++) {
    const r = input[i] || {};
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : genId(),
      enabled: r.enabled !== false,
      urlIncludes: typeof r.urlIncludes === 'string' ? r.urlIncludes : '',
      urlRegex: typeof r.urlRegex === 'string' ? r.urlRegex : undefined,
      urlExcludes: typeof r.urlExcludes === 'string' ? r.urlExcludes : undefined,
      method: typeof r.method === 'string' ? r.method : undefined,
      status: typeof r.status === 'number' ? r.status : undefined,
      delayMs: typeof r.delayMs === 'number' ? r.delayMs : undefined,
      requestHeaders: isPlainRecord(r.requestHeaders) ? r.requestHeaders : undefined,
      responseHeaders: isPlainRecord(r.responseHeaders) ? r.responseHeaders : undefined,
      responseBody: typeof r.responseBody === 'string' ? r.responseBody : undefined,
      requestBody: typeof r.requestBody === 'string' ? r.requestBody : undefined,
      block: r.block === true ? true : undefined,
    });
  }
  return out;
}

function isPlainRecord(o: any): boolean {
  return !!o && typeof o === 'object' && Object.prototype.toString.call(o) !== '[object Array]';
}

let idSeq = 0;
function genId(): string {
  idSeq += 1;
  return 'r' + Date.now().toString(36) + '_' + idSeq.toString(36);
}

// ==== 规则匹配 ====

// 每个请求都 new RegExp 开销过大
const regexCache: { [pattern: string]: RegExp | null } = {};
function compileRegex(pattern: string): RegExp | null {
  if (!Object.prototype.hasOwnProperty.call(regexCache, pattern)) {
    try {
      regexCache[pattern] = new RegExp(pattern);
    } catch {
      regexCache[pattern] = null;
    }
  }
  return regexCache[pattern];
}

function keepBody(s: string | undefined, max: number): string | undefined {
  if (typeof s !== 'string') return undefined;
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function bodyLen(s?: string): number {
  return typeof s === 'string' ? s.length : 0;
}

function ruleMatches(r: MockRule, url: string, method: string): boolean {
  if (!r.enabled) return false;
  const hasInclude = !!r.urlIncludes;
  const hasRegex = typeof r.urlRegex === 'string' && r.urlRegex.length > 0;
  if (!hasInclude && !hasRegex) return false;
  if (hasInclude && url.indexOf(r.urlIncludes) < 0) return false;
  if (hasRegex) {
    const re = compileRegex(r.urlRegex as string);
    if (!re || !re.test(url)) return false;
  }
  if (r.urlExcludes && url.indexOf(r.urlExcludes) >= 0) return false;
  if (r.method && method.toUpperCase() !== r.method.toUpperCase()) return false;
  return true;
}

function mergeHeadersRecord(target: { [k: string]: string }, rec?: { [k: string]: string }) {
  if (!rec) return;
  const keys = Object.keys(rec);
  for (let i = 0; i < keys.length; i++) {
    target[keys[i]] = rec[keys[i]];
  }
}

function pickResponseBody(matched: MockRule[]): string | null {
  for (let i = 0; i < matched.length; i++) {
    if (typeof matched[i].responseBody === 'string' && (matched[i].responseBody as string).length > 0) {
      return matched[i].responseBody as string;
    }
  }
  return null;
}

function pickRequestBody(matched: MockRule[]): string | null {
  for (let i = 0; i < matched.length; i++) {
    if (typeof matched[i].requestBody === 'string' && (matched[i].requestBody as string).length > 0) {
      return matched[i].requestBody as string;
    }
  }
  return null;
}

function pickStatus(matched: MockRule[]): number | null {
  for (let i = 0; i < matched.length; i++) {
    if (typeof matched[i].status === 'number') return matched[i].status as number;
  }
  return null;
}

function pickDelay(matched: MockRule[]): number {
  let d = 0;
  for (let i = 0; i < matched.length; i++) {
    if (typeof matched[i].delayMs === 'number' && (matched[i].delayMs as number) > d) {
      d = matched[i].delayMs as number;
    }
  }
  return d;
}

function collectResponseHeaders(matched: MockRule[]): { [k: string]: string } {
  const extra: { [k: string]: string } = {};
  for (let i = 0; i < matched.length; i++) {
    mergeHeadersRecord(extra, matched[i].responseHeaders);
  }
  return extra;
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// ==== 安装 ====

// 注入前已发出的 XHR 与 fetch 无法被 mock，统计出来供面板告警
function collectPreInstall(): { count: number; samples: string[] } {
  const out = { count: 0, samples: [] as string[] };
  try {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return out;
    const list: any[] = performance.getEntriesByType('resource') as any[];
    for (let i = 0; i < list.length; i++) {
      const t = list[i] && list[i].initiatorType;
      if (t !== 'xmlhttprequest' && t !== 'fetch') continue;
      out.count += 1;
      if (out.samples.length < 20) out.samples.push(String(list[i].name || ''));
    }
  } catch {
    // ignore
  }
  return out;
}

export function installNetworkHook(): void {
  const w = window as any;
  if (w[GLOBAL_KEY]) return;

  const state: NetState = loadState();
  const installedAt = Date.now();
  let installedAfterMs = 0;
  try {
    installedAfterMs = Math.round(typeof performance !== 'undefined' ? performance.now() : 0);
  } catch {
    installedAfterMs = 0;
  }
  const preInstall = collectPreInstall();
  // 页面刷新后重新生成，前端据此判断需要全量同步
  const sessionTag = Math.random().toString(36).slice(2, 10) + installedAt.toString(36);

  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          mockEnabled: state.mockEnabled,
          rules: state.rules,
          limits: state.limits,
        })
      );
    } catch {
      // ignore
    }
  }

  function matchRules(url: string, method: string): MockRule[] {
    if (!state.mockEnabled) return [];
    const out: MockRule[] = [];
    for (let i = 0; i < state.rules.length; i++) {
      if (ruleMatches(state.rules[i], url, method)) out.push(state.rules[i]);
    }
    return out;
  }

  const hits: MockHit[] = [];
  let hitSeq = 0;
  function recordHit(hit: {
    url: string;
    method: string;
    ruleId: string;
    replaced: boolean;
    blocked: boolean;
    status: number | null;
    reqBody?: string;
    respBody?: string;
  }) {
    hitSeq += 1;
    const max = state.limits.maxBodyBytes;
    hits.push({
      id: hitSeq,
      uid: sessionTag + ':' + hitSeq,
      url: hit.url,
      method: hit.method,
      ruleId: hit.ruleId,
      replaced: hit.replaced,
      blocked: hit.blocked,
      status: hit.status,
      reqBody: keepBody(hit.reqBody, max),
      respBody: keepBody(hit.respBody, max),
      reqLen: bodyLen(hit.reqBody),
      respLen: bodyLen(hit.respBody),
      ts: Date.now(),
    });
    while (hits.length > MAX_HITS) hits.shift();
    releaseOldBodies();
  }

  // 只有最近 keepFullCount 条留原文，更早的压回 PREVIEW_BYTES 释放内存
  function releaseOldBodies() {
    const end = hits.length - state.limits.keepFullCount;
    for (let i = 0; i < end; i++) {
      const h = hits[i];
      if (h.released) continue;
      h.released = true;
      if (typeof h.reqBody === 'string' && h.reqBody.length > PREVIEW_BYTES) {
        h.reqBody = h.reqBody.slice(0, PREVIEW_BYTES);
      }
      if (typeof h.respBody === 'string' && h.respBody.length > PREVIEW_BYTES) {
        h.respBody = h.respBody.slice(0, PREVIEW_BYTES);
      }
    }
  }

  function findHit(uid: string): MockHit | null {
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].uid === uid) return hits[i];
    }
    return null;
  }

  function toLite(h: MockHit): MockHitLite {
    return {
      uid: h.uid,
      seq: h.id,
      url: h.url,
      method: h.method,
      ruleId: h.ruleId,
      replaced: h.replaced,
      blocked: h.blocked,
      status: h.status,
      ts: h.ts,
      hasReqBody: typeof h.reqBody === 'string' && h.reqBody.length > 0,
      hasRespBody: typeof h.respBody === 'string' && h.respBody.length > 0,
      reqLen: h.reqLen || 0,
      respLen: h.respLen || 0,
      released: h.released === true,
    };
  }

  installFetchHook(w, matchRules, recordHit);
  installXhrHook(w, matchRules, recordHit);
  installSendBeaconHook(w, matchRules, recordHit);

  const api: ChiiNetApi = {
    version: 3,
    getState: function () {
      return {
        version: state.version,
        mockEnabled: state.mockEnabled,
        rules: state.rules,
        limits: {keepFullCount: state.limits.keepFullCount, maxBodyBytes: state.limits.maxBodyBytes},
      };
    },
    setState: function (patch) {
      if (patch && typeof patch.mockEnabled === 'boolean') state.mockEnabled = patch.mockEnabled;
      if (patch && Object.prototype.toString.call(patch.rules) === '[object Array]') {
        state.rules = normalizeRules(patch.rules as any[]);
      }
      if (patch && patch.limits) {
        state.limits = normalizeLimits(patch.limits, state.limits);
        releaseOldBodies();
      }
      persist();
      return api.getState();
    },
    setRules: function (rules) {
      let arr: any[] = [];
      if (typeof rules === 'string') {
        try {
          arr = JSON.parse(rules);
        } catch {
          arr = [];
        }
      } else if (Object.prototype.toString.call(rules) === '[object Array]') {
        arr = rules as any[];
      }
      state.rules = normalizeRules(arr);
      persist();
      return api.getState();
    },
    setMockEnabled: function (v) {
      state.mockEnabled = !!v;
      persist();
      return api.getState();
    },
    setLimits: function (limits) {
      let o: any = limits;
      if (typeof limits === 'string') {
        try {
          o = JSON.parse(limits);
        } catch {
          o = null;
        }
      }
      state.limits = normalizeLimits(o, state.limits);
      releaseOldBodies();
      persist();
      return api.getState();
    },
    getHits: function () {
      return hits.slice();
    },
    getHitsSince: function (sinceSeq, tag) {
      const all = tag !== sessionTag;
      const out: MockHitLite[] = [];
      for (let i = 0; i < hits.length; i++) {
        if (all || hits[i].id > sinceSeq) out.push(toLite(hits[i]));
      }
      return { tag: sessionTag, seq: hitSeq, hits: out };
    },
    getHitBodies: function (uid) {
      const h = findHit(uid);
      if (!h) return null;
      return {
        reqBody: keepBody(h.reqBody, PREVIEW_BYTES),
        respBody: keepBody(h.respBody, PREVIEW_BYTES),
        reqLen: h.reqLen || 0,
        respLen: h.respLen || 0,
        reqKept: bodyLen(h.reqBody),
        respKept: bodyLen(h.respBody),
        released: h.released === true,
      };
    },
    getHitBodyFull: function (uid, which) {
      const h = findHit(uid);
      if (!h) return null;
      const isReq = which === 'req';
      const text = isReq ? h.reqBody : h.respBody;
      return {
        text: text,
        len: (isReq ? h.reqLen : h.respLen) || 0,
        kept: bodyLen(text),
        released: h.released === true,
      };
    },
    getDiagnostics: function () {
      return {
        installedAt: installedAt,
        installedAfterMs: installedAfterMs,
        preInstallCount: preInstall.count,
        preInstallSamples: preInstall.samples,
      };
    },
    clearHits: function () {
      hits.length = 0;
    },
  };

  w[GLOBAL_KEY] = api;
}

type MatchFn = (url: string, method: string) => MockRule[];

// ---------- fetch ----------

function installFetchHook(w: any, matchRules: MatchFn, recordHit: RecordHitFn) {
  if (typeof w.fetch !== 'function' || typeof w.Request === 'undefined') return;
  const nativeFetch = w.fetch.bind(w);

  w.fetch = function (input: any, init?: any): Promise<Response> {
    let url = '';
    let method = 'GET';
    try {
      if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) {
        url = new URL(String(input), location.href).href;
      } else if (input && typeof input === 'object') {
        url = String(input.url || '');
        if (input.method) method = input.method;
      }
      if (init && init.method) method = init.method;
    } catch {
      // ignore
    }
    method = (method || 'GET').toUpperCase();

    const matched = matchRules(url, method);
    if (matched.length === 0) {
      // 必须原样透传入参，重建 Request 会让 chobitsu 读不到 postData
      return nativeFetch(input, init);
    }

    const delayMs = pickDelay(matched);
    const overrideStatus = pickStatus(matched);
    const replacedBody = pickResponseBody(matched);
    const extraRespHeaders = collectResponseHeaders(matched);

    // 命中 responseBody 时短路真实请求
    if (replacedBody != null) {
      recordHit({
        url: url,
        method: method,
        ruleId: matched[0].id,
        replaced: true,
        blocked: false,
        status: overrideStatus,
        reqBody: bodyToText(init && init.body),
        respBody: replacedBody,
      });
      const build = function (): Response {
        const respInit: any = {
          status: overrideStatus != null ? overrideStatus : 200,
          statusText: 'OK',
          headers: new Headers(extraRespHeaders),
        };
        return new Response(replacedBody, respInit);
      };
      if (delayMs > 0) {
        return sleep(delayMs).then(build);
      }
      return Promise.resolve(build());
    }

    // 只改请求头体、响应头、状态码或延迟时仍要打真实请求
    recordHit({url: url, method: method, ruleId: matched[0].id, replaced: false, blocked: false, status: overrideStatus});
    let req: Request;
    try {
      req = new Request(input, init);
    } catch {
      return nativeFetch(input, init);
    }
    const reqHeaders: { [k: string]: string } = {};
    req.headers.forEach(function (v: string, k: string) {
      reqHeaders[k] = v;
    });
    for (let i = 0; i < matched.length; i++) {
      mergeHeadersRecord(reqHeaders, matched[i].requestHeaders);
    }
    const newReqBody = pickRequestBody(matched);
    const outInit: any = { headers: new Headers(reqHeaders) };
    if (newReqBody != null) outInit.body = newReqBody;
    let outbound: Request;
    try {
      outbound = new Request(req, outInit);
    } catch {
      outbound = req;
    }

    return nativeFetch(outbound).then(function (response: Response) {
      const finish = function (): Promise<Response> {
        if (overrideStatus == null && Object.keys(extraRespHeaders).length === 0) {
          return Promise.resolve(response);
        }
        const respHeaders: { [k: string]: string } = {};
        response.headers.forEach(function (v: string, k: string) {
          respHeaders[k] = v;
        });
        mergeHeadersRecord(respHeaders, extraRespHeaders);
        const status = overrideStatus != null ? overrideStatus : response.status;
        const respInit: any = {
          status: status,
          statusText: response.statusText,
          headers: new Headers(respHeaders),
        };
        if (response.body) {
          return Promise.resolve(new Response(response.body, respInit));
        }
        return response.arrayBuffer().then(function (buf) {
          return new Response(buf, respInit);
        });
      };
      if (delayMs > 0) {
        return sleep(delayMs).then(finish);
      }
      return finish();
    });
  };
}

// ---------- XHR ----------

function installXhrHook(w: any, matchRules: MatchFn, recordHit: RecordHitFn) {
  if (typeof w.XMLHttpRequest === 'undefined') return;
  const proto = w.XMLHttpRequest.prototype;
  const rawOpen = proto.open;
  const rawSend = proto.send;

  proto.open = function (this: any, ...args: any[]) {
    const method = args[0];
    const url = args[1];
    let resolved: string;
    try {
      resolved = new URL(url, location.href).href;
    } catch {
      resolved = String(url);
    }
    this.__chiiUrl = resolved;
    this.__chiiMethod = method || 'GET';
    return rawOpen.apply(this, args);
  };

  proto.send = function (this: any, ...args: any[]) {
    const url: string = this.__chiiUrl || '';
    const method: string = (this.__chiiMethod || 'GET').toUpperCase();

    const matched = matchRules(url, method);
    if (matched.length === 0) {
      return rawSend.apply(this, args);
    }

    const overrideBody = pickRequestBody(matched);
    const overrideStatus = pickStatus(matched);
    const delayMs = pickDelay(matched);
    const replaced = pickResponseBody(matched);

    // 命中 responseBody 时短路真实请求
    if (replaced != null) {
      recordHit({
        url: url,
        method: method,
        ruleId: matched[0].id,
        replaced: true,
        blocked: false,
        status: overrideStatus,
        reqBody: bodyToText(args[0]),
        respBody: replaced,
      });
      const doSim = () => {
        simulateXhrResponse(this, matched, replaced, overrideStatus);
      };
      if (delayMs > 0) {
        setTimeout(doSim, delayMs);
      } else {
        // 异步派发，让调用方先挂上 onload
        setTimeout(doSim, 0);
      }
      return;
    }

    recordHit({url: url, method: method, ruleId: matched[0].id, replaced: false, blocked: false, status: overrideStatus});
    const reqHeaders: { [k: string]: string } = {};
    for (let i = 0; i < matched.length; i++) {
      mergeHeadersRecord(reqHeaders, matched[i].requestHeaders);
    }
    const hk = Object.keys(reqHeaders);
    for (let j = 0; j < hk.length; j++) {
      try {
        this.setRequestHeader(hk[j], reqHeaders[hk[j]]);
      } catch {
        // ignore
      }
    }

    this.addEventListener('readystatechange', () => {
      if (this.readyState !== 4) return;
      applyXhrMutations(this, matched, overrideStatus);
    });

    const doSend = () => {
      if (overrideBody != null) {
        return rawSend.call(this, overrideBody);
      }
      return rawSend.apply(this, args);
    };
    if (delayMs > 0) {
      setTimeout(doSend, delayMs);
      return;
    }
    return doSend();
  };
}

// 覆写 readyState、status、response 系列属性后派发完成事件，模拟一个已结束的 XHR
function simulateXhrResponse(xhr: any, matched: MockRule[], replaced: string, overrideStatus: number | null) {
  const status = overrideStatus != null ? overrideStatus : 200;
  defineXhrResponse(xhr, replaced);
  defineXhrHeaders(xhr, collectResponseHeaders(matched));
  try {
    Object.defineProperty(xhr, 'status', {configurable: true, enumerable: true, get: function () { return status; }});
  } catch {
    // ignore
  }
  try {
    Object.defineProperty(xhr, 'statusText', {configurable: true, enumerable: true, get: function () { return 'OK'; }});
  } catch {
    // ignore
  }
  try {
    Object.defineProperty(xhr, 'readyState', {configurable: true, enumerable: true, get: function () { return 4; }});
  } catch {
    // ignore
  }
  try {
    Object.defineProperty(xhr, 'responseURL', {configurable: true, enumerable: true, get: function () { return xhr.__chiiUrl || ''; }});
  } catch {
    // ignore
  }
  dispatchXhrDone(xhr);
}

function dispatchXhrDone(xhr: any) {
  const fire = function (type: string) {
    try {
      if (typeof xhr.dispatchEvent === 'function') {
        xhr.dispatchEvent(new Event(type));
      }
    } catch {
      // ignore
    }
  };
  fire('readystatechange');
  fire('load');
  fire('loadend');
}

function defineXhrResponse(xhr: any, replaced: string) {
  try {
    Object.defineProperty(xhr, 'responseText', {
      configurable: true,
      enumerable: true,
      get: function () {
        return replaced;
      },
    });
  } catch {
    // ignore
  }
  const rt = xhr.responseType;
  if (rt === '' || rt === 'text') {
    try {
      Object.defineProperty(xhr, 'response', {
        configurable: true,
        enumerable: true,
        get: function () {
          return replaced;
        },
      });
    } catch {
      // ignore
    }
  } else if (rt === 'json') {
    try {
      Object.defineProperty(xhr, 'response', {
        configurable: true,
        enumerable: true,
        get: function () {
          try {
            return JSON.parse(replaced);
          } catch {
            return null;
          }
        },
      });
    } catch {
      // ignore
    }
  }
}

function defineXhrHeaders(xhr: any, extraHeaders: { [k: string]: string }) {
  if (Object.keys(extraHeaders).length === 0) return;
  const rawGet = xhr.getResponseHeader ? xhr.getResponseHeader.bind(xhr) : function () { return null; };
  const rawGetAll = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders.bind(xhr) : function () { return ''; };
  xhr.getResponseHeader = function (name: string) {
    const lower = String(name).toLowerCase();
    const keys = Object.keys(extraHeaders);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return extraHeaders[keys[i]];
    }
    return rawGet(name);
  };
  xhr.getAllResponseHeaders = function () {
    const base = rawGetAll() || '';
    const lines = base.replace(/\r/g, '').split('\n');
    const map: { [k: string]: string } = {};
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf(':');
      if (idx < 0) continue;
      map[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
    }
    const ek = Object.keys(extraHeaders);
    for (let j = 0; j < ek.length; j++) {
      map[ek[j].toLowerCase()] = extraHeaders[ek[j]];
    }
    const mk = Object.keys(map);
    const out: string[] = [];
    for (let k = 0; k < mk.length; k++) {
      out.push(mk[k] + ': ' + map[mk[k]]);
    }
    return out.join('\r\n') + '\r\n';
  };
}

function applyXhrMutations(xhr: any, matched: MockRule[], overrideStatus: number | null) {
  const replaced = pickResponseBody(matched);
  defineXhrHeaders(xhr, collectResponseHeaders(matched));

  if (replaced != null) {
    defineXhrResponse(xhr, replaced);
  }

  if (overrideStatus != null) {
    try {
      Object.defineProperty(xhr, 'status', {
        configurable: true,
        enumerable: true,
        get: function () {
          return overrideStatus;
        },
      });
    } catch {
      // ignore
    }
  }
}

// ---------- navigator.sendBeacon ----------

function installSendBeaconHook(w: any, matchRules: MatchFn, recordHit: RecordHitFn) {
  const nav = w.navigator;
  if (!nav || typeof nav.sendBeacon !== 'function') return;
  const rawSendBeacon = nav.sendBeacon.bind(nav);

  nav.sendBeacon = function (url: string, data?: any): boolean {
    let fullUrl: string;
    try {
      fullUrl = new URL(url, location.href).href;
    } catch {
      fullUrl = String(url);
    }

    const matched = matchRules(fullUrl, 'POST');
    // sendBeacon 无法改写载荷，只支持整条阻断
    for (let i = 0; i < matched.length; i++) {
      if (matched[i].block) {
        recordHit({url: fullUrl, method: 'POST', ruleId: matched[i].id, replaced: false, blocked: true, status: null, reqBody: bodyToText(data)});
        return true;
      }
    }
    return rawSendBeacon(url, data);
  };
}
