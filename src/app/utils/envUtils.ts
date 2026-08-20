import { globToRegExp } from './glob';
import { loadCache } from './settingsCache';

export function hostFromUrl(input: string): string {
  const s = (input || '').trim();
  if (!s) return '';
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).hostname;
  } catch (e) {
    return s.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  }
}

let compiledFrom: string[] | null = null;
let compiled: RegExp[] = [];

// 按数组引用缓存编译结果，设置未变时不重复编译
function bizPatterns(): RegExp[] {
  const hosts = loadCache()?.bizHosts ?? [];
  if (hosts === compiledFrom) return compiled;
  compiled = [];
  for (const h of hosts) {
    const p = (h || '').trim().toLowerCase();
    if (!p) continue;
    try {
      compiled.push(globToRegExp(p));
    } catch (e) {
      // 无效 pattern 直接跳过
    }
  }
  compiledFrom = hosts;
  return compiled;
}

// 业务域名在设置里配置，未配置时恒为 false
export function isBizHost(hostOrUrl: string): boolean {
  const h = hostFromUrl(hostOrUrl).toLowerCase();
  if (!h) return false;
  return bizPatterns().some(re => re.test(h));
}

// 业务域名下省略 host，只显示路径，便于在窄列里对比
export function shortBizUrl(url: string): string {
  if (!isBizHost(url)) return url;
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    const rest = `${u.pathname}${u.search}${u.hash}`;
    if (!rest || rest === '/') return u.host;
    return rest;
  } catch (e) {
    return url;
  }
}
