// target 侧调试浮窗
const rawConsoleLog: (...args: any[]) => void =
  typeof console !== 'undefined' && console.log
    ? console.log.bind(console)
    : () => {
        /* no console */
      };

type WsState =
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'error'
  | 'unknown';

interface PanelState {
  targetId: string;
  serverUrl: string;
  wsUrl: string;
  deviceId: string;
  deviceIdSource: 'computed' | 'empty' | '';
  roomId: string;
  state: WsState;
  reconnectCount: number;
  lastError: string;
  lastCloseCode: number | null;
  lastCloseReason: string;
  connectedAt: number | null;
  sentLogs: number;
  receivedMsgs: number;
  events: { time: number; text: string }[];
}

const MAX_EVENTS = 30;
const HIDDEN_KEY = 'chii-debug-hidden';

const FAB_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#chii-fab-g)"/>
  <defs>
    <linearGradient id="chii-fab-g" x1="1" y1="1" x2="23" y2="23" gradientUnits="userSpaceOnUse">
      <stop stop-color="#4f9bff"/>
      <stop offset="1" stop-color="#1966d2"/>
    </linearGradient>
  </defs>
  <path d="M9.5 8L6 12l3.5 4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14.5 8L18 12l-3.5 4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function isForceEnabled(): boolean {
  try {
    if (location.search.indexOf('chii_debug=1') >= 0) return true;
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('chii-debug') === '1'
    ) {
      return true;
    }
  } catch (e) {
    // ignore
  }
  return false;
}

