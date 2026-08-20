<h1 align="center">Chii</h1>

<div align="center">

Remote debugging tool.

</div>

基于 [Chii](https://github.com/liriliri/chii) 二次开发，用最新的 [Chrome DevTools 前端](https://github.com/ChromeDevTools/devtools-frontend) 替代传统 web inspector，在 PC 上调试手机、平板、客户端 WebView 等设备中的网页。

## 相比原项目增加了什么

| 能力 | 说明 |
| --- | --- |
| React 管理台 | 目标列表、会话记录、房间、设置多页面，替代原来的单表格首页 |
| 会话记录与回看 | 每次连接落一条会话，持久化 console 日志、连接日志与首屏快照，断开后仍可查 |
| 房间 | 多人共用一个服务时按房间隔离各自的设备与会话，扫码或手动输入 RoomID 加入 |
| 调试浮窗 | 注入页面内的浮窗，显示连接状态与 RoomID，连不上服务端也能看到诊断信息 |
| Mock 面板 | DevTools 里按规则改写 fetch、XHR 与 sendBeacon 的请求与响应 |
| 标题规则 | 按 URL 规则重写目标标题，让列表里的设备可辨识 |
| 设置页 | 浮窗开关、连接日志开关、访问基地址、业务域名、数据清理 |

## 它能做什么

把一段脚本注入目标页面后，就能在电脑浏览器里打开 DevTools，远程查看和操作另一台设备里的网页：

- 查看和修改 DOM 与样式
- 控制台日志、断点调试
- 网络请求审查
- 按规则改写网络请求与响应

适用于手机 H5、客户端内嵌 WebView、智能设备网页等无法直接打开 F12 的场景。

## 架构

```text
目标页面(target.js)  ◄──WebSocket──►  Chii 服务器  ◄──►  DevTools 前端(PC)
   chobitsu 模拟 CDP                   转发消息          调试界面
                                            │
                                       React 管理台
```

- `target.js` 注入目标页面，用 [chobitsu](https://github.com/liriliri/chobitsu) 模拟 Chrome DevTools Protocol
- 服务端是 Koa 加 WebSocket，托管 `target.js` 与 DevTools 前端，转发调试消息，并用 SQLite 持久化会话
- 管理台用 React 实现，与服务端走 REST

服务端只做连接配对与消息转发，不解析 DOM、Runtime、Network 的具体结构，因此 CDP 升级时中间层不需要跟着改。

## 安装

```bash
npm install chii -g
```

## 使用

启动服务：

```bash
chii start -p 8080
```

在目标页面注入脚本：

```html
<script src="//<服务器IP>:8080/target.js"></script>
```

打开 `http://localhost:8080`，在目标列表中点击 Inspect 开始调试。

### 用 CDN 托管 DevTools 前端

DevTools 前端在 `public/front_end/`，是 Chromium 构建产物，体积大且不随 npm 包发布。部署时用 `--cdn` 指向已托管前端的地址，避免 `chii_app.html` 返回 404：

```bash
chii start -p 8080 --cdn https://cdn.jsdelivr.net/npm/chii@1.15.5/public
```

### 配合 Whistle

不想手动改页面时，可以用 [whistle.chii](https://github.com/liriliri/whistle.chii) 通过代理向命中的 HTML 注入 `target.js`。业务仓库不需要提交调试代码，关闭代理规则后页面恢复原始加载流程。

## 数据存放

会话、日志、房间与设置都在本机，不上传任何第三方服务：

| 内容 | 位置 |
| --- | --- |
| 全局设置 | `~/.chii/settings.json` |
| 会话与日志 | SQLite 数据库，随服务进程创建 |
| 连接日志归档 | 运行目录下 `logs/conn-*.log` |
| Mock 规则 | 被调试页面的 `localStorage`，键 `chii-net` |
| 房间归属 | 被调试页面的 `localStorage`，键 `chii-debug-room` |

设置页的「数据清理」可以按连接日志、会话、房间三个维度分别清空。

## 目录结构

```text
src/
├── target.ts               注入端入口，保持 ES5
├── target/
│   ├── config.ts           解析服务地址与 targetId
│   ├── connectServer.ts    WebSocket 连接、上报与自定义事件
│   ├── connectRtc.ts       WebRTC 通道
│   ├── connectIframe.ts    embedded 模式
│   ├── consoleLogger.ts    console 采集与来源定位
│   ├── debugPanel.ts       页面内调试浮窗
│   ├── networkHook.ts      fetch / XHR / sendBeacon 拦截
│   └── README.md           注入端设计说明
├── bind.ts                 扫码绑定落地页
├── deviceId.ts             跨 origin 的浏览器指纹
├── index.tsx               管理台入口
└── app/
    ├── api.ts              REST 封装与 UA 解析
    ├── navConfig.ts        导航与路由登记
    ├── hooks/              目标、会话、房间、设置的数据订阅
    ├── pages/              在线调试、记录、房间、我的、设置
    ├── components/         表格、弹窗、工具栏、设置分区
    └── utils/              域名、设置缓存、时间、剪贴板

devtools-panels/
└── mock/                   Mock 面板源码，需拷贝到 devtools-frontend

server/
├── index.js                Koa 服务装配
├── middle/router.js        REST 路由
├── lib/ChannelManager.js   连接配对与自定义事件处理
├── lib/SessionStore.js     会话与日志持久化
├── lib/RoomStore.js        房间
├── lib/DeviceStore.js      在线设备
├── lib/PendingBindStore.js 待绑定房间，按 deviceId 哈希存
└── lib/SettingsStore.js    全局设置

docs/                       Mock 面板与面板开发文档
```

新增管理台页面的做法：在 `src/app/navConfig.ts` 的 `NAV_DEFS` 加一项，在 `src/app/pages/` 下建页面目录，用 `PageShell` 包一层即可获得统一的工具栏与布局。

## 开发

### 管理台与注入端

```bash
npm install
npm run dev     # watch 构建
npm run build   # 生产构建
npm run lint    # 代码规范
npm run es5     # 注入端 ES5 兼容性
```

服务端给静态文件设了缓存，改完记得硬刷新。

### DevTools 前端

需要先安装 [depot_tools](https://chromium.googlesource.com/chromium/tools/depot_tools.git)，然后拉取并构建 Chromium devtools-frontend：

```bash
npm run init:front_end    # 下载源码，体积较大
npm run dev:front_end     # gn + autoninja + gulp copy
```

Mock 面板源码在 `devtools-panels/mock/`，需要拷贝到 devtools-frontend 检出目录并改三处登记点，步骤见 [devtools-panels/README.md](devtools-panels/README.md)。

### 文档

- [注入端说明](src/target/README.md)：连接、日志采集、浮窗与快照的实现要点
- [Mock 面板](docs/mock-panel.md)：规则字段、原文保留策略与已知限制
- [新增 DevTools 面板](docs/devtools-panel-guide.md)：面板创建、登记与数据接入

## 已知限制

- Mock 只在 `target.js` 早于业务请求加载时生效，晚装的请求拦不到，面板会给出告警
- 不拦截 iframe 内的请求
- 设备标识是浏览器指纹，存在碰撞与漂移，绑定链路靠短 TTL 与一次性消费限制影响面
- 页面快照复用 chobitsu 的 screencast，只截首屏
- Network 面板看不到浏览器自发的资源请求，chobitsu 未合成这部分事件

## 原出处

本项目基于 [liriliri/chii](https://github.com/liriliri/chii)（MIT License）二次开发，感谢原作者。

- [chii](https://github.com/liriliri/chii)：原始项目
- [chobitsu](https://github.com/liriliri/chobitsu)：CDP 的 JavaScript 实现
- [whistle.chii](https://github.com/liriliri/whistle.chii)：Whistle 注入插件

## License

MIT
