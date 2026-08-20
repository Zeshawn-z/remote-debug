import { useMemo, useState } from 'react';
import useTargets from '../../hooks/useTargets';
import useSessions from '../../hooks/useSessions';
import useRooms from '../../hooks/useRooms';
import { SortKey } from '../../api';
import { useAppShell } from '../../AppShell';
import PageShell from '../../components/PageShell/PageShell';
import TargetTable from '../../components/TargetTable/TargetTable';
import styles from './TargetsPage.module.css';

interface TargetsPageProps {
  /** 只显示当前房间设备，供我的页内嵌 */
  mineOnly?: boolean;
  hideToolbar?: boolean;
}

export default function TargetsPage({
  mineOnly,
  hideToolbar,
}: TargetsPageProps = {}) {
  const targets = useTargets();
  const { sessions } = useSessions();
  const rooms = useRooms();
  const shell = useAppShell();

  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | ''>('');
  const [sortOrder, setSortOrder] = useState<1 | -1>(1);
  const [showAll, setShowAll] = useState(!mineOnly);

  const effectiveShowAll = mineOnly ? showAll : showAll;

  // 只认当前房间
  const isMine = (roomId?: string) =>
    !!rooms.current && (roomId || '') === rooms.current;

  // 房间维度的过滤
  const filteredTargets = useMemo(() => {
    let list = targets;

    const onlyMine = mineOnly || !effectiveShowAll;
    if (onlyMine) {
      list = list.filter(t => isMine(t.roomId));
    }

    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter(
        t =>
          `${t.title} ${t.url} ${t.ip} ${t.userAgent}`
            .toLowerCase()
            .indexOf(f) >= 0
      );
    }
    return list;
  }, [targets, filter, effectiveShowAll, rooms.current, mineOnly]);

  const visibleTargets = useMemo(() => {
    let list = filteredTargets;

    if (sortKey) {
      list = list.slice().sort((a, b) => {
        const av = `${a[sortKey] || ''}`.toLowerCase();
        const bv = `${b[sortKey] || ''}`.toLowerCase();
        if (av < bv) return -sortOrder;
        if (av > bv) return sortOrder;
        return 0;
      });
    }

    return list;
  }, [filteredTargets, sortKey, sortOrder]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(order => (order === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortOrder(1);
    }
  };

  // 没有活跃 session 时退回 Logs 页
  const openLogsByTargetId = (targetId: string) => {
    const active = sessions.find(s => s.targetId === targetId && s.active);
    if (active) {
      shell.openLogModal(active);
    } else {
      shell.setActiveNav('logs');
    }
  };

  return (
    <div className={styles.page}>
      <PageShell
        toolbar={
          hideToolbar
            ? undefined
            : {
                filter,
                onFilter: setFilter,
                count: visibleTargets.length,
                countLabel: 'Target',
                room: {
                  current: rooms.current,
                  alias: rooms.currentInfo ? rooms.currentInfo.alias : '',
                  showAll: effectiveShowAll,
                  onShowAll: setShowAll,
                  onGoMine: () => shell.setActiveNav('mine'),
                },
              }
        }
      >
        <TargetTable
          targets={visibleTargets}
          sortKey={sortKey}
          sortOrder={sortOrder}
          onSort={handleSort}
          onViewLogs={t => openLogsByTargetId(t.id)}
        />
      </PageShell>
    </div>
  );
}
