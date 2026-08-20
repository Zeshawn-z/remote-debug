// web 端只记录自己加入了哪些房间与当前所在房间，房间清单与别名由服务端维护

const KEY = 'chii-rooms';

export interface Membership {
  /** 空串表示尚未加入任何房间 */
  current: string;
  rooms: string[];
}

const listeners = new Set<() => void>();

function read(): Membership {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const m = JSON.parse(raw);
      const rooms = Array.isArray(m && m.rooms)
        ? m.rooms.filter((x: any) => typeof x === 'string' && x)
        : [];
      const current = typeof (m && m.current) === 'string' ? m.current : '';
      return { current, rooms };
    }
  } catch (e) {
    // ignore
  }
  return { current: '', rooms: [] };
}

function write(m: Membership) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch (e) {
    // ignore
  }
  listeners.forEach(fn => {
    try {
      fn();
    } catch (e) {
      // ignore
    }
  });
}

export function getMembership(): Membership {
  return read();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// 跨标签页同步
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === KEY) {
      listeners.forEach(fn => {
        try {
          fn();
        } catch (err) {
          // ignore
        }
      });
    }
  });
}

export function addRoom(id: string, makeCurrent = true) {
  if (!id) return;
  const m = read();
  if (m.rooms.indexOf(id) < 0) m.rooms.push(id);
  if (makeCurrent) m.current = id;
  write(m);
}

// 退出的是当前房间时切到剩余的第一个
export function removeRoom(id: string) {
  const m = read();
  m.rooms = m.rooms.filter(r => r !== id);
  if (m.current === id) m.current = m.rooms[0] || '';
  write(m);
}

export function setCurrent(id: string) {
  if (!id) return;
  const m = read();
  if (m.rooms.indexOf(id) < 0) m.rooms.push(id);
  m.current = id;
  write(m);
}
