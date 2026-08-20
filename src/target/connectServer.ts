import Socket from 'licia/Socket';
import query from 'licia/query';
import chobitsu from 'chobitsu';
import { serverUrl, id } from './config';
import { getFavicon } from './util';
import { installConsoleLogger } from './consoleLogger';
import { createDebugPanel, dbg, setDbgEnabled, DebugPanelHandle, loadRoom } from './debugPanel';
import { getDeviceIdResult } from '../deviceId';

// target 端连接与上报，设计说明见 ./README.md

let awaitingShot = false;
// 防并发
let shotInFlight = false;
// 超时保护
let shotTimer: any = null;

// chobitsu 是模块级单例，setOnMessage 只绑一次
let chobitsuBound = false;

// 当前活动连接，重连时只换它
let currentWs: any = null;
let currentReady = false;

// 调试浮窗单例，多次重连共用
let panel: DebugPanelHandle | null = null;

// null 表示从未加入房间。每次连接成功后重新上报，让新 session 继承
let lastRoomId: string | null = loadRoom() || null;

// url/title 变化监听
let urlWatchTimer: any = null;
let lastReportedUrl = location.href;
let lastReportedTitle = (window as any).ChiiTitle || document.title;

function startUrlWatch(getWs: () => any, isReady: () => boolean) {
  if (urlWatchTimer) return;
  urlWatchTimer = setInterval(() => {
    const ws = getWs();
    if (!ws || !isReady()) return;
    const url = location.href;
    const title = (window as any).ChiiTitle || document.title;
    if (url === lastReportedUrl && title === lastReportedTitle) return;
    lastReportedUrl = url;
    lastReportedTitle = title;
    try {
      ws.send(
        JSON.stringify({
          method: 'ChiiTarget.update',
          params: { url, title, favicon: getFavicon() },
        })
      );
    } catch (e) {
      // ignore
    }
  }, 3000);
}

