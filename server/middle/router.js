const path = require('path');
const Router = require('koa-router');
const send = require('koa-send');
const fs = require('fs');
const readTpl = require('../lib/readTpl');
const now = require('licia/now');
const pairs = require('licia/pairs');
const reverse = require('licia/reverse');
const map = require('licia/map');
const rtrim = require('licia/rtrim');

const pkg = require('../../package.json');
const proxy = require('../lib/proxy');
const sessionStore = require('../lib/SessionStore');
const settingsStore = require('../lib/SettingsStore');
const roomStore = require('../lib/RoomStore');
const deviceStore = require('../lib/DeviceStore');
const pendingBindStore = require('../lib/PendingBindStore');
const connLogStore = require('../lib/ConnLogStore');

// 路由参数里的 id 会拼进文件名与查询条件
const SAFE_ID = /^[\w-]+$/;

// 截图响应允许的 contentType
const ALLOWED_SCREENSHOT_TYPES = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
};

function sanitizeId(raw) {
  const s = String(raw || '');
  if (!SAFE_ID.test(s)) return '';
  return s.replace(/[^\w-]/g, '');
}

function safeFilenamePart(s) {
  return String(s || '').replace(/[^\w.-]/g, '_');
}

// 拦下越出 root 的路径
function resolveWithin(root, p) {
  const base = path.resolve(root);
  const target = path.resolve(p);
  if (target === base || target.startsWith(base + path.sep)) {
    return target;
  }
  return null;
}

