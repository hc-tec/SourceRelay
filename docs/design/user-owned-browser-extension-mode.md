# 用户自有浏览器扩展模式

- 状态：Accepted；Checkpoint B（签名工作项、扩展自有 work tab、`bilibili.video_detail`）、Checkpoint C（固定首页 `bilibili.native_search`）与 Checkpoint D（固定两页 `bilibili.native_search_batch`）均已真实 live canary 验证；其余能力/API 的一次性生产迁移待实现
- 决策日期：2026-07-25
- 决策记录：[Grill 决策账本第 171 题](collector-grilling-decision-log.md)
- 替代的生产路径：[`managed-page-pool-browser-host-mvp.md`](managed-page-pool-browser-host-mvp.md) 中的受管 Browser Host / Collection Profile 路径
- 当前实现状态：扩展可通过一次性配对码与 loopback Gateway 建立 `browserBindingId`，并可从 `/v2/collect` 接收签名的 `bilibili.video_detail`、`bilibili.native_search` 或 `bilibili.native_search_batch` work item，在扩展自己创建的工作标签页中完成受限导航和固定 DOM 投影。单页搜索固定为“综合 / 相关性 / 第 1 页”；batch 搜索固定为同一语义下的第 1、2 页，并且最多两次 URL 导航、零页面语义输入。两者都只输出可见规范 BV 视频卡片。`POST /v1/collect` 仍调用旧 `profileId` / Browser Host runner，属于明确隔离的测试通道，**不能作为 `/v2` 的 fallback**。

## 1. 一句话结论

正式产品运行在用户平时已经打开、已经登录、持续使用的 Chrome 或 Edge 中。用户安装 Collector 扩展，再将扩展与本机 Local Collector Gateway 配对；上层应用只调用本地 Gateway API。

```text
上层本地应用
    │  scoped Local Collector Service token
    ▼
Local Collector Gateway
    │  已登记能力、任务预算、账号安全、产物
    ▼
已配对的 Collector Extension
    │  仅在用户日常浏览器内执行受限能力
    ▼
用户原有浏览器会话、原有登录状态、用户选定或扩展创建的工作标签页
```

Collector 不创建、启动、关闭、复制、迁移或读取任何浏览器 Profile 目录。Chrome/Edge 自身当然仍可能有多个浏览器 Profile，但那是浏览器的内部和用户的选择，不是 Collector 的资源模型。

登录态不是 Collector 要“保存”的数据：它本来就已经由用户日常浏览器维护。扩展可以在该登录上下文中读取获准页面的 DOM、执行已登记的只读平台能力、观察获准的网络元数据，并把白名单化结果提交给本机 Gateway；它不能导出 Cookie、密码、Token、Storage 或 Profile 文件。

## 2. 先区分三种东西

| 名称 | 谁拥有 | 用途 | 正式生产路径是否使用 |
| --- | --- | --- | --- |
| 用户日常浏览器 | 用户 | 用户每天正常浏览、正常登录、正常使用的 Chrome/Edge | 是 |
| 浏览器 Profile | Chrome/Edge 与用户 | 浏览器内部保存登录态、扩展安装和偏好 | 只作为浏览器内部事实；Collector 不管理它 |
| Collector Browser Host / Collection Profile | Collector 开发与测试环境 | 隔离账号、可重复测试、真实页面侦察、无登录验证 | 否；只保留为测试/隔离账号通道 |

因此，“扩展安装在哪个 Chrome Profile”并不等于“Collector 管理了一个 Profile”。生产系统只认一个经过用户配对的扩展实例，不知道、也不需要知道它的 Profile 路径、用户名、Cookie 或登录凭据。

## 3. 生产边界

### 3.1 Gateway 可以做什么

- 保存 Gateway 身份、扩展配对记录、已登记能力、动作账本、账号安全状态和 raw-first 本地产物；
- 接收上层应用的最小权限本地 API 请求；
- 向已配对扩展分发短时、签名、一次性的 typed work item；
- 校验回传的能力、来源、预算、操作号和产物白名单；
- 在验证码、风控、限流、登录失效、断网结果未知、浏览器或标签页消失时停止本轮，不做自动平台动作重试。

