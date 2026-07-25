# 用户自有浏览器扩展模式

- 状态：Accepted，待实现迁移
- 决策日期：2026-07-25
- 决策记录：[Grill 决策账本第 171 题](collector-grilling-decision-log.md)
- 替代的生产路径：[`managed-page-pool-browser-host-mvp.md`](managed-page-pool-browser-host-mvp.md) 中的受管 Browser Host / Collection Profile 路径
- 当前实现状态：仓库代码仍以 `profileId`、Browser Host 和 Playwright 持久 context 为中心；**它尚未实现本文定义的生产模式**。

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

本文定义的是正式产品流程；在代码完成迁移前，不能把当前受管 Browser Host 的启动命令伪装成下面的流程。

### 6.1 一次性安装

1. 用户在自己平时使用的 Chrome 或 Edge 安装已签名/稳定 ID 的 Collector 扩展；开发态可加载 unpacked 制品，但生产安装必须保证扩展 ID 稳定。
2. 用户启动本机 Local Collector Gateway 服务。Gateway 仅监听 `127.0.0.1`。
3. 用户打开扩展控制页，授予精确的 loopback 与平台 optional host permission，并用 Gateway Console 显示的一次性配对码完成配对。
4. 扩展生成或读取本地 `extensionInstanceId`，验证 Gateway 公钥指纹与签名后，保存配对授权于扩展自己的受限 storage；Gateway 创建 `browserBindingId`。

此过程不创建 Collection Profile，不复制登录态，不要求用户重新扫码登录，也不要求用户将日常浏览器交给 Playwright。

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

当前 MVP 的 API 使用：

```text
GET  /v1/collector-service/profiles
POST /v1/collect { profileId, platform, capability, input }
```

这只属于受管 Profile 测试通道。正式生产通道应一次性迁移为：

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
- 默认 `executionTarget` 是 `collector_work_tab`；
- `user_selected_tab` 只能消费用户刚刚从扩展 UI 显式建立的短期选择，缺失时返回 `user_selected_tab_required`，不能回退到任意浏览器 tab；
- `input` 依旧只能是 capability 注册的强类型输入。例如 B站详情可以接受规范 BV URL，搜索可以接受查询与已批准页数预算；不能把 URL、selector、脚本或鼠标坐标的权力下放给调用方；
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
2. **扩展生产控制面**：稳定 extension ID、loopback pairing、绑定状态、用户选定 tab、Collector 工作 tab 建立/复用/接管/外部终止；不启动任何浏览器进程。
3. **Gateway 服务面**：建立 browser-binding registry、认证 dispatch/evidence、账号安全按 binding/platform 归属；将 Local Collector Service 从 `profiles` 一次性改为 `browser-bindings`。
4. **能力迁移**：B站能力按现有固定 Strategy 迁到扩展主导的 DOM/网络观察与受限语义动作；Gateway 不再直接持有 Playwright Page。
5. **真实本地验证**：用临时 Chrome/Edge 安装模拟真实扩展安装、Gateway 配对、工作标签复用和故障停止；它是测试环境，不是生产 Browser Host。平台验证仍以真实页面、低频、只读、已授权的 run 为准，不能用 fake 页面或 fake Gateway 证明能力。
6. **删除生产旧路径**：删除服务 API 的 `profileId`、Browser Host 启动依赖和受管 Profile Console 面板；Browser Host 如果继续保留，移动到明确的 `test/isolated-account` 命令和文档，不与正式启动路径共用。

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

当前 `poc/collector-gateway/src/config.ts`、`browser-manager.ts`、`poc/collector-browser-host` 和扩展 Native Bridge 仍把 `profileId` / `browserSessionId` 作为核心键，并由 Playwright `chromium.launchPersistentContext()` 启动 Gateway 所拥有的目录。这是本文要替换的旧生产实现，而不是可直接给用户安装使用的日常浏览器方案。

在迁移完成前，任何运行手册都必须明确称它为“受管测试/隔离账号模式”。不得声称它已接入用户日常 Chrome/Edge，也不得让用户按当前 Browser Host 启动步骤去获得所谓“正常浏览器模式”。
