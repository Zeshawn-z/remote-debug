// ~/.chii 下 json 存配置与注册表，db 存统计与会话

const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(os.homedir(), '.chii');

try {
  fs.mkdirSync(DB_DIR, { recursive: true });
} catch (e) {
  // ignore
}

/**
 * @param {string} fileName 库文件名，如 chii-stat.db
 * @returns {import('better-sqlite3').Database}
 */
function openDb(fileName) {
  const db = new Database(path.join(DB_DIR, fileName));
  // WAL 下 NORMAL 同步级别不会丢已提交事务
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  return db;
}

module.exports = { openDb, DB_DIR };
