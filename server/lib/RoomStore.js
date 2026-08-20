// 房间清单与别名由服务端维护并落盘，web 端只在 localStorage 记录自己加入过哪些房间。

const fs = require('fs');
const os = require('os');
const path = require('path');
const randomId = require('licia/randomId');

const ROOMS_DIR = path.join(os.homedir(), '.chii');
const ROOMS_FILE = path.join(ROOMS_DIR, 'rooms.json');

// roomId 会拼进文件名与查询条件，只放行字母数字、下划线、连字符
const SAFE_ID = /^[\w-]+$/;
const MAX_ROOMS = 2000;
const ALIAS_MAX = 100;

class RoomStore {
  constructor() {
    this._rooms = {};
    // 创建顺序，超限时从头淘汰
    this._order = [];
    this._load();
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(ROOMS_FILE, 'utf8');
    } catch (e) {
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[chii] rooms file is not valid JSON, ignored: ${ROOMS_FILE}`);
      return;
    }
    const list = data && Array.isArray(data.rooms) ? data.rooms : [];
    // 按 createdAt 升序重建，保持 FIFO 淘汰语义
    list
      .filter(r => r && typeof r.id === 'string' && SAFE_ID.test(r.id))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .slice(-MAX_ROOMS)
      .forEach(r => {
        if (this._rooms[r.id]) return;
        const createdAt = typeof r.createdAt === 'number' ? r.createdAt : Date.now();
        this._rooms[r.id] = {
          id: r.id,
          alias: typeof r.alias === 'string' ? r.alias.slice(0, ALIAS_MAX) : '',
          createdAt,
          lastActiveAt:
            typeof r.lastActiveAt === 'number' ? r.lastActiveAt : createdAt,
        };
        this._order.push(r.id);
      });
  }

  _save() {
    try {
      fs.mkdirSync(ROOMS_DIR, { recursive: true });
    } catch (e) {
      // ignore
    }
    const rooms = this._order.map(id => this._rooms[id]).filter(Boolean);
    const json = JSON.stringify({ rooms }, null, 2);
    const tmp = ROOMS_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, ROOMS_FILE);
    } catch (e) {
      // 写盘失败不影响内存生效
      // eslint-disable-next-line no-console
      console.error('[chii] failed to save rooms:', e && e.message);
    }
  }

  genId() {
    let id = randomId(8);
    while (this._rooms[id]) {
      id = randomId(8);
    }
    return id;
  }

  // defaultAlias 只在房间首次创建时生效
  ensure(id, defaultAlias) {
    if (!SAFE_ID.test(id || '')) return null;
    let room = this._rooms[id];
    if (!room) {
      const now = Date.now();
      room = this._rooms[id] = {
        id,
        alias:
          typeof defaultAlias === 'string' ? defaultAlias.slice(0, ALIAS_MAX) : '',
        createdAt: now,
        lastActiveAt: now,
      };
      this._order.push(id);
      // 只淘汰注册表条目，在线连接不受影响
      while (this._order.length > MAX_ROOMS) {
        const dropped = this._order.shift();
        delete this._rooms[dropped];
      }
      this._save();
    }
    return room;
  }

  get(id) {
    if (!SAFE_ID.test(id || '')) return null;
    return this._rooms[id] || null;
  }

  // 列出所有房间，按创建顺序
  list() {
    return this._order.map(id => this._rooms[id]).filter(Boolean);
  }

  create(defaultAlias) {
    return this.ensure(this.genId(), defaultAlias);
  }

  // 设备接入或加入房间时调用
  touch(id) {
    const room = this.get(id);
    if (!room) return null;
    room.lastActiveAt = Date.now();
    this._save();
    return room;
  }

  // 仅对已存在房间生效
  setAlias(id, alias) {
    const room = this.get(id);
    if (!room) return null;
    room.alias = typeof alias === 'string' ? alias.slice(0, ALIAS_MAX) : '';
    this._save();
    return room;
  }

  // 返回被清空的房间 id，调用方据此通知在线设备解除房间归属
  clear() {
    const ids = this._order.slice();
    this._rooms = {};
    this._order = [];
    this._save();
    return ids;
  }

  // 删除房间，返回是否删除成功
  remove(id) {
    if (!this._rooms[id]) return false;
    delete this._rooms[id];
    const idx = this._order.indexOf(id);
    if (idx >= 0) this._order.splice(idx, 1);
    this._save();
    return true;
  }
}

module.exports = new RoomStore();
module.exports.SAFE_ID = SAFE_ID;
