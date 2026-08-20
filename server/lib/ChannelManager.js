const Emitter = require('licia/Emitter');
const truncate = require('licia/truncate');
const ansiColor = require('licia/ansiColor');
const util = require('./util');
const Channel = require('licia/Channel');
const sessionStore = require('./SessionStore');
const settingsStore = require('./SettingsStore');
const roomStore = require('./RoomStore');
const deviceStore = require('./DeviceStore');
const pendingBindStore = require('./PendingBindStore');
const parseCdpMessage = require('./cdpLog');

module.exports = class ChannelManager extends Emitter {
  constructor() {
    super();

    this._targets = {};
    this._clients = {};

    settingsStore.on('change', () => {
      this._reapplyTitleRules();
      this._broadcastDebugConfig();
    });
  }
  createTarget(id, ws, url, title, favicon, ip, userAgent) {
    const rawTitle = title || '';
    const finalTitle = settingsStore.applyTitle(url, rawTitle);
    // 房间不存在时视为未加入，稍后下发 ChiiRoom.deleted 让设备清除
    const claimedRoomId = typeof ws.roomId === 'string' ? ws.roomId.slice(0, 200) : '';
    const roomValid = claimedRoomId && !!roomStore.get(claimedRoomId);
    const roomId = roomValid ? claimedRoomId : '';

    const sessionId = sessionStore.open({
      targetId: id,
      url,
      title: finalTitle,
      favicon,
      userAgent,
      ip,
      rtc: !!ws.rtc,
      roomId,
    });

    if (roomId) {
      roomStore.touch(roomId);
    }

    const channel = createChannel(ws, {
      type: 'target',
      sessionId,
      manager: this,
      targetId: id,
    });

    util.log(`${ansiColor.yellow('target')} ${id}:${truncate(finalTitle, 10)} ${ansiColor.green('connected')}`);
    this._targets[id] = {
      id,
      title: finalTitle,
      rawTitle,
      url,
      favicon,
      channel,
      ws,
      ip,
      userAgent,
      rtc: ws.rtc,
      sessionId,
      roomId,
      // 由 target 上报 ChiiDevice.claim 后填充
      deviceId: '',
    };

    ws.on('close', () => {
      sessionStore.close(sessionId);
      this.removeTarget(id, finalTitle);
    });
    ws.on('error', error => {
      util.log(`${ansiColor.yellow('target')} ${id}:${truncate(finalTitle, 10)} ${ansiColor.red('error')} ${error.message}`);
    });

    // 决定 target 是否显示调试浮窗
    sendDebugConfig(ws, settingsStore.isDebugEnabled());
    if (claimedRoomId && !roomValid) {
      sendRoomDeleted(ws, claimedRoomId);
    }
    this.emit('target_changed');
  }
  createClient(id, ws, target) {
    target = this._targets[target];
    if (!target) {
      return ws.close();
    }


    const channel = createChannel(ws, { type: 'client', id });
    util.log(
      `${ansiColor.blue('client')} ${id} ${ansiColor.green('connected')} to target ${target.id}:${truncate(
        target.title,
        10
      )}`
    );
    channel.connect(target.channel);

    this._clients[id] = {
      id,
      target: target.id,
      ws,
      channel,
    };

    // 把当前 session 的历史日志回放给新连接的 DevTools
    replayLogsToClient(ws, target.sessionId);

    const closeClientWs = () => ws.close();
    ws.on('close', () => {
      target.ws.removeListener('close', closeClientWs);
      this.removeClient(id);
    });
    // target 断开时一并关掉 client，DevTools 侧会因此需要手动重连
    target.ws.on('close', closeClientWs);
  }
  removeTarget(id, title = '') {
    util.log(`${ansiColor.yellow('target')} ${id}:${title} ${ansiColor.red('disconnected')}`);
    delete this._targets[id];

    this.emit('target_changed');
  }
  removeClient(id) {
    util.log(`${ansiColor.blue('client')} ${id} ${ansiColor.red('disconnected')}`);
    delete this._clients[id];
  }
  getTargets() {
    return this._targets;
  }
  getClients() {
    return this._clients;
  }
  // 设置变更后重新套用 title 规则
  _reapplyTitleRules() {
    let changed = false;
    Object.keys(this._targets).forEach(id => {
      const t = this._targets[id];
      const next = settingsStore.applyTitle(t.url, t.rawTitle || '');
      if (next !== t.title) {
        t.title = next;
        if (t.sessionId) {
          sessionStore.updateTitle(t.sessionId, next);
        }
        changed = true;
      }
    });
    if (changed) {
      this.emit('target_changed');
    }
  }

  // 业务页 url/title/favicon 变化时更新 target 与当前 session，并通知前端刷新。
  _updateTargetInfo(targetId, info) {
    const t = this._targets[targetId];
    if (!t || !info) return;
    let changed = false;

    const url = typeof info.url === 'string' ? info.url.slice(0, 2000) : '';
    if (url && url !== t.url) {
      t.url = url;
      if (t.sessionId) sessionStore.updateUrl(t.sessionId, url);
      changed = true;
    }

    if (typeof info.title === 'string') t.rawTitle = info.title.slice(0, 500);

    const favicon = typeof info.favicon === 'string' ? info.favicon.slice(0, 2000) : '';
    if (favicon && favicon !== t.favicon) {
      t.favicon = favicon;
      changed = true;
    }

    // 依据最新 url 与 rawTitle 重新套用标题规则
    const nextTitle = settingsStore.applyTitle(t.url, t.rawTitle || '');
    if (nextTitle !== t.title) {
      t.title = nextTitle;
      if (t.sessionId) sessionStore.updateTitle(t.sessionId, nextTitle);
      changed = true;
    }

    if (changed) this.emit('target_changed');
  }

  // 更新指定 target 当前会话所属房间，并通知前端。
  // 请求校验：加入非空房间时校验其存在性，不存在则拒绝并通知设备清除。
  _setTargetRoom(targetId, roomId) {
    const t = this._targets[targetId];
    if (!t) return;
    let next = typeof roomId === 'string' ? roomId.slice(0, 200) : '';
    if (next && !roomStore.get(next)) {
      // 房间不存在则拒绝加入，并让设备清除本地归属
      if (t.ws) sendRoomDeleted(t.ws, next);
      next = '';
    }
    if (t.roomId === next) return;
    t.roomId = next;
    if (t.sessionId) {
      sessionStore.updateRoom(t.sessionId, next);
    }
    if (t.deviceId) deviceStore.setRoom(t.deviceId, next);
    if (next) roomStore.touch(next);
    this.emit('target_changed');
  }

  // 认领宿主通用扫一扫留下的待绑定房间，命中后下发 ChiiRoom.apply 让设备在业务域持久化
  _onDeviceClaim(targetId, deviceId) {
    const t = this._targets[targetId];
    if (!t) return;
    if (typeof deviceId !== 'string' || !deviceId) return;

    const shortId = deviceStore.upsert(deviceId, {
      roomId: t.roomId || '',
      userAgent: t.userAgent || '',
      ip: t.ip || '',
    });
    if (shortId && t.deviceId !== shortId) {
      t.deviceId = shortId;
      this.emit('target_changed');
    }

    // 认领宿主通用扫一扫留下的待绑定房间
    const roomId = pendingBindStore.take(deviceId);
    if (!roomId) return;
    // 取出后房间可能已被删除
    if (!roomStore.get(roomId)) return;
    if (t.roomId !== roomId) {
      t.roomId = roomId;
      if (t.sessionId) {
        sessionStore.updateRoom(t.sessionId, roomId);
      }
      if (shortId) deviceStore.setRoom(shortId, roomId);
      roomStore.touch(roomId);
      this.emit('target_changed');
    }
    if (t.ws) sendRoomApply(t.ws, roomId);
  }

  // 房间被删除时清除在线设备的房间归属
  notifyRoomDeleted(roomId) {
    if (!roomId) return;
    Object.keys(this._targets).forEach(id => {
      const t = this._targets[id];
      if (t && t.roomId === roomId) {
        if (t.ws) sendRoomDeleted(t.ws, roomId);
        t.roomId = '';
        if (t.sessionId) {
          sessionStore.updateRoom(t.sessionId, '');
        }
        if (t.deviceId) deviceStore.setRoom(t.deviceId, '');
      }
    });
    this.emit('target_changed');
  }

  // 把最新 debug 配置广播给所有活跃 target
  _broadcastDebugConfig() {
    const enabled = settingsStore.isDebugEnabled();
    Object.keys(this._targets).forEach(id => {
      const t = this._targets[id];
      if (t && t.ws) {
        sendDebugConfig(t.ws, enabled);
      }
    });
  }
};

