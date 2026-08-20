// 每次 target 接入产生一个 session，永久保留，列表读库不走内存缓存

const fs = require('fs');
const os = require('os');
const path = require('path');
const randomId = require('licia/randomId');
const dateFormat = require('licia/dateFormat');
const { openDb } = require('./db');

const LOG_DIR = path.join(os.tmpdir(), 'chii-logs');
const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024;
const SCREENSHOT_MAX_BASE64_LENGTH = Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4;
const SCREENSHOT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const SAFE_ID = /^[\w-]+$/;

const db = openDb('chii-session.db');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS session (
    id              TEXT PRIMARY KEY,
    day             TEXT NOT NULL DEFAULT '',
    target_id       TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    favicon         TEXT NOT NULL DEFAULT '',
    user_agent      TEXT NOT NULL DEFAULT '',
    ip              TEXT NOT NULL DEFAULT '',
    rtc             INTEGER NOT NULL DEFAULT 0,
    room_id         TEXT NOT NULL DEFAULT '',
    start_time      INTEGER NOT NULL,
    end_time        INTEGER,
    log_count       INTEGER NOT NULL DEFAULT 0,
    screenshot      TEXT,
    screenshot_data BLOB
  );
`);

function ensureColumn(name, definition) {
  const columns = db.prepare('PRAGMA table_info(session)').all();
  if (columns.some(column => column.name === name)) return false;
  db.exec(`ALTER TABLE session ADD COLUMN ${name} ${definition}`);
  return true;
}

const addedDay = ensureColumn('day', 'TEXT NOT NULL DEFAULT \'\'');
const addedLogCount = ensureColumn('log_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('screenshot_data', 'BLOB');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_session_start ON session(start_time DESC, id);
  CREATE INDEX IF NOT EXISTS idx_session_day_start ON session(day, start_time DESC, id);
  CREATE INDEX IF NOT EXISTS idx_session_active_target
    ON session(target_id, end_time, start_time DESC);
  CREATE TABLE IF NOT EXISTS session_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    time            INTEGER NOT NULL,
    last_time       INTEGER,
    type            TEXT NOT NULL DEFAULT 'log',
    text            TEXT NOT NULL DEFAULT '',
    count           INTEGER NOT NULL DEFAULT 1,
    source_url      TEXT NOT NULL DEFAULT '',
    source_line     INTEGER,
    source_column   INTEGER,
    source_function TEXT NOT NULL DEFAULT '',
    source_label    TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_session_log_session_id
    ON session_log(session_id, id);
`);

// 新增列时补齐历史数据
if (addedDay) {
  db.exec(`
    UPDATE session
    SET day = strftime('%Y-%m-%d', start_time / 1000, 'unixepoch', 'localtime')
    WHERE day = ''
  `);
}
if (addedLogCount) {
  db.exec(`
    UPDATE session
    SET log_count = (
      SELECT COUNT(*) FROM session_log WHERE session_log.session_id = session.id
    )
  `);
}

