// 扫码绑定落地页

import { getDeviceId } from './deviceId';

// 必须与 src/target/debugPanel.ts 中的 ROOM_KEY 保持一致
const ROOM_KEY = 'chii-debug-room';

// roomId 会写入存储并渲染到 DOM
const SAFE_ID = /^[\w-]+$/;

function getParam(name: string): string {
  const m = new RegExp('[?&]' + name + '=([^&#]+)').exec(location.search || '');
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch (e) {
    return m[1];
  }
}

function parseRoomId(): string {
  const raw = (getParam('chii_room') || getParam('room') || '').trim();
  return SAFE_ID.test(raw) ? raw : '';
}

type Status = 'loading' | 'success' | 'error';

function ensureContainer(): HTMLElement {
  let el = document.getElementById('app');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app';
    document.body.appendChild(el);
  }
  return el;
}

function render(status: Status, roomId: string, message?: string) {
  const root = ensureContainer();
  root.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card';

  const icon = document.createElement('div');
  icon.className = 'icon ' + status;
  icon.textContent =
    status === 'success' ? '✓' : status === 'error' ? '!' : '';
  if (status === 'loading') {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    icon.appendChild(spinner);
  }

  const title = document.createElement('h1');
  title.className = 'title';
  title.textContent =
    status === 'success'
      ? '绑定成功'
      : status === 'error'
        ? '绑定失败'
        : '正在绑定…';

  card.appendChild(icon);
  card.appendChild(title);

  if (status === 'success' && roomId) {
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = '已加入房间';
    const id = document.createElement('div');
    id.className = 'roomId';
    id.textContent = roomId;
    const tip = document.createElement('p');
    tip.className = 'tip';
    tip.textContent =
      '本设备的绑定已记录，下次调试连接建立后会自动加入该房间。可关闭此页面，返回应用即可在控制台看到本设备。';
    card.appendChild(label);
    card.appendChild(id);
    card.appendChild(tip);
  }

  if (status === 'error') {
    const tip = document.createElement('p');
    tip.className = 'tip';
    tip.textContent = message || '绑定失败，请重试。';
    card.appendChild(tip);
  }

  root.appendChild(card);
}

function injectStyle() {
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      background: #f4f6fa;
      color: #1f2933;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    #app { width: 100%; max-width: 360px; }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,.08);
      padding: 32px 24px;
      text-align: center;
    }
    .icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      margin: 0 auto 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 34px;
      font-weight: 700;
      color: #fff;
      line-height: 1;
    }
    .icon.success { background: #30a46c; }
    .icon.error { background: #e5484d; }
    .icon.loading { background: #eef1f6; }
    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid #cdd5e0;
      border-top-color: #0d99ff;
      border-radius: 50%;
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .title { margin: 0; font-size: 20px; font-weight: 600; }
    .label { margin-top: 18px; font-size: 13px; color: #8896a8; }
    .roomId {
      margin-top: 6px;
      font-family: "SFMono-Regular", Consolas, Menlo, monospace;
      font-size: 18px;
      font-weight: 700;
      color: #0d99ff;
      word-break: break-all;
    }
    .tip {
      margin: 16px 0 0;
      font-size: 13px;
      line-height: 1.6;
      color: #6b7785;
    }
  `;
  document.head.appendChild(style);
}

// bind.js 与 chii 服务同源，从 script src 反推 origin 加 basePath
function getBasePath(): string {
  try {
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src || '';
      const idx = src.indexOf('bind.js');
      if (idx >= 0) return src.slice(0, idx);
    }
  } catch (e) {
    // ignore
  }
  return '/';
}

function postBind(prefix: string, deviceId: string, roomId: string): Promise<boolean> {
  return fetch(`${prefix}bind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, roomId }),
  }).then(
    res => res.ok,
    () => false
  );
}

// 取不到设备标识时退回本地存储，只在 bind 页与被调试页同源时有效
function fallbackLocal(roomId: string) {
  let ok = false;
  try {
    localStorage.setItem(ROOM_KEY, roomId);
    ok = true;
  } catch (e) {
    ok = false;
  }
  if (ok) {
    render('success', roomId);
  } else {
    render('error', roomId, '无法写入本地存储（可能处于隐私模式或存储被禁用）。');
  }
}

function main() {
  injectStyle();
  render('loading', '');

  const roomId = parseRoomId();
  if (!roomId) {
    render('error', '', '链接中未包含有效的房间 ID。');
    return;
  }

  const prefix = getBasePath();

  // 设备标识与 origin 无关，故走服务端记录待绑定的链路可跨域生效
  getDeviceId().then(
    deviceId => {
      if (deviceId) {
        postBind(prefix, deviceId, roomId).then(ok => {
          if (ok) {
            render('success', roomId);
          } else {
            render(
              'error',
              roomId,
              '绑定请求失败，请重试，或在设备调试面板手动输入 RoomID。'
            );
          }
        });
      } else {
        fallbackLocal(roomId);
      }
    },
    () => fallbackLocal(roomId)
  );
}

if (document.body) {
  main();
} else {
  document.addEventListener('DOMContentLoaded', main, { once: true });
}