function createChannel(ws, meta) {
  const channel = new Channel();

  ws.on('close', () => channel.destroy());
  ws.on('message', (data, isBinary) => {
    const msg = isBinary ? data : data.toString();

    // 拦截 target 上报的 Chii* 自定义事件，其余透传
    if (meta && meta.type === 'target' && !isBinary) {
      if (typeof msg === 'string' && msg.indexOf('ChiiRoom.set') >= 0) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && parsed.method === 'ChiiRoom.set') {
            const roomId = parsed.params && parsed.params.roomId;
            if (meta.manager && meta.targetId) {
              meta.manager._setTargetRoom(meta.targetId, roomId);
            }
            return;
          }
        } catch (e) {
          // ignore
        }
      }

      // 业务页 url/title 变化 ChiiTarget.update
      if (typeof msg === 'string' && msg.indexOf('ChiiTarget.update') >= 0) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && parsed.method === 'ChiiTarget.update') {
            if (meta.manager && meta.targetId) {
              meta.manager._updateTargetInfo(meta.targetId, parsed.params || {});
            }
            return;
          }
        } catch (e) {
          // 解析失败
        }
      }

      // 认领待绑定房间 ChiiDevice.claim（上报设备标识 deviceId）
      if (typeof msg === 'string' && msg.indexOf('ChiiDevice.claim') >= 0) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && parsed.method === 'ChiiDevice.claim') {
            const deviceId = parsed.params && parsed.params.deviceId;
            if (meta.manager && meta.targetId) {
              meta.manager._onDeviceClaim(meta.targetId, deviceId);
            }
            return;
          }
        } catch (e) {
          // ignore
        }
      }

      if (typeof msg === 'string' && msg.indexOf('ChiiScreenshot.set') >= 0) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && parsed.method === 'ChiiScreenshot.set') {
            const dataUrl = parsed.params && parsed.params.dataUrl;
            const ok = sessionStore.setScreenshot(meta.sessionId, dataUrl);
            if (ok && meta.manager) {
              meta.manager.emit('target_changed');
            }
            return;
          }
        } catch (e) {
          // ignore
        }
      }

      const entry = parseCdpMessage(msg);
      if (entry) {
        sessionStore.add(meta.sessionId, entry);
        try {
          channel.send(JSON.stringify(toConsoleAPICalled(entry)));
        } catch (e) {
          // ignore
        }
        return;
      }
    }

    channel.send(msg);
  });
  channel.on('message', msg => ws.send(msg));

  return channel;
}

