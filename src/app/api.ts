import detectOs from 'licia/detectOs';
import randomId from 'licia/randomId';
import winIcon from '../icon/win.svg';
import macIcon from '../icon/mac.svg';
import linuxIcon from '../icon/linux.svg';
import globeIcon from '../icon/globe.svg';
import androidIcon from '../icon/android.svg';
import harmonyIcon from '../icon/harmony.svg';

// 鸿蒙 UA 识别，兼容 HarmonyOS/OpenHarmony/ArkWeb 标记
function isHarmony(userAgent: string): boolean {
  return /HarmonyOS|OpenHarmony|ArkWeb/i.test(userAgent || '');
}

export interface Target {
  id: string;
  title: string;
  url: string;
  ip: string;
  favicon: string;
  userAgent: string;
  rtc: boolean;
  roomId?: string;
  sessionId?: string;
  hasScreenshot?: boolean;
  // 同一物理设备的多个会话据此归并
  deviceId?: string;
}

export type SortKey = 'title' | 'url' | 'ip' | 'userAgent';

export interface LogSource {
  url: string;
  line: number;
  column: number;
  function?: string;
}

export interface LogEntry {
  time: number;
  type: string;
  text: string;
  count?: number;
  lastTime?: number;
  source?: LogSource;
  sourceLabel?: string;
}

export interface Session {
  id: string;
  targetId: string;
  url: string;
  title: string;
  favicon: string;
  userAgent: string;
  ip: string;
  rtc: boolean;
  roomId?: string;
  startTime: number;
  endTime: number | null;
  active: boolean;
  logCount: number;
  hasScreenshot?: boolean;
}

declare const window: any;

export const defaultFavicon = globeIcon;

const osIcons: { [key: string]: string } = {
  windows: winIcon,
  'os x': macIcon,
  ios: macIcon,
  linux: linuxIcon,
  android: androidIcon,
};

export function getOsIcon(userAgent: string): string {
  if (isHarmony(userAgent)) return harmonyIcon;
  const os = detectOs(userAgent);
  return osIcons[os] || '';
}

// 归纳为简短的设备加浏览器标签，便于表格快速区分
export function getDeviceLabel(userAgent: string): string {
  const ua = userAgent || '';
  if (!ua) return '未知设备';

  let device = '';
  if (isHarmony(ua)) device = '鸿蒙';
  else if (/iPad/i.test(ua)) device = 'iPad';
  else if (/iPhone/i.test(ua)) device = 'iPhone';
  else if (/iPod/i.test(ua)) device = 'iPod';
  else if (/Android/i.test(ua)) {
    // 形如 Android x.x; zh-cn; MODEL Build/
    const m = /Android[^;]*;\s*[^;]*;?\s*([^;)]+)\s+Build/i.exec(ua);
    device = m && m[1] ? `Android(${m[1].trim()})` : 'Android';
  } else {
    const os = detectOs(ua);
    if (os === 'windows') device = 'Windows';
    else if (os === 'os x') device = 'macOS';
    else if (os === 'linux') device = 'Linux';
    else device = os ? os : '未知设备';
  }

  // webview 优先于浏览器判断
  let browser = '';
  if (/MicroMessenger/i.test(ua)) browser = '微信';
  else if (/QQ\//i.test(ua) || /QQBrowser/i.test(ua)) browser = 'QQ';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';

  return browser ? `${device} · ${browser}` : device;
}

export interface UaInfo {
  /** 尽量带版本，如 Windows 10、macOS 13、Android 13、iOS 16 */
  system: string;
  browser: string;
  /** 微信、企业微信、QQ 或浏览器 */
  env: string;
}

function firstMatch(re: RegExp, s: string): string {
  const m = re.exec(s);
  return m && m[1] ? m[1].trim() : '';
}