export default function () {
  let isInit = false;
  let openedOnce = false;

  const proxy = `${serverUrl}proxy`;
  chobitsu.domain('Page').setProxy({
    proxy,
  });
  chobitsu.domain('Debugger').setProxy({
    proxy,
  });
  chobitsu.domain('CSS').setProxy({
    proxy,
  });

  const wsUrl = `${serverUrl.replace(/^http/, 'ws')}target/${id}?${query.stringify({
    url: location.href,
    title: (window as any).ChiiTitle || document.title,
    favicon: getFavicon(),
    roomId: lastRoomId || '',
    '__chobitsu-hide__': true,
  })}`;

  // 脚本加载即创建浮窗，连接失败也能用
  const tid = id || '';
  if (!panel) {
    panel = createDebugPanel({
      targetId: tid,
      serverUrl,
      wsUrl,
    });
    panel.onForceReconnect(() => {
      try {
        if (currentWs) {
          dbg('用户手动触发重连');
          panel && panel.pushEvent('用户手动触发重连');
          // licia/Socket 在 1000、1001、1005 下不重连，故用 4000
          currentWs.close(4000, 'manual reconnect');
        }
      } catch (e) {
        // ignore
      }
    });
    panel.onRoomChange((roomId: string) => {
      lastRoomId = roomId;
      try {
        if (currentWs && currentReady) {
          currentWs.send(
            JSON.stringify({
              method: 'ChiiRoom.set',
              params: { roomId },
            })
          );
          panel && panel.pushEvent('已加入房间：' + (roomId || '(已退出)'));
          dbg('加入房间', roomId);
        } else {
          panel && panel.pushEvent('未连接，房间将在连接后生效');
        }
      } catch (e) {
        // ignore
      }
    });
    panel.onSnapshot(() => {
      if (!currentWs || !currentReady) {
        panel && panel.pushEvent('未连接，无法截取快照');
        return;
      }
      if (shotInFlight) {
        panel && panel.pushEvent('快照进行中，请稍候');
        return;
      }
      panel && panel.pushEvent('用户手动触发快照');
      dbg('用户手动触发快照');
      requestSnapshot();
    });
  } else {
    panel.setState({ wsUrl, serverUrl, targetId: tid });
  }

  const ws = new Socket(wsUrl);

  panel.setState({ state: 'connecting' });
  panel.pushEvent('开始连接');
  dbg('开始连接', wsUrl);

  // ws.open 之前的日志先缓存，最多 500 条
  const pendingLogs: string[] = [];
  const sendRaw = (raw: string) => {
    if (isInit) {
      try {
        ws.send(raw);
        panel && panel.bumpSent();
      } catch (e) {
        // ignore
      }
    } else {
      if (pendingLogs.length < 500) {
        pendingLogs.push(raw);
      }
    }
  };

  installConsoleLogger(sendRaw);

  if (!chobitsuBound) {
    chobitsuBound = true;
    chobitsu.setOnMessage((message: string) => {
      // 自动快照触发的 screencastFrame 只在本地消费，不外发
      if (awaitingShot && message.indexOf('Page.screencastFrame') >= 0) {
        if (consumeScreencastFrame(message)) return;
      }
      if (!currentWs || !currentReady) return;
      try {
        currentWs.send(message);
      } catch (e) {
        // ignore
      }
    });
  }
  currentWs = ws;
  currentReady = false;

  // message 监听必须在 open 之前注册且只注册一次，否则自动重连会累积监听器
  ws.on('message', event => {
    panel && panel.bumpReceived();
    if (handleControlMessage(event && event.data)) {
      return;
    }
    chobitsu.sendRawMessage(event.data);
  });

  ws.on('open', () => {
    const firstOpen = !openedOnce;
    isInit = true;
    currentReady = true;
    panel && panel.setState({ state: 'open', connectedAt: Date.now(), lastError: '' });
    panel && panel.pushEvent(firstOpen ? '已连接' : '重连成功');
    dbg(firstOpen ? '已连接' : '重连成功', wsUrl);

    if (firstOpen) {
      openedOnce = true;
      // 重连时不再 enable，否则会重复触发 executionContextCreated
      chobitsu.sendMessage('Runtime.enable');
    }

    // 连接建立时以当前地址为基线，并启动 url/title 变化监听
    lastReportedUrl = location.href;
    lastReportedTitle = (window as any).ChiiTitle || document.title;
    startUrlWatch(() => currentWs, () => currentReady);

    // 连接成功后延迟截一次页面快照
    if (shotTimer) clearTimeout(shotTimer);
    setTimeout(() => requestSnapshot(), firstOpen ? 3000 : 1500);

    while (pendingLogs.length) {
      try {
        ws.send(pendingLogs.shift() as string);
        panel && panel.bumpSent();
      } catch (e) {
        break;
      }
    }

    // 首次补发连接前加入的房间，重连时让新 session 继承
    if (lastRoomId !== null) {
      try {
        ws.send(
          JSON.stringify({
            method: 'ChiiRoom.set',
            params: { roomId: lastRoomId },
          })
        );
        panel && panel.pushEvent('已应用房间：' + (lastRoomId || '(已退出)'));
      } catch (e) {
        // ignore
      }
    }

    // 上报设备标识，未 ready 时每 500ms 重试，最多 10 次
    getDeviceIdResult().then(({ deviceId, source }) => {
      if (panel) {
        panel.setState({
          deviceId,
          deviceIdSource: deviceId ? source : 'empty',
        });
      }
      if (!deviceId) return;
      let tries = 0;
      const send = () => {
        if (currentWs !== ws) return;
        if (currentReady) {
          try {
            ws.send(
              JSON.stringify({
                method: 'ChiiDevice.claim',
                params: { deviceId },
              })
            );
          } catch (e) {
            // ignore
          }
          return;
        }
        if (tries++ < 10) setTimeout(send, 500);
      };
      send();
    });
  });

  ws.on('close', (e: any) => {
    if (currentWs === ws) {
      currentReady = false;
    }
    isInit = false;
    const code = (e && e.code) || 0;
    const reason = (e && e.reason) || '';
    panel &&
      panel.setState({
        state: 'closed',
        lastCloseCode: code,
        lastCloseReason: reason,
        connectedAt: null,
      });
    panel &&
      panel.pushEvent(`连接关闭 code=${code}${reason ? ' ' + reason : ''}`);
    dbg('连接关闭', code, reason);
    // licia/Socket 在 1000、1001、1005 下不自动重连
    if (code !== 1000 && code !== 1001 && code !== 1005) {
      panel && panel.bumpReconnect();
      panel && panel.setState({ state: 'connecting' });
    }
  });

  ws.on('error', (err: any) => {
    const text = (err && (err.message || err.code)) || 'ws error';
    panel && panel.setState({ state: 'error', lastError: String(text) });
    panel && panel.pushEvent('连接错误：' + String(text));
    dbg('连接错误', err);
  });
}

