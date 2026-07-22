# B站账号投稿目录：受管浏览器真实分页闭环 v0.2

- 日期：2026-07-22
- 状态：`completed` / 真实本地 canary；尚未 admission
- 页面角色：`account_video_inventory_pagination`
- 策略候选：`bilibili.account.video-inventory.pagination.dom.v2 @ 0.2.0`
- 目标：`space.bilibili.com/7481602/upload/video` 的直接数字页码第 1–7 页公开视频目录
- 运行时：`0.7.7`；本次覆盖了“复用仍停留在精确目标 URL 的受管页后，再次导航”的真实路径

> 文件名保留早期三页 canary 的历史名称。本页已更新为同日、独立的七页真实覆盖结果；早期三页结果仍是该能力的首次实网证据，不应被误写为全部覆盖。

## 结论

受管、可见、持久的 B站 Collection Profile 在一次独立 run 中成功采集目录第 1–7 页：共 **262** 个公开视频卡片、**262** 个唯一 BVID、**0** 个未解析卡片、**0** 个跨页重复。

这证明的是“声明页数预算内、直接数字页码的连续目录分页”，不是“该 UP 主所有投稿已经获取”。当前代码与实网都覆盖 `maxPages=1..7`；超过该范围的“下一页”/跳页语义、所有投稿穷尽性、排序和筛选仍是独立能力。

## 修复后复用路径

此前一次七页 canary 在复用保留精确目标页时，于首屏观察阶段报出 `document_context_changed`。根因不是 B站页码控件：旧页面的延迟 document-start 握手在预导航绑定后抢先写入旧 `documentId`，正常导航到新文档后，扩展正确拒绝了旧文档上下文。

`0.7.7` 将这变成受限协议能力：会立即导航的精确复用页必须请求 `next_navigation_only`；扩展保存并排除当前 main-frame `documentId`，只接受下一次导航产生的新文档。该模式不是任意脚本或任意文档访问能力，桥接契约只接受两个固定模式。

本次先用一个独立的单页引导 run 建立 `retained_for_review` 精确目标页，随后七页 run 显式报告 `targetTabSelection=reused_matching_managed_tab`，完整成功。因此它实证覆盖了上述修复，而不仅是新建 tab 的偶然成功。

## 最终 run 的三面证据

| 阶段 | 视觉 | DOM 投影 | Network metadata |
|---|---|---|---|
| 导航到第 1 页 | 运行期视觉证据已保存于 ignored local runtime | 40 张合规卡片 | 不读取 response body |
| 第 1 → 2 页 | 点击前后均有运行期视觉证据 | active 页切换至 2，40 张合规卡片，BVID 集合改变 | 语义匹配的 `GET /x/space/wbi/arc/search`，状态 `200` |
| 第 2 → 3 页 | 点击前后均有运行期视觉证据 | active 页切换至 3，40 张合规卡片，BVID 集合再次改变 | 同一路由，状态 `200` |
| 第 3 → 4 页 | 点击前后均有运行期视觉证据 | active 页切换至 4，40 张合规卡片，BVID 集合改变 | 同一路由，状态 `200` |
| 第 4 → 5 页 | 点击前后均有运行期视觉证据 | active 页切换至 5，40 张合规卡片，BVID 集合改变 | 同一路由，状态 `200` |
| 第 5 → 6 页 | 点击前后均有运行期视觉证据 | active 页切换至 6，40 张合规卡片，BVID 集合改变 | 同一路由，状态 `200` |
| 第 6 → 7 页 | 点击前后均有运行期视觉证据 | active 页切换至 7，22 张合规卡片，BVID 集合改变 | 同一路由，状态 `200` |

每次点击前 Browser Host 都重新读取目标页码的实时边界、`elementFromPoint` 命中与 hover 状态；实际输入由浏览器级鼠标完成。没有使用 `HTMLElement.click()`、content-script synthetic event、固定坐标、任意 selector 或任意 JavaScript 接口。

## 动作、覆盖和数据边界

```text
平台导航                         1 次，completed
可信相邻页码点击                 6 次（目标页 2–7 各 1 次），completed
每个语义动作尝试                 恰好 1 次
自动刷新 / 自动重试 / 重放       0 次
response body / header / query   0 次读取
Cookie / Token / 浏览器存储       0 次读取或导出
artifact                         manifest + page-001..007 JSON + SHA-256
```

| 页码 | 合规卡片数 | 未解析卡片 | 与上一页的 BVID 集合 |
|---:|---:|---:|---|
| 1 | 40 | 0 | 初始集合 |
| 2 | 40 | 0 | 已改变 |
| 3 | 40 | 0 | 已改变 |
| 4 | 40 | 0 | 已改变 |
| 5 | 40 | 0 | 已改变 |
| 6 | 40 | 0 | 已改变 |
| 7 | 22 | 0 | 已改变 |

artifact 只保存规范 MID、无 query 的公开视频 URL、BVID、标题、bounded visible text、公开封面引用、页数/覆盖/终态、动作账本和去敏视觉证据引用。运行截图、真实 Profile、网络原始材料与认证信息均留在 ignored local runtime，未进入 Git。

## 生命周期与失败语义

最终 target 使用当前 Browser Session 中精确匹配的受管 tab；run 结束后为 `retained_for_review`，活跃 lease 为 0。实测时页面池为 1 张受管保留页、0 张隔离页、0 个 extension page；账号安全状态为 `ready`。Browser Host 与 Collection Profile 有意保持运行，供后续视觉/DOM/Network 复核，不会因普通 run 完成而关闭。

本能力在以下任何条件下停止而非继续点击：登录失效、验证码、异常访问、限流、目录不可用、页码控件不满足前置条件、目标页未激活、目录 route 非成功状态、卡片集合未替换、跨页重复、document/context 改变或动作结果未知。`platform_action_outcome_unknown`、无效 Host 响应和 context 改变会同时触发账号安全锁定，不能由自动重试绕过。

## 当前非目标

- 超过直接数字页码第 7 页的下一页/跳页、所有视频穷尽性、恢复式全量归档、排序或筛选；
- 图文、音频、动态、合集、视频详情、字幕、弹幕或评论；
- response API 重放、签名参数、Cookie/Token、验证码或限流规避。
