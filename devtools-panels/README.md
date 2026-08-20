# DevTools 自定义面板

这里存放需要合入 Chromium `devtools-frontend` 的面板源码。Chii 的 DevTools 前端来自独立仓库，构建时从 `devtools/devtools-frontend` 读取源码，因此面板不能直接放在 `src/` 下。

目前只有一个面板：

| 面板 | 目录 | 页面侧依赖 |
| --- | --- | --- |
| Mock | `mock/` | `src/target/networkHook.ts` 挂载的 `window.__chiiNet` |

## 应用到 devtools-frontend

先按根目录 README 初始化 `devtools/devtools-frontend`，然后拷贝源码：

```bash
cp -r devtools-panels/mock devtools/devtools-frontend/front_end/panels/mock
```

再改三处登记点。

`front_end/entrypoints/chii_app/chii_app.ts` 增加：

```ts
import '../../panels/mock/mock-meta.js';
```

`front_end/entrypoints/chii_app/BUILD.gn` 的 `deps` 增加：

```gn
"../../panels/mock:meta",
```

`config/gni/devtools_grd_files.gni` 的 release 清单增加：

```gn
"front_end/panels/mock/mock-meta.js",
"front_end/panels/mock/mock.js",
```

debug 清单增加：

```gn
"front_end/panels/mock/MockPanel.js",
```

两份清单互斥，同一个文件不要同时登记。

## 构建

```bash
npm run dev:front_end     # 调试产物
npm run build:front_end   # 发布产物
```

服务端对静态资源设了缓存，构建完成后需要硬刷新 DevTools 页面。

## 文件职责

| 文件 | 说明 |
| --- | --- |
| `MockPanel.ts` | 面板 UI 与规则管理 |
| `mock.ts` | 模块出口 |
| `mock-meta.ts` | 面板注册信息，`order` 为 102 |
| `BUILD.gn` | GN 构建配置 |

`mock-meta.ts` 中的 `id` 必须与 `MockPanel` 构造函数里的 `super('mock')` 一致。`UIStrings` 的 `@description` 注释不能删，否则 i18n 构建检查不通过。
