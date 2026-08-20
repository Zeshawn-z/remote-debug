import { useEffect, useRef, useState } from 'react';
import {
  Session,
  LogEntry,
  fetchSessionLogs,
  getSessionLogDownloadUrl,
  inspect,
} from '../../api';
import styles from './LogModal.module.css';

interface Props {
  session: Session | null;
  onClose: () => void;
}

function formatTime(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function legacyCopyText(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('copy failed');
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      legacyCopyText(text);
      return;
    }
  }
  legacyCopyText(text);
}

export default function LogModal({ session, onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<
    'idle' | 'copying' | 'copied' | 'error'
  >('idle');
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = (id: string) => {
    setLoading(true);
    fetchSessionLogs(id).then(
      list => {
        setLogs(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    // 只在打开某会话时上报一次，不随轮询重复上报
    load(session.id);
    if (!session.active) {
      return;
    }
    const timer = setInterval(() => load(session.id), 2000);
    return () => clearInterval(timer);
  }, [session && session.id, session && session.active]);

  useEffect(() => {
    setCopyStatus('idle');
    setFilter('');
    setIsFullscreen(false);
    return () => {
      if (copyResetTimer.current) {
        clearTimeout(copyResetTimer.current);
        copyResetTimer.current = null;
      }
    };
  }, [session && session.id]);

  if (!session) {
    return null;
  }

  const titleText = session.title || session.targetId || session.id;
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredLogs = normalizedFilter
    ? logs.filter(log => log.text.toLowerCase().includes(normalizedFilter))
    : logs;

  const copyLogs = async () => {
    setCopyStatus('copying');
    if (copyResetTimer.current) {
      clearTimeout(copyResetTimer.current);
      copyResetTimer.current = null;
    }
    try {
      const response = await fetch(getSessionLogDownloadUrl(session.id));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await copyText(await response.text());
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
    copyResetTimer.current = setTimeout(() => {
      setCopyStatus('idle');
      copyResetTimer.current = null;
    }, 1500);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${isFullscreen ? styles.fullscreen : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title} title={titleText}>
            Logs · {titleText}
            {session.active ? (
              <span className={styles.badgeActive}>LIVE</span>
            ) : (
              <span className={styles.badgeEnded}>ENDED</span>
            )}
          </span>
          <div className={styles.actions}>
            <input
              className={styles.filterInput}
              type="search"
              value={filter}
              placeholder="筛选日志内容"
              aria-label="筛选日志内容"
              onChange={event => setFilter(event.target.value)}
            />
            {session.active ? (
              <button
                type="button"
                className={styles.debugBtn}
                onClick={() => inspect(session.targetId, session.rtc)}
              >
                打开调试
              </button>
            ) : null}
            <button
              type="button"
              className={styles.fullscreenBtn}
              onClick={() => setIsFullscreen(value => !value)}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? '退出全屏' : '全屏'}
            </button>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={copyLogs}
              disabled={copyStatus === 'copying'}
            >
              {copyStatus === 'copying'
                ? '复制中'
                : copyStatus === 'copied'
                  ? '复制成功'
                  : copyStatus === 'error'
                    ? '复制失败'
                    : '复制'}
            </button>
            <a
              className={styles.downloadBtn}
              href={getSessionLogDownloadUrl(session.id)}
              target="_blank"
              rel="noreferrer"
            >
              下载
            </a>
            <button className={styles.closeBtn} onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className={styles.body}>
          {filteredLogs.length === 0 ? (
            <div className={styles.empty}>
              {loading
                ? 'Loading…'
                : logs.length > 0
                  ? '没有匹配的日志'
                  : 'No logs captured'}
            </div>
          ) : (
            filteredLogs.map((log, i) => {
              const srcLabel = log.sourceLabel || '';
              const srcUrl = log.source && log.source.url ? log.source.url : '';
              return (
                <div key={i} className={`${styles.line} ${styles[log.type] || ''}`}>
                  <span className={styles.time}>
                    {formatTime(log.lastTime || log.time)}
                  </span>
                  <span className={styles.level}>{log.type}</span>
                  <span className={styles.text}>
                    {log.count && log.count > 1 ? (
                      <span className={styles.count} title={`Repeated ${log.count} times`}>
                        ×{log.count}
                      </span>
                    ) : null}
                    {log.text}
                  </span>
                  {srcLabel ? (
                    <a
                      className={styles.source}
                      href={srcUrl || undefined}
                      target="_blank"
                      rel="noreferrer"
                      title={srcUrl}
                    >
                      {srcLabel}
                    </a>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
