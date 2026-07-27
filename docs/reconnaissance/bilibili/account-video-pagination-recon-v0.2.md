# B 站 UP 主投稿目录分页：真实交互侦察 v0.2

- 日期：2026-07-27
- 状态：**人类流程已证明；日常浏览器 direct 实现尚未获准**
- 目标角色：`account_video_inventory.pagination`
- 目标标识：`public-account-video-inventory-redacted`
- 数据边界：本文不保存帐号 ID、昵称、视频标题、视频 URL、BVID、截图、Cookie、Token、Storage、请求 query/header/body 或 response body。

> 本文新增记录一个独立、已登录隔离验证 Profile 中的真实人类流程。它取代 [v0.1](account-video-pagination-recon-v0.1.md) 对“已登录环境是否能够完成第 1 页到第 2 页数据替换”的不确定判断；不改写该文档中匿名环境的 `partial` 事实。

## 1. 唯一可行性问题与结论

问题：在公开的 UP 主投稿视频目录中，已登录用户能否通过真实浏览器输入，从第 1 页进入第 2 页，并同时以视觉、DOM 和 Network 元数据证明内容确实替换？

结论：`proved`。

这只证明真实浏览器中的人类流程，**不**证明 MV3 content script 可以代替人类完成点击，也不授权复用旧 Browser Host、Playwright、CDP 或全局鼠标控制来接管用户日常浏览器。

```yaml
runId: bilibili-account-video-pagination-20260727-run-4
platform: bilibili
targetRole: account
targetIdentity: public-account-video-inventory-redacted
browserMode: visible persistent isolated validation profile
browserLifecycle: temporary_recon
authenticated: true
extensionInteractionLoaded: false
existingPlatformRunnerUsed: false
navigationCount: 1
outcome: proved
```

## 2. 基线与观察时间线

先启动 Network 观察，再提交一次公开账号投稿页导航。页面稳定后，视觉、DOM 与页面公开统计同时成立：

- 页面显示公共视频总数 `263`；
- 第 1 页有 `40` 张稳定可见的视频卡片；
- 诊断性 DOM 计数为 `/video/` 路径 `81`、BVID 型链接 `80`；这些是页面 DOM 结构计数，不是对卡片内容的长期保存；
- 第 1 页为 active，数字第 2 页与“下一页”控件存在；
- 未见登录弹窗、验证码、安全验证、限流或源页面不可用信号。

| phase | 来源 | 事实 |
| --- | --- | --- |
| `browser_started` | browser | 使用独立、可见、持久的隔离验证 Profile；未加载待验证的扩展交互逻辑。 |
| `network_observer_attached` | network | 在导航前开始仅记录去 query/hash 的 route、method、status 和 MIME。 |
| `baseline_visible` | visual + DOM | 第 1 页内容稳定，40 张卡片存在，第 2 页尚未 active。 |
| `control_revealed` | visual + DOM | 一次滚动后，第 2 页控件位于当前视窗内且未被选中。 |
| `action_attempted` | browser | 仅一次浏览器级鼠标移动和 click。 |
| `visual_postcondition` | visual | 页面回到顶部，第 2 页成为可见 active 页。 |
| `dom_postcondition` | DOM | active 页从 `1` 变为 `2`，稳定卡片身份摘要发生变化。 |
| `network_postcondition` | network | 动作后出现语义匹配的目录请求增量，`GET /x/space/wbi/arc/search` 返回 `200 application/json`。 |
| `cleanup_verified` | local | 临时侦察 context 已关闭；运行材料只留在 ignored runtime，未进入 Git。 |

## 3. 动作账本

所有输入均为浏览器级真实输入；没有使用 `HTMLElement.click()`、`dispatchEvent`、内容脚本 synthetic event、刷新、重试或第二次点击。

| actionId | 前置条件 | 输入 | attempted / attempts | 结果 |
| --- | --- | --- | --- | --- |
| `open_account_video_inventory` | 新建侦察页面 | 一次导航 | `true / 1` | 完成，第 1 页稳定。 |
| `reveal_pagination` | 内容与第 2 页控件已发现 | 一次可信浏览器滚动 `2000px` | `true / 1` | 完成，`scrollY=2000`，数字第 2 页位于 `y=631` 的当前视窗内，仍非 active。 |
| `open_account_video_inventory_page_2` | 第 1 页 active；第 2 页可见、未 active、未禁用 | 鼠标移动至实时中心后一次 click | `true / 1` | 完成，页面复位到顶部，内容实际替换。 |

