import { useState } from 'react';
import { Target, SortKey, defaultFavicon, inspect, getSessionScreenshotUrl } from '../../api';
import UserAgentCell from '../UserAgentCell/UserAgentCell';
import UrlCell from '../UrlCell/UrlCell';
import ScreenshotHover from '../ScreenshotHover/ScreenshotHover';
import styles from './TargetTable.module.css';

interface Props {
  targets: Target[];
  sortKey: SortKey | '';
  sortOrder: 1 | -1;
  onSort: (key: SortKey) => void;
  onViewLogs: (target: Target) => void;
}

const columns: { key: SortKey; label: string }[] = [
  { key: 'title', label: '标题' },
  { key: 'url', label: 'URL' },
  { key: 'ip', label: 'IP' },
  { key: 'userAgent', label: '设备' },
];

export default function TargetTable({ targets, sortKey, sortOrder, onSort, onViewLogs }: Props) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const toggleRow = (id: string) => setExpandedRows(m => ({ ...m, [id]: !m[id] }));
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map(col => {
              const active = sortKey === col.key;
              const widthCls =
                col.key === 'title'
                  ? styles.colTitle
                  : col.key === 'url'
                    ? styles.colUrl
                    : col.key === 'ip'
                      ? styles.colIp
                      : col.key === 'userAgent'
                        ? styles.colUa
                        : '';
              return (
                <th
                  key={col.key}
                  className={`${styles.th} ${widthCls} ${active ? styles.thActive : ''}`}
                  onClick={() => onSort(col.key)}
                >
                  {col.label}
                  {active ? (sortOrder === 1 ? ' ↑' : ' ↓') : ''}
                </th>
              );
            })}
            <th className={`${styles.th} ${styles.thAction}`}>操作</th>
          </tr>
        </thead>
        <tbody>
          {targets.map(target => {
            const expanded = !!expandedRows[target.id];
            return (
              <tr key={target.id} className={styles.row}>
                <td className={styles.td}>
                  <ScreenshotHover
                    url={
                      target.hasScreenshot && target.sessionId
                        ? getSessionScreenshotUrl(target.sessionId)
                        : null
                    }
                    className={styles.title}
                  >
                    <img
                      className={styles.favicon}
                      src={target.favicon}
                      onError={e => {
                        (e.target as HTMLImageElement).src = defaultFavicon;
                      }}
                    />
                    <span className={expanded ? styles.titleFull : styles.ellipsis}>
                      {target.title}
                    </span>
                    {target.hasScreenshot ? (
                      <span className={styles.shotDot} title="已截取页面快照" />
                    ) : null}
                  </ScreenshotHover>
                </td>
                <td className={`${styles.td} ${expanded ? styles.tdWrap : ''}`}>
                  <UrlCell url={target.url} expanded={expanded} showToggle={false} />
                </td>
                <td className={`${styles.td} ${styles.ip} ${expanded ? styles.tdWrap : ''}`}>
                  {target.ip}
                </td>
                <td className={styles.td}>
                  <UserAgentCell
                    userAgent={target.userAgent}
                    expanded={expanded}
                    showToggle={false}
                  />
                </td>
                <td className={`${styles.td} ${styles.tdAction}`}>
                  <button
                    className={styles.inspectBtn}
                    onClick={() => inspect(target.id, target.rtc)}
                  >
                    调试
                  </button>
                  <button
                    className={styles.logsBtn}
                    onClick={() => onViewLogs(target)}
                  >
                    日志
                  </button>
                  <button
                    className={styles.detailBtn}
                    onClick={() => toggleRow(target.id)}
                  >
                    {expanded ? '收起' : '详情'}
                  </button>
                </td>
              </tr>
            );
          })}
          {targets.length === 0 ? (
            <tr>
              <td className={styles.empty} colSpan={5}>
                暂无已连接的目标
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