const stmtInsertSession = db.prepare(`
  INSERT INTO session
    (id, day, target_id, url, title, favicon, user_agent, ip, rtc, room_id,
     start_time, end_time, log_count, screenshot, screenshot_data)
  VALUES
    (@id, @day, @targetId, @url, @title, @favicon, @userAgent, @ip, @rtc,
     @roomId, @startTime, NULL, 0, NULL, NULL)
`);
const stmtClose = db.prepare('UPDATE session SET end_time = ? WHERE id = ? AND end_time IS NULL');
const stmtCloseStale = db.prepare('UPDATE session SET end_time = ? WHERE end_time IS NULL');
const stmtUpdateTitle = db.prepare('UPDATE session SET title = ? WHERE id = ?');
const stmtUpdateUrl = db.prepare('UPDATE session SET url = ? WHERE id = ?');
const stmtUpdateRoom = db.prepare('UPDATE session SET room_id = ? WHERE id = ?');
const stmtSetScreenshot = db.prepare('UPDATE session SET screenshot = ?, screenshot_data = ? WHERE id = ?');
const stmtGetScreenshot = db.prepare('SELECT screenshot, screenshot_data FROM session WHERE id = ?');
const stmtDelete = db.prepare('DELETE FROM session WHERE id = ?');
const stmtDeleteLogs = db.prepare('DELETE FROM session_log WHERE session_id = ?');
const SESSION_META_COLUMNS = `
  id, day, target_id, url, title, favicon, user_agent, ip, rtc, room_id,
  start_time, end_time, log_count, screenshot,
  screenshot_data IS NOT NULL AS has_screenshot_data
`;
const stmtCount = db.prepare('SELECT COUNT(*) AS count FROM session');
const stmtPage = db.prepare(`
  SELECT ${SESSION_META_COLUMNS} FROM session
  ORDER BY start_time DESC, id LIMIT ? OFFSET ?
`);
const stmtList = db.prepare(`
  SELECT ${SESSION_META_COLUMNS} FROM session ORDER BY start_time DESC, id
`);
const stmtGet = db.prepare(`
  SELECT ${SESSION_META_COLUMNS} FROM session WHERE id = ?
`);
const stmtExists = db.prepare('SELECT 1 FROM session WHERE id = ?');
const stmtActiveByTarget = db.prepare(`
  SELECT ${SESSION_META_COLUMNS} FROM session
  WHERE target_id = ? AND end_time IS NULL
  ORDER BY start_time DESC, id LIMIT 1
`);
const stmtLastLog = db.prepare(`
  SELECT * FROM session_log WHERE session_id = ? ORDER BY id DESC LIMIT 1
`);
const stmtLogs = db.prepare(`
  SELECT * FROM session_log WHERE session_id = ? ORDER BY id ASC
`);
const stmtLogById = db.prepare('SELECT * FROM session_log WHERE id = ?');
const stmtLogCount = db.prepare('SELECT COUNT(*) AS count FROM session_log WHERE session_id = ?');
const stmtInsertLog = db.prepare(`
  INSERT INTO session_log
    (session_id, time, last_time, type, text, count, source_url, source_line,
     source_column, source_function, source_label)
  VALUES
    (@sessionId, @time, @lastTime, @type, @text, @count, @sourceUrl,
     @sourceLine, @sourceColumn, @sourceFunction, @sourceLabel)
`);
const stmtMergeLog = db.prepare(`
  UPDATE session_log
  SET count = count + 1, last_time = MAX(COALESCE(last_time, time), ?)
  WHERE id = ?
`);
const stmtIncrementLogCount = db.prepare('UPDATE session SET log_count = log_count + 1 WHERE id = ?');
const stmtSetLogCount = db.prepare('UPDATE session SET log_count = ? WHERE id = ?');

function dayKey(time) {
  return dateFormat(new Date(time), 'yyyy-mm-dd');
}