### 3.2 Gateway 不可以做什么

- 启动、附着、关闭或复用用户日常浏览器进程；
- 创建、删除、迁移、复制或定位 Chrome/Edge Profile；
- 读取、写入、导出或注入 Cookie、密码、Token、Storage、书签或浏览历史；
- 接受任意 URL、CSS selector、JavaScript、鼠标坐标、CDP 命令或 Network request/response body；
- 枚举并接管用户所有普通标签页；
- 因运行失败反复刷新、重开页面、重放点击或借由日常浏览器规避验证码、频率限制、付费限制、反自动化或平台规则。

用户日常浏览器带来的价值是连续的、由用户自己维护的登录和可见交互环境；它不是规避平台安全措施的手段。

## 4. 正式身份模型：Binding，而不是 Profile

生产 API 删除 `profileId` 的语义，改为下列三个不同层级的标识。

```text
extensionInstanceId  ── 扩展首次安装后在 chrome.storage.local 生成
        │
        └── browserBindingId ── Gateway 配对后签发的本地不透明绑定 ID
                  │
                  └── tabLeaseId / workTabId ── 单次 run 的短时、仅扩展内部使用的标签页租约
```

- `extensionInstanceId`：区分同一扩展 ID 在不同用户浏览器安装中的实例；不包含任何登录身份。
- `browserBindingId`：上层服务选择哪一个已配对浏览器扩展实例时使用的稳定逻辑 ID；Gateway 只保存扩展 ID、实例 ID、协议/能力版本、配对状态和安全摘要。
- `tabLeaseId`：一次任务对一个标签页的临时独占权；不对上层 API 公开，浏览器重启、扩展重载、标签页关闭或用户接管后立即失效。

Gateway 不保存 tab 标题、完整 URL、浏览器窗口句柄、Profile 路径或账号凭据。必要的来源身份只能以能力声明中的规范目标摘要和短期运行元数据表示。

## 5. 标签页模型：不干扰日常使用，但仍可自动化

“使用日常浏览器”不等于“可以随意控制用户正在阅读的标签页”。正式模式同时支持两类经过边界约束的标签页。

### 5.1 用户选定标签页

用户在目标页面点击扩展按钮，明确选择“将当前页交给本次 Collector”。扩展只对这一个当前标签页建立短期 `tabLease`。

- 默认不自动导航、刷新、关闭、切换前台或复用该标签页；
- 只允许该 capability 已声明的只读观察和已批准的单次语义动作；
- 用户自行导航、关闭、点击接管或页面身份漂移，立即撤销 lease 并停止 run；
- 上层应用不能传 tab ID、窗口 ID 或任意 URL 来指定用户标签页。

它适合“我正在看这个视频/作者页，请你把评论、字幕或公开信息收集下来”这种场景。

### 5.2 扩展工作标签页（默认自动化路径）

对于“按需搜索”“收集某作者全部投稿”“批量读取一组已批准详情”等不应打断用户当前阅读的任务，扩展在用户的**同一日常浏览器会话**中创建一个可见的 Collector 工作标签页。它使用现有登录态，但标签页本身由扩展建立因果记录并持有。

- 只可导航到已登记 capability 产生的规范平台目标，不能接收任意 URL；
- 只复用扩展明确创建并仍满足身份核验的空闲工作标签页；绝不把普通用户标签页当作可复用资源；
- run 成功后进入可见的 `idle_reusable`，不“测完瞬间关浏览器/关标签”；
- 用户关闭、移动、导航或接管工作标签页时视为外部状态变化，停止该 run，不自动重开；
- 仅在用户从扩展控制页显式清理工作标签页、或用户明确要求关闭时关闭；
- 多标签并行只在扩展的工作标签池内发生，并仍受每平台/每账号动作预算和全局输入许可限制。

这使上层应用可以在不触碰用户正在使用的标签页的前提下发起自动任务，也避免旧 Browser Host 那种“刚打开就关掉、反复新开标签”的异常体验。

## 6. 安装、配对和日常启动

本文定义并对应正式产品流程。生产入口已经独立编译为 `user-browser-server.js`；它没有 Browser Host、受管浏览器注册表、Profile runner 或 Playwright 控制依赖。旧隔离通道另有 `isolated-browser-server.js`，只能从显式测试命令启动。

