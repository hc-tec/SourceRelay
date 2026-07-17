# Personal Intelligence Collector Extension

这是个人情报产品的浏览器内采集底座。一个 Manifest V3 Collector Core 运行在用户自己的 Collection Browser Profile 中，根据已批准的研究计划进入平台页面、读取公开可见内容，并在后续阶段把证据交给本地 Gateway / Evidence Vault。

当前实现已完成 P0 / P1 控制面、受管 Profile、B站匿名 breadth 策略 admission，以及一次正式 B站 Research Task 的 dispatch → visible DOM → 认证 Evidence 回传 → 本地 batch → completed 闭环。加密 Vault、DeepResearch 和 B站详情 / 评论等独立深度策略尚未接入。

## 产品边界

目标架构是：

```text
Local Research Console / Gateway
  -> one MV3 Collector Core
  -> dedicated visible Collection Window
  -> persistent Collection Browser Profile
  -> platform-specific static strategy definitions
  -> encrypted local Evidence Vault
  -> sealed EvidencePackage
  -> DeepResearch / swarm analysis
```

浏览器 Profile 自然持有用户在平台上的正常登录状态。扩展不设计 Cookie 导入、导出或注入，不读取密码、Token、二维码、验证码、请求头、请求体、Profile 路径，也不复刻签名或模拟私有接口。

第三方平台爬虫仓库只能作为页面和产品调研参考，不能复制、集成、运行或成为采集后端。正式采集路线只允许在用户授权的真实浏览器页面中读取正常呈现的数据并执行有界只读动作。它不授权绕过登录、验证码、付费限制、限流或平台安全措施。

## P0 / P1 共享契约

[collection-contracts.ts](src/shared/collection-contracts.ts) 固定了后续 Console、Gateway、策略和 EvidencePackage 必须共同遵守的语言：

- 任务目标：`keyword_query`、`account_target`、`known_url`；
- 研究档案：`scout`、`evidence`、`deep_dive`、`discussion`、`account_archive`；
- 证据目标：广度搜索、详情、讨论样本、账号上下文、账号归档和趋势快照；
- 采集机制：原生导航、可见 DOM、有界交互、批准后的 response 投影、详情和评论导航；
- 任务预算：总预算与每个平台独立上限，未使用预算只能经显式批准后转移；
- 同意范围：动作类别、证据目标和所有范围升级都在任务级记录；
- 能力预检：权限、登录、用户动作、缺失选项、能力缺失和策略暂停均可见；
- 来源与终态：策略 ID / 版本 / 成熟度 / 真实验证记录和每个来源的独立结果必须保留。

证据目标与采集机制是两个正交维度。用户提出“归档某博主当前可见的所有笔记”并不自动授予无限滚动、评论、response observation 或原始媒体下载能力；这些动作仍受策略、预算和同意范围约束。

[control-plane.ts](src/shared/control-plane.ts) 进一步定义了 `EvidencePlan`、待批准与已批准计划、loopback Gateway 固定身份、一次性配对 challenge、带 nonce / 过期时间 / 计划摘要 / 签名的任务 envelope、浏览器重启后失效的 session stage lease，以及绑定 task / stage / lease / strategy 的正式 Evidence submission。当前 `build_ready` 策略在 preflight 中返回 `live_validation_required`，不能作为正式任务直接启动。

## 策略成熟度

成熟度固定为：

```text
draft
  -> build_ready
  -> live_anonymous_verified | live_authenticated_verified
  -> suspended
```

当前注册表包含四个 `breadth_search + visible_dom` 静态策略。B站 `bilibili.search.breadth.dom.v1 @ 1.1.0` 已在匿名、可见、用户控制的 Validation Profile 中验证首屏可见标题和规范 BV URL，成熟度为 `live_anonymous_verified`；知乎、微博和小红书仍是 `build_ready / liveValidation = null`。

`build_ready` 只表示源码能够编译、生成 MV3 bundle、通过批准的 Manifest 权限清单并由受管理 Chromium 自动加载。它不表示平台页面可访问，不表示选择器仍有效，也不表示登录、翻页、详情、评论、账号归档或 response route 已经验证。

生产 response route 当前刻意为空，因此任务不会 arm 或注入 MAIN-world observer。在完成精确 route、页面可见字段投影、安全生命周期和用户控制环境中的真实验证前，不得加入任何生产 route。

## 构建门禁，不是平台测试

本项目不保留 fixture、离线平台样本、单元测试或 fixture E2E，也没有 test-branded 扩展。远程 CI 只能运行构建门禁，不得访问真实平台或任何登录状态。

`npm run verify:build` 只证明以下事实：

