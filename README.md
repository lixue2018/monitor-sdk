# MonitorX 前端监控 SDK

| 包名 | 说明 |
|------|------|
| `@lixue2018/monitorx-core` | 核心采集与上报 |
| `@lixue2018/monitorx-vue` | Vue 2 / Vue 3 插件 |

> **为什么 `npm install @monitorx/vue` 会 404？**  
> 公共 npm 上**没有** `@monitorx/*` 这个作用域。当前包名是 **`@lixue2018/monitorx-*`**，且需先**本地构建**或**发布到你自己的 npm** 后才能安装。见下文「安装方式」。

本仓库是 **SDK 源码**；完整监控平台在上一级目录 **`fe-monitor/`**（后端 + 管理后台 + 数据库）。

---

## 一、先搞懂：只有一个 `endpoint`

**不是**「每种错误 / 每个 Web Vital 各配一个 API」。

| 你配置的 | 作用 |
|----------|------|
| `endpoint` | **唯一上报地址**，所有数据都 `POST` 到这里 |
| `appKey` | 项目标识，区分不同前端应用（写入每条数据的 `apikey` / `app_key`） |

SDK 在内存里按类型采集，**批量合并**成 JSON 数组，一次请求发出：

```
POST {endpoint}
Content-Type: application/json

[
  { "type": "js_error", "message": "...", "apikey": "csl-new-ui", ... },
  { "type": "performance", "fcp": 1200, "lcp": 2500, ... },
  { "type": "api_error", "url": "/api/user", "status": 500, ... }
]
```

### 业务 API vs 监控 API（两套系统）

| | 业务系统 | 监控系统 |
|--|----------|----------|
| 用途 | 登录、列表、提交表单… | 错误、性能、埋点 |
| 前端配置 | `axios` + `VITE_APP_BASE_API`（如 `/dev-api`） | `createMonitor({ endpoint, appKey })` |
| 后端 | Java 等业务服务 | `fe-monitor/monitor-server`（Node，默认 3000 端口） |
| 数据库 | 业务库 | MongoDB `fe_monitor` |

---

## 二、SDK 上报的数据类型（同一 endpoint，靠 `type` 区分）

没有单独的「FCP 接口」「LCP 接口」，都在 body 里用字段 **`type`** 区分。

| `type` 值 | 含义 | 触发来源 | body 里常见字段 |
|-----------|------|----------|-----------------|
| `js_error` | JS 运行时错误 | `window.error` | `message`, `stack`, `filename`, `lineno`；子类型 `promise_error` 也在 data.type |
| `js_error` | Promise 未捕获 | `unhandledrejection` | `message`, `stack` |
| `vue_error` | Vue 组件错误 | Vue `errorHandler` | `message`, `stack`, `info` |
| `resource_error` | 静态资源加载失败 | 捕获阶段 `error`（script/img/link…） | `resourceUrl`, `resourceType` |
| `api_error` | 业务接口 4xx/5xx 或网络失败 | 劫持 XHR / Fetch | `url`, `method`, `status`, `duration` |
| `performance` | 性能与 Web Vitals | Performance API / 页面卸载 | `fp`, `fcp`, `lcp`, `fid`, `cls`, `ttfb`, `domReady`, `loadTime` 等 |
| `page_view` | 页面访问（需手动调用） | `monitor.reportPageView()` | `pageUrl` 等 |
| `custom_event` | 自定义埋点 | `monitor.reportEvent()` / `v-monitor` | 自定义字段 |

### Web Vitals 不是独立 API

FP、FCP、LCP、FID、CLS、TTFB 等都打包在 **一条** `type: "performance"` 记录里，例如：

```json
{
  "type": "performance",
  "fp": 320,
  "fcp": 580,
  "lcp": 2100,
  "fid": 12,
  "cls": 0.05,
  "ttfb": 180,
  "domReady": 1200,
  "loadTime": 3500,
  "pageUrl": "https://app.example.com/home",
  "apikey": "csl-new-ui",
  "timestamp": 1716000000000
}
```

---

## 三、业务项目安装与接入

### 1. 安装方式（三选一）

#### 方式 A：本地路径安装（推荐，无需发布 npm）

在业务项目（如 `csl-new-ui`）里执行，路径按你机器上的实际目录调整：

```bash
# 1. 先构建 SDK
cd D:/fe-monitor/monitor-sdk
npm install
npm run build:core
npm run build:vue

# 2. 在业务项目安装（Windows 示例）
cd D:/object/csl-new-ui
npm install D:/fe-monitor/monitor-sdk/packages/core
npm install D:/fe-monitor/monitor-sdk/packages/vue
```

或在业务项目 `package.json` 里写：

