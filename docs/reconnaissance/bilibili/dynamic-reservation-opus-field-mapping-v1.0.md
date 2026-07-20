# B 站账号动态预约 Opus：字段映射真实闭环 v1.0

- 日期：2026-07-20
- 目标：`https://space.bilibili.com/7481602/dynamic`
- Strategy：`bilibili.dynamic.account-feed.response-dom.v1 @ 1.0.0`
- 成熟度：`live authenticated canary`；仍为 `research_validation`，不是 production admission

## 1. 本轮只回答的问题

此前 Browser Host canary 的 12 张首屏卡中，只有第 4、10 张公开预约 Opus 卡未通过严格 DOM/response 互证。问题不是“Opus 链接能否放宽”，而是：页面实际展示的是哪一个公开 response 字段。

本轮只执行了证明该问题所需的最小动作：

1. 一次新的单页 canary，取得视觉、DOM 与精确 feed response；
2. 在内存中把预约 Opus 卡与固定公开候选字段比较；
3. 仅在三面证据成立后，增加一条预约卡专属文本候选；
4. 一次独立、同目标 retained tab 复用 canary 验证严格 gate。

没有滚动、筛选、评论、互动、刷新、重试、Cookie/Token/请求头读取或原始 response 落盘。

## 2. 字段来源研究

首次研究 canary：

```text
runId:      f8568458-06dd-4233-8539-90000be8fd88
artifactId: fd560af0-5fe6-4ee5-b060-5ad65476f034
state:      failed / dom_response_mismatch
```

三面事实：

| 证据面 | 事实 |
| --- | --- |
| Visual | 本地 ignored runtime 截图已保存；首屏 `scrollY=0` |
| DOM | 12 张可见卡；第 4、10 张均为 `opus + reservation` |
| Network | `GET /x/polymer/web-dynamic/v1/feed/space`，状态 `200`，12 条 response item |
| 同序关系 | response 12 / DOM 12，精确数量对齐 |

去敏字段诊断对两张预约卡得到相同结果：

```text
generic visibleText match      = false
generic majorTitle match       = false
matching public response path  = modules.module_dynamic.additional.reserve.title
```

诊断没有保存任何字段值、动态 ID、作者、可见正文、URL、query 或 response body。它只持久化卡片位置、类别、布尔结果和匹配字段路径。

这同时否定了两个错误修复方向：

- 不能把预约附加对象的唯一 DOM 链接当作 Opus 主身份；
- 不能降低“每卡必须有证据”的 strict gate。

## 3. 最小修复

只对 `card.reservation === true` 的卡片增加第三个文本候选：

```text
modules.module_dynamic.additional.reserve.title
```

普通 Opus 卡仍只使用既有正文与 major title 候选；视频/文章/直播的主链接规则、转发规则、受限占位规则和页面数量 gate 均未变化。

对应提交：

```text
685b2ba feat: diagnose reservation opus field mappings
4f06fb1 fix: match reservation opus titles on reservation cards
```

## 4. 独立真实 canary 验证

修复后 run：

```text
runId:      a5ebf186-511c-47c2-925a-2ecae38939fb
artifactId: 27e2092b-4597-4ee0-b6a4-0ac8c3811cf7
state:      partial / budget_exhausted
```

`partial` 只表示此 MVP 的单页预算已经用尽，而 response 仍声明后续页面；它不是字段映射失败。

| 严格检查 | 结果 |
| --- | ---: |
| response items / DOM cards | 12 / 12 |
| 同序 page cards | 12 / 12 |
| author | 12 / 12 |
| publication | 12 / 12 |
| access state | 12 / 12 |
| forwarded state | 12 / 12 |
| card evidence | 12 / 12 |
| 累计卡片数量 | 精确一致 |

动作与生命周期：

```text
navigation           = 1 / completed
scroll/filter/comment/interaction = 0
automatic retry      = 0
target tab selection = reused_matching_managed_tab
target page          = retained_after_run
post-run leases      = 0
post-run quarantine  = 0
account safety       = ready, no active run
```

视觉证据已保存到 ignored runtime；Browser Host、Chromium、Native Messaging 和精确 Extension binding 在 run 后保持运行。没有把浏览器的正常保留状态误报为泄漏或闪退。

## 5. 结论与 MVP 停止点

预约 Opus 卡的映射问题已经由真实 Visual + DOM + Network 证据定位并通过新的真实 canary 复核。B 站动态单页策略现在可以标记为 `live authenticated canary`，但仍只支持一页预算，仍为 `research_validation`。

本 MVP 在此停止：不立即实现第二页滚动、当前 document 复核模式、通用页面池策略或更多平台抽象。只有后续任务明确需要更多动态页、评论区或不同卡型时，才在新的窄可行性问题下继续扩展。