// 会话历史日志分批回放给新接入的 DevTools
function replayLogsToClient(ws, sessionId) {
  const logs = sessionStore.getLogs(sessionId);
  if (!logs || logs.length === 0) return;

  const BATCH = 50;
  let i = 0;
  let stopped = false;

  const send = () => {
    if (stopped) return;
    if (ws.readyState !== 1) return;
    const end = Math.min(i + BATCH, logs.length);
    for (; i < end; i++) {
      try {
        ws.send(JSON.stringify(toConsoleAPICalled(logs[i])));
      } catch (err) {
        stopped = true;
        return;
      }
    }
    if (i < logs.length) {
      setImmediate(send);
    }
  };
  // 延后 200ms，等 DevTools 完成自身初始化
  setTimeout(send, 200);
}

function toConsoleAPICalled(entry) {
  const type = mapType(entry.type);
  const stackTrace = entry.source
    ? {
        callFrames: [
          {
            functionName: entry.source.function || '',
            scriptId: '0',
            url: entry.source.url || '',
            lineNumber: Math.max(0, (entry.source.line || 1) - 1),
            columnNumber: Math.max(0, (entry.source.column || 1) - 1),
          },
        ],
      }
    : { callFrames: [] };
  // 合并的重复日志用 (×n) 前缀标识
  const prefix = entry.count && entry.count > 1 ? `(×${entry.count}) ` : '';
  return {
    method: 'Runtime.consoleAPICalled',
    params: {
      type,
      args: [
        {
          type: 'string',
          value: prefix + (entry.text || ''),
        },
      ],
      executionContextId: 1,
      timestamp: entry.time,
      stackTrace,
    },
  };
}

function mapType(t) {
  switch (t) {
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    case 'info':
      return 'info';
    case 'debug':
      return 'debug';
    default:
      return 'log';
  }
}

function sendDebugConfig(ws, enabled) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(
      JSON.stringify({
        method: 'ChiiDebug.config',
        params: { enabled: !!enabled },
      })
    );
  } catch (e) {
    // ignore
  }
}

// target 收到后清除本地房间归属
function sendRoomDeleted(ws, roomId) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(
      JSON.stringify({
        method: 'ChiiRoom.deleted',
        params: { roomId: roomId || '' },
      })
    );
  } catch (e) {
    // ignore
  }
}

// target 收到后在业务域持久化房间归属
function sendRoomApply(ws, roomId) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(
      JSON.stringify({
        method: 'ChiiRoom.apply',
        params: { roomId: roomId || '' },
      })
    );
  } catch (e) {
    // ignore
  }
}
