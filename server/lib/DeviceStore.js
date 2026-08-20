// 设备注册表

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEVICES_DIR = path.join(os.homedir(), '.chii');
const DEVICES_FILE = path.join(DEVICES_DIR, 'devices.json');

const MAX_DEVICES = 5000;
const UA_MAX = 512;
const ROOM_MAX = 200;

// 原始 deviceId 不落盘，取 sha256 前 16 位作为主键与对外展示 id
function hashId(deviceId) {
  return crypto
    .createHash('sha256')
    .update(String(deviceId || ''))
    .digest('hex')
    .slice(0, 16);
}

class DeviceStore {
  constructor() {
    this._devices = {};
    // firstSeen 顺序，超限时从头淘汰
    this._order = [];
    this._load();
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    } catch {
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[chii] devices file is not valid JSON, ignored: ${DEVICES_FILE}`);
      return;
    }
    const list = data && Array.isArray(data.devices) ? data.devices : [];
    list
      .filter(d => d && typeof d.id === 'string')
      .sort((a, b) => (a.firstSeen || 0) - (b.firstSeen || 0))
      .slice(-MAX_DEVICES)
      .forEach(d => {
        if (this._devices[d.id]) return;
        this._devices[d.id] = {
          id: d.id,
          roomId: typeof d.roomId === 'string' ? d.roomId.slice(0, ROOM_MAX) : '',
          userAgent: typeof d.userAgent === 'string' ? d.userAgent.slice(0, UA_MAX) : '',
          ip: typeof d.ip === 'string' ? d.ip : '',
          firstSeen: typeof d.firstSeen === 'number' ? d.firstSeen : Date.now(),
          lastSeen: typeof d.lastSeen === 'number' ? d.lastSeen : Date.now(),
        };
        this._order.push(d.id);
      });
  }

  _save() {
    try {
      fs.mkdirSync(DEVICES_DIR, { recursive: true });
    } catch {
      // ignore
    }
    const devices = this._order.map(id => this._devices[id]).filter(Boolean);
    const json = JSON.stringify({ devices }, null, 2);
    const tmp = DEVICES_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, DEVICES_FILE);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[chii] failed to save devices:', e && e.message);
    }
  }

  // deviceId 传原始值，返回哈希后的短 id
  upsert(deviceId, info) {
    if (!deviceId) return '';
    const id = hashId(deviceId);
    const now = Date.now();
    info = info || {};
    let device = this._devices[id];
    if (!device) {
      device = this._devices[id] = {
        id,
        roomId: '',
        userAgent: '',
        ip: '',
        firstSeen: now,
        lastSeen: now,
      };
      this._order.push(id);
      while (this._order.length > MAX_DEVICES) {
        const dropped = this._order.shift();
        delete this._devices[dropped];
      }
    }
    if (typeof info.roomId === 'string') device.roomId = info.roomId.slice(0, ROOM_MAX);
    if (typeof info.userAgent === 'string' && info.userAgent) device.userAgent = info.userAgent.slice(0, UA_MAX);
    if (typeof info.ip === 'string' && info.ip) device.ip = info.ip;
    device.lastSeen = now;
    this._save();
    return id;
  }

  setRoom(id, roomId) {
    const device = this._devices[id];
    if (!device) return;
    device.roomId = typeof roomId === 'string' ? roomId.slice(0, ROOM_MAX) : '';
    device.lastSeen = Date.now();
    this._save();
  }

  get(id) {
    return this._devices[id] || null;
  }

  list() {
    return this._order.map(id => this._devices[id]).filter(Boolean);
  }

  clear() {
    this._devices = {};
    this._order = [];
    this._save();
  }
}

module.exports = new DeviceStore();
module.exports.hashId = hashId;