1. TypeScript 能够编译；
2. 生产 bundle 能够生成；
3. `manifest.json` 是 MV3，引用的脚本均存在；
4. API 权限、host permissions 和 content-script 范围与当前批准配置完全一致；
5. 制品拒绝 `<all_urls>`、通配 scheme / host、`localhost`、未批准 loopback、静态 MAIN-world 注入、高风险权限和测试入口；唯一例外是显式配对所需的 optional `http://127.0.0.1/*`；
6. Playwright 管理的临时空 Chromium Profile 能自动加载生产扩展、启动 MV3 service worker 并打开内部状态控制页；
7. 新 Profile 没有任何已授予 optional host permission，也没有持久平台注册脚本。

自动加载门禁不会打开任何平台页面，不会使用 Chrome / Edge 日常 Profile，也不需要人工进入 `chrome://extensions`、扫码、登录或点击扩展。它使用临时目录，结束后自动删除。

前置条件是 Node.js 22+。首次使用先安装依赖和构建门禁专用 Chromium：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-extension
npm install
npm run setup:build-browser
npm run verify:build
```

浏览器已经安装时，日常只需：

```powershell
npm run verify:build
```

也可以分开执行：

```powershell
npm run typecheck
npm run build
npm run verify:artifacts
npm run verify:extension-load
```

生成物位于 `dist/`。

## 权限与任务页面边界

安装时 `host_permissions` 现在为空。B站、知乎、微博和小红书的八个精确 origin pattern 只列在 `optional_host_permissions`；用户在控制页首次启用某平台策略时，浏览器显示并请求该策略声明的精确范围。撤销后该策略的 preflight 重新回到 `permission_required`。

Manifest 不再静态声明任何平台 `content_scripts`，授予站点权限也不会把采集代码常驻注入该站所有用户页面。只有已配对 Gateway 提交、用户批准、preflight 为 `ready` 且拥有活动 stage lease 的专用 Collection Window 才允许对精确任务 tab 动态注入固定的 `content.js`。手工导航使 URL 摘要发生变化时，lease 标记为 `task_context_changed`，后续注入和结果接收停止。

扩展不申请 `cookies`、`debugger`、`downloads`、`webRequest`、`webRequestBlocking` 或 `<all_urls>`。MAIN-world observer 不是静态 content script；现阶段即使其安全底座被打包，也因为生产 route allowlist 为空而不能接纳平台响应。

## 真实平台验证

平台行为只允许在用户控制的本地 Validation Profile 中低频验证：

- 使用专用、可见的 Validation Browser，不接触用户日常 Profile；
- 严格只读，不点赞、关注、收藏、评论、私信、上传、订阅或发布；
- 需要登录时由用户在该浏览器上下文中自行完成，然后显式继续；
- 不索要或传递 Cookie、Token、密码、二维码、验证码、Profile 路径或代理凭据；
- 每项平台能力独立记录策略版本、匿名 / 登录类别、验证时间、覆盖和失败语义；
- 只有真实验证记录可以把策略升级为 `live_anonymous_verified` 或 `live_authenticated_verified`。

固定的用户配置浏览器代理可以作为 Profile 的正常网络环境；扩展不读取、管理或轮换代理。

## 当前控制面与下一阶段

点击扩展图标只打开 Collector 状态控制页，用于显式配对 / 撤销固定 Gateway、查看平台 maturity / permission 和活动 lease；它不直接采集当前 tab，也没有旧的快捷键采集入口。配对会核验一次性 Session、8 位配对码摘要、扩展 challenge、Gateway 公钥指纹、ECDSA P-256 签名和 pairing authorization 摘要；控制页、快照和日志不显示授权密钥。

Gateway 已建立 Collection / Validation Profile 生命周期：它从内部逻辑 ID 推导隔离目录，启动可见 Playwright Chromium，自动加载生产扩展，并让 Research Task 按平台绑定同平台 Collection Profile。扩展仍会在签名 task 入口复核绑定形状，拒绝 Validation、匿名、跨平台或伪造 Profile 绑定。

B站 `breadth_search + visible_dom` 的精确 `v1.1.0` 现在可以在 Profile、同意和精确 host permission 都满足时进入 `ready / formal`；其他三平台仍是 `live_validation_required / experimental`。正式结果先进入 `chrome.storage.local` 的待提交队列，只有通过配对 HMAC 提交、Gateway 校验租约 / 策略 / 来源 / 预算并确认本地 batch 后，lease 才标记 completed；相同 task / stage / result digest 重投不会生成第二个 batch。

该 admission 仍只覆盖匿名首屏搜索卡标题与 BV URL，不覆盖登录、翻页、详情或评论。下一检查点是为 B站 detail 和 bounded discussion 分别建立新策略、预算、页面动作与真实 admission，而不是扩大 breadth 策略的解释范围。

完整产品决策见：

- [Collector 决策审计](../../docs/design/collector-decision-audit.md)
- [平台采集策略产品规格](../../docs/design/platform-strategy-product-spec.md)
- [1–100 题决策账本](../../docs/design/collector-grilling-decision-log.md)