### 6.1 一次性安装

1. 用户运行 `npm run prepare:user-browser-deployment`，将生产 MV3 制品放入稳定的用户目录；再在自己平时使用的 Chrome 或 Edge 中一次性安装该目录。开发态可以加载 unpacked 制品，但安装目录必须保持不动，才能保持同一扩展实例与配对关系。
2. 用户运行 `npm run start:user-browser` 启动本机 Local Collector Gateway 服务。Gateway 仅监听 `127.0.0.1`，也不启动、附着、关闭或枚举任何浏览器进程。
3. 用户打开扩展控制页，授予精确的 loopback 与平台 optional host permission，并粘贴 Gateway Console 显示的身份指纹、一次性会话 ID 和八位配对码完成配对。
4. 扩展生成或读取本地 `extensionInstanceId`，验证 Gateway 公钥指纹与签名后，保存配对授权于扩展自己的受限 storage；Gateway 创建 `browserBindingId`。

此过程不创建 Collection Profile，不复制登录态，不要求用户重新扫码登录，也不要求用户将日常浏览器交给 Playwright。默认状态目录与稳定扩展目录都在 `%LOCALAPPDATA%\PersonalIntelligenceCollector`；状态中只有 Gateway 身份、配对、绑定安全、本地 client 和本地产物。

### 6.2 每天使用

1. 用户像平时一样打开 Chrome/Edge；浏览器自己恢复自己的会话和登录。
2. Gateway 按需运行；上层应用以本地 token 调用其稳定 API。
3. Gateway 只向已配对的 `browserBindingId` 发出已登记能力的短时工作项。
4. 扩展使用用户选定标签页或自己的可见工作标签页执行；结果以签名回传为 Gateway 本地产物。

浏览器、扩展、Gateway 三者任一个消失时，任务进入明确的停止或待用户恢复状态；不会隐藏地重启日常浏览器、重放输入或创建一串扩展/空白标签页。

## 6.3 真实人类输入的技术边界

扩展运行在用户日常浏览器中，能稳定做的是：读取获准页面 DOM、注册/撤销 content script、观察获准网络元数据、创建或导航它自己拥有的工作标签页，以及向 Gateway 回传白名单化证据。它**不能**通过 JavaScript 把 `element.click()`、合成 `MouseEvent` 或 `dispatchEvent()` 变成网页所见的 `isTrusted=true` 人类输入。

因此每个需要 hover、点击、展开评论、切换字幕或翻页的 capability 在上线前必须经过真实页面侦察，并明确选择一种已验证路径：

1. 平台接受扩展受限 DOM 语义动作，且前后置条件和风险停止都已真实验证；
2. 能用已登记的浏览器导航或页面本身公开状态完成，不需要伪造点击；
3. 在用户明确选定的标签页中提示用户完成这一个输入，扩展只观察随后出现的 DOM/XHR；
4. 标记为当前不可自动化，而不是用 selector 猜测、坐标点击、raw CDP、OS 鼠标注入或无限重试硬凑出来。

`chrome.debugger`、任意 CDP、全局键鼠注入和“伪装真实用户”的通用控制接口不进入正式模式。它们既扩大权限，又不能构成绕过平台安全机制的产品理由。过去 Browser Host 的可信输入研究结果只能帮助理解页面流程和设计可验证后置条件，不能成为接管日常浏览器的后门。

## 7. 上层 API 迁移

旧的隔离测试 API 使用：

```text
GET  /v1/collector-service/profiles
POST /v1/collect { profileId, platform, capability, input }
```

这只属于受管 Profile 测试通道。已实现的 direct-mode MVP 使用独立 versioned 生产通道：

```text
GET  /v2/collector-service/browser-bindings
POST /v2/collect
GET  /v2/collect/operations/{operationId}
GET  /v1/collect/artifacts/{capability}/{artifactId}
```

```json
{
  "schemaVersion": 2,
  "browserBindingId": "…",
  "platform": "bilibili",
  "capability": "bilibili.video_detail",
  "executionTarget": "collector_work_tab",
  "input": {
    "canonicalVideoUrl": "https://www.bilibili.com/video/BV…"
  }
}
```

