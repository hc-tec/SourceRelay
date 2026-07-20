# B 站账号动态第二页：可信滚动 MVP 契约 v0.1

- 日期：2026-07-20
- 状态：已完成一次真实、只读两页闭环；第二页的逐卡证据采用 `verified / unresolved_card_evidence` 明确分层
- 目标页面：`https://space.bilibili.com/7481602/dynamic`

## 1. 本轮唯一要回答的问题

在同一个账号动态页中，人类进行最小、可信的向下滚动后，页面是否会新增一条公开的：

```text
GET https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space
```

如果会，新增 response 是否能与新增的动态卡片序列严格对应。

本问题不预设“一次 1200px 滚动一定足够”。先由真实页面证明实际触发阈值；每一个已计划的滚动语义动作最多执行一次，结果未知时立即停止而不重放。

## 2. 侦察与产品闭环必须分开

第一阶段是独立真实侦察：使用可见、独立的 Validation Profile，且不加载现有动态 Strategy、Gateway runner 或 content-script 交互逻辑。它必须并行记录：

1. Visual：滚动前后截图、视口、滚动位置与人眼可见的新增卡片；
2. DOM：卡片容器/卡片的实际结构、数量、实时位置和加载状态；
3. Network：导航基线与每一次滚动后的精确 feed route、状态、大小，以及只在内存中用于互证的公开字段。

若独立未登录页面无法形成正常动态流，才以项目管理的已登录 Collection Profile 进行一次被动扩展基线；仍不得调用现有平台 runner。

第二阶段才是产品闭环验证：Browser Host 负责导航、可信滚动和截图；MV3 仅绑定精确 tab/document/run 并观察白名单 response；Gateway 负责预算、账本、严格互证和 artifact。

## 3. 这次产品 MVP 的硬边界

```text
最大页数                         2
导航                              1 次
可信滚动                          按真实侦察确定的最小次数，逐次显式入账
筛选 / 排序 / 卡片点击 / 展开      0
评论区                            0
自动平台重试                      0
页面结果未知、风控、验证码、弱网    立即停止并隔离页面
结束页                            retained_for_review
```

不得借此引入：通用 cursor 引擎、任意 response 批量读取、任意 selector/JavaScript 输入、通用 review runner、或新的页面池 acquire mode。

## 4. 通过标准与诚实的 partial 语义

产品闭环只有同时满足下列事实才可标记为 `live authenticated canary`：

1. 同一精确 managed page 的第一次导航后获得首屏 feed response；
2. 每一次可信滚动都有动作前后滚动位置、一次浏览器级 mouse/wheel 输入和不可重放的 action ID；
3. 滚动后新增的第二个精确 feed response 能按时间顺序与第二批页面卡片对应；
4. 两页 response 的 stable dynamic ID 无重复；
5. DOM 累计卡片数精确等于两页 response 累计 item 数；
6. 每一张卡都记录既有作者、发布时间、访问状态、转发状态和卡片证据 strict gate；
7. 页面、文档、run 和 Extension binding 没有漂移；没有读取或持久化 Cookie、Token、query 值、请求头或原始 response。

当全部卡片的 strict gate 成立时，页可作为完整已验证页。若 response 已通过状态、页序、累计卡片数、作者、时间、访问状态和转发状态的互证，但少数卡片没有安全的文本或主身份依据，系统可以保存该 response 页为：

```text
run state:                        partial
terminal reason:                  dom_response_mismatch
artifact unresolved count:        N > 0
per-item domEvidence.cardEvidenceMatch: true | false
admissionEligible:                false
```

这不是放宽 strict gate，更不是把页面标为完成。`failedResponseEvidence` 仍只表示 response 状态或投影失败；有效但卡片证据不足的 `200` response 必须留在 artifact 中，供人工和后续研究复核。

`partial / budget_exhausted` 只表示两页预算用尽而源仍有下一页。它与 `partial / dom_response_mismatch` 都不能被下游误报为完整采集成功。

## 5. 停止条件

验证码、异常访问、限流、登录失效、断网、导航或滚动结果未知、document/page identity 变化，都会结束当前动作链。不会刷新、换代理、重复滚动或自动启动新的 tab。
