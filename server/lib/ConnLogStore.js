// WebSocket 连接日志，内存保留最近 500 条供 UI 展示，全量按天归档到 logs 目录

const fs = require('fs');
const path = require('path');
const dateFormat = require('licia/dateFormat');
const settingsStore = require('./SettingsStore');

const MAX_ENTRIES = 500;
const MAX_STR = 1024;
const LOG_DIR = path.join(process.cwd(), 'logs');

function clip(s, n) {
  if (typeof s !== 'string') return '';
  const max = n || MAX_STR;
  return s.length > max ? s.slice(0, max) : s;
}

function safeParseLine(line) {
  try {
    const o = JSON.parse(line);
    return o && typeof o === 'object' ? o : null;
  } catch (e) {
    return null;
  }
}

class ConnLogStore {
  constructor() {
    this._entries = [];
    this._id = 0;
    this._seq = 0;
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (e) {
      // 目录创建失败时退化为只在内存记录
    }
    this._loadToday();
  }

  // 按本地日期切分
  _fileForNow() {
    return path.join(LOG_DIR, `conn-${dateFormat('yyyy-mm-dd')}.log`);
  }

  _loadToday() {
    let raw;
    try {
      raw = fs.readFileSync(this._fileForNow(), 'utf8');
    } catch (e) {
      return;
    }
    const lines = raw.split('\n');
    const parsed = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const o = safeParseLine(line);
      if (o) parsed.push(o);
    }
    const tail = parsed.slice(-MAX_ENTRIES);
    for (let i = 0; i < tail.length; i++) {
      const o = tail[i];
      if (typeof o.id === 'number' && o.id > this._id) this._id = o.id;
      if (typeof o.seq === 'number' && o.seq > this._seq) this._seq = o.seq;
      this._entries.push(o);
    }
  }

  // 为一次连接分配序号
  nextConnSeq() {
    this._seq += 1;
    return this._seq;
  }

  add(entry) {
    if (!settingsStore.isConnLogEnabled()) return null;
    entry = entry || {};
    this._id += 1;
    const stored = {
      id: this._id,
      time: Date.now(),
      seq: typeof entry.seq === 'number' ? entry.seq : 0,
      phase: clip(entry.phase, 20) || 'upgrade',
      type: clip(entry.type, 20),
      connId: clip(entry.connId, 100),
      ip: clip(entry.ip, 100),
      userAgent: clip(entry.userAgent, MAX_STR),
      origin: clip(entry.origin, 400),
      host: clip(entry.host, 200),
      path: clip(entry.path, 400),
      url: clip(entry.url, MAX_STR),
      detail: clip(entry.detail, 400),
    };
    this._entries.push(stored);
    while (this._entries.length > MAX_ENTRIES) {
      this._entries.shift();
    }
    try {
      fs.appendFile(this._fileForNow(), JSON.stringify(stored) + '\n', () => {});
    } catch (e) {
      // 落盘失败不影响内存记录
    }
    return stored;
  }

  // 按时间倒序
  list() {
    return this._entries.slice().reverse();
  }

  // 只清内存列表，归档文件保留
  clear() {
    this._entries = [];
  }

  // 连归档文件一起删
  clearAll() {
    this._entries = [];
    let files = [];
    try {
      files = fs.readdirSync(LOG_DIR);
    } catch (e) {
      return;
    }
    files.forEach(f => {
      if (/^conn-.*\.log$/.test(f)) {
        try {
          fs.unlinkSync(path.join(LOG_DIR, f));
        } catch (e) {
          // 单个文件删除失败不影响其余
        }
      }
    });
  }
}

module.exports = new ConnLogStore();
module.exports.LOG_DIR = LOG_DIR;
