import { useMemo, useState } from 'react';
import useSessions from '../../hooks/useSessions';
import useRooms from '../../hooks/useRooms';
import { useAppShell } from '../../AppShell';
import PageShell from '../../components/PageShell/PageShell';
import SessionTable from '../../components/SessionTable/SessionTable';
import styles from './LogsPage.module.css';

export default function LogsPage() {
  const { sessions, hasMore, loadingMore, loadMore } = useSessions();
  const rooms = useRooms();
  const shell = useAppShell();
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(true);

  const effectiveShowAll = showAll;

  const filtering = !!filter || (!effectiveShowAll && !!rooms.current);

  // 房间维度的过滤
  const visibleSessions = useMemo(() => {
    let list = sessions;

    // 属于当前房间
    if (!effectiveShowAll) {
      list = list.filter(
        s => !!rooms.current && (s.roomId || '') === rooms.current
      );
    }

    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter(
        s =>
          `${s.title} ${s.url} ${s.ip} ${s.userAgent}`
            .toLowerCase()
            .indexOf(f) >= 0
      );
    }

    return list;
  }, [sessions, filter, effectiveShowAll, rooms.current]);

  return (
    <div className={styles.page}>
      <PageShell
        toolbar={{
          filter,
          onFilter: setFilter,
          count: visibleSessions.length,
          countLabel: 'Session',
          room: {
            current: rooms.current,
            alias: rooms.currentInfo ? rooms.currentInfo.alias : '',
            showAll: effectiveShowAll,
            onShowAll: setShowAll,
            onGoMine: () => shell.setActiveNav('mine'),
          },
        }}
      >
        <SessionTable
          sessions={visibleSessions}
          onViewLogs={shell.openLogModal}
          onDeleted={sid => {
            if (shell.logSession && shell.logSession.id === sid) {
              shell.closeLogModal();
            }
          }}
        />
        {hasMore ? (
          <div className={styles.loadMore}>
            {filtering ? (
              <span className={styles.loadMoreHint}>
                筛选仅作用于已加载会话，
              </span>
            ) : null}
            <button
              className={styles.loadMoreBtn}
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          </div>
        ) : null}
      </PageShell>
    </div>
  );
}
