// 跨 origin 稳定的设备标识，作为扫码绑定链路里 bind 页与 target 端的会合 key

export type DeviceIdSource = 'computed' | 'empty';

export interface DeviceIdResult {
  deviceId: string;
  source: DeviceIdSource;
}

let cached: string | null = null;
let cachedSource: DeviceIdSource = 'empty';
let inflight: Promise<string> | null = null;

// 手动补零，不依赖 padStart 的运行时支持
function toHex8(n: number): string {
  let s = (n >>> 0).toString(16);
  while (s.length < 8) s = '0' + s;
  return s;
}

// 双 FNV-1a 变体拼成 64 位，非加密用途
function hashStr(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return toHex8(h1) + toHex8(h2);
}

// 同一设备与 GPU、驱动、浏览器下稳定且跨 origin 一致，被隐私策略拦截时返回空串
function canvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px \'Arial\'';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('chii-fp', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('chii-fp', 4, 17);
    return hashStr(canvas.toDataURL());
  } catch (e) {
    return '';
  }
}

// 只取与 origin 无关且相对稳定的特征
function computeFingerprint(): string {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  const scr: any = typeof screen !== 'undefined' ? screen : {};
  const dpr =
    typeof window !== 'undefined' && window.devicePixelRatio
      ? window.devicePixelRatio
      : '';
  const signals = [
    String(nav.userAgent || ''),
    String(nav.language || ''),
    String((nav.languages && nav.languages.join(',')) || ''),
    String(nav.platform || ''),
    String(nav.hardwareConcurrency || ''),
    String(nav.deviceMemory || ''),
    String(nav.maxTouchPoints || ''),
    String(scr.width || '') + 'x' + String(scr.height || ''),
    String(scr.colorDepth || ''),
    String(dpr),
    String(new Date().getTimezoneOffset()),
    canvasFingerprint(),
  ];
  // fp_ 前缀便于排查来源，bind 页与 target 端算法必须一致
  return 'fp_' + hashStr(signals.join('|'));
}

// 结果缓存，重复调用不再重算指纹
export function getDeviceId(): Promise<string> {
  if (cached !== null) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = new Promise<string>(resolve => {
    const fp = computeFingerprint();
    cachedSource = fp ? 'computed' : 'empty';
    resolve(fp);
  }).then(v => {
    cached = v;
    inflight = null;
    return v;
  });
  return inflight;
}

export function getDeviceIdResult(): Promise<DeviceIdResult> {
  return getDeviceId().then(deviceId => ({ deviceId, source: cachedSource }));
}
