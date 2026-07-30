# 中文个人情报 Collector

这个仓库正在建设一个“需要时才启动”的本地个人情报系统。当前正式产品路线不是传统爬虫、私有 API 模拟器或提前囤积所有平台数据，而是：

```text
External Local Applications (revocable local API token)
  -> Local Collector Service API (registered capabilities only)
  -> paired MV3 Collector Core installed in the user's existing browser
  -> bounded DOM / trusted-input / Network observation in the selected tab
  -> operation and raw-first local artifact
```

宿主浏览器自然持有用户正常登录状态；Core 不创建、接管或复制生产 Profile。系统不设计 Cookie 导入、导出、注入或跨进程分发，不索要密码、Token、二维码、验证码、Profile 路径或代理凭据，也不授权绕过登录、付费限制、限流和平台安全措施。

## 当前产品组件

```text
poc/collector-contracts/   版本化 Core wire contracts
poc/collector-extension/  单一最小权限 MV3 Collector Core
poc/collector-gateway/    只监听 127.0.0.1 的本地 Collector Service / 控制面
poc/collector-browser-host/ 仅用于 Core 本地真实测试和受控生命周期验证
poc/collector-client/     JS SDK
poc/collector-python-client/ Python SDK
docs/design/              决策账本、产品规格、审计和实现状态
skills/recon-live-web-interactions/  真实网页人类视角交互侦察 Skill
```

## 开源仓库边界

本仓库是 Collector Core：负责 MV3 浏览器插件、必要的本地 Browser Host/Gateway、
Contracts、JS/Python SDK 以及经过真实验证的平台注册采集能力。它的交付物是受控的
operation、raw artifact 和稳定的 Local Collector Service API。

知识包编排、跨平台汇总、媒体处理、OCR/ASR、DeepResearch、CLI、研究控制台和其他
产品级上层应用不属于本仓库。未来这些内容应在仓库外的独立项目中实现，只通过版本化
API/OpenAPI/SDK 使用 Collector Core；当前仓库内的 `apps/` 仅用于 smoke、验证和开发，
不作为上层产品目录。

当前已经完成：

- P0 产品契约、生产 bundle、MV3 Manifest、权限和自动扩展加载门禁；
- 移除 fixture、test build、test driver、离线平台样本和 `fixture_verified`；
- `keyword_query` / `account_target` / `known_url`、研究档案、证据目标、预算、同意、终态和策略 provenance 契约；
- 安装时零 host permission；站点和 loopback Gateway 只通过精确 `optional_host_permissions` 显式授予；
- 不向普通用户页面常驻注册平台脚本，只允许有效 stage lease 的专用任务 tab 动态注入固定文件；
- Gateway ECDSA P-256 固定身份、一次性配对 Session、八位配对码、扩展 challenge、签名与 pairing authorization；
- 配对后的 HMAC 请求认证、nonce 防重放、Gateway 签名 work item、EvidencePlan preflight 和 Console 计划展示；
- 测试通道的临时 Profile、可见 Playwright Chromium 生命周期门禁和生产扩展自动加载；生产模式只绑定用户常用浏览器，不由 Core 创建或管理 Profile；
- 版本化 Local Collector Service API：外部应用只能调用已登记 capability，不能传任意 URL、selector、脚本、坐标或 Network route；`/v2/openapi.json` 发布机器可读 OpenAPI 3.1 与 capability input JSON Schema；
- `/v2/release` Core compatibility manifest：公开 user-owned-browser service schema、Extension/Browser Host/Native Bridge 协议版本和“上层应用必须在仓库外”的边界；JS/Python SDK 均可读取该 manifest；
- 可撤销 Local API token、显式最小权限 scope（Profile / collect / artifact）、去敏持久化调用审计，以及不持有浏览器控制权的独立本地 Reference Client；
- 测试任务与生产 user-owned-browser binding 分层；测试 Profile、任意磁盘路径和匿名 Profile 不能混入正式生产 API；
- 独立的短时 Validation Run、真实 Chrome 权限、终态恢复、字段白名单、人工 review 与显式源码 admission；
- B站匿名 `breadth_search + visible_dom` 的精确策略 `v1.1.0` 已完成真实验证；其他 `build_ready` 能力仍不能批准。

