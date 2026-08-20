import { TitleRule } from '../api';
import { globToRegExp } from './glob';
import { isBizHost } from './envUtils';

export { STORAGE_KEY, loadCache, saveCache } from './settingsCache';
export { globToRegExp } from './glob';

export function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// 业务域名下 pattern 当作 path 加 search 的子串匹配
function bizMatches(pattern: string, url: string): boolean {
  const sub = (pattern || '').toLowerCase();
  if (!sub) return false;
  if (!isBizHost(url)) return false;
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return (u.pathname + u.search).toLowerCase().indexOf(sub) >= 0;
  } catch (e) {
    return url.toLowerCase().indexOf(sub) >= 0;
  }
}

// 与服务端 ruleMatches 保持一致，供本地预览测试 URL 命中哪条规则
export function ruleMatchesUrl(rule: TitleRule, url: string): boolean {
  if (!rule || !rule.enabled || !rule.pattern || !url) return false;
  if (rule.bizDomain) return bizMatches(rule.pattern, url);
  try {
    return globToRegExp(rule.pattern).test(url);
  } catch (e) {
    return false;
  }
}