function isUserHidden(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function setUserHidden(v: boolean) {
  try {
    if (v) sessionStorage.setItem(HIDDEN_KEY, '1');
    else sessionStorage.removeItem(HIDDEN_KEY);
  } catch (e) {
    // ignore
  }
}

const ROOM_KEY = 'chii-debug-room';
const DETAIL_KEY = 'chii-debug-detail';

// 存在业务域的 localStorage，刷新与重连后继承
export function loadRoom(): string {
  try {
    return localStorage.getItem(ROOM_KEY) || '';
  } catch (e) {
    return '';
  }
}
function saveRoom(v: string) {
  try {
    if (v) localStorage.setItem(ROOM_KEY, v);
    else localStorage.removeItem(ROOM_KEY);
  } catch (e) {
    // ignore
  }
}

function loadDetail(): boolean {
  try {
    return localStorage.getItem(DETAIL_KEY) === '1';
  } catch (e) {
    return false;
  }
}
function saveDetail(v: boolean) {
  try {
    if (v) localStorage.setItem(DETAIL_KEY, '1');
    else localStorage.removeItem(DETAIL_KEY);
  } catch (e) {
    // ignore
  }
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtTime(t: number) {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m${pad2(s)}s`;
  const h = Math.floor(m / 60);
  return `${h}h${pad2(m % 60)}m`;
}

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }
  .root {
    position: relative;
    width: 40px;
    height: 40px;
    color: #fff;
  }
  .fab {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #fff;
    color: #fff;
    border: 3px solid #0d99ff;
    cursor: pointer;
    touch-action: none;
    box-shadow: 0 4px 14px rgba(0,0,0,.25);
    font-size: 18px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .15s, border-color .15s;
    position: relative;
  }
  .fab:hover { transform: scale(1.05); }
  .fab:active { cursor: grabbing; }
  .fab.dragging { transition: none; cursor: grabbing; }
  .fab.dragging:hover { transform: none; }
  .fab.state-open { border-color: #30a46c; }
  .fab.state-connecting, .fab.state-closing { border-color: #d97e00; }
  .fab.state-closed, .fab.state-error { border-color: #e5484d; }
  .fab svg { display: block; }

  .panel {
    position: absolute;
    width: 360px;
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    background: #1f2933;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    overflow: hidden;
    font-size: 12px;
    color: #e8eef5;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: #0f1822;
    border-bottom: 1px solid #2a3744;
  }
  .header .title {
    flex: 1;
    font-weight: 600;
  }
  .badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    color: #fff;
    text-transform: uppercase;
  }
  .badge.state-open { background: #30a46c; }
  .badge.state-connecting, .badge.state-closing { background: #d97e00; }
  .badge.state-closed, .badge.state-error { background: #e5484d; }
  .iconBtn {
    background: transparent;
    color: #c8d2dd;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
  }
  .iconBtn:hover { background: rgba(255,255,255,.08); color: #fff; }

  .body {
    flex: 1;
    min-height: 0;
    padding: 8px 12px;
    overflow: auto;
  }
  .markBar {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 12px;
    background: #16212c;
    border-bottom: 1px solid #2a3744;
  }
  .markBar .label {
    color: #8896a8;
    flex-shrink: 0;
  }
  .markBar input {
    flex: 1;
    min-width: 0;
    background: #0f1822;
    border: 1px solid #36475a;
    color: #e8eef5;
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 12px;
    outline: none;
  }
  .markBar input:focus { border-color: #0d99ff; }
  .markBar button {
    background: #0d99ff;
    color: #fff;
    border: none;
    border-radius: 5px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .markBar button:hover { background: #2ba3ff; }
  .row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 4px 0;
    border-bottom: 1px dashed rgba(255,255,255,.06);
  }
  .row .k {
    width: 92px;
    color: #8896a8;
    flex-shrink: 0;
  }
  .row .v {
    flex: 1;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #e8eef5;
  }
  .row .copy {
    background: transparent;
    border: 1px solid #36475a;
    color: #c8d2dd;
    border-radius: 4px;
    font-size: 10px;
    padding: 1px 6px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .row .copy:hover { border-color: #6f8aab; color: #fff; }

  .events {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid #2a3744;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #c8d2dd;
    max-height: 160px;
    overflow: auto;
  }
  .events .item { padding: 2px 0; }
  .events .t { color: #8896a8; margin-right: 6px; }

  .footer {
    padding: 8px 12px;
    background: #0f1822;
    border-top: 1px solid #2a3744;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .btn {
    background: #2a3744;
    color: #e8eef5;
    border: none;
    border-radius: 5px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
  }
  .btn:hover { background: #36475a; }
  .btn.primary { background: #0d99ff; }
  .btn.primary:hover { background: #2ba3ff; }
`;

export interface DebugPanelHandle {
  setState: (next: Partial<PanelState>) => void;
  pushEvent: (text: string) => void;
  bumpReconnect: () => void;
  bumpSent: () => void;
  bumpReceived: () => void;
  setEnabled: (v: boolean) => void;
  destroy: () => void;
  onForceReconnect: (cb: () => void) => void;
  onRoomChange: (cb: (roomId: string) => void) => void;
  // 会同步输入框、持久化并触发 onRoomChange
  setRoom: (roomId: string) => void;
  onSnapshot: (cb: () => void) => void;
}

function rafThrottle(fn: () => void): () => void {
  let scheduled = false;
  const tick = () => {
    scheduled = false;
    try {
      fn();
    } catch (e) {
      // ignore
    }
  };
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: any) => setTimeout(cb, 16);
  return () => {
    if (scheduled) return;
    scheduled = true;
    raf(tick);
  };
}

export function createDebugPanel(initial: {
  targetId: string;
  serverUrl: string;
  wsUrl: string;
}): DebugPanelHandle {
  const forceOn = isForceEnabled();
  let userHidden = isUserHidden();
  let serverEnabled = true;
  let detailOn = loadDetail();

  const state: PanelState = {
    targetId: initial.targetId,
    serverUrl: initial.serverUrl,
    wsUrl: initial.wsUrl,
    deviceId: '',
    deviceIdSource: '',
    roomId: loadRoom(),
    state: 'connecting',
    reconnectCount: 0,
    lastError: '',
    lastCloseCode: null,
    lastCloseReason: '',
    connectedAt: null,
    sentLogs: 0,
    receivedMsgs: 0,
    events: [],
  };

  const reconnectCbs: Array<() => void> = [];
  const roomCbs: Array<(roomId: string) => void> = [];
  const snapshotCbs: Array<() => void> = [];

  const host = document.createElement('div');
  host.setAttribute('data-chii-debug', '1');
  // 定位放在 host 而非 shadow 内子元素，部分 webview 对 shadow 内 fixed 定位有异常。
  // !important 防止宿主页面的全局 div 样式覆盖
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('right', '12px', 'important');
  host.style.setProperty('bottom', '12px', 'important');
  host.style.setProperty('left', 'auto', 'important');
  host.style.setProperty('top', 'auto', 'important');
  host.style.setProperty('width', '40px', 'important');
  host.style.setProperty('height', '40px', 'important');
  host.style.setProperty('z-index', '2147483646', 'important');

  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: 'closed' });
  } catch (e) {
    return makeNoopHandle();
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  shadow.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = 'root';
  shadow.appendChild(root);

  let opened = false;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'chii 调试面板';
  fab.innerHTML = FAB_SVG;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.style.display = 'none';

  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = '远程调试面板';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = state.state;
  const minBtn = document.createElement('button');
  minBtn.className = 'iconBtn';
  minBtn.title = '折叠';
  minBtn.textContent = '–';
  minBtn.addEventListener('click', () => setOpened(false));
  const detailBtn = document.createElement('button');
  detailBtn.className = 'iconBtn';
  detailBtn.title = '显示/隐藏详细信息与日志';
  const refreshDetailBtn = () => {
    detailBtn.textContent = detailOn ? '收起' : '详情';
  };
  refreshDetailBtn();
  detailBtn.addEventListener('click', () => {
    detailOn = !detailOn;
    saveDetail(detailOn);
    refreshDetailBtn();
    renderBody();
  });
  const hideBtn = document.createElement('button');
  hideBtn.className = 'iconBtn';
  hideBtn.title = '本次会话不再显示（刷新后恢复，或在服务端开启调试模式也会恢复）';
  hideBtn.textContent = '×';
  hideBtn.addEventListener('click', () => {
    userHidden = true;
    setUserHidden(true);
    applyVisibility();
  });
  header.appendChild(title);
  header.appendChild(badge);
  header.appendChild(detailBtn);
  header.appendChild(minBtn);
  header.appendChild(hideBtn);

  const body = document.createElement('div');
  body.className = 'body';

  const roomBar = document.createElement('div');
  roomBar.className = 'markBar';
  const roomLabel = document.createElement('span');
  roomLabel.className = 'label';
  roomLabel.textContent = '房间';
  const roomInput = document.createElement('input');
  roomInput.type = 'text';
  roomInput.placeholder = '输入 RoomID 进入房间';
  roomInput.maxLength = 200;
  roomInput.value = state.roomId;
  const roomBtn = document.createElement('button');
  roomBtn.textContent = '进入';
  const commitRoom = () => {
    const v = roomInput.value.trim();
    state.roomId = v;
    saveRoom(v);
    roomCbs.forEach(cb => {
      try {
        cb(v);
      } catch (e) {
        // ignore
      }
    });
  };
  roomBtn.addEventListener('click', commitRoom);
  roomInput.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') commitRoom();
  });
  roomBar.appendChild(roomLabel);
  roomBar.appendChild(roomInput);
  roomBar.appendChild(roomBtn);

  const footer = document.createElement('div');
  footer.className = 'footer';

  const reconnectBtn = document.createElement('button');
  reconnectBtn.className = 'btn primary';
  reconnectBtn.textContent = '重连';
  reconnectBtn.addEventListener('click', () => {
    reconnectCbs.forEach(cb => {
      try {
        cb();
      } catch (e) {
        // ignore
      }
    });
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn';
  copyBtn.textContent = '复制信息';
  copyBtn.addEventListener('click', () => {
    const text = serializeState();
    copyText(text);
    pushEvent('已复制调试信息到剪贴板');
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.textContent = '隐藏';
  closeBtn.addEventListener('click', () => setOpened(false));

  const snapshotBtn = document.createElement('button');
  snapshotBtn.className = 'btn';
  snapshotBtn.textContent = '重截快照';
  snapshotBtn.title = '重新截取首屏快照并上传';
  snapshotBtn.addEventListener('click', () => {
    snapshotCbs.forEach(cb => {
      try {
        cb();
      } catch (e) {
        // ignore
      }
    });
  });

  footer.appendChild(reconnectBtn);
  footer.appendChild(copyBtn);
  footer.appendChild(closeBtn);
  footer.appendChild(snapshotBtn);

  panel.appendChild(header);
  panel.appendChild(roomBar);
  panel.appendChild(body);
  panel.appendChild(footer);

  root.appendChild(fab);
  root.appendChild(panel);

  // ==== FAB 拖拽 ====
  const FAB_SIZE = 40;
  const EDGE = 8;
  const DRAG_ENABLE_DELAY = 3000;

  const viewport = () => ({
    vw: window.innerWidth || document.documentElement.clientWidth || 0,
    vh: window.innerHeight || document.documentElement.clientHeight || 0,
  });

  // 位置以距右下角的距离表示
  function clampPos(p: { right: number; bottom: number }) {
    const { vw, vh } = viewport();
    const maxRight = vw > 0 ? vw - FAB_SIZE - EDGE : Infinity;
    const maxBottom = vh > 0 ? vh - FAB_SIZE - EDGE : Infinity;
    return {
      right: Math.max(EDGE, Math.min(p.right, maxRight)),
      bottom: Math.max(EDGE, Math.min(p.bottom, maxBottom)),
    };
  }

  let fabPos = { right: 12, bottom: 12 };
  let dragEnabled = false;

  function applyPos() {
    host.style.setProperty('right', `${fabPos.right}px`, 'important');
    host.style.setProperty('bottom', `${fabPos.bottom}px`, 'important');
    host.style.setProperty('left', 'auto', 'important');
    host.style.setProperty('top', 'auto', 'important');
  }

  // 3 秒后才从 DOM 实际位置接管并允许拖拽，期间沿用 CSS 定位，避免视觉跳动
  window.setTimeout(() => {
    const { vw, vh } = viewport();
    const rect = host.getBoundingClientRect();
    if (vw > 0 && vh > 0 && rect.width > 0 && rect.height > 0) {
      fabPos = clampPos({
        right: vw - rect.right,
        bottom: vh - rect.bottom,
      });
    }
    applyPos();
    dragEnabled = true;
    fab.style.cursor = 'grab';
  }, DRAG_ENABLE_DELAY);

  const GAP = 8;
  const MIN_H = 140;
  let alignRight = false;
  let openDown = true;

  const spaceBelow = () => fabPos.bottom - GAP - EDGE;
  const spaceAbove = () =>
    viewport().vh - fabPos.bottom - FAB_SIZE - GAP - EDGE;

  function choosePanelDir() {
    const { vw } = viewport();
    const cx = vw - fabPos.right - FAB_SIZE / 2;
    alignRight = cx > vw / 2;
    openDown = spaceBelow() >= spaceAbove();
  }

  // 保持既定方向，只在放不下且对侧更宽裕时翻转
  function applyPanelPos() {
    const { vw } = viewport();

    if (openDown && spaceBelow() < MIN_H && spaceAbove() > spaceBelow()) {
      openDown = false;
    } else if (!openDown && spaceAbove() < MIN_H && spaceBelow() > spaceAbove()) {
      openDown = true;
    }
    if (openDown) {
      panel.style.top = `calc(100% + ${GAP}px)`;
      panel.style.bottom = 'auto';
      panel.style.maxHeight = `${Math.max(MIN_H, spaceBelow())}px`;
    } else {
      panel.style.bottom = `calc(100% + ${GAP}px)`;
      panel.style.top = 'auto';
      panel.style.maxHeight = `${Math.max(MIN_H, spaceAbove())}px`;
    }

    const panelW = Math.min(360, vw - 2 * EDGE);
    const fabLeft = vw - fabPos.right - FAB_SIZE;
    if (!alignRight) {
      if (
        fabLeft + panelW > vw - EDGE &&
        fabLeft + FAB_SIZE - panelW >= EDGE
      ) {
        alignRight = true;
      }
    } else if (
      fabLeft + FAB_SIZE - panelW < EDGE &&
      fabLeft + panelW <= vw - EDGE
    ) {
      alignRight = false;
    }
    if (alignRight) {
      panel.style.left = 'auto';
      panel.style.right = '0';
    } else {
      panel.style.right = 'auto';
      panel.style.left = '0';
    }
  }

  if (typeof window.PointerEvent === 'function') {
    let dragging = false;
    let moved = false;
    let sx = 0;
    let sy = 0;
    let sRight = 0;
    let sBottom = 0;

    fab.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      sRight = fabPos.right;
      sBottom = fabPos.bottom;
      try {
        fab.setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
      e.preventDefault();
    });

    fab.addEventListener('pointermove', e => {
      if (!dragging || !dragEnabled) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      // 位移超过 3px 才算拖拽，避免误触抖动
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        moved = true;
        fab.classList.add('dragging');
      }
      if (moved) {
        // 以右下角为锚，指针右移则 right 减小
        fabPos = clampPos({ right: sRight - dx, bottom: sBottom - dy });
        applyPos();
        if (opened) applyPanelPos();
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        fab.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
      fab.classList.remove('dragging');
      if (!moved) {
        setOpened(!opened);
      }
    };
    fab.addEventListener('pointerup', endDrag);
    fab.addEventListener('pointercancel', endDrag);
  } else {
    fab.addEventListener('click', () => setOpened(!opened));
  }

  const onWinResize = () => {
    if (dragEnabled) {
      fabPos = clampPos(fabPos);
      applyPos();
    }
    if (opened) applyPanelPos();
  };
  window.addEventListener('resize', onWinResize);

  // 等 body 就绪再挂，不阻塞首屏
  if (document.body) {
    document.body.appendChild(host);
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        if (document.body && !host.isConnected) document.body.appendChild(host);
      },
      { once: true }
    );
  }

  // rAF 节流，避免高频 bump 触发整建 DOM 拖慢页面
  const scheduleRender = rafThrottle(() => {
    if (!opened) return;
    renderBody();
  });

  function setOpened(v: boolean) {
    opened = v;
    if (v) {
      // 展开瞬间确定方向并锁定
      choosePanelDir();
      applyPanelPos();
    }
    panel.style.display = v ? 'flex' : 'none';
    if (v) renderBody();
  }

  function applyVisibility() {
    const visible = forceOn || (serverEnabled && !userHidden);
    root.style.display = visible ? 'block' : 'none';
  }

  function deviceIdText(): string {
    if (!state.deviceId) {
      return state.deviceIdSource === 'empty' ? '(未取到)' : '(获取中…)';
    }
    const srcLabel = state.deviceIdSource === 'computed' ? '计算' : '';
    return srcLabel ? `${state.deviceId}（来源：${srcLabel}）` : state.deviceId;
  }

  function renderBody() {
    badge.className = `badge state-${state.state}`;
    badge.textContent = state.state.toUpperCase();
    if (!opened) return;
    const prevBodyScroll = body.scrollTop;
    const oldEvents = body.querySelector('.events');
    const prevEvScroll = oldEvents ? oldEvents.scrollTop : 0;
    body.innerHTML = '';
    // 四元组为 key、value、是否可复制、是否仅在详情展开时显示
    const rows: Array<[string, string, boolean?, boolean?]> = [
      ['target id', state.targetId || '-'],
      ['房间', state.roomId || '(未加入)'],
      ['设备 id', deviceIdText(), true, true],
      ['server', state.serverUrl || '-', true],
      ['ws url', state.wsUrl || '-', true, true],
      ['ws state', state.state.toUpperCase(), false, true],
      [
        '连接时长',
        state.connectedAt ? fmtDuration(Date.now() - state.connectedAt) : '-',
        false,
        true,
      ],
      ['重连次数', String(state.reconnectCount), false, true],
      [
        '上次关闭',
        state.lastCloseCode === null
          ? '-'
          : `code=${state.lastCloseCode}${
              state.lastCloseReason ? ' ' + state.lastCloseReason : ''
            }`,
        false,
        true,
      ],
      ['上次错误', state.lastError || '-', false, true],
      ['已上报日志', String(state.sentLogs), false, true],
      ['已收消息', String(state.receivedMsgs), false, true],
      ['UA', navigator.userAgent || '-', false, true],
    ];
    rows.forEach(([k, v, copyable, detailOnly]) => {
      if (detailOnly && !detailOn) return;
      const row = document.createElement('div');
      row.className = 'row';
      const kEl = document.createElement('span');
      kEl.className = 'k';
      kEl.textContent = k;
      const vEl = document.createElement('span');
      vEl.className = 'v';
      vEl.textContent = v;
      row.appendChild(kEl);
      row.appendChild(vEl);
      if (copyable) {
        const cBtn = document.createElement('button');
        cBtn.className = 'copy';
        cBtn.textContent = '复制';
        cBtn.addEventListener('click', () => copyText(v));
        row.appendChild(cBtn);
      }
      body.appendChild(row);
    });

    if (detailOn && state.events.length > 0) {
      const evWrap = document.createElement('div');
      evWrap.className = 'events';
      // 倒序，最新在上
      for (let i = state.events.length - 1; i >= 0; i--) {
        const e = state.events[i];
        const item = document.createElement('div');
        item.className = 'item';
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = fmtTime(e.time);
        const x = document.createElement('span');
        x.textContent = e.text;
        item.appendChild(t);
        item.appendChild(x);
        evWrap.appendChild(item);
      }
      body.appendChild(evWrap);
      evWrap.scrollTop = prevEvScroll;
    }

    body.scrollTop = prevBodyScroll;
  }

  function refreshFab() {
    fab.className = `fab state-${state.state}`;
  }

  function setState(next: Partial<PanelState>) {
    Object.assign(state, next);
    refreshFab();
    badge.className = `badge state-${state.state}`;
    badge.textContent = state.state.toUpperCase();
    if (opened) scheduleRender();
  }

  function pushEvent(text: string) {
    state.events.push({ time: Date.now(), text });
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
    if (opened) scheduleRender();
  }

  function bumpReconnect() {
    state.reconnectCount += 1;
    pushEvent(`触发重连（累计 ${state.reconnectCount}）`);
  }

  function bumpSent() {
    state.sentLogs += 1;
    if (opened) scheduleRender();
  }

  function bumpReceived() {
    state.receivedMsgs += 1;
    if (opened) scheduleRender();
  }

  function setEnabled(v: boolean) {
    if (serverEnabled === v) return;
    serverEnabled = v;
    if (v && userHidden) {
      userHidden = false;
      setUserHidden(false);
    }
    pushEvent(v ? '服务端启用调试浮窗' : '服务端禁用调试浮窗');
    applyVisibility();
  }

  function onForceReconnect(cb: () => void) {
    reconnectCbs.push(cb);
  }

  function onRoomChange(cb: (roomId: string) => void) {
    roomCbs.push(cb);
  }

  // 会同步输入框、持久化并触发 onRoomChange
  function setRoom(roomId: string) {
    const v = typeof roomId === 'string' ? roomId.trim() : '';
    roomInput.value = v;
    state.roomId = v;
    saveRoom(v);
    if (opened) scheduleRender();
    roomCbs.forEach(cb => {
      try {
        cb(v);
      } catch (e) {
        // ignore
      }
    });
  }

  function onSnapshot(cb: () => void) {
    snapshotCbs.push(cb);
  }

  function serializeState(): string {
    return [
      `chii debug snapshot @ ${new Date().toISOString()}`,
      `target id:    ${state.targetId}`,
      `server:       ${state.serverUrl}`,
      `ws url:       ${state.wsUrl}`,
      `ws state:     ${state.state}`,
      `reconnects:   ${state.reconnectCount}`,
      `last close:   ${
        state.lastCloseCode === null
          ? '-'
          : `code=${state.lastCloseCode} ${state.lastCloseReason || ''}`
      }`,
      `last error:   ${state.lastError || '-'}`,
      `sent logs:    ${state.sentLogs}`,
      `received:     ${state.receivedMsgs}`,
      `ua:           ${navigator.userAgent}`,
      `page url:     ${location.href}`,
    ].join('\n');
  }

  function copyText(text: string) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {
      // clipboard 不可用时退回 execCommand
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      // ignore
    }
  }

  refreshFab();
  applyVisibility();

  // 延后一轮上报，让调用方先注册 onRoomChange
  if (state.roomId) {
    setTimeout(() => {
      roomCbs.forEach(cb => {
        try {
          cb(state.roomId);
        } catch (e) {
          // ignore
        }
      });
    }, 0);
  }

  // 每秒刷一次连接时长
  const tick = setInterval(() => {
    if (opened && state.connectedAt) scheduleRender();
  }, 1000);

  function destroy() {
    clearInterval(tick);
    window.removeEventListener('resize', onWinResize);
    try {
      host.parentNode && host.parentNode.removeChild(host);
    } catch (e) {
      // ignore
    }
  }

  return {
    setState,
    pushEvent,
    bumpReconnect,
    bumpSent,
    bumpReceived,
    setEnabled,
    destroy,
    onForceReconnect,
    onRoomChange,
    setRoom,
    onSnapshot,
  };
}

function makeNoopHandle(): DebugPanelHandle {
  const noop = () => {
    /* no-op */
  };
  return {
    setState: noop,
    pushEvent: noop,
    bumpReconnect: noop,
    bumpSent: noop,
    bumpReceived: noop,
    setEnabled: noop,
    destroy: noop,
    onForceReconnect: noop,
    onRoomChange: noop,
    setRoom: noop,
    onSnapshot: noop,
  };
}

let dbgEnabled = true;

export function setDbgEnabled(v: boolean) {
  dbgEnabled = v;
}

// 走 rawConsoleLog，避免被自身的 console hook 再次上报
export function dbg(...args: any[]) {
  if (!dbgEnabled) return;
  try {
    rawConsoleLog('[chii]', ...args);
  } catch (e) {
    // ignore
  }
}
