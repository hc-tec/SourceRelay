# SourceRelay

> Turn an already signed-in browser and approved official providers into a safe local API.

SourceRelay 是一个本地、能力驱动（capability-driven）的信息采集基础服务。它不试图把每个
网站做成通用爬虫，而是把已经登记、已经验证过的只读能力，安全地暴露给本机应用和
[SourceRelay AgentKit](https://github.com/hc-tec/SourceRelay-AgentKit)。

```text
本机应用 / Agent
      │  versioned API + scoped token
      ▼
SourceRelay Gateway (127.0.0.1)
      ├─ Browser Provider  → 用户日常 Chrome/Edge 中的 MV3 扩展
      └─ Official Provider → Gateway 内的登记官方数据源
      ▼
异步 Operation → raw-first、受限 Artifact
```

## 先看结论

- SourceRelay Core 只负责浏览器扩展、Gateway、协议、SDK 和已登记的数据源能力。
- 生产浏览器是用户自己的浏览器；Core 不创建、复制、读取、启动或关闭用户 Profile。
- 调用方只能选择已登记的强边界 capability，不能提交任意 URL、selector、脚本、坐标、tab、
  CDP、DevTools 或原始 Network response。
- 采集结果先作为异步 Operation 和本地 raw Artifact 返回；分析、汇总、知识库和
  DeepResearch 属于仓库外的上层应用。

## 首次使用先选择数据源路径

- 只使用知乎官方数据：不需要安装扩展或配对浏览器，在 Gateway Console 的“知乎开放平台”
  卡片配置 Access Secret；
- 使用 B站 / 小红书：安装扩展到日常 Chrome / Edge，启动 Gateway 并完成一次浏览器配对；
- 两类都使用：先配置知乎官方 Provider，再按浏览器 runbook 完成扩展配对。

知乎 Access Secret 与给上层应用使用的 `cst_...` Local API Token 不同。前者只属于 Gateway，
后者只用于上层应用访问 SourceRelay。

## 当前发布面

当前 release anchor 为 `0.7.17`，service schema 为 `3`。运行时唯一真相是
`GET /v2/release`、`GET /v2/capabilities` 和 `GET /v2/openapi.json`；README 不会替代这些
接口。

| Provider | 当前 direct-ready | 调用边界 | 当前状态 |
| --- | ---: | --- | --- |
| Bilibili Browser Provider | 10 | 必须使用已配对的浏览器 binding | 已完成真实 L3/L4 矩阵 |
| Xiaohongshu Browser Provider | 5 | 必须使用已配对的浏览器 binding；遵守 no-refresh / no-new-tab 边界 | 已完成真实 L3 矩阵 |
| Zhihu Official Provider | 2 | 不接受浏览器 binding；凭证只存在于 Gateway | Core 已验证，MCP L3 待单独验证 |
| Global Web Search via Zhihu Provider | 1 | 不接受浏览器 binding；由官方 Provider 执行 | Core 已验证，MCP L3 待单独验证 |
| Catalog-only / migration-required | 3 | 不可通过 `/v2/collect` 调用 | 保留在 catalog，不代表可执行 |

当前 18 项 direct-ready capability 的完整机器可读清单，以 `/v2/capabilities` 和
`npm run verify:core-capability-matrix` 为准。平台字段边界和真实证据见：

- [Bilibili capability matrix](docs/validation/bilibili-native-search-dom-v2.0.0.md)
- [Xiaohongshu developer-readiness matrix](docs/validation/developer-readiness-xiaohongshu-l3-matrix.md)
- [Zhihu official provider boundary](docs/design/official-source-provider-boundary.md)

## 五分钟启动：用户日常浏览器模式

这是当前推荐的生产路径。它不会启动测试 Chromium，也不会接管用户浏览器。

### 1. 构建稳定部署目录

要求 Node.js `>=22`。在仓库根目录执行：

```powershell
Set-Location .\poc
npm ci
npm run prepare:user-browser-deployment
```

命令会生成一个稳定的 unpacked MV3 扩展目录，并打印绝对路径。

### 2. 在已经登录的 Chrome / Edge 中加载扩展

打开 `chrome://extensions`（Edge 使用对应扩展管理页），开启“开发者模式”，选择“加载已
解压的扩展”，然后选择上一步打印的目录。安装、配对和权限确认必须由浏览器显示给用户；
SourceRelay 不会静默安装扩展，也不会导出 Cookie、密码、Storage、Token 或 Profile 文件。

完整图文步骤见[用户日常浏览器部署 runbook](docs/runbooks/core-user-browser-deployment-v0.7.md)。

### 3. 启动本地 Gateway

```powershell
Set-Location .\poc
npm run start:user-browser
```

默认只监听 `http://127.0.0.1:43127`。另开终端检查服务：

```powershell
Set-Location .\poc
npm run check:user-browser
```

随后在 Gateway Console 创建一次性配对会话，在扩展控制页完成配对，并创建给上层应用的
最小权限 token。token 应只通过进程环境变量注入，不能写入命令行历史、日志或 Git。

### 4. 让上层应用调用

JS/Python SDK 和原始 API 都只使用版本化 Core 合同。先发现在线 binding：

```powershell
Set-Location .\poc
$env:COLLECTOR_SERVICE_ORIGIN = 'http://127.0.0.1:43127'
$env:COLLECTOR_SERVICE_TOKEN = 'cst_...'
npm run collector-user-browser-client -- bindings
```

请求只接受 `/v2/capabilities` 已登记的 capability；提交后得到 `operationId`，调用方再读取
Operation 直到终态，最后按返回的 Artifact 引用读取结果。完整请求、权限 scope、幂等和
错误处理见[本地 API 与扩展 runbook](docs/runbooks/user-owned-browser-extension.md)。

### 知乎官方 Provider 的独立路径

知乎官方站内搜索、热榜和开放平台全网搜索不需要浏览器扩展或知乎网页登录态。启动
Gateway 后，在 Console 的“知乎开放平台”卡片中配置知乎开放平台 Access Secret；能力目录的
`runtimeState` 变为 `ready` 后即可调用对应 capability。这个状态表示 Gateway 已配置凭证，
首次实际调用仍可能收到官方鉴权或额度错误。该凭证只属于 Gateway，不会进入扩展、SDK、Artifact、
审计或日志。

知乎 Access Secret 与给上层应用使用的 `cst_...` Local API Token 不同：前者用于 Gateway
访问 `developer.zhihu.com`，后者用于上层应用访问 SourceRelay。两条 Provider 路径互不
fallback；只用知乎时不需要安装或配对扩展。

## 开发与验证

SourceRelay 的测试分为“本地产品合同”和“真实平台证据”两条线：

```powershell
Set-Location .\poc
npm ci

# 单元、合同、真实本地 Chromium、Gateway E2E 与制品门禁
npm run verify:collector

# 生成版本化 Core release（不访问真实平台）
npm run package:core-release

# 验证发布 tarball / wheel 可以脱离源码安装
npm run verify:sdk-release-installation
```

`verify:collector` 只使用 test-scoped 状态和临时 Profile，不把 fake 页面或 fake Gateway 当成
平台证据。真实平台验证必须在本地、可见、低频、只读地执行，并为每一项 capability 保存
独立的 provenance；远程 CI 不访问平台。完整分层说明见[测试架构调研](docs/research/collector-test-architecture-and-frameworks-v0.1.md)。

## 安全边界

- 浏览器登录态只留在用户浏览器内；没有 Cookie 导入/导出/注入，也不接收密码、二维码或验证码。
- Gateway 只监听 loopback；上层应用使用可撤销、最小 scope 的本地 API token。
- Browser Provider 与 Official Provider 是两条独立执行面，不能互相 fallback。
- Operation 状态、终态原因、partial 覆盖范围和 outcome uncertainty 原样保留；未知结果不会自动重放。
- Artifact 采用 metadata-first、有界读取；不会向 Agent 暴露 Profile、浏览器身份、Core token 或任意本地文件路径。

## 仓库结构

```text
poc/collector-contracts/       versioned wire contracts
poc/collector-extension/       最小权限 MV3 extension
poc/collector-gateway/         loopback Local Service / control plane
poc/collector-browser-host/    隔离验证与本地生命周期测试
poc/collector-client/          JavaScript SDK
poc/collector-python-client/   Python SDK
docs/                          架构、runbook、设计与真实验证证据
skills/recon-live-web-interactions/
                               真实网页视觉、DOM、Network 侦察规范
```

知识包、跨平台汇总、OCR/ASR、媒体处理、CLI、研究控制台、模型 Provider 和 DeepResearch
不属于 Core。仓库中的 `apps/` 只服务 smoke、验证和开发，不是上层产品目录。

## 从哪里继续读

- [本地 API / 用户浏览器部署](docs/runbooks/user-owned-browser-extension.md)
- [版本化 Core release](docs/core-release.md)
- [Core release candidate 验证](docs/core-release-candidate.md)
- [分层架构与仓库边界](docs/design/layered-architecture-and-boundaries.md)
- [Collector 实现状态](docs/design/collector-implementation-status.md)
- [SourceRelay AgentKit](https://github.com/hc-tec/SourceRelay-AgentKit)

## 贡献与许可

贡献前请阅读 [AGENTS.md](AGENTS.md)、[CONTRIBUTING.md](CONTRIBUTING.md) 和
[SECURITY.md](SECURITY.md)。新 capability 必须先完成真实页面侦察、最小权限设计、合同注册和
对应验证，不能通过增加一个通用爬虫入口来绕过这些步骤。

SourceRelay 使用 [Apache License 2.0](LICENSE) 开源。