`/v2` 当前承诺三条 direct capability：严格规范 BV URL 的 `bilibili.video_detail`，只接受关键词的固定首页 `bilibili.native_search`，以及同样只接受关键词、固定第 1、2 页的 `bilibili.native_search_batch`。它返回异步 `operationId`，由 `operations:read` 查询终态；它没有 `profileId` 兼容适配、双写或 fallback。所有已发布 capability 完成 direct migration 后，正式 API 才统一收敛为：

```text
GET  /v1/collector-service/browser-bindings
POST /v1/collect {
  schemaVersion: 2,
  browserBindingId,
  platform,
  capability,
  executionTarget: "collector_work_tab" | "user_selected_tab",
  input
}
```

规则如下：

- `browserBindingId` 只能引用已配对、在线、授权了目标平台、且未被账号安全锁定的扩展实例；
- 当前 `/v2` 只发布 `collector_work_tab`；它只复用扩展自己创建、当前 worker session 仍可证明所有权的 tab；
- `user_selected_tab` 仍是后续能力，届时只能消费用户刚刚从扩展 UI 显式建立的短期选择，缺失时返回 `user_selected_tab_required`，不能回退到任意浏览器 tab；
- `input` 依旧只能是 capability 注册的强类型输入。例如 B站详情可以接受规范 BV URL；两种 direct 搜索都只接受 `query`，单页能力固定第 1 页、batch 能力固定第 1/2 页，不能把 URL、页码、排序、selector、脚本或鼠标坐标的权力下放给调用方；
- `browserBindingId` 是服务选择目标扩展的标识，不是账号标识；若用户在浏览器中切换登录账号，平台策略必须在动作前用允许的公开可见身份证据重新核验，无法核验则阻断；
- 不提供 `profileId` 的兼容适配、双写或 fallback。受管 Profile API 留在显式 test/isolated lane，不与生产 API 混用。

Local API token 的最小权限、loopback 限制、审计、artifact retrieval 和不暴露任意浏览器控制面的原则继续保留。

## 8. 扩展与 Gateway 通讯

生产扩展直接与固定、已配对的 loopback Gateway 通讯。现有 ECDSA 身份、一次性配对码、扩展实例、nonce、短时 timestamp、body digest、HMAC 请求认证和 Gateway 签名 work item 都可复用；但它们的绑定主键必须从：

```text
profileId + browserSessionId
```

改为：

```text
extensionId + extensionInstanceId + browserBindingId
```

Native Messaging 若保留，只能作为本地唤醒/传输实现细节，不能再安装临时 native host 来控制 Browser Host、不能携带 Profile 路径、不能成为 Playwright 代理。优先路径是扩展的受认证 loopback 控制面；MV3 worker 被浏览器回收时，任务应通过安全的短轮询/显式用户触发恢复，不应借此重放平台动作。

## 9. 故障与安全语义

| 事件 | 必须发生的结果 | 禁止的行为 |
| --- | --- | --- |
| 用户关闭浏览器或扩展被停用 | 当前任务停止；已发输入按 outcome unknown 处理 | 自动重启浏览器或重放输入 |
| 用户关闭/导航绑定标签页 | lease 失效，run 停止或隔离 | 偷偷重开同一 URL 或把别的 tab 顶替 |
| 断网/弱网 | 结束当前 run；对已发动作保守处理 | 循环刷新、连续重试、重复点击 |
| 验证码、风控、限流、登录失效 | 平台/绑定进入明确风险或人工处理状态 | 绕过、代答、换账号、自动解锁 |
| 用户在普通 tab 中操作 | 用户优先，撤销或隔离该 tab lease | 阻止用户输入或继续自动输入 |
| Gateway 不在线 | 扩展显示离线，不进行新平台动作 | 离线缓存并稍后自行执行旧任务 |

所有真实平台动作继续遵守 account-safety、at-most-once、短 deadline、动作预算、已声明后置条件和证据白名单。切换到日常浏览器不会降低这些门槛。

## 10. 实施切换顺序

这是一次生产所有权模型切换，不是给旧 `profileId` 增加一个别名。

