const WebSocket = require('ws');
const url = require('url');
const ChannelManager = require('./ChannelManager');
const query = require('licia/query');
const connLogStore = require('./ConnLogStore');

function getIp(req) {
  let ip = req.socket && req.socket.remoteAddress;
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) {
    // 取第一跳，后续为代理链
    ip = String(xff).split(',')[0].trim();
  }
  return ip || '';
}

module.exports = class WebSocketServer {
  constructor() {
    this.channelManager = new ChannelManager();

    const wss = (this._wss = new WebSocket.Server({ noServer: true }));

    wss.on('connection', (ws, req) => {
      const type = ws.type;
      const ip = getIp(req);

      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      connLogStore.add({
        seq: ws._connSeq,
        phase: 'open',
        type,
        connId: ws.id,
        ip,
        userAgent: req.headers['user-agent'],
        origin: req.headers['origin'],
        host: req.headers['host'],
      });

      ws.on('close', (code, reason) => {
        connLogStore.add({
          seq: ws._connSeq,
          phase: 'close',
          type,
          connId: ws.id,
          ip,
          detail: `code=${code}${reason ? ' ' + reason.toString() : ''}`,
        });
      });
      ws.on('error', err => {
        connLogStore.add({
          seq: ws._connSeq,
          phase: 'error',
          type,
          connId: ws.id,
          ip,
          detail: (err && (err.message || err.code)) || 'ws error',
        });
      });

      if (type === 'target') {
        const { id, chiiUrl, title, favicon } = ws;
        const userAgent = req.headers['user-agent'];
        this.channelManager.createTarget(id, ws, chiiUrl, title, favicon, ip, userAgent);
      } else {
        const { id, target } = ws;
        this.channelManager.createClient(id, ws, target);
      }
    });

    // 每 25s 单向 ping，上一轮未收到 pong 则断开，最坏 50s 才能发现假活连接
    const HEARTBEAT_INTERVAL = 25000;
    this._heartbeat = setInterval(() => {
      wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
          try {
            // terminate 关闭码为 1006，target 侧会自动重连；close 默认 1000 不会
            ws.terminate();
          } catch (e) {
            // ignore
          }
          return;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch (e) {
          // ignore
        }
      });
    }, HEARTBEAT_INTERVAL);
    // 不阻止进程退出
    if (this._heartbeat && this._heartbeat.unref) {
      this._heartbeat.unref();
    }
    wss.on('close', () => clearInterval(this._heartbeat));
  }
  start(server) {
    const wss = this._wss;

    server.on('upgrade', function (request, socket, head) {
      const urlObj = url.parse(request.url);
      const pathname = urlObj.pathname.split('/');

      // 路径形如 .../target/:id 或 .../client/:id
      const len = pathname.length;
      const type = pathname[len - 2];
      const id = pathname[len - 1];

      const seq = connLogStore.nextConnSeq();
      const ip = getIp(request);
      const q = query.parse(urlObj.query);
      const known = type === 'target' || type === 'client';

      connLogStore.add({
        seq,
        phase: 'upgrade',
        type: known ? type : '',
        connId: id,
        ip,
        userAgent: request.headers['user-agent'],
        origin: request.headers['origin'],
        host: request.headers['host'],
        path: urlObj.pathname,
        url: q && q.url,
      });

      if (known) {
        wss.handleUpgrade(request, socket, head, ws => {
          ws.type = type;
          ws.id = id;
          ws._connSeq = seq;
          if (type === 'target') {
            ws.chiiUrl = q.url;
            ws.title = q.title;
            ws.favicon = q.favicon;
            ws.userAgent = q.userAgent;
            ws.rtc = q.rtc === 'true';
            ws.roomId = q.roomId || '';
          } else {
            ws.target = q.target;
          }
          wss.emit('connection', ws, request);
        });
      } else {
        connLogStore.add({
          seq,
          phase: 'rejected',
          type: '',
          connId: id,
          ip,
          userAgent: request.headers['user-agent'],
          origin: request.headers['origin'],
          host: request.headers['host'],
          path: urlObj.pathname,
          detail: 'invalid ws path (expect .../target/:id or .../client/:id)',
        });
        socket.destroy();
      }
    });
  }
};