// 取不到的字段留空
export function parseUa(userAgent: string): UaInfo {
  const ua = userAgent || '';
  if (!ua) {
    return { system: '未知系统', browser: '未知', env: '未知' };
  }

  let system = '';
  if (isHarmony(ua)) {
    // 兼容 "HarmonyOS 4.0" 与 "OpenHarmony 6.0"（Harmony 后可无 OS）
    const v = firstMatch(/(?:Open)?Harmony(?:OS)?\s*([\d.]+)/i, ua);
    system = v ? `HarmonyOS ${v}` : 'HarmonyOS';
  } else if (/Windows NT 10\.0/i.test(ua)) system = 'Windows 10/11';
  else if (/Windows NT 6\.3/i.test(ua)) system = 'Windows 8.1';
  else if (/Windows NT 6\.1/i.test(ua)) system = 'Windows 7';
  else if (/Windows/i.test(ua)) system = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) {
    const v = firstMatch(/OS (\d+[_.]\d+)/i, ua).replace(/_/g, '.');
    system = v ? `iOS ${v}` : 'iOS';
  } else if (/Android/i.test(ua)) {
    const v = firstMatch(/Android (\d+(?:\.\d+)?)/i, ua);
    system = v ? `Android ${v}` : 'Android';
  } else if (/Mac OS X/i.test(ua)) {
    const v = firstMatch(/Mac OS X (\d+[_.]\d+)/i, ua).replace(/_/g, '.');
    system = v ? `macOS ${v}` : 'macOS';
  } else if (/Linux/i.test(ua)) system = 'Linux';
  else system = '其他系统';

  let browser = '';
  const chrome = firstMatch(/Chrome\/(\d+)/i, ua);
  const safari = firstMatch(/Version\/(\d+)/i, ua);
  if (/Edg\//i.test(ua)) browser = `Edge ${firstMatch(/Edg\/(\d+)/i, ua)}`.trim();
  else if (/OPR\/|Opera/i.test(ua)) browser = `Opera ${firstMatch(/OPR\/(\d+)/i, ua)}`.trim();
  else if (/Firefox\//i.test(ua)) browser = `Firefox ${firstMatch(/Firefox\/(\d+)/i, ua)}`.trim();
  else if (/QQBrowser/i.test(ua)) browser = `QQ浏览器 ${firstMatch(/QQBrowser\/(\d+)/i, ua)}`.trim();
  else if (chrome) browser = `Chrome ${chrome}`;
  else if (/Safari\//i.test(ua)) browser = safari ? `Safari ${safari}` : 'Safari';
  else browser = '未知';

  // webview 优先于浏览器判断
  let env = '浏览器';
  if (/wxwork/i.test(ua)) env = '企业微信';
  else if (/MicroMessenger/i.test(ua)) env = '微信';
  else if (/QQ\/(?!Browser)/i.test(ua)) env = 'QQ';

  return { system, browser, env };
}

function jsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) {
    return Promise.reject(new Error(`HTTP ${res.status}`));
  }
  return res.json();
}

export function fetchTargets(): Promise<Target[]> {
  return fetch(`${window.basePath}targets`)
    .then(jsonOrThrow)
    .then(data => data.targets || []);
}

// 目标列表变更时间戳，轮询据此决定是否刷新
export function fetchTimestamp(): Promise<string> {
  return fetch(`${window.basePath}timestamp`).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
}

