import { useEffect, useState, useCallback } from 'react';
import {
  RoomInfo,
  fetchRooms,
  createRoom,
  updateRoomAlias,
  deleteRoom,
} from '../api';
import {
  getMembership,
  subscribe,
  addRoom,
  removeRoom,
  setCurrent,
  Membership,
} from '../rooms';

export interface UseRooms {
  current: string;
  rooms: string[];
  /** 服务端房间信息，按 id 索引 */
  infos: Record<string, RoomInfo>;
  currentInfo: RoomInfo | null;
  /** 默认房间是否就绪 */
  ready: boolean;
  create: () => void;
  join: (id: string) => void;
  leave: (id: string) => void;
  /** 服务端移除房间并通知归属设备清除 */
  del: (id: string) => void;
  switchTo: (id: string) => void;
  setAlias: (id: string, alias: string) => void;
}

// 多个 useRooms 实例或页面重挂载共享同一次 createRoom，避免首个请求返回前重复创建孤儿房间
let defaultRoomPromise: Promise<RoomInfo> | null = null;

// 请求结束即清空守卫，房间被删除后仍能再次创建
function ensureDefaultRoom(): Promise<RoomInfo> {
  if (!defaultRoomPromise) {
    defaultRoomPromise = createRoom();
    const clear = () => {
      defaultRoomPromise = null;
    };
    defaultRoomPromise.then(clear, clear);
  }
  return defaultRoomPromise;
}

// 本地成员关系存 localStorage，服务端房间信息靠轮询
export default function useRooms(): UseRooms {
  const [m, setM] = useState<Membership>(() => getMembership());
  const [infos, setInfos] = useState<Record<string, RoomInfo>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => subscribe(() => setM(getMembership())), []);

  // 尚未加入任何房间时申请一个默认房间
  useEffect(() => {
    let stopped = false;
    const cur = getMembership();
    if (cur.current) {
      // 房间是否真实存在交给下面的轮询校验
      setReady(true);
      return;
    }
    ensureDefaultRoom().then(
      info => {
        addRoom(info.id, true);
        if (!stopped) {
          setInfos(prev => ({ ...prev, [info.id]: info }));
          setReady(true);
        }
      },
      () => {
        if (!stopped) setReady(true);
      }
    );
    return () => {
      stopped = true;
    };
  }, []);

  // 轮询服务端房间信息，同时校验本地成员关系
  const roomsKey = m.rooms.join(',');
  useEffect(() => {
    let stopped = false;

    const createDefault = () => {
      ensureDefaultRoom().then(
        info => {
          addRoom(info.id, true);
          if (!stopped) setInfos(prev => ({ ...prev, [info.id]: info }));
        },
        () => {
          // 创建失败，下个轮询周期重试
        }
      );
    };

    const refresh = () => {
      const ids = getMembership().rooms;
      if (ids.length === 0) {
        setInfos({});
        createDefault();
        return;
      }
      fetchRooms(ids).then(
        list => {
          if (stopped) return;
          // 服务端未返回的房间视为已删除
          const next: Record<string, RoomInfo> = {};
          list.forEach(r => {
            next[r.id] = r;
          });
          setInfos(next);

          // removeRoom 剔除当前房间时会自动切到剩余的有效房间
          getMembership().rooms.forEach(id => {
            if (!next[id]) removeRoom(id);
          });
          if (getMembership().rooms.length === 0) {
            createDefault();
          }
        },
        () => {
          // 网络抖动不应误判房间不存在
        }
      );
    };
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [roomsKey]);

  const create = useCallback(() => {
    createRoom().then(
      info => {
        addRoom(info.id, true);
        setInfos(prev => ({ ...prev, [info.id]: info }));
      },
      () => {
        // 创建失败，下次操作可重试
      }
    );
  }, []);

  const join = useCallback((id: string) => {
    addRoom(id, true);
  }, []);

  const leave = useCallback((id: string) => {
    removeRoom(id);
  }, []);

  const del = useCallback((id: string) => {
    // 无论服务端删除成败都从本地列表移除
    deleteRoom(id).then(
      () => removeRoom(id),
      () => removeRoom(id)
    );
    setInfos(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const switchTo = useCallback((id: string) => {
    setCurrent(id);
  }, []);

  const setAlias = useCallback((id: string, alias: string) => {
    updateRoomAlias(id, alias).then(
      info => setInfos(prev => ({ ...prev, [id]: info })),
      () => {
        // 房间可能已被删除
      }
    );
  }, []);

  return {
    current: m.current,
    rooms: m.rooms,
    infos,
    currentInfo: m.current ? infos[m.current] || null : null,
    ready,
    create,
    join,
    leave,
    del,
    switchTo,
    setAlias,
  };
}
