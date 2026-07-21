# B 站账号投稿目录第 2 页：受管浏览器真实闭环 v0.1

- 日期：2026-07-21
- 状态：completed / page_two_ready
- 平台与页面角色：B 站、账号投稿目录
- 验证范围：受管、可见、用户管理登录态 Profile 中，第 1 页到第 2 页的一次可信分页动作
- 设计依据：[账号投稿分页 MVP](../design/bilibili-account-video-pagination-mvp-v0.1.md)
- 匿名人类交互前置事实：[账号投稿分页侦察](../reconnaissance/bilibili/account-video-pagination-recon-v0.1.md)

## 1. 这次验证证明了什么

本记录只证明一个很窄的能力：在受管登录态中，账号投稿目录可以由 Browser Host 通过一次可信页码点击，从第 1 页切到第 2 页，并由视觉、固定 DOM 投影和去 query 的 Network metadata 三面共同证明数据已经替换。

~~~text
run state                         completed
terminal reason                   page_two_ready
第 2 页已渲染卡片                 40
未解析卡片                        0
第 1 页 / 第 2 页稳定 ID 集合      changed
页码 active                       1 -> 2
目标目录 route metadata           GET、成功状态
~~~

这不是“全量投稿采集”或“自动翻完所有页”的验证。

## 2. 动作与账号安全摘要

本次成功 run 的平台可观察动作严格有界：

| 动作 | 尝试次数 | 结果 |
| --- | ---: | --- |
| 导航到规范投稿目录 | 1 | completed |
| 第 2 页可信页码点击 | 1 | completed |
| 自动重试 / 刷新 / 重新导航 | 0 | 未发生 |
| response body 读取 | 0 | 未发生 |

Browser Host 在点击前读取实时目标边界、命中和 hover 状态；点击后将指针迁移到经审计的非媒体、非交互区域。点击前后都有 runtime 视觉证据，但截图和 Profile 运行材料仅保留在 ignored local runtime，不进入 Git。

终态后：

~~~text
Account Safety                    ready
active run                        none
active PageLease                  0
成功目标页                         retained_for_review
~~~

## 3. 三面完成条件

| 证据面 | 本次事实 |
| --- | --- |
| 视觉 | 点击前后均生成去敏 runtime 视觉证据；最终页面状态对应第 2 页。 |
| DOM | 页码由第 1 页 active 变为第 2 页 active；固定投影得到 40 张合规第 2 页卡片，且稳定 ID 集合与第 1 页不同。 |
| Network | 点击窗口内观察到语义匹配的目录 GET route 成功 metadata；未读取 request/response header、query、fragment 或 body。 |

因此，本次不是仅凭页码样式或单个 HTTP 状态宣称成功。

## 4. 本次暴露并修复的执行链缺口

成功之前，两个独立 run 如实以 failed artifact 终止，且没有自动重试：

1. 新建受管页在导航前处于 leased_pre_navigation；runner 错误要求它已经是 leased，导致导航前就误报 document context changed。修复后，初始 next-document Binding 可以接受导航前状态。
2. 第 2 页点击已证明不产生主文档导航，但 runner 错误地再次安装“等待下一文档”的 Binding，导致读取同一 document 时被拒绝。修复后，点击后的 DOM 读取复用导航前建立的同文档 Binding。

这两个问题属于 Gateway、Host、Extension 间的 document 生命周期组合契约，不属于 B 站反爬、登录或 Network 数据读取问题。它们也说明本地真实 Chromium 门禁需要补足“导航前绑定 -> 导航 -> 同文档交互 -> 重读”的纵向行为覆盖；该改进不能用 fake B 站页面冒充平台能力。

## 5. 明确没有证明的能力

- 第 3 页及以后、自动连续翻页、全量归档或穷尽性；
- 其他账号、未登录/匿名变体、不同窗口布局或长期页面稳定性；
- 视频详情、评论、字幕、媒体下载或 response body 投影；
- 任何 API 重放、Cookie/Token 使用、请求签名、验证码处理或限流规避。

后续能力必须单独建立 Dossier、预算、动作契约、真实验证记录和 admission；不得由本记录自动升级。
