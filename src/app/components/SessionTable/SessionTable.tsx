import { useState } from 'react';
import {
  Session,
  defaultFavicon,
  inspect,
  deleteSession,
  getSessionScreenshotUrl,
} from '../../api';
import UserAgentCell from '../UserAgentCell/UserAgentCell';
import UrlCell from '../UrlCell/UrlCell';
import ScreenshotHover from '../ScreenshotHover/ScreenshotHover';
import styles from './SessionTable.module.css';

interface Props {
  sessions: Session[];
  onViewLogs: (session: Session) => void;
  onDeleted?: (sessionId: string) => void;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDateTime(t: number): string {
  const d = new Date(t);
  // 去掉年份，仅显示 月-日 时:分:秒，节省列宽
  return (
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  if (m > 0) return `${m}:${pad(s)}`;
  return `${s}s`;
}

export default function SessionTable({ sessions, onViewLogs, onDeleted }: Props) {
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const toggleRow = (id: string) => setExpandedRows(m => ({ ...m, [id]: !m[id] }));

  const handleDelete = (s: Session) => {
    const tip = s.active
      ? `该会话正在进行中，删除将同时断开目标“${s.title || s.targetId}”的连接，是否继续？`
      : '确定删除该会话及其日志？';
    if (!window.confirm(tip)) return;
    setDeleting(d => ({ ...d, [s.id]: true }));
    deleteSession(s.id).then(
      () => {
        setDeleting(d => {
          const next = { ...d };
          delete next[s.id];
          return next;
        });
        onDeleted && onDeleted(s.id);
      },
      err => {
        setDeleting(d => {
          const next = { ...d };
          delete next[s.id];
          return next;
        });
        // eslint-disable-next-line no-alert
        window.alert(`删除失败：${err && err.message ? err.message : err}`);
      }
    );
  };

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>标题</th>
            <th className={styles.th}>URL</th>
            <th className={`${styles.th} ${styles.colUa}`}>设备</th>
            <th className={`${styles.th} ${styles.colTime}`}>开始时间</th>
            <th className={`${styles.th} ${styles.colTime}`}>结束时间</th>
            <th className={`${styles.th} ${styles.duration}`}>持续时长</th>
            <th className={`${styles.th} ${styles.thAction}`}>操作</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => {
            const end = s.endTime || Date.now();
            const isDeleting = !!deleting[s.id];
            const expanded = !!expandedRows[s.id];
            return (
              <tr key={s.id} className={styles.row}>
                <td className={styles.td}>
                  <ScreenshotHover
                    url={
                      s.hasScreenshot ? getSessionScreenshotUrl(s.id) : null
                    }
                    className={`${styles.title} ${
                      s.active ? styles.titleClickable : ''
                    }`}
                  >
                    <span
                      className={styles.titleInner}
                      onClick={
                        s.active ? () => inspect(s.targetId, s.rtc) : undefined
                      }
                      title={
                        s.active ? '点击打开 DevTools 调试该目标' : undefined
                      }
                    >
                      <img
                        className={styles.favicon}
                        src={s.favicon || defaultFavicon}
                        onError={e => {
                          (e.target as HTMLImageElement).src = defaultFavicon;
                        }}
                      />
                      <span className={expanded ? styles.titleFull : styles.ellipsis}>
                        {s.title || s.targetId || s.id}
                      </span>
                      {s.active ? (
                        <span className={styles.badgeActive}>活跃</span>
                      ) : null}
                      {s.hasScreenshot ? (
                        <span
                          className={styles.shotDot}
                          title="已截取页面快照"
                        />
                      ) : null}
                    </span>
                  </ScreenshotHover>
                </td>
                <td className={styles.td}>
                  <UrlCell url={s.url} expanded={expanded} showToggle={false} />
                </td>
                <td className={styles.td}>
                  <UserAgentCell
                    userAgent={s.userAgent}
                    expanded={expanded}
                    showToggle={false}
                  />
                </td>
                <td className={`${styles.td} ${styles.timeCell}`}>
                  {formatDateTime(s.startTime)}
                </td>
                <td className={`${styles.td} ${styles.timeCell}`}>
                  {s.endTime ? formatDateTime(s.endTime) : '—'}
                </td>
                <td className={`${styles.td} ${styles.timeCell} ${styles.duration}`}>
                  {formatDuration(end - s.startTime)}
                </td>
                <td className={`${styles.td} ${styles.tdAction}`}>
                  <span className={styles.logCount}>{s.logCount}</span>
                  <button
                    className={styles.logsBtn}
                    onClick={() => onViewLogs(s)}
                  >
                    日志
                  </button>
                  <button
                    className={styles.detailBtn}
                    onClick={() => toggleRow(s.id)}
                  >
                    {expanded ? '收起' : '详情'}
                  </button>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(s)}
                    disabled={isDeleting}
                    title={s.active ? '断开连接并删除' : '删除会话'}
                  >
                    {isDeleting ? '…' : '删除'}
                  </button>
                </td>
              </tr>
            );
          })}
          {sessions.length === 0 ? (
            <tr>
              <td className={styles.empty} colSpan={8}>
                暂无会话记录
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
