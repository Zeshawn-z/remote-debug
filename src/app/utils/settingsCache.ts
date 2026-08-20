import { Settings } from '../api';

export const STORAGE_KEY = 'chii-settings-cache';

// 内存副本，供渲染期同步读取，避免每次访问都解析 localStorage
let cache: Settings | null | undefined;

function readFromStorage(): Settings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.titleRules)) {
      return {
        titleRules: data.titleRules,
        debug: {
          enabled: !!(data.debug && data.debug.enabled),
        },
        connLog: {
          enabled: data.connLog ? !!data.connLog.enabled : true,
        },
        baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '',
        bizHosts: Array.isArray(data.bizHosts)
          ? data.bizHosts.filter((h: unknown): h is string => typeof h === 'string')
          : [],
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function loadCache(): Settings | null {
  if (cache === undefined) {
    cache = readFromStorage();
  }
  return cache;
}

export function saveCache(s: Settings) {
  cache = s;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    // ignore
  }
}