export interface SessionPage {
  sessions: Session[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export function fetchSessions(
  offset = 0,
  limit = 20
): Promise<SessionPage> {
  const q = `?offset=${offset}&limit=${limit}`;
  return fetch(`${window.basePath}sessions${q}`)
    .then(jsonOrThrow)
    .then(data => ({
      sessions: Array.isArray(data && data.sessions) ? data.sessions : [],
      total: (data && data.total) || 0,
      offset: (data && data.offset) || 0,
      limit: (data && data.limit) || limit,
      hasMore: !!(data && data.hasMore),
    }));
}

export function fetchSessionLogs(sessionId: string): Promise<LogEntry[]> {
  return fetch(`${window.basePath}sessions/${encodeURIComponent(sessionId)}/logs`)
    .then(jsonOrThrow)
    .then(data => data.logs || []);
}

export function getSessionLogDownloadUrl(sessionId: string): string {
  return `${window.basePath}sessions/${encodeURIComponent(sessionId)}/logs/download`;
}

export function getSessionScreenshotUrl(sessionId: string): string {
  return `${window.basePath}sessions/${encodeURIComponent(sessionId)}/screenshot`;
}

// 会话仍活跃时服务端会先断开 target ws
export function deleteSession(sessionId: string): Promise<void> {
  return fetch(`${window.basePath}sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  }).then(res => {
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
  });
}

export interface TitleRule {
  id: string;
  pattern: string;
  title: string;
  enabled: boolean;
  /** 开启后 pattern 按路径子串匹配，只在设置里配置的业务域名下生效 */
  bizDomain?: boolean;
}

export interface DebugSettings {
  enabled: boolean;
}

export interface Settings {
  titleRules: TitleRule[];
  debug: DebugSettings;
  connLog: DebugSettings;
  baseUrl: string;
  /** 业务域名 host 的 glob 列表，命中后列表里的 URL 省略 host */
  bizHosts: string[];
}

export function fetchSettings(): Promise<Settings> {
  return fetch(`${window.basePath}settings`)
    .then(jsonOrThrow)
    .then(data => ({
      titleRules: Array.isArray(data && data.titleRules) ? data.titleRules : [],
      debug: {
        enabled: !!(data && data.debug && data.debug.enabled),
      },
      connLog: {
        enabled: data && data.connLog ? !!data.connLog.enabled : true,
      },
      baseUrl: data && typeof data.baseUrl === 'string' ? data.baseUrl : '',
      bizHosts: Array.isArray(data && data.bizHosts)
        ? data.bizHosts.filter((h: unknown): h is string => typeof h === 'string')
        : [],
    }));
}

export function resolveBaseUrl(baseUrl: string): string {
  return (baseUrl || location.origin).trim().replace(/\/+$/, '');
}

// 连接日志
export interface ConnLog {
  id: number;
  time: number;
  seq: number;
  /** upgrade 握手请求、open 建立、close 关闭、error 错误、rejected 路径非法被拒 */
  phase: string;
  /** target、client 或空 */
  type: string;
  connId: string;
  ip: string;
  userAgent: string;
  origin: string;
  host: string;
  path: string;
  url: string;
  detail: string;
}

export function fetchConnLogs(): Promise<ConnLog[]> {
  return fetch(`${window.basePath}connlogs`)
    .then(jsonOrThrow)
    .then(data => (Array.isArray(data && data.logs) ? data.logs : []));
}

export function clearConnLogs(): Promise<void> {
  return fetch(`${window.basePath}connlogs`, { method: 'DELETE' }).then(res => {
    if (!res.ok) throw new Error(`clear failed: ${res.status}`);
  });
}

export type DataType = 'logs' | 'sessions' | 'stat' | 'rooms';

// 不可恢复，调用方需做多重确认
export function clearData(type: DataType): Promise<void> {
  return fetch(`${window.basePath}data/${type}`, { method: 'DELETE' }).then(
    res => {
      if (!res.ok) throw new Error(`clear failed: ${res.status}`);
    }
  );
}

export function saveSettings(settings: Settings): Promise<Settings> {
  return fetch(`${window.basePath}settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(jsonOrThrow);
}

// 打开 DevTools 调试指定目标
export function inspect(id: string, rtc: boolean) {
  const { basePath } = window;
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host;
  const url =
    location.protocol +
    `//${host}${basePath}front_end/chii_app.html?${wsProtocol}=${encodeURIComponent(
      `${host}${basePath}client/${randomId(6)}?target=${id}`
    )}&rtc=${rtc}`;
  window.open(url, '_blank');
}

// 含离线设备
export interface DeviceInfo {
  id: string;
  roomId: string;
  roomAlias: string;
  userAgent: string;
  ip: string;
  firstSeen: number;
  lastSeen: number;
  online: boolean;
}

// 拉取设备清单
export function fetchDevices(): Promise<DeviceInfo[]> {
  return fetch(`${window.basePath}devices`)
    .then(jsonOrThrow)
    .then(data => (Array.isArray(data && data.devices) ? data.devices : []));
}

// 房间清单与别名由服务端维护，web 端只在 localStorage 记录自己加入过哪些房间
export interface RoomInfo {
  id: string;
  alias: string;
  createdAt: number;
  /** 最近一次有设备接入或加入房间的时间 */
  lastActiveAt: number;
  deviceCount: number;
}

export function createRoom(): Promise<RoomInfo> {
  return fetch(`${window.basePath}rooms`, { method: 'POST' }).then(jsonOrThrow);
}

export function fetchRoom(id: string): Promise<RoomInfo> {
  return fetch(`${window.basePath}rooms/${encodeURIComponent(id)}`).then(
    jsonOrThrow
  );
}

// 不存在的房间会被服务端过滤，据此识别已删除
export function fetchRooms(ids: string[]): Promise<RoomInfo[]> {
  if (!ids || ids.length === 0) return Promise.resolve([]);
  const q = encodeURIComponent(ids.join(','));
  return fetch(`${window.basePath}rooms?ids=${q}`)
    .then(jsonOrThrow)
    .then(data => (Array.isArray(data && data.rooms) ? data.rooms : []));
}

export function fetchAllRooms(): Promise<RoomInfo[]> {
  return fetch(`${window.basePath}rooms?all=1`)
    .then(jsonOrThrow)
    .then(data => (Array.isArray(data && data.rooms) ? data.rooms : []));
}

export function updateRoomAlias(id: string, alias: string): Promise<RoomInfo> {
  return fetch(`${window.basePath}rooms/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias }),
  }).then(jsonOrThrow);
}

// 服务端会通知归属设备清除房间
export function deleteRoom(id: string): Promise<void> {
  return fetch(`${window.basePath}rooms/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then(res => {
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
  });
}