实现与风险矩阵见 [Collector 实现状态](docs/design/collector-implementation-status.md)。

## 当前平台能力真相

`/v2/capabilities` 是唯一的运行时能力真相：当前 catalog 共 18 项，其中 15 项
`direct_ready` 可以通过 `/v2/collect` 执行，3 项仍是 catalog-only/migration-required。
Gateway Registry、Artifact Reader、OpenAPI、JavaScript SDK 和 Python SDK 由
`npm run verify:core-capability-matrix` 强制保持同一组 15 项 direct capability。

当前直接能力覆盖 B 站公开详情、站内搜索、账号主页与投稿首屏、动态、合集/系列、
弹幕和用户已选评论页，以及小红书公开搜索、博主笔记列表、笔记详情、评论和评论回复。
字幕、B 站视频投稿翻页和小红书当前页网络元数据仍不会因为“存在旧实现”而自动开放。
第三方平台爬虫仓库只能作为页面与产品调研参考，不能复制、集成、执行或成为采集后端。

## 历史 POC 与正式产品隔离

以下目录保存早期数据源研究和可行性证据，不属于当前 Collector 产品运行时，也不进入
Core workspace、构建、发布候选或 SDK：

```text
poc/browserwing/
poc/maxun/
poc/intelligence-gateway/
```

它们曾用于验证公开页面、搜索、正文和平台限制，但其共享 Profile、传统连接器、私有接口候选或 crawler-style 执行方式不能直接接入当前浏览器扩展路线。旧能力声明和样本只表示当时的研究结果，不构成当前平台能力发布证明。

`poc/deepresearch-gateway/` 也是历史适配 POC，不是当前产品主线。未来任何分析系统都只能作为本地 Collector Service 的外部消费者；它们不拥有浏览器、Profile、Cookie、平台策略或直接的平台网络路径。

## 真实平台侦察方法

所有平台交互先遵循项目内 [真实网页交互侦察 Skill](skills/recon-live-web-interactions/SKILL.md)：暂时绕开待验证的扩展和已有 runner，以可见真实浏览器从人类视角理解页面，并行使用视觉、DOM 与 Network/XHR 建立动作因果；只有可信浏览器输入、页面后置条件和网络副作用被真实证明后，才允许把流程写入生产策略。

项目所有者已对本仓库范围内的低频真实平台侦察、能力验证和只读采集开发授予常设权限。代理不再逐次询问聊天授权；只有扫码、密码、验证码等必须由用户本人完成的身份动作才通知用户。该常设授权不删除产品面向最终用户的任务同意、预算和审计机制，也不授权导出浏览器凭据或绕过平台安全措施。

## 分层本地验证

从仓库根目录执行完整的 Collector 本地验证：

```powershell
Set-Location D:\AIProject\inteligence\poc
npm ci
npx playwright install chromium
npm run verify:collector
```

该入口按顺序运行：

```text
L1/L2  Vitest + fast-check：协议、扩展 URL/网络去敏、状态机、去敏/持久化、PageLease 与 Profile 边界
L3-I   @playwright/test integration：production dist、真实 Chromium、MV3、Native Messaging、Browser Host、worker 版本不匹配安全拒绝与多 Profile 隔离
L3-E   @playwright/test e2e-local：Gateway API -> Browser Host -> Chromium 的完整本地产品链路
L0/S   既有 typecheck、build、manifest、制品与研究合同门禁（支持性 regression spine）
```

需要定位某一层时，可以单独运行：

```powershell
npm run test:unit
npm run test:unit:coverage
npm run test:integration
npm run test:e2e:local
```

