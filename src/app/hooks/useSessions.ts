import { useCallback, useEffect, useRef, useState } from 'react';
import { Session, fetchSessions } from '../api';

const PAGE_SIZE = 20;

export interface UseSessions {
  sessions: Session[];
  hasMore: boolean;
  /** 首屏加载中 */
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

// 每 2s 只刷新已加载范围，让活跃会话状态实时更新
export default function useSessions(): UseSessions {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // 轮询按已加载条数取，避免刷新时把已展开的更多页缩回去
  const loadedRef = useRef(PAGE_SIZE);

  const refresh = useCallback(() => {
    const limit = Math.max(PAGE_SIZE, loadedRef.current);
    fetchSessions(0, limit).then(
      page => {
        setSessions(page.sessions);
        setHasMore(page.hasMore);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    const nextLimit = loadedRef.current + PAGE_SIZE;
    fetchSessions(0, nextLimit).then(
      page => {
        loadedRef.current = nextLimit;
        setSessions(page.sessions);
        setHasMore(page.hasMore);
        setLoadingMore(false);
      },
      () => setLoadingMore(false)
    );
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped || document.hidden) return;
      refresh();
    };
    refresh();
    const timer = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refresh]);

  return { sessions, hasMore, loading, loadingMore, loadMore };
}
