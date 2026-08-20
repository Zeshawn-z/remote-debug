// 宿主通用扫一扫留下的待绑定意图，等设备上报 deviceId 时认领
const crypto = require('crypto');

// 与 RoomStore 保持一致
const SAFE_ID = /^[\w-]+$/;
// 待绑定有效期 60 分钟
const TTL = 60 * 60 * 1000;
// 容量上限，超出按插入序淘汰最旧
const MAX = 5000;

class PendingBindStore {
  constructor() {
    // Map 保持插入序，便于 FIFO 淘汰
    this._map = new Map();
  }

  _hash(deviceId) {
    return crypto.createHash('sha256').update(String(deviceId)).digest('hex');
  }

  _gc() {
    const now = Date.now();
    for (const [k, v] of this._map) {
      if (now - v.createdAt > TTL) this._map.delete(k);
    }
    while (this._map.size > MAX) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  set(deviceId, roomId) {
    if (!deviceId || !SAFE_ID.test(roomId || '')) return false;
    this._gc();
    const key = this._hash(deviceId);
    // 先删后插，让该 key 处于插入序末尾，淘汰时最后被清
    this._map.delete(key);
    this._map.set(key, { roomId, createdAt: Date.now() });
    return true;
  }

  // 一次性消费，无记录或已过期返回空串
  take(deviceId) {
    if (!deviceId) return '';
    const key = this._hash(deviceId);
    const v = this._map.get(key);
    if (!v) return '';
    this._map.delete(key);
    if (Date.now() - v.createdAt > TTL) return '';
    return v.roomId;
  }
}

module.exports = new PendingBindStore();