1. **合同与状态模型**：在 `collector-contracts` 增加 `ExtensionInstance`、`BrowserBinding`、`WorkTabLease` 和明确的 tab ownership state；删除生产路径中的 Profile 语义。
2. **扩展生产控制面**：已完成 loopback pairing、绑定状态、`collector_work_tab` 建立/复用/接管/外部终止，以及 MV3 恢复时的保守停止；不启动任何浏览器进程。`user_selected_tab` 尚未发布。
3. **Gateway 服务面**：已完成 browser-binding registry、认证 dispatch/result、binding/platform safety、`/v2` scoped local API、capability-bound artifact retrieval，以及独立的 direct-only server entry。生产 Console 只显示扩展配对、绑定安全、本地 API client 和去敏审计；`/v1` Profile 服务只存在于 isolated entry，direct entry 对它明确返回 `user_browser_legacy_route_not_available`。
4. **能力迁移**：已完成 B站 `video_detail`、固定首页 `native_search` 和固定两页 `native_search_batch` 的扩展主导 DOM direct path；两种搜索通过只读、签名 URL 导航和白名单卡片投影避免页面语义输入。评论、字幕、弹幕、有界投稿分页、筛选、账号页等必须各自完成真实三面侦察，不能复用这些 MVP 的“无需语义输入”结论。
5. **真实本地验证**：用临时 Chrome/Edge 安装模拟真实扩展安装、Gateway 配对、工作标签复用和故障停止；它是测试环境，不是生产 Browser Host。平台验证仍以真实页面、低频、只读、已授权的 run 为准，不能用 fake 页面或 fake Gateway 证明能力。
6. **隔离生产旧路径**：已从生产入口移除服务 API 的 `profileId`、Browser Host 启动依赖和受管 Profile Console 面板；Browser Host 保留在明确的 `start:isolated-browser` 测试/隔离账号命令中，不与正式启动路径、状态根目录或 Console 共用。

## 11. 验收标准

正式模式完成时必须同时满足：

1. 用户无需提供、导入或维护任何 Collector Profile，也无需重新登录；
2. Gateway 启动或任务执行不会启动、关闭或附着用户浏览器进程；
3. 上层 API 不再含 `profileId`，只可选择已配对 `browserBindingId` 和受限执行目标；
4. 扩展不读取或导出浏览器凭据，Gateway state 中不存在 Profile 路径、Cookie、Token 或密码；
5. 自动任务只使用扩展创建的工作标签页，用户标签页只有用户显式选定后才能被短期绑定；
6. 用户标签页和用户浏览器关闭/导航时不会触发自动重开、重试或 tab storm；
7. CAPTCHA、风控、限流、登录失效、断网和未知结果都可在 Gateway/扩展 UI 中看见明确停止原因；
8. 真实 E2E 验证通过安装的 MV3 扩展、真实本地 Gateway 和实际浏览器完成，且不依赖 fake 页面、fake XHR 或 fake Gateway 响应；
9. Browser Host 与受管 Profile 只在测试/隔离账号命令中可见，不能被生产 API、Console 默认入口或上层应用误调用。

## 12. 对当前代码的影响

2026-07-25 已完成第一个可运行检查点：

- Gateway Console 显示 Gateway 固定身份指纹，并创建五分钟、一次性的配对会话和八位配对码；它还可列出或撤销去敏 `browserBindingId`；
- 生产 MV3 扩展在控制页中请求唯一的 optional `http://127.0.0.1/*` 权限，验证 Gateway P-256 签名、配对码摘要与 HMAC 授权后，在扩展 storage 保存配对记录；
- Gateway 持久化的配对记录使用 `browserBindingId + extensionId + extensionInstanceId`，没有 Profile ID、磁盘路径、Cookie、Token、密码或账号身份；状态读取需要 timestamp、nonce、body digest 和 HMAC；
- 已用真实 Gateway 进程、真实生产扩展、真实 Chromium 原生权限对话和真实 loopback CORS/HMAC 请求完成自动本地 E2E；没有打开任何平台页，所有 HTTP 请求都限定在临时 `127.0.0.1` Gateway。

