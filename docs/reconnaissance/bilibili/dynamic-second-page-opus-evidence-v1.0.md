# B 站账号动态第二页：Opus 证据闭环 v1.0

- 日期：2026-07-20
- 结论：`partial`，但两页动态的可信滚动、response/DOM 累计对齐和逐项可用性分层均已证明
- 范围：账号动态公开列表的两页 MVP；不包含详情、评论、筛选、搜索、关注或任何写操作
- 目标：`https://space.bilibili.com/7481602/dynamic`
- Strategy candidate：`bilibili.dynamic.account-feed.response-dom.v1 / 1.2.0`（仅 `research_validation`，不可直接准入）
- Extension runtime：`0.7.3 / control-surface revision 7`
- 真实 run：`da05a5bf-051a-45a2-8b10-b2a545ff9aab`
- 去敏 artifact：`d39f84e4-e334-482b-94d3-3b925a72ae16`

## 结果

独立匿名基线显示页面身份可见，但动态列表受登录浮层阻断；没有点击登录或规避。随后在项目管理、已登录的 Collection Profile 上进行一次低频、只读产品闭环。MV3 只作精确 tab/document/run 的被动 DOM/XHR 观察，Browser Host 执行浏览器级可信输入。

| 证据 | 第一页 | 第二页 / 累计 |
| --- | ---: | ---: |
| 精确 feed response items | 12 | 12 / 24 |
| 可见 DOM 卡片 | 12 | 12 / 24 |
| 作者、发布时间、访问状态、转发状态 | 12 / 12 | 12 / 12 |
| card evidence strict gate | 12 / 12 | 11 / 12 |
| duplicate dynamic ID | 无 | 无 |

第二页第 3、11 张普通 Opus 分别由下列**已观测且白名单化**的 response 字段完成文本互证：

```text
modules.module_dynamic.additional.goods.head_text
modules.module_dynamic.additional.upower_lottery.title
```

第二页第 9 张普通 Opus 的 `domEvidence.cardEvidenceMatch` 为 `false`，因此被明确标为 `unresolved_card_evidence`。它的作者、发布时间、访问状态、转发状态、卡片顺序和累计数量都对齐，但没有安全的可持久化文本匹配、精确主 Opus 链接或稳定 dynamic-ID DOM 属性。没有猜测字段、放宽链接规则或把它伪装为已验证。

## 动作账本与安全结果

```text
导航：              1 次，completed
可信 wheel 滚动：    3 次，各 1200 CSS px，均 completed
筛选/点击/展开：     0
自动重试：           0
截图证据：           基线 1 份，滚动后 3 份（仅 runtime，不提交）
```

第三次可信滚动后出现第二条精确 `/x/polymer/web-dynamic/v1/feed/space` response；其页面高度由 4618 增至 4690，且第二页 12 项与累计 24 张 DOM 卡片严格对齐。

run 最终状态为：

```text
state:                           partial
terminalReason:                  dom_response_mismatch
errorCode:                       dynamic_second_card_evidence_partial
captured pages / items:          2 / 24
unresolvedCardEvidenceItemCount: 1
failedResponseEvidence:          null
completeWithinAccountFeed:       false
```

结束后账号安全状态为 `ready`，无活跃 run、无页面 lease；目标动态页按设计保留为 `retained_for_review`，未关闭浏览器、未新开重复页面、未触发验证码、限流或风险规避。

## 产品含义

当前 MVP 已经证明一条可复用的底层能力：同一受管页面上的真实导航、可信滚动、精确 route-bound XHR 观察和受限 DOM 投影可以组合为可审计的两页动态采集，而无需读取 Cookie、Token、请求头、query 值或保存原始 response。

它尚不意味着“所有 Opus 都已完全支持”。下一步应只针对第 9 张这类证据不足卡，先以视觉、DOM、Network 三面重新侦察真实人类流程；不得通过扩大 response 扫描、接受任意链接或自动重放滚动来追求表面完成率。