module.exports = function (channelManager, domain, cdn, basePath) {
  const router = new Router();

  router.get(basePath, async ctx => {
    const tpl = await readTpl('index');
    ctx.body = tpl({
      domain,
      basePath,
      version: pkg.version,
    });
  });

  router.get(`${basePath}bind`, async ctx => {
    const tpl = await readTpl('bind');
    ctx.body = tpl({
      basePath,
    });
  });

  // 设备下次连接时按 deviceId 命中待绑定表并下发房间
  router.post(`${basePath}bind`, async ctx => {
    const body = await readJsonBody(ctx);
    if (!body) {
      ctx.status = 400;
      ctx.body = { error: 'invalid json body' };
      return;
    }
    // deviceId 不可信，只限长度，store 内部以哈希存储
    const deviceId =
      typeof body.deviceId === 'string' ? body.deviceId.slice(0, 256) : '';
    const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
    if (!deviceId || !SAFE_ID.test(roomId)) {
      ctx.status = 400;
      ctx.body = { error: 'invalid params' };
      return;
    }
    if (!roomStore.get(roomId)) {
      ctx.status = 404;
      ctx.body = { error: 'room not found' };
      return;
    }
    pendingBindStore.set(deviceId, roomId);
    ctx.body = { ok: true };
  });

  router.all(`${basePath}proxy`, async ctx => {
    await proxy(ctx, ctx.query.url);
  });

  // 连接日志
  router.get(`${basePath}connlogs`, ctx => {
    ctx.body = { logs: connLogStore.list() };
  });

  router.delete(`${basePath}connlogs`, ctx => {
    connLogStore.clear();
    ctx.body = { ok: true };
  });

  // ==== 数据清理 ====
  const DATA_CLEANERS = {
    logs() {
      connLogStore.clearAll();
    },
    sessions() {
      // 先断开仍持有会话的 target ws，再清空存储
      const targets = channelManager.getTargets();
      Object.keys(targets).forEach(k => {
        const t = targets[k];
        if (t && t.sessionId && t.ws) {
          try {
            t.ws.close();
          } catch (e) {
            // ignore
          }
        }
      });
      sessionStore.clearAll();
    },
    rooms() {
      const ids = roomStore.clear();
      ids.forEach(id => channelManager.notifyRoomDeleted(id));
      // 设备与房间强关联，房间清空后设备注册表也没有意义
      deviceStore.clear();
    },
  };

  router.delete(`${basePath}data/:type`, ctx => {
    const type = ctx.params.type;
    const cleaner =
      Object.prototype.hasOwnProperty.call(DATA_CLEANERS, type) &&
      DATA_CLEANERS[type];
    if (!cleaner) {
      ctx.status = 400;
      ctx.body = { error: 'invalid data type' };
      return;
    }
    cleaner();
    ctx.body = { ok: true };
  });

  if (cdn) {
    cdn = rtrim(cdn, '/');
    router.get(`${basePath}front_end/chii_app.html`, async ctx => {
      const tpl = await readTpl('chii_app');
      ctx.body = tpl({
        cdn,
      });
    });
  }

  let timestamp = now();
  router.get(`${basePath}timestamp`, ctx => {
    ctx.body = timestamp;
  });
  channelManager.on('target_changed', () => (timestamp = now()));

  router.get(`${basePath}targets`, ctx => {
    const targets = reverse(
      map(pairs(channelManager.getTargets()), item => {
        const ret = {
          id: item[0],
          ...item[1],
        };
        delete ret.channel;
        delete ret.ws;
        delete ret.rawTitle;
        const sessionMeta = ret.sessionId
          ? sessionStore.meta(ret.sessionId)
          : null;
        ret.hasScreenshot = !!(sessionMeta && sessionMeta.hasScreenshot);
        return ret;
      })
    );

    ctx.body = {
      targets,
    };
  });

  // 不带分页参数时返回第一页 20 条
  router.get(`${basePath}sessions`, ctx => {
    const { items, total, offset, limit, hasMore } = sessionStore.page(
      ctx.query.offset,
      ctx.query.limit
    );
    ctx.body = { sessions: items, total, offset, limit, hasMore };
  });

  // 删除一个会话
  router.delete(`${basePath}sessions/:id`, ctx => {
    const id = ctx.params.id;
    if (!SAFE_ID.test(id || '')) {
      ctx.status = 400;
      ctx.body = { error: 'invalid session id' };
      return;
    }
    const meta = sessionStore.meta(id);
    if (!meta) {
      ctx.status = 404;
      ctx.body = { error: 'session not found' };
      return;
    }
    if (meta.active) {
      // 活跃会话要先断开 target ws，否则 close 回调会再写一次记录
      const targets = channelManager.getTargets();
      const target = targets[meta.targetId];
      if (target && target.sessionId === id && target.ws) {
        try {
          target.ws.close();
        } catch (e) {
          // ignore
        }
      }
    }
    sessionStore.remove(id);
    ctx.body = { ok: true };
  });

  // 查询指定会话的日志
  router.get(`${basePath}sessions/:id/logs`, ctx => {
    const id = ctx.params.id;
    if (!SAFE_ID.test(id || '')) {
      ctx.status = 400;
      ctx.body = { error: 'invalid session id' };
      return;
    }
    const meta = sessionStore.meta(id);
    if (!meta) {
      ctx.status = 404;
      ctx.body = { error: 'session not found' };
      return;
    }
    ctx.body = {
      session: meta,
      logs: sessionStore.getLogs(id),
    };
  });

  // 下载指定会话的日志
  router.get(`${basePath}sessions/:id/logs/download`, ctx => {
    const id = sanitizeId(ctx.params.id);
    if (!id) {
      ctx.status = 400;
      ctx.body = 'invalid session id';
      return;
    }
    const meta = sessionStore.meta(id);
    if (!meta) {
      ctx.status = 404;
      ctx.body = 'session not found';
      return;
    }
    const logs = sessionStore.getLogs(id);
    const header = [
      `# session: ${id}`,
      `# target:  ${meta.targetId}`,
      `# url:     ${meta.url}`,
      `# title:   ${meta.title}`,
      `# ua:      ${meta.userAgent}`,
      `# start:   ${new Date(meta.startTime).toISOString()}`,
      `# end:     ${meta.endTime ? new Date(meta.endTime).toISOString() : '(active)'}`,
      '',
    ].join('\n');
    const text = map(logs, l => {
      const t = `[${new Date(l.time).toISOString()}]`;
      const lvl = `[${l.type}]`;
      const src = l.sourceLabel ? ` [${l.sourceLabel}]` : '';
      const repeat = l.count && l.count > 1 ? ` (×${l.count})` : '';
      return `${t} ${lvl}${src}${repeat} ${l.text}`;
    }).join('\n');
    const downloadName = `chii-${safeFilenamePart(meta.targetId || 'session')}-${id}.log`;
    ctx.set('Content-Disposition', `attachment; filename="${downloadName}"`);
    ctx.type = 'text/plain; charset=utf-8';
    ctx.body = header + (text || '(no logs)');
  });

  // 查看指定会话的页面快照
  router.get(`${basePath}sessions/:id/screenshot`, ctx => {
    const id = sanitizeId(ctx.params.id);
    if (!id) {
      ctx.status = 400;
      ctx.body = 'invalid session id';
      return;
    }
    const shot = sessionStore.getScreenshot(id);
    if (!shot) {
      ctx.status = 404;
      ctx.body = 'screenshot not found';
      return;
    }
    ctx.type = ALLOWED_SCREENSHOT_TYPES[shot.contentType]
      ? shot.contentType
      : 'application/octet-stream';
    ctx.set('Cache-Control', 'private, max-age=300');
    ctx.set('X-Content-Type-Options', 'nosniff');
    if (shot.data) {
      ctx.body = shot.data;
      return;
    }
    const safePath = resolveWithin(sessionStore.LOG_DIR, shot.path);
    if (!safePath || !fs.existsSync(safePath)) {
      ctx.status = 404;
      ctx.body = 'screenshot not found';
      return;
    }
    ctx.body = fs.createReadStream(safePath);
  });

  // 全局设置
  router.get(`${basePath}settings`, ctx => {
    ctx.body = settingsStore.get();
  });

  router.put(`${basePath}settings`, async ctx => {
    const body = await readJsonBody(ctx);
    if (!body) {
      ctx.status = 400;
      ctx.body = { error: 'invalid json body' };
      return;
    }
    ctx.body = settingsStore.replace(body);
  });

  // ==== 房间 ====
  function roomDeviceCount(roomId) {
    let n = 0;
    const targets = channelManager.getTargets();
    Object.keys(targets).forEach(k => {
      if (targets[k] && targets[k].roomId === roomId) n++;
    });
    return n;
  }

  function roomInfo(id) {
    const room = roomStore.get(id);
    if (!room) return null;
    return {
      id: room.id,
      alias: room.alias || '',
      createdAt: room.createdAt,
      lastActiveAt: room.lastActiveAt || room.createdAt,
      deviceCount: roomDeviceCount(room.id),
    };
  }

  // ids 批量查询，all=1 列出全部。不存在的房间会被过滤，web 端据此识别已删除
  router.get(`${basePath}rooms`, ctx => {
    if (ctx.query.all === '1') {
      const rooms = roomStore
        .list()
        .map(r => roomInfo(r.id))
        .filter(Boolean);
      ctx.body = { rooms };
      return;
    }
    const ids = String(ctx.query.ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(s => SAFE_ID.test(s))
      .slice(0, 200);
    const seen = {};
    const rooms = [];
    ids.forEach(id => {
      if (seen[id]) return;
      seen[id] = true;
      const info = roomInfo(id);
      if (info) rooms.push(info);
    });
    ctx.body = { rooms };
  });

  router.post(`${basePath}rooms`, ctx => {
    const room = roomStore.create('');
    ctx.body = roomInfo(room.id);
  });

  // 查询单个房间信息
  router.get(`${basePath}rooms/:id`, ctx => {
    const id = ctx.params.id;
    if (!SAFE_ID.test(id || '')) {
      ctx.status = 400;
      ctx.body = { error: 'invalid room id' };
      return;
    }
    const info = roomInfo(id);
    if (!info) {
      ctx.status = 404;
      ctx.body = { error: 'room not found' };
      return;
    }
    ctx.body = info;
  });

  // 更新房间别名
  router.put(`${basePath}rooms/:id`, async ctx => {
    const id = ctx.params.id;
    if (!SAFE_ID.test(id || '')) {
      ctx.status = 400;
      ctx.body = { error: 'invalid room id' };
      return;
    }
    if (!roomStore.get(id)) {
      ctx.status = 404;
      ctx.body = { error: 'room not found' };
      return;
    }
    const body = await readJsonBody(ctx);
    if (!body) {
      ctx.status = 400;
      ctx.body = { error: 'invalid json body' };
      return;
    }
    roomStore.setAlias(id, body.alias);
    ctx.body = roomInfo(id);
  });

  // 房间不存在也返回 ok，用 existed 区分
  router.delete(`${basePath}rooms/:id`, ctx => {
    const id = ctx.params.id;
    if (!SAFE_ID.test(id || '')) {
      ctx.status = 400;
      ctx.body = { error: 'invalid room id' };
      return;
    }
    const existed = roomStore.remove(id);
    channelManager.notifyRoomDeleted(id);
    ctx.body = { ok: true, existed };
  });

  // ==== 设备 ====
  // 含离线设备，online 由当前在线 target 的 deviceId 集合实时判定
  router.get(`${basePath}devices`, ctx => {
    const targets = channelManager.getTargets();
    const onlineIds = {};
    Object.keys(targets).forEach(k => {
      const t = targets[k];
      if (t && t.deviceId) onlineIds[t.deviceId] = true;
    });
    const devices = deviceStore.list().map(d => {
      const room = d.roomId ? roomStore.get(d.roomId) : null;
      return {
        id: d.id,
        roomId: d.roomId || '',
        roomAlias: room ? room.alias || '' : '',
        userAgent: d.userAgent || '',
        ip: d.ip || '',
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        online: !!onlineIds[d.id],
      };
    });
    ctx.body = { devices };
  });

  function createStatic(prefix, folder) {
    router.get(`${basePath}${prefix}/:staticPath(.*)`, async ctx => {
      ctx.set('Cache-Control', 'no-cache');
      await send(ctx, ctx.path.slice(basePath.length + prefix.length), {
        root: path.resolve(__dirname, `../..${folder}`),
      });
    });
  }

  function createStaticFile(file) {
    router.get(`${basePath}${file}`, async ctx => {
      ctx.set('Cache-Control', 'no-cache');
      await send(ctx, file, {
        root: path.resolve(__dirname, '../../public'),
      });
    });
  }

  createStatic('front_end', '/public/front_end');
  createStatic('test', '/test');
  createStaticFile('target.js');
  createStaticFile('index.js');
  createStaticFile('bind.js');

  return router.routes();
};

function readJsonBody(ctx) {
  return new Promise(resolve => {
    let raw = '';
    let aborted = false;
    // 请求体上限 256KB
    const MAX = 256 * 1024;
    ctx.req.on('data', chunk => {
      if (aborted) return;
      raw += chunk;
      if (raw.length > MAX) {
        aborted = true;
        resolve(null);
      }
    });
    ctx.req.on('end', () => {
      if (aborted) return;
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve(null);
      }
    });
    ctx.req.on('error', () => resolve(null));
  });
}