`verify:collector` 会先运行四层的正式测试项目；随后执行既有支持性验证脊柱，并跳过已由 Playwright 项目执行的 Chromium lane，避免打开第二套重复的临时浏览器会话。所有这些测试只使用 test-scoped 临时状态和 Profile，并要求零实网请求。Worker 版本不匹配的本地 Integration gate 还要求：没有注册 Managed Profile、没有安装 Native Messaging Host、没有写入 `profile_launched`，并且测试进程树归零；多 Profile gate 还要求两个真实 MV3 会话、Native Messaging 注册和 page lease 相互隔离，控制连接断开时两边 lease 都会被 quarantine 但浏览器保持，关闭其中一个也不会关闭另一个；Gateway E2E 进一步验证这些 Profile 穿过真实 HTTP API 和 Gateway 重启仍保持隔离。它们不代表任何平台策略已经通过；真实平台 Canary 仍遵循下节的低频、可见、受审计流程。完整分层和框架取舍见[测试架构调研](docs/research/collector-test-architecture-and-frameworks-v0.1.md)。

## 构建门禁

扩展：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-extension
npm install
npm run setup:build-browser
npm run verify:build
```

Gateway：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-gateway
npm install
npm run setup:browser
npm run verify:build
```

这些命令是构建门禁，不是平台能力测试。扩展门禁只检查 TypeScript、bundle、MV3、批准权限、引用制品、临时空 Profile 自动加载、零已授予 optional origin、零持久平台注册脚本和内部控制页加载；不会访问真实平台或登录状态。

平台行为不使用离线 fixture、单元测试或 fixture E2E 冒充验证。真实验证只能在本地、可见、项目管理的专用 Browser Profile 中低频、只读执行，远程 CI 不得访问平台；本地代理按上述常设权限自主推进，不再等待逐次聊天批准。

## 本地状态不进入 Git

根级和组件级 `.gitignore` 排除：

- `.env`、Cookie、Token、证书、密钥和凭据；
- 浏览器 Profile、截图、下载和原始运行材料；
- Gateway `runtime/` 身份、配对授权和任务运行状态；
- 数据库、日志、PID、缓存、虚拟环境和 `node_modules/`；
- 第三方源码 checkout。

Gateway identity 和 pairing authorization 是本机运行状态，不进入 Git。平台公开可见信息未来进入加密 Evidence Vault；页面公开联系方式不会被“去敏”误删，但认证材料、隐藏状态和未呈现 response 字段不得进入长期证据。

## 下一阶段

1. 已完成独立 Contracts、Browser Host、受管多页面池、PageLease、真实本地 Chromium 生命周期门禁和 B站采集 runner；
2. 将已有 runner 统一经由版本化的 Local Collector Service API 提供给其他本地应用；
3. 已为独立本地客户端补充 Console 签发、仅摘要持久化、可即时撤销的 Local API token，以及显式 scope 和去敏调用审计；不放宽 loopback、Profile 或平台安全边界；
4. 后续只按同一 API capability 模型逐个平台增加经过真实页面侦察验证的能力；不开放任意浏览器控制接口。

当前 Core 版本化发布与用户常用浏览器部署入口见：

- [Core 版本化发布](docs/core-release.md)
- [用户常用浏览器部署 runbook](docs/runbooks/core-user-browser-deployment-v0.7.md)
- [Core Release Candidate 验证](docs/core-release-candidate.md)

权威产品文档：

- [受管浏览器采集开发规范](docs/development/managed-browser-collection-development-standard-v0.1.md)
- [Collector 决策审计](docs/design/collector-decision-audit.md)
- [平台采集策略产品规格](docs/design/platform-strategy-product-spec.md)
- [Browser Host 与受管页面池 MVP](docs/design/managed-page-pool-browser-host-mvp.md)
- [1–170 题决策账本](docs/design/collector-grilling-decision-log.md)
- [Collector 实现状态](docs/design/collector-implementation-status.md)