同日完成 Checkpoint B：Gateway 对 `bilibili.video_detail` 创建 60 秒、P-256 签名、一次 claim 的 typed work item；扩展对已配对 Gateway 做 HMAC/nonce poll，验证 work signature，在只由扩展创建的可见 work tab 中最多导航一次，固定投影首屏 DOM，并回传经 HMAC 认证的 bounded result。成功 tab 进入 `idle_reusable`；风险、未知、关闭、移动或接管会停止并移出复用池。工作项、binding safety 和 artifact 均不包含 Profile 路径、Cookie、Token、浏览器进程或 tab ID。

Checkpoint C 随后完成 `bilibili.native_search`：Gateway 只接受规范化关键词，自己派生短时签名的 `https://search.bilibili.com/all?keyword=…` 目标；结果类型固定为综合、排序固定为相关性、页码固定为 1。扩展不点击搜索、不滚动、不翻页、不调用签名站内接口，也不读取 response body；它只读取搜索页可见的规范 `www.bilibili.com/video/BV…` 卡片，排除直播、广告、课程及其他混合对象。终态 work ledger 和 artifact 不持久化原关键词或带关键词 URL，只保留 SHA-256 摘要。真实 live canary 已验证详情与搜索各一次导航、HMAC 回传、artifact retrieval 和 work-tab 留存；搜索页较慢的语义等价 URL 更新不会被误报为用户接管，但未知 URL、激活、移动和关闭仍会立即停止任务。

Checkpoint D（2026-07-27）完成 `bilibili.native_search_batch`：调用方同样只提供关键词，Gateway 固定派生并签名综合/相关性的第 1、2 页，扩展只在自己的同一个 work tab 中顺序导航这两个目标。该能力的硬边界是最多两次导航、零 DOM click/hover/scroll/filter/sort、零 response body、每页最多 12 张规范 BV 卡；第 1 页为空、风险、用户接管、文档身份漂移、未知导航或 deadline 到期都会停止，绝不创建无意义的第 2 页或重放已发导航。真实 canary 使用临时可见 Chromium、production MV3、direct-only Gateway 与真实 Testbench，得到 `search_batch_ready`、两页各一次 action、24 项受控投影、`responseBodies=not_read` 与 `semanticActions=0`。详见[验证记录](../validation/bilibili-native-search-batch-direct-canary-v0.1.md)。

该闭环已用临时真实 Gateway、生产 MV3 extension、真实 Chromium 原生 loopback permission、scoped local API token 和真实公开 B站详情页验证。页面级 HTTP redirect（规范 URL 到 trailing slash）被记作同一一次扩展导航；没有点击、刷新、字幕/评论操作、fake 页面、fake Gateway 或 Browser Host/Profile。`poc/collector-gateway/src/config.ts`、`browser-manager.ts`、`poc/collector-browser-host` 和其他 B站 runner 仍以 `profileId` / `browserSessionId` 为核心，留在明确测试通道，不能把它们误报为 direct-mode capability。

2026-07-26 已完成部署边界收束：

- 默认 `npm start` 与 `npm run start:user-browser` 都启动独立的 direct-only server；`npm run start:isolated-browser` 才会进入旧 Browser Host 测试通道；
- direct server 使用独立的用户状态根，启动前拒绝包含 `profiles/`、`browser-host/` 或 `browser-profiles.json` 的旧状态根，避免读取或混入隔离账号运行材料；
- direct server 的依赖图只包含 Gateway identity、配对、绑定安全、work queue、direct artifacts、本地 client/audit 和 MV3 loopback 路由；构建门禁会验证其产物不含 Browser Host runtime；
- 部署准备脚本将 unpacked MV3 制品复制到稳定路径，但不会自动安装、重载、打开或关闭 Chrome/Edge；这些浏览器可见动作仍由用户一次性完成；
- 真实本地集成验证已改为直接启动 `user-browser-server.js`、加载生产 MV3、完成原生 loopback 权限和配对，并断言 direct state 里没有旧隔离运行目录。

除 `bilibili.video_detail`、`bilibili.native_search` 和 `bilibili.native_search_batch` 之外，任何运行手册都必须明确称旧能力为“受管测试/隔离账号模式”。不得把 Browser Host 启动步骤写成日常 Chrome/Edge 安装步骤，也不得让 `/v2` API 退回旧 runner。
