# B站账号投稿目录：三页受管浏览器真实闭环 v0.2

- 日期：2026-07-22
- 状态：`completed` / 真实本地 canary；尚未 admission
- 页面角色：`account_video_inventory_pagination`
- 策略候选：`bilibili.account.video-inventory.pagination.dom.v2 @ 0.2.0`
- 目标：`space.bilibili.com/7481602/upload/video` 的第 1–3 页公开视频目录

## 结论

受管、可见、持久的 B站 Collection Profile 在一次独立 run 中成功采集目录第 1–3 页：共 120 个公开视频卡片、120 个唯一 BVID、0 个未解析卡片、0 个跨页重复。

这证明的是“声明页数预算内的连续目录分页”，不是“该 UP 主所有投稿已经获取”。代码允许直接数字页码的 `maxPages=1..7`，但本次实网证明只覆盖第 1–3 页；第 4–7 页以及任何“下一页”/跳页语义仍须独立 canary。

## 最终 run 的三面证据

| 阶段 | 视觉 | DOM 投影 | Network metadata |
|---|---|---|---|
| 导航到第 1 页 | 运行期视觉证据已保存于 ignored local runtime | 40 张合规卡片 | 不读取 response body |
| 第 1 → 2 页 | 点击前后均有运行期视觉证据 | active 页切换至 2，40 张合规卡片，BVID 集合改变 | `GET /x/space/wbi/arc/search`，成功状态 |
| 第 2 → 3 页 | 点击前后均有运行期视觉证据 | active 页切换至 3，40 张合规卡片，BVID 集合再次改变 | `GET /x/space/wbi/arc/search`，成功状态 |

每次点击前 Browser Host 重新读取目标页码的实时边界、`elementFromPoint` 命中与 hover 状态；实际输入由浏览器级鼠标完成。没有使用 `HTMLElement.click()`、content-script synthetic event、固定坐标、任意 selector 或任意 JS 接口。

## 动作与数据边界

```text
平台导航                         1 次，completed
可信页码点击                     2 次（目标页 2、3 各 1 次），completed
自动刷新 / 自动重试 / 重放       0 次
response body / header / query   0 次读取
Cookie / Token / 浏览器存储       0 次读取或导出
artifact                         manifest + page-001..003 JSON + SHA-256
```

artifact 只保存规范 MID、无 query 的公开视频 URL、BVID、标题、bounded visible text、公开封面引用、页数/覆盖/终态、动作账本和去敏视觉证据引用。运行截图、真实 Profile、网络原始材料与认证信息均留在 ignored local runtime，未进入 Git。

## 生命周期与失败语义

最终 target 使用新建的受管 tab，run 结束后 `retained_for_review`；浏览器和 Collection Profile 保持运行，活跃 lease 为 0。此前一张 document context 不确定的旧页被隔离为 `quarantined`，没有被下一次 run 复用。

本能力在以下任何条件下停止而非继续点击：登录失效、验证码、异常访问、限流、目录不可用、页码控件不满足前置条件、目标页未激活、目录 route 非成功状态、卡片集合未替换、跨页重复、document/context 改变或动作结果未知。`platform_action_outcome_unknown`、无效 Host 响应和 context 改变会同时触发账号安全锁定，不能由自动重试绕过。

## 当前非目标

- 第 4–7 页的实网 admission、超过直接数字页码范围的下一页/跳页；
- “所有视频”穷尽性、恢复式全量归档、排序或筛选；
- 图文、音频、动态、合集、视频详情、字幕、弹幕或评论；
- response API 重放、签名参数、Cookie/Token、验证码或限流规避。
