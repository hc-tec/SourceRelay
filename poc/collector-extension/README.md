# Personal Intelligence Collector Extension

这是个人情报产品的浏览器内采集底座。一个 Manifest V3 Collector Core 运行在用户自己的 Collection Browser Profile 中，根据已批准的研究计划进入平台页面、读取公开可见内容，并在后续阶段把证据交给本地 Gateway / Evidence Vault。

当前实现处于 **P0：决策契约与构建门禁**。它尚未宣称任何真实平台能力，也没有接入日常浏览器 Profile、登录态、本地 Gateway、加密 Vault 或 DeepResearch。

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

## P0 共享契约

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

## 策略成熟度

成熟度固定为：

```text
draft
  -> build_ready
  -> live_anonymous_verified | live_authenticated_verified
  -> suspended
```

当前注册表只有四个 `breadth_search + visible_dom` 静态策略骨架：B站、知乎、微博和小红书。它们是 `build_ready`，且 `liveValidation` 全部为空。

`build_ready` 只表示源码能够编译、生成 MV3 bundle、通过批准的 Manifest 权限清单并由受管理 Chromium 自动加载。它不表示平台页面可访问，不表示选择器仍有效，也不表示登录、翻页、详情、评论、账号归档或 response route 已经验证。

生产 response route 当前刻意为空，因此任务不会 arm 或注入 MAIN-world observer。在完成精确 route、页面可见字段投影、安全生命周期和用户控制环境中的真实验证前，不得加入任何生产 route。

## 构建门禁，不是平台测试

本项目不保留 fixture、离线平台样本、单元测试或 fixture E2E，也没有 test-branded 扩展。远程 CI 只能运行构建门禁，不得访问真实平台或任何登录状态。

`npm run verify:build` 只证明以下事实：

1. TypeScript 能够编译；
2. 生产 bundle 能够生成；
3. `manifest.json` 是 MV3，引用的脚本均存在；
4. API 权限、host permissions 和 content-script 范围与当前批准配置完全一致；
5. 制品拒绝 `<all_urls>`、通配 scheme / host、localhost、静态 MAIN-world 注入、高风险权限和测试入口；
6. Playwright 管理的临时空 Chromium Profile 能自动加载生产扩展并启动 MV3 service worker。

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

## 权限迁移边界

当前 P0 仍冻结并审查旧 POC 的精确平台 host 列表，以保证本轮不发生静默权限扩张。最终产品要求在启用具体策略时请求精确 `optional_host_permissions`；这需要和 Gateway 配对、策略启用、Collection Window 及 capability preflight 一起在 P1 完成，不能只改 Manifest 而留下无法执行或永久预授权的半套状态。

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

## 下一阶段

P1 将建立本地 Console / Gateway 配对、任务计划入口、专用 Collection Window、精确 optional host permission 和 capability preflight。之后才进入 B站 discovery → detail → bounded discussion 的真实纵向样板；其他平台能力继续按独立策略和真实验证记录推进。

完整产品决策见：

- [Collector 决策审计](../../docs/design/collector-decision-audit.md)
- [平台采集策略产品规格](../../docs/design/platform-strategy-product-spec.md)
- [1–100 题决策账本](../../docs/design/collector-grilling-decision-log.md)