每个语义平台动作恰好一次。动作后未出现验证码、异常访问、限流、登录阻断或页面不可用信号。

## 4. 三面后置条件

### 视觉

点击前，分页条中的数字第 2 页处于当前视窗；点击后页面回到顶部，数字第 2 页呈 active 状态，视频卡片区域显示不同内容。未将截图或帐户可识别内容纳入长期文档。

### DOM

点击前：

```text
viewport                 1280 × 720 CSS px
scrollY                  2000
activePage               1
visibleVideoCards        40
page 2 visible           true
page 2 active            false
page 2 y                 631 CSS px
card digest              df65458161d2eb8b6792d61eee2e06bcd5f5b2ca1aeb962d68417754f38d56b6
```

点击并等待内容 settle 后：

```text
scrollY                  0
activePage               2
visibleVideoCards        40
page 2 active            true
card digest              0770188707c74758272929e1b60367e43ec05e3742a378d11dad7eabca87881a
```

两个摘要不同，且 active 状态真实改变。因此结论不是“只有 CSS 被改成第 2 页”，而是页面卡片集合完成了替换。

### Network

只记录 metadata，未读取响应正文。点击后的新增、语义匹配记录为：

```text
phase                    after_open_account_video_inventory_page_2
method                   GET
origin                   https://api.bilibili.com
path                     /x/space/wbi/arc/search
status                   200
mime                     application/json
causalAssessment         confirmed
```

它满足“动作后新增、route 语义匹配、页面卡片摘要与 active 页同时变化”的条件。该观察**不是**读取或接入该 API 的许可，也不能用于猜测 query、签名或翻页参数。

## 5. 前驱 run 的如实记录

本次结论来自独立的 run-4；前三次并未被重试掩盖：

| run | 已执行的最大动作 | 结果 | 原因 |
| --- | --- | --- | --- |
| run-1 | 一次 `1100px` 可信滚动 | `partial` | 分页器仍在视窗外，未点击。 |
| run-2 | 新 run 的一次 `2000px` 滚动与一次 click | `partial` | 第 2 页 active，但旧观察器在内容 settle 前采样，不能证明卡片替换。 |
| run-3 | 仅导航 | `stopped` | 旧摘要采样早于分页节点和卡片完成挂载；未滚动、未点击。 |
| run-4 | 一次导航、一次 `2000px` 滚动、一次可信 click | `proved` | 等待稳定卡片、控件可见、点击后卡片摘要变化和语义匹配 Network 增量均成立。 |

这说明产品完成条件不能只检查 active CSS，也不能写成“随便滚一次后点击”。

## 6. 对 direct 产品设计的约束

当前能力 `bilibili.account_inventory.pagination` 仍保持：

```text
direct_migration_required
```

理由不是网页流程不可行，而是 direct mode 的控制边界不同：

1. `element.click()`、合成 `MouseEvent` 和 content-script synthetic input 不能被视为可信人类输入。
2. 日常浏览器 direct Gateway 不得用 Browser Host、Playwright、CDP 或全局鼠标控制接管用户正在使用的浏览器；扩展也不申请 `chrome.debugger` 权限。
3. 这次 click 后只观察到目录 XHR metadata，尚未证明存在可由 Gateway 固定派生、签名并安全导航的第 2 页规范 document URL。

下一步的窄问题是：**第 2 页是否存在可证明的规范 document URL。**

- 若存在，Gateway 才可固定派生并签名 URL，在 extension-owned work tab 直接导航，再用受控 DOM 投影复核。
- 若不存在，必须等待 `user_selected_tab` 的用户真实点击观察模式；扩展只观察后续 DOM/XHR，不伪造点击。
- 两者均未证明前，禁止把旧可信 click 路径作为日常浏览器 fallback。

## 7. 清理与复核

本轮临时 Playwright context 在 `finally` 中关闭；没有保留页面、CDP 端口或临时 Gateway。侦察脚本、状态 JSON、截图和日志仅为短期运行材料，已在本文完成去敏证据固化后删除。隔离 validation Profile 不是本轮 run 的泄漏，按产品生命周期交还受管验证浏览器；用户日常浏览器及其登录状态未被读取、复制、关闭或改变。
