import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnLog,
  fetchConnLogs,
  clearConnLogs,
  getDeviceLabel,
} from '../../api';
import styles from './ConnLogModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PHASE_META: { [k: string]: { label: string; color: string } } = {
  upgrade: { label: '握手请求', color: '#0d99ff' },
  open: { label: '已建立', color: '#30a46c' },
  close: { label: '已关闭', color: '#8896a8' },
  error: { label: '错误', color: '#e5484d' },
  rejected: { label: '被拒绝', color: '#d97e00' },
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export default function ConnLogModal({ open, onClose }: Props) {
  const [logs, setLogs] = useState<ConnLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchConnLogs().then(
      list => {
        setLogs(list);
        setLoading(false);
        setErr('');
      },
      e => {
        setLoading(false);
        setErr((e && e.message) || '加载失败');
      }
    );
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !auto) return;
    timer.current = setInterval(load, 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [open, auto, load]);

  if (!open) {
    return null;
  }

  const onClear = () => {
    clearConnLogs().then(load, load);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>
            连接日志
            <span className={styles.count}>{logs.length}</span>
          </span>
          <div className={styles.actions}>
            <button
              className={auto ? styles.btnActive : styles.btn}
              onClick={() => setAuto(a => !a)}
              title="每 3 秒自动刷新"
            >
              {auto ? '自动刷新·开' : '自动刷新·关'}
            </button>
            <button className={styles.btn} onClick={load} disabled={loading}>
              {loading ? '刷新中…' : '刷新'}
            </button>
            <button className={styles.btnDanger} onClick={onClear}>
              清空
            </button>
            <button className={styles.closeBtn} onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {err ? <div className={styles.err}>{err}</div> : null}
          {logs.length === 0 ? (
            <div className={styles.empty}>
              {loading ? '加载中…' : '暂无连接记录'}
            </div>
          ) : (
            <table className={styles.table}>
              <colgroup>
                <col style={{ width: 78 }} />
                <col style={{ width: 88 }} />
                <col style={{ width: 56 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 190 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th className={styles.th}>时间</th>
                  <th className={styles.th}>阶段</th>
                  <th className={styles.th}>类型</th>
                  <th className={styles.th}>IP</th>
                  <th className={styles.th}>设备 (UA)</th>
                  <th className={styles.th}>详情</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => {
                  const meta = PHASE_META[l.phase] || {
                    label: l.phase,
                    color: 'var(--text-weak)',
                  };
                  const detail = l.detail || l.url || l.path || '';
                  return (
                    <tr className={styles.row} key={l.id}>
                      <td className={styles.td}>{fmtTime(l.time)}</td>
                      <td className={styles.td}>
                        <span
                          className={styles.phaseBadge}
                          style={{ background: meta.color }}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className={styles.td}>{l.type || '-'}</td>
                      <td className={styles.tdBreak}>{l.ip || '-'}</td>
                      <td className={styles.tdBreak} title={l.userAgent}>
                        {l.userAgent ? getDeviceLabel(l.userAgent) : '-'}
                      </td>
                      <td className={styles.tdBreak} title={detail}>
                        {detail || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