```json
{
  "dependencies": {
    "@lixue2018/monitorx-core": "file:../fe-monitor/monitor-sdk/packages/core",
    "@lixue2018/monitorx-vue": "file:../fe-monitor/monitor-sdk/packages/vue"
  }
}
```

然后 `npm install`。

#### 方式 B：pnpm / npm link

```bash
cd fe-monitor/monitor-sdk/packages/core && npm link
cd fe-monitor/monitor-sdk/packages/vue && npm link
cd 你的业务项目
npm link @lixue2018/monitorx-core @lixue2018/monitorx-vue
```

#### 方式 C：发布到 npm 后再安装

```bash
cd fe-monitor/monitor-sdk
npm run build:core
npm run build:vue

cd packages/core
npm publish --access public

cd ../vue
npm publish --access public
```

发布后业务项目才可执行：

```bash
npm install @lixue2018/monitorx-vue @lixue2018/monitorx-core
```

需已登录 npm，且包名 `@lixue2018/*` 有发布权限。

#### 方式 D：Git 标签自动发布（推荐）

推送标签 `v1.0.3` 后由 GitHub Actions 自动 build 并 publish，无需本机 OTP。完整步骤见 **[docs/PUBLISH.md](./docs/PUBLISH.md)**。

---

### 2. 在 `main.ts` 初始化（唯一必填配置）

```ts
import createMonitor from '@lixue2018/monitorx-vue';

app.use(createMonitor({
  appKey: import.meta.env.VITE_MONITOR_APP_KEY,      // 项目名，对应后台「项目」筛选
  endpoint: import.meta.env.VITE_MONITOR_ENDPOINT,   // 唯一上报 URL
  debug: import.meta.env.DEV,
  enableErrorTracking: true,
  enableResourceTracking: true,
  enablePerformance: true,
}));
```

仅核心库、不用 Vue 插件时：

```ts
import { MonitorCore } from '@lixue2018/monitorx-core';

const monitor = new MonitorCore({
  appKey: 'csl-new-ui',
  endpoint: '/monitor-api/reportData',
});
```

### 3. 环境变量（推荐）

`.env.development`：

```env
VITE_MONITOR_APP_KEY=csl-new-ui
VITE_MONITOR_ENDPOINT=/monitor-api/reportData
```

`.env.production`：

```env
VITE_MONITOR_APP_KEY=csl-new-ui
VITE_MONITOR_ENDPOINT=https://monitor.your-company.com/reportData
```

### 4. 开发环境 Vite 代理（把 `/monitor-api` 转到监控服务）

```ts
// vite.config.ts — 与业务 /dev-api 分开配置
proxy: {
  '/monitor-api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/monitor-api/, ''),
  },
},
```

此时 `endpoint` 填 **`/monitor-api/reportData`**，实际落到 `http://localhost:3000/reportData`。

---

## 四、fe-monitor 全栈架构（SDK + 后端 + 后台 + 库）

```
┌─────────────────────────────────────────────────────────────────┐
│  你的业务前端（csl-new-ui / csl-new-front 等）                    │
│  npm: @lixue2018/monitorx-vue                                   │
│  createMonitor({ endpoint: '/monitor-api/reportData', appKey }) │
└────────────────────────────┬────────────────────────────────────┘
                             │ POST 批量 JSON（唯一上报）
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  monitor-server（Node + Express）  默认 http://localhost:3000   │
│  目录: fe-monitor/monitor-server/                               │
│  写入 MongoDB                                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  MongoDB  mongodb://127.0.0.1:27017/fe_monitor                  │
│  集合: reports（上报明细）  projects（按 apikey 统计）            │
└────────────────────────────┬────────────────────────────────────┘
                             │ GET 查询接口
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  monitor-admin（Vue3 + Element Plus） 默认 http://localhost:5174 │
│  目录: fe-monitor/monitor-admin/                                │
│  页面: 数据概览 / 错误列表 / 错误详情                              │
└─────────────────────────────────────────────────────────────────┘
```

### 启动顺序

```bash
cd fe-monitor

# 1. 数据库（Docker）
npm run mongo

# 2. 监控后端
npm run server          # → http://localhost:3000

# 3. 管理后台
npm run admin           # → http://localhost:5174

# 4. （可选）带 web-see 的 demo
npm run demo
```

---

## 五、monitor-server 接口说明

### 5.1 上报接口（SDK 只用这个）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | **`/reportData`** | MonitorX 默认对接此地址；body 为对象或数组 |
| `POST` | `/api/report` | 同上，返回格式 `{ code: 0 }`（管理端风格） |

请求体示例：

```json
[
  {
    "type": "js_error",
    "apikey": "csl-new-ui",
    "message": "xxx is not defined",
    "stack": "...",
    "pageUrl": "http://localhost/",
    "timestamp": 1716000000000
  }
]
```

