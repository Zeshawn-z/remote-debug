import { useEffect, useState } from 'react';
import { TitleRule, fetchSettings, saveSettings } from '../api';
import { loadCache, saveCache, genId } from '../utils/settingsUtils';

export interface UseSettings {
  rules: TitleRule[];
  debugEnabled: boolean;
  connLogEnabled: boolean;
  baseUrl: string;
  bizHosts: string[];
  loaded: boolean;
  saving: boolean;
  dirty: boolean;
  errorMsg: string;
  successMsg: string;
  addRule: () => void;
  updateRule: (id: string, patch: Partial<TitleRule>) => void;
  removeRule: (id: string) => void;
  moveRule: (id: string, dir: -1 | 1) => void;
  toggleDebug: (v: boolean) => void;
  toggleConnLog: (v: boolean) => void;
  setBaseUrl: (v: string) => void;
  setBizHosts: (v: string[]) => void;
  save: () => void;
}

export default function useSettings(): UseSettings {
  const [rules, setRules] = useState<TitleRule[]>([]);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [connLogEnabled, setConnLogEnabled] = useState(true);
  const [baseUrl, setBaseUrlState] = useState('');
  const [bizHosts, setBizHostsState] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 先用 localStorage 缓存渲染，再拉服务端
  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setRules(cached.titleRules);
      setDebugEnabled(!!(cached.debug && cached.debug.enabled));
      setConnLogEnabled(cached.connLog ? !!cached.connLog.enabled : true);
      setBaseUrlState(cached.baseUrl || '');
      setBizHostsState(cached.bizHosts || []);
    }
    fetchSettings().then(
      s => {
        setRules(s.titleRules);
        setDebugEnabled(!!(s.debug && s.debug.enabled));
        setConnLogEnabled(!!(s.connLog && s.connLog.enabled));
        setBaseUrlState(s.baseUrl || '');
        setBizHostsState(s.bizHosts || []);
        setLoaded(true);
        saveCache(s);
      },
      () => {
        setLoaded(true);
      }
    );
  }, []);

  const markDirty = () => {
    setDirty(true);
    setSuccessMsg('');
  };

  const updateRule = (id: string, patch: Partial<TitleRule>) => {
    setRules(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
    markDirty();
  };

  const removeRule = (id: string) => {
    setRules(rs => rs.filter(r => r.id !== id));
    markDirty();
  };

  const addRule = () => {
    setRules(rs => [
      ...rs,
      {
        id: genId(),
        pattern: '*://example.com/*',
        title: 'Example',
        enabled: true,
        bizDomain: false,
      },
    ]);
    markDirty();
  };

  const moveRule = (id: string, dir: -1 | 1) => {
    setRules(rs => {
      const idx = rs.findIndex(r => r.id === id);
      if (idx < 0) return rs;
      const next = idx + dir;
      if (next < 0 || next >= rs.length) return rs;
      const copy = rs.slice();
      const [item] = copy.splice(idx, 1);
      copy.splice(next, 0, item);
      return copy;
    });
    markDirty();
  };

  const toggleDebug = (v: boolean) => {
    setDebugEnabled(v);
    markDirty();
  };

  const toggleConnLog = (v: boolean) => {
    setConnLogEnabled(v);
    markDirty();
  };

  const setBaseUrl = (v: string) => {
    setBaseUrlState(v);
    markDirty();
  };

  const setBizHosts = (v: string[]) => {
    setBizHostsState(v);
    markDirty();
  };

  const save = () => {
    for (const r of rules) {
      if (!r.pattern || !r.title) {
        setErrorMsg('请为每条规则填写匹配规则与标题');
        return;
      }
    }
    setErrorMsg('');
    setSaving(true);
    saveSettings({
      titleRules: rules,
      debug: { enabled: debugEnabled },
      connLog: { enabled: connLogEnabled },
      baseUrl: baseUrl.trim(),
      bizHosts: bizHosts.map(h => h.trim()).filter(Boolean),
    }).then(
      s => {
        setRules(s.titleRules);
        setDebugEnabled(!!(s.debug && s.debug.enabled));
        setConnLogEnabled(!!(s.connLog && s.connLog.enabled));
        setBaseUrlState(s.baseUrl || '');
        setBizHostsState(s.bizHosts || []);
        saveCache(s);
        setSaving(false);
        setDirty(false);
        setSuccessMsg('已保存');
        setTimeout(() => setSuccessMsg(''), 2000);
      },
      err => {
        setSaving(false);
        setErrorMsg((err && err.message) || '保存失败');
      }
    );
  };

  return {
    rules,
    debugEnabled,
    connLogEnabled,
    baseUrl,
    bizHosts,
    loaded,
    saving,
    dirty,
    errorMsg,
    successMsg,
    addRule,
    updateRule,
    removeRule,
    moveRule,
    toggleDebug,
    toggleConnLog,
    setBaseUrl,
    setBizHosts,
    save,
  };
}