function parseScreenshot(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 校验文件头，只接受 jpeg、png、webp
function isScreenshotData(contentType, data) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > SCREENSHOT_MAX_BYTES) {
    return false;
  }
  if (contentType === 'image/jpeg') {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return (
      data.length >= 8 &&
      data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (contentType === 'image/webp') {
    return (
      data.length >= 12 &&
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

function decodeScreenshot(contentType, encoded) {
  if (
    typeof encoded !== 'string' ||
    !encoded.length ||
    encoded.length > SCREENSHOT_MAX_BASE64_LENGTH ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    return null;
  }
  const data = Buffer.from(encoded, 'base64');
  const normalized = encoded.replace(/=+$/, '');
  // Buffer 对非法 base64 会静默丢字符，回编码比对可拦下这种输入
  if (data.toString('base64').replace(/=+$/, '') !== normalized) return null;
  return isScreenshotData(contentType, data) ? data : null;
}

function rowToMeta(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetId: row.target_id || '',
    url: row.url || '',
    title: row.title || '',
    favicon: row.favicon || '',
    userAgent: row.user_agent || '',
    ip: row.ip || '',
    rtc: !!row.rtc,
    roomId: row.room_id || '',
    startTime: row.start_time,
    endTime: row.end_time == null ? null : row.end_time,
    active: row.end_time == null,
    logCount: Number(row.log_count) || 0,
    hasScreenshot: !!row.screenshot && !!row.has_screenshot_data,
  };
}

function rowToLog(row) {
  if (!row) return null;
  const entry = {
    time: row.time,
    type: row.type || 'log',
    text: row.text || '',
    count: Number(row.count) || 1,
  };
  if (row.last_time != null) entry.lastTime = row.last_time;
  if (row.source_url || row.source_line != null || row.source_column != null || row.source_function) {
    entry.source = {
      url: row.source_url || '',
      line: row.source_line,
      column: row.source_column,
      function: row.source_function || '',
    };
  }
  if (row.source_label) entry.sourceLabel = row.source_label;
  return entry;
}

// 与上一条日志比对，相同则合并计数
function entryFingerprint(entry) {
  return [
    entry.type || 'log',
    entry.text || '',
    entry.source
      ? `${entry.source.url || ''}:${entry.source.line || ''}:${entry.source.column || ''}:${entry.source.function || ''}`
      : '',
    entry.sourceLabel || '',
  ].join('\u0000');
}

function logParams(sessionId, entry, count) {
  const source = entry.source || {};
  const time = typeof entry.time === 'number' ? entry.time : Date.now();
  return {
    sessionId,
    time,
    lastTime: typeof entry.lastTime === 'number' ? entry.lastTime : null,
    type: typeof entry.type === 'string' ? entry.type : 'log',
    text: typeof entry.text === 'string' ? entry.text : String(entry.text || ''),
    count: Number(count) > 0 ? Number(count) : 1,
    sourceUrl: typeof source.url === 'string' ? source.url : '',
    sourceLine: Number.isFinite(source.line) ? source.line : null,
    sourceColumn: Number.isFinite(source.column) ? source.column : null,
    sourceFunction: typeof source.function === 'string' ? source.function : '',
    sourceLabel: typeof entry.sourceLabel === 'string' ? entry.sourceLabel : '',
  };
}

const addSessionLog = db.transaction((sessionId, entry) => {
  if (!entry || !stmtExists.get(sessionId)) {
    return { merged: false, entry: null };
  }
  const lastRow = stmtLastLog.get(sessionId);
  const last = rowToLog(lastRow);
  if (last && entryFingerprint(last) === entryFingerprint(entry)) {
    const lastTime = typeof entry.time === 'number' ? entry.time : Date.now();
    stmtMergeLog.run(lastTime, lastRow.id);
    return { merged: true, entry: rowToLog(stmtLogById.get(lastRow.id)) };
  }

  const result = stmtInsertLog.run(logParams(sessionId, entry, 1));
  stmtIncrementLogCount.run(sessionId);
  return {
    merged: false,
    entry: rowToLog(stmtLogById.get(result.lastInsertRowid)),
  };
});

const insertLegacyLogs = db.transaction((sessionId, entries) => {
  for (let i = 0; i < entries.length; i++) {
    stmtInsertLog.run(logParams(sessionId, entries[i], entries[i].count));
  }
  stmtSetLogCount.run(entries.length, sessionId);
});

const removeSession = db.transaction(sessionId => {
  stmtDeleteLogs.run(sessionId);
  return stmtDelete.run(sessionId).changes > 0;
});

const clearSessions = db.transaction(() => {
  db.prepare('DELETE FROM session_log').run();
  db.prepare('DELETE FROM session').run();
});

class SessionStore {
  constructor() {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch {
      // 旧数据目录不可用不影响数据库存储
    }
    // 进程重启后上次遗留的 active session 一律收尾
    stmtCloseStale.run(Date.now());
    this._migrateLegacyFiles();
  }

  open(meta) {
    const id = randomId(12);
    const startTime = Date.now();
    stmtInsertSession.run({
      id,
      day: dayKey(startTime),
      targetId: meta.targetId || '',
      url: meta.url || '',
      title: meta.title || '',
      favicon: meta.favicon || '',
      userAgent: meta.userAgent || '',
      ip: meta.ip || '',
      rtc: meta.rtc ? 1 : 0,
      roomId: meta.roomId || '',
      startTime,
    });
    return id;
  }

  close(sessionId) {
    return stmtClose.run(Date.now(), sessionId).changes > 0;
  }

  updateTitle(sessionId, title) {
    return stmtUpdateTitle.run(title || '', sessionId).changes > 0;
  }

  updateUrl(sessionId, url) {
    return stmtUpdateUrl.run(typeof url === 'string' ? url : '', sessionId).changes > 0;
  }

  updateRoom(sessionId, roomId) {
    const value = typeof roomId === 'string' ? roomId : '';
    return stmtUpdateRoom.run(value, sessionId).changes > 0;
  }

  setScreenshot(sessionId, dataUrl) {
    if (
      typeof dataUrl !== 'string' ||
      dataUrl.length > SCREENSHOT_MAX_BASE64_LENGTH + 64
    ) {
      return false;
    }
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl
    );
    if (!match || !SCREENSHOT_TYPES[match[1]]) return false;
    const data = decodeScreenshot(match[1], match[2]);
    if (!data) return false;

    const screenshot = JSON.stringify({
      contentType: match[1],
      ext: SCREENSHOT_TYPES[match[1]],
    });
    return stmtSetScreenshot.run(screenshot, data, sessionId).changes > 0;
  }

  getScreenshot(sessionId) {
    const row = stmtGetScreenshot.get(sessionId);
    if (!row || !row.screenshot) return null;
    const screenshot = parseScreenshot(row.screenshot);
    if (!screenshot || !SCREENSHOT_TYPES[screenshot.contentType]) return null;
    if (row.screenshot_data) {
      return { contentType: screenshot.contentType, data: row.screenshot_data };
    }
    const file = this._screenshotFile(sessionId);
    if (!file) return null;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || !stat.size || stat.size > SCREENSHOT_MAX_BYTES) return null;
      return { contentType: screenshot.contentType, path: file };
    } catch {
      return null;
    }
  }

  add(sessionId, entry) {
    return addSessionLog(sessionId, entry);
  }

  getLogs(sessionId) {
    return stmtLogs.all(sessionId).map(rowToLog);
  }

  remove(sessionId) {
    const removed = removeSession(sessionId);
    this._dropLegacyFiles(sessionId);
    return removed;
  }

  clearAll() {
    clearSessions();
    let files = [];
    try {
      files = fs.readdirSync(LOG_DIR);
    } catch {
      return;
    }
    files.forEach(file => {
      if (/\.(jsonl|screenshot)$/.test(file)) {
        try {
          fs.unlinkSync(path.join(LOG_DIR, file));
        } catch {
          // 单个旧文件删除失败不影响数据库清理
        }
      }
    });
  }

  list() {
    return stmtList.all().map(rowToMeta);
  }

  page(offset, limit) {
    let off = parseInt(offset, 10);
    let lim = parseInt(limit, 10);
    if (isNaN(off) || off < 0) off = 0;
    if (isNaN(lim) || lim <= 0) lim = 20;

    const total = stmtCount.get().count;
    const items = stmtPage.all(lim, off).map(rowToMeta);
    return {
      items,
      total,
      offset: off,
      limit: lim,
      hasMore: off + items.length < total,
    };
  }

  meta(sessionId) {
    return rowToMeta(stmtGet.get(sessionId));
  }

  activeByTargetId(targetId) {
    return rowToMeta(stmtActiveByTarget.get(targetId));
  }

  // 早期版本把日志和截图存在 tmp 目录的文件里，启动时搬进数据库
  _migrateLegacyFiles() {
    let files = [];
    try {
      files = fs.readdirSync(LOG_DIR);
    } catch {
      return;
    }

    files.forEach(file => {
      const logMatch = /^([\w-]+)\.jsonl$/.exec(file);
      if (logMatch) this._migrateLegacyLogs(logMatch[1], path.join(LOG_DIR, file));
    });

    const rows = db
      .prepare('SELECT id, screenshot FROM session WHERE screenshot IS NOT NULL AND screenshot_data IS NULL')
      .all();
    rows.forEach(row => this._migrateLegacyScreenshot(row));
  }

  _migrateLegacyLogs(sessionId, file) {
    if (!stmtExists.get(sessionId)) return;
    if (stmtLogCount.get(sessionId).count > 0) {
      try {
        fs.unlinkSync(file);
      } catch {
        // 旧文件清理失败不影响数据库记录
      }
      return;
    }
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }

    const lines = raw.split('\n').filter(Boolean);
    const entries = [];
    for (let i = 0; i < lines.length; i++) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        return;
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      entries.push(entry);
    }
    if (!entries.length) return;
    try {
      insertLegacyLogs(sessionId, entries);
      fs.unlinkSync(file);
    } catch {
      // 迁移失败时保留旧文件供下次重试
    }
  }

  _migrateLegacyScreenshot(row) {
    const screenshot = parseScreenshot(row.screenshot);
    const file = this._screenshotFile(row.id);
    if (!screenshot || !file) return;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || !stat.size || stat.size > SCREENSHOT_MAX_BYTES) return;
      const data = fs.readFileSync(file);
      if (!isScreenshotData(screenshot.contentType, data)) return;
      stmtSetScreenshot.run(row.screenshot, data, row.id);
      fs.unlinkSync(file);
    } catch {
      // 迁移失败时保留旧文件供下次重试
    }
  }

  _file(sessionId) {
    return SAFE_ID.test(sessionId) ? path.join(LOG_DIR, `${sessionId}.jsonl`) : null;
  }

  _screenshotFile(sessionId) {
    return SAFE_ID.test(sessionId) ? path.join(LOG_DIR, `${sessionId}.screenshot`) : null;
  }

  _dropLegacyFiles(sessionId) {
    const files = [this._file(sessionId), this._screenshotFile(sessionId)];
    files.forEach(file => {
      if (file) fs.unlink(file, () => {});
    });
  }
}

module.exports = new SessionStore();
module.exports.SAFE_ID = SAFE_ID;
module.exports.LOG_DIR = LOG_DIR;
