# target 端（target.js）说明

注入到被调试页面的脚本。`src/target.ts` 为入口，按模式分发：`embedded` 走 iframe 内嵌 DevTools，`rtc` 走 WebRTC，否则 `connectServer()` 走 WebSocket 直连服务端。打包为 UMD 全局 `chii`，暴露 `chii.chobitsu`。

## connectServer.ts —— 连接与上报

- 单条 WebSocket（`licia/Socket`），关闭码非 `1000/1001/1005` 时自动重连。
- 模块级单例：`panel`（调试浮窗）、`currentWs` 与 `currentReady`（当前活动连接指针）、`chobitsuBound`（`chobitsu.setOnMessage` 只绑一次）。重连只换 `currentWs`，不重复创建。
- `pendingLogs`：`open` 之前的日志先缓存，连接后一次性 flush，上限 500 条。
- 自定义事件不走 chobitsu，不属于标准 CDP：
  - target 到 server：`ChiiRoom.set` 加入或切换房间、`ChiiScreenshot.set` 首屏快照、`ChiiDevice.claim` 认领待绑定房间。
  - server 到 target：`ChiiDebug.config` 开关调试浮窗、`ChiiRoom.apply` 下发房间，由 `handleControlMessage` 拦截。
- `lastRoomId` 在每次重连成功后重新上报，使重连产生的新 session 继承所属房间；连接时也通过 query 参数 `roomId` 带上。

## networkHook.ts —— 网络 Mock

- 拦截 `fetch`、`XMLHttpRequest` 与 `navigator.sendBeacon`，按规则改写请求与响应，接口挂在 `window.__chiiNet`。
- 必须早于业务请求执行，因此在 `target.ts` 顶部安装，早于连接逻辑。
- 无规则命中时 fetch 原样调用 `nativeFetch(input, init)`。重建 `Request` 会让 chobitsu 读不到 `postData`。
- 规则与限制项存在被调试页面的 `localStorage`，键为 `chii-net`。
- 详细说明见 [docs/mock-panel.md](../../docs/mock-panel.md)。

## 房间（rooms）与设备绑定

- 房间把「设备」与「开发者」关联起来：web 端「我的」页展示当前房间二维码，内容是绑定链接；设备侧在调试浮窗手动输入 RoomID 也能加入。web 端据此按房间过滤在线设备与会话。
- 房间 id 持久化在 `localStorage['chii-debug-room']`，刷新与重连后继承。

### 跨域绑定链路

用手机相机或任意扫码工具打开二维码里的绑定链接时，打开的是**服务域**的 `bind` 页，与注入业务页面的 target.js 处于**不同 origin**，localStorage 不互通。打通方式：

1. `bind` 页（`src/bind.ts`）取设备标识 `deviceId`（见 `src/deviceId.ts`，与 origin 无关的浏览器指纹），`POST {basePath}bind { deviceId, roomId }`；服务端 `PendingBindStore` 以 `sha256(deviceId)` 为 key 记录待绑定房间，带 TTL 与容量上限，不落盘原始值。
2. 设备端不做任何存储。
3. target 每次连接成功后经 `getDeviceId()` 上报 `ChiiDevice.claim { deviceId }`；服务端命中待绑定表则应用房间，下发 `ChiiRoom.apply { roomId }` 并消费该记录。
4. target 收到 `ChiiRoom.apply` 后调 `panel.setRoom(roomId)`，此时在业务域持久化 localStorage 并回报 `ChiiRoom.set`，闭环完成。

指纹仅在绑定链接与被调试页面处于**同一设备的同一浏览器**时一致；存在碰撞与漂移可能，靠短 TTL 加一次性消费限制影响面。取不到标识时 `bind` 页退回直接写本地存储，仅同源场景有效，此时需在浮窗手动输入 RoomID。

## consoleLogger.ts —— 日志采集与来源定位

- 进程内只 hook 一次 console（`hooked` 守卫），`currentSender` 持有当前连接的 sender，可随重连切换。
- 同时监听 `error` 与 `unhandledrejection`。
- 富文本序列化 `stringify` 处理循环引用、函数、Error、DOM 节点、Map 与 Set，单条文本上限 64KB。
- 来源定位 `isInternalFrame` 要跳过 chii 自身的栈帧：
  - 开发态按文件名匹配 `chobitsu` 与 `consoleLogger`。
  - 生产态所有内部代码都被打进 `target.js`，源码里的标识名已消失，必须按栈帧 URL 等于 `target.js` 判定。
  - 不这么做时 console hook 的包装帧会被误判为业务来源，导致所有日志来源都指向 target.js。

## debugPanel.ts —— 调试浮窗

- 纯 DOM 加 Shadow DOM 隔离样式；target.js 加载即创建，连不上服务端也能用。
- 显隐优先级：URL `?chii_debug=1` 或 `localStorage['chii-debug']==='1'` 强制启用，其次服务端 `ChiiDebug.config`，最后用户手动隐藏，写 `sessionStorage`。
- `dbg()` 用模块加载时抓取的原始 `console.log`，避免被 consoleLogger 的 hook 再次上报形成回环。

## 页面快照

复用 chobitsu 的 screencast，不自带 html2canvas。chobitsu 内部 `Page.startScreencast` 已用 html2canvas 截图并以 `Page.screencastFrame` 推帧，单独再 `import 'html2canvas'` 会重复打包约 400KB。

- 由 `connectServer` 在连接成功后触发：`chobitsu.sendMessage('Page.startScreencast')`，在 `setOnMessage` 回调里截获首帧（`params.data` 是 base64 jpeg），随后 `Page.stopScreencast`，裁切到首屏 `innerWidth × innerHeight` 后经 `ChiiScreenshot.set` 上传。截获的这一帧会被消费，不外发。
- 裁切原因：chobitsu 对 `document.body` 整体截图，结果含完整滚动高度，但首屏以下区域常因懒加载或虚拟滚动渲染为白。曾尝试按 `metadata.offsetTop` 反推 scrollY 裁到当前视口，实测 chobitsu 截图始终以 body 左上为起点，裁出来还是首屏，遂保留首屏裁切。
- 触发策略：首连延迟 3s，每次重连延迟 1.5s 各截一次；浮窗「重截快照」可手动重截；`shotInFlight` 防并发，`shotTimer` 超时保护。

## 构建注意

target 侧无动态 import 与代码分割需求，沿用默认 `ts-loader` 加 tsconfig（commonjs）。`window.chii.chobitsu` 由 `target.ts` 的 `module.exports` 暴露。改完要跑 `npm run es5` 校验 ES5 兼容性。