// 处理服务端下发的 Chii 系列消息，非标准 CDP 不转给 chobitsu
function handleControlMessage(raw: any): boolean {
  if (typeof raw !== 'string') return false;
  // 先做子串判断，避免对每条消息都 JSON.parse
  if (raw.indexOf('ChiiDebug.') < 0 && raw.indexOf('ChiiRoom.') < 0) {
    return false;
  }
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return false;
  }
  if (!msg || typeof msg.method !== 'string') return false;
  if (msg.method === 'ChiiDebug.config') {
    const params = msg.params || {};
    const enabled = !!params.enabled;
    if (panel) {
      panel.setEnabled(enabled);
      panel.pushEvent('收到服务端配置：debug=' + enabled);
    }
    setDbgEnabled(enabled);
    dbg('debug config:', params);
    return true;
  }
  // 服务端未指定房间时也要清除，视为无条件退出
  if (msg.method === 'ChiiRoom.deleted') {
    const params = msg.params || {};
    const deletedId = typeof params.roomId === 'string' ? params.roomId : '';
    if (!deletedId || deletedId === lastRoomId) {
      panel && panel.pushEvent('房间已被删除，已退出房间：' + (deletedId || lastRoomId || ''));
      dbg('房间被删除', deletedId);
      // setRoom 空串会清空输入框、持久化为空，并上报 ChiiRoom.set
      panel && panel.setRoom('');
    }
    return true;
  }
  if (msg.method === 'ChiiRoom.apply') {
    const params = msg.params || {};
    const roomId = typeof params.roomId === 'string' ? params.roomId : '';
    if (roomId) {
      lastRoomId = roomId;
      panel && panel.pushEvent('扫码绑定生效，加入房间：' + roomId);
      dbg('扫码绑定生效', roomId);
      // localStorage 落在业务域，与服务域的 bind 页不共享
      panel && panel.setRoom(roomId);
    }
    return true;
  }
  return false;
}

// 复用 chobitsu 的 screencast，截获首帧即停止
function requestSnapshot() {
  if (shotInFlight) return;
  shotInFlight = true;
  awaitingShot = true;
  try {
    // 参数会被 chobitsu 忽略，仅作语义标注
    chobitsu.sendMessage('Page.startScreencast', { format: 'jpeg', quality: 80 });
  } catch (e) {
    resetShot();
    return;
  }
  // 10s 无帧则停掉并复位
  shotTimer = setTimeout(() => {
    panel && panel.pushEvent('页面快照超时未获取');
    stopScreencastSafe();
    resetShot();
  }, 10000);
}

// chobitsu 把整页 body 喂给 html2canvas，结果图含完整滚动高度，
// 首屏以下区域常因懒加载或虚拟滚动渲染为白，故在 target 端裁到首屏再上传。
// 曾按 metadata.offsetTop 裁当前视口，但 chobitsu 截图始终以 body 左上为起点，裁出来还是首屏。
function consumeScreencastFrame(message: string): boolean {
  let msg: any;
  try {
    msg = JSON.parse(message);
  } catch (e) {
    return false;
  }
  if (!msg || msg.method !== 'Page.screencastFrame') return false;
  const p = msg.params || {};
  stopScreencastSafe();
  resetShot();
  if (!p.data || !currentWs || !currentReady) return true;

  const fullDataUrl = 'data:image/jpeg;base64,' + p.data;
  cropToViewport(fullDataUrl).then(
    ({ dataUrl, width, height }) => {
      if (!currentWs || !currentReady) return;
      try {
        currentWs.send(
          JSON.stringify({
            method: 'ChiiScreenshot.set',
            params: { dataUrl, width, height },
          })
        );
        panel && panel.bumpSent();
        panel && panel.pushEvent('已上传页面快照（裁切至首屏）');
        dbg('已上传页面快照（裁切）', width, height);
      } catch (e) {
        // ignore
      }
    },
    e => {
      panel && panel.pushEvent('快照裁切失败：' + (e && e.message ? e.message : String(e)));
      dbg('快照裁切失败', e);
    }
  );
  return true;
}

// 裁到 viewport 大小，jpeg 质量 0.8
function cropToViewport(
  dataUrl: string
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cw = Math.min(window.innerWidth || img.naturalWidth, img.naturalWidth);
        const ch = Math.min(window.innerHeight || img.naturalHeight, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('no 2d context'));
          return;
        }
        ctx.drawImage(img, 0, 0, cw, ch, 0, 0, cw, ch);
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.8),
          width: cw,
          height: ch,
        });
      } catch (e) {
        reject(e as any);
      }
    };
    img.onerror = () => reject(new Error('image load error'));
    img.src = dataUrl;
  });
}

function stopScreencastSafe() {
  try {
    chobitsu.sendMessage('Page.stopScreencast');
  } catch (e) {
    // ignore
  }
}

function resetShot() {
  awaitingShot = false;
  shotInFlight = false;
  if (shotTimer) {
    clearTimeout(shotTimer);
    shotTimer = null;
  }
}
