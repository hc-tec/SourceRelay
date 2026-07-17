# 中文个人情报 Collector

这个仓库正在建设一个“需要时才启动”的本地个人情报系统。当前正式产品路线不是传统爬虫、私有 API 模拟器或提前囤积所有平台数据，而是：

```text
Local Research Console / Collector Gateway
  -> paired MV3 Collector Core
  -> dedicated visible Collection Window
  -> persistent Collection Browser Profile
  -> static, versioned, live-validated platform strategies
  -> encrypted local Evidence Vault
  -> sealed EvidencePackage
  -> DeepResearch / swarm analysis
```

浏览器 Profile 自然持有用户正常登录状态。系统不设计 Cookie 导入、导出、注入或跨进程分发，不索要密码、Token、二维码、验证码、Profile 路径或代理凭据，也不授权绕过登录、付费限制、限流和平台安全措施。

## 当前产品组件

```text
poc/collector-extension/  单一最小权限 MV3 Collector Core
poc/collector-gateway/    只监听 127.0.0.1 的本地 Console / 控制面
docs/design/              1–100 题决策账本、产品规格、审计和实现状态
```

当前已经完成：

- P0 产品契约、生产 bundle、MV3 Manifest、权限和自动扩展加载门禁；
- 移除 fixture、test build、test driver、离线平台样本和 `fixture_verified`；
- `keyword_query` / `account_target` / `known_url`、研究档案、证据目标、预算、同意、终态和策略 provenance 契约；
- 安装时零 host permission；站点和 loopback Gateway 只通过精确 `optional_host_permissions` 显式授予；
- 不向普通用户页面常驻注册平台脚本，只允许有效 stage lease 的专用任务 tab 动态注入固定文件；
- Gateway ECDSA P-256 固定身份、一次性配对 Session、八位配对码、扩展 challenge、签名与 pairing authorization；
- 配对后的 HMAC 请求认证、nonce 防重放、Gateway 签名 work item、EvidencePlan preflight 和 Console 计划展示；
- Gateway 管理的持久 Collection / Validation Profile、可见 Playwright Chromium 启动器、生产扩展自动加载、运行状态与逻辑账号绑定；
- Research Task 按平台绑定同平台 Collection Profile；Validation Profile、任意磁盘路径和匿名 Profile 不能混入正式采集任务；
- 独立的短时 Validation Run、真实 Chrome 权限、终态恢复、字段白名单、人工 review 与显式源码 admission；
- B站匿名 `breadth_search + visible_dom` 的精确策略 `v1.1.0` 已完成真实验证；其他 `build_ready` 能力仍不能批准。

实现与风险矩阵见 [Collector 实现状态](docs/design/collector-implementation-status.md)。

## 当前平台能力真相

注册表里存在 B站、知乎、微博和小红书的 `breadth_search + visible_dom` 策略。目前只有 B站的精确版本通过真实验证：

```text
B站 bilibili.search.breadth.dom.v1 @ 1.1.0
  maturity = live_anonymous_verified
  liveValidation.recordId = bb91e996-7758-4447-ba94-486bc99b7872

知乎 / 微博 / 小红书
  maturity = build_ready
  liveValidation = null

所有平台 production response routes = []
```

B站 admission 只覆盖匿名关键词搜索、首个渲染页面、最多 20 条可见视频标题和规范 BV URL；不覆盖登录、翻页、穷尽排序、详情、评论、账号归档或 response observation。脱敏 admission 记录见 [B站 v1.1.0 验证记录](docs/validation/bilibili-search-breadth-dom-v1.1.0.json)。`build_ready` 仍只表示代码能编译、打包、满足批准权限清单并自动加载。

生产 response route 当前为空，因此不会 arm 或注入 MAIN-world observer。第三方平台爬虫仓库只能作为页面与产品调研参考，不能复制、集成、执行或成为采集后端。

## 历史 POC 与正式产品隔离

以下目录保存早期数据源研究和可行性证据，不属于当前 Collector 产品运行时：

```text
poc/browserwing/
poc/maxun/
poc/intelligence-gateway/
```

它们曾用于验证公开页面、搜索、正文和平台限制，但其共享 Profile、传统连接器、私有接口候选或 crawler-style 执行方式不能直接接入当前浏览器扩展路线。旧能力声明和样本只表示当时的研究结果，不构成当前平台能力发布证明。

`poc/deepresearch-gateway/` 也是历史适配 POC。DeerFlow、天工式系统或其他蜂群框架未来只能通过稳定 EvidencePackage / Coverage / Citation / CollectionGapRequest 边界接入；框架自带搜索器默认禁用，`.env` 搜索凭据只归本地 Gateway / Search Adapter，分析 Agent 不拥有浏览器和平台策略。

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

平台行为不使用离线 fixture、单元测试或 fixture E2E 冒充验证。真实验证只能在本地、可见、用户控制的 Validation Browser 中低频、只读执行，远程 CI 不得访问平台。

## 本地状态不进入 Git

根级和组件级 `.gitignore` 排除：

- `.env`、Cookie、Token、证书、密钥和凭据；
- 浏览器 Profile、截图、下载和原始运行材料；
- Gateway `runtime/` 身份、配对授权和任务运行状态；
- 数据库、日志、PID、缓存、虚拟环境和 `node_modules/`；
- 第三方源码 checkout。

Gateway identity 和 pairing authorization 是本机运行状态，不进入 Git。平台公开可见信息未来进入加密 Evidence Vault；页面公开联系方式不会被“去敏”误删，但认证材料、隐藏状态和未呈现 response 字段不得进入长期证据。

## 下一阶段

1. 用已 admitted 的 B站 discovery 完成一次配对 Gateway → preflight → 批准 → Collection Window 正式控制链验证；
2. 推进 B站 `detail -> bounded discussion`，每项能力继续独立验证和 admission；
3. 随后推进小红书登录态 `account identity -> visible inventory -> resumable archive -> selected detail`；
4. 建设加密 Vault、不可变批次、coverage ledger、hash manifest 和 Evidence Explorer；
5. 最后通过 EvidencePackage 接入 DeepResearch / 蜂群分析。

权威产品文档：

- [Collector 决策审计](docs/design/collector-decision-audit.md)
- [平台采集策略产品规格](docs/design/platform-strategy-product-spec.md)
- [1–100 题决策账本](docs/design/collector-grilling-decision-log.md)
- [Collector 实现状态](docs/design/collector-implementation-status.md)