成功响应（`/reportData`）：`{ "code": 200, "msg": "上报成功！" }`

### 5.2 查询接口（给 monitor-admin 用，业务前端不用配）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/overview` | 概览（支持 `apikey`） |
| `GET` | `/api/dashboard?apikey=&days=7` | 首页多维度统计 |
| `GET` | `/api/stats?apikey=&days=7` | 按 category / type 聚合统计 |
| `GET` | `/api/trend?apikey=&days=7` | 错误趋势（按天） |
| `GET` | `/api/projects` | 项目列表（apikey） |
| `GET` | `/api/list?page=&size=&type=&apikey=&keyword=` | 分页列表，**可用 `type` 筛 performance / js_error 等** |
| `GET` | `/api/detail/:id` | 单条详情 |
| `DELETE` | `/api/detail/:id` | 删除 |
| `POST` | `/api/batch-delete` | 批量删除 `{ ids: [] }` |
| `GET` | `/health` | 健康检查（无需数据库） |

兼容 web-see 的旧接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/getErrorList?apikey=` | 错误列表（排除 performance） |
| `GET` | `/getRecordScreenId?id=` | 录屏关联数据 |

---

## 六、MongoDB 数据结构

数据库名：**`fe_monitor`**（环境变量 `MONGO_URI` 可改）

### 集合 `reports`（每条上报一条文档）

| 字段 | 说明 |
|------|------|
| `apikey` | 项目标识（与 SDK `appKey` 对应） |
| `type` | `js_error` / `performance` / `api_error` / `resource_error` / `custom_event` 等 |
| `category` | 服务端根据 type 推导的分类 |
| `message` | 错误信息或描述 |
| `stack` | 堆栈 |
| `pageUrl` | 页面地址 |
| `userId` | 用户 ID（SDK 自动生成或可 `setUserId`） |
| `timestamp` | 客户端时间戳 |
| `data` | **原始上报 JSON 完整保留**（含 fcp、lcp 等性能字段） |

索引：`apikey + type + timestamp`、`userId`、`errorUid` 等。

### 集合 `projects`

按 `apikey` 汇总 `reportCount`、`lastReportAt`。

---

## 七、monitor-admin 管理后台

| 路由 | 页面 |
|------|------|
| `/dashboard` | 数据统计（多维度图表，`/api/dashboard`） |
| `/reports/js-error` 等 | 按 MonitorX `type` 分菜单的错误列表 |
| `/performance` | Web 性能 / Vitals 列表 |
| `/detail/:id` | 单条上报详情 |

顶栏 **项目下拉**（全部 / 各 apikey）会过滤所有统计与列表。

开发时 `monitor-admin/vite.config.ts` 已将 `/api` 代理到 `http://localhost:3000`。

---

## 八、本仓库（monitor-sdk）目录

```
monitor-sdk/
├── packages/
│   ├── core/          # @lixue2018/monitorx-core
│   └── vue/           # @lixue2018/monitorx-vue
└── examples/
    └── vue3-demo/     # 接入示例
```

```bash
cd monitor-sdk
npm install
npm run build:core
npm run build:vue
```

---

## 九、常见问题

**Q：`npm install @monitorx/vue` 报 404？**  
A：公共 npm 没有 `@monitorx` 包。请用 **`@lixue2018/monitorx-vue`**，并按上文「方式 A」本地 `file:` 安装，或先 `npm publish` 再安装。

**Q：为什么文档里写过 `/api/collect/batch`？**  
A：那是通用设计示例。**当前 fe-monitor 后端实际路径是 `POST /reportData`**，`endpoint` 请与此一致。

**Q：性能数据和错误数据怎么在后台分开看？**  
A：后台 `/api/list` 传 `type=performance` 或 `type=js_error` 等筛选，不是不同 URL。

**Q：`appKey` 和后台的 `apikey` 一样吗？**  
A：一样。SDK 上报时会同时带 `app_key` 与 `apikey`（同值），便于入库和按项目筛选。

**Q：和业务 `/dev-api` 有什么关系？**  
A：完全无关。监控只认 `endpoint` 指向的 monitor-server。

---

## 十、相关仓库路径速查

| 组件 | 路径 | 默认地址 |
|------|------|----------|
| SDK | `fe-monitor/monitor-sdk/` | `@lixue2018/monitorx-*`（本地 file 或 npm 发布） |
| 上报服务 | `fe-monitor/monitor-server/` | `http://localhost:3000/reportData` |
| 管理后台 | `fe-monitor/monitor-admin/` | `http://localhost:5174` |
| 数据库 | Docker / 本地 MongoDB | `mongodb://127.0.0.1:27017/fe_monitor` |
| 演示前端 | `fe-monitor/monitor-demo/` | `http://localhost:5175` |
