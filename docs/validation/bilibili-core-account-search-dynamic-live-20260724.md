# B 站账号主链、动态与站内搜索真实闭环记录

- 日期：2026-07-24
- 目标账号：`https://space.bilibili.com/7481602`
- 运行方式：项目管理的可见 Chromium + Browser Host + 生产 MV3 + Gateway
- 扩展版本：`0.7.17` / control-surface revision `15`
- 结论：账号档案、投稿目录分页、显式详情物化、动态双页、站内搜索双页均完成真实本地 canary；策略仍保持 `admissionEligible=false`。

## 本轮结果

| 能力 | Profile | Run / batch | 结果 | 核心覆盖 |
|---|---|---|---|---|
| `account_profile` | `67f9abed-4d5a-4e2e-9043-74dfbeae83b0` | `e31f3658-8b82-4d2c-ab20-146921a908f2` / artifact `574e3f99-6e12-42af-85da-815f12d5e266` | `completed / profile_captured` | MID `7481602`、显示名、头像、横幅、8 个公开字段、公告、充电区 |
| `account_inventory` | `ee439ada-a7d7-436f-a898-e959004316ee` | `0979124e-acd5-4a6d-b7d4-e2b5fbd56ce2` / artifact `92c12ae6-7272-4523-bf13-f9ea3854a054` | `completed / requested_page_budget_reached` | 7 页、263 条、263 个唯一 BVID、0 重复、0 未解析卡片 |
| `video_detail`（目录显式选择） | `ee439ada-a7d7-436f-a898-e959004316ee` | batch run `af8f6b00-0468-43ca-bd6f-a860f6cf7ad9` / artifact `537b8f9f-3e6a-4101-b28e-f6cb3dca8a0e` | `completed / all_selected_details_materialized` | 从上游 artifact 选 1 个 `BV1ybKh6LENe`，详情子 artifact `ad317161-1cd4-4fdf-9fbe-125268db681b` |
| `dynamic` | `ee439ada-a7d7-436f-a898-e959004316ee` | `31315029-5566-4412-b5f6-1e5765cd6dc5` / artifact `b0982db1-7367-41b8-8898-2b23160103ce` | `partial / budget_exhausted` | 2 页、24 条、0 未解析；视频 7、图文 13、转发 4；公开 16、专属占位 8 |
| `native_search` | `f503901c-3940-4637-a8f8-9f96ec7f973c` | batch `eb30f7b2-b9e4-4b32-a5b7-c518dbf7c85d` / artifact `a70d69ef-2474-40d0-ab4b-04acae6a10ef` | `completed / search_batch_ready` | 中文查询“人工智能”按视频/最新发布，第 1–2 页各 20 条，合并 40 个唯一 BVID、0 重复 |

## 证据与边界

- 每个真实 run 的导航、滚动或分页动作均按语义 ID 最多尝试一次；没有自动重放未知平台动作。
- 账号档案、投稿目录和详情只使用页面公开 DOM；动态使用受限的 response 元数据与 DOM 同序互证，未保存原始 response body。
- 站内搜索请求体按 UTF-8 发送；artifact 只保存 query digest，不保存原始查询文本。结果标题可正常显示中文，未出现 `????`。
- 没有读取或导出 Cookie、Token、storage state、请求头、请求体、完整 HAR 或签名参数。
- 动态的 `budget_exhausted` 只代表本轮两页预算用尽，不代表账号动态已经遍历完；投稿目录的 7 页同理不代表全量投稿终点。
- 详情首屏的简介/选集等字段仍按 `present/absent` 诚实记录；一次详情成功不代表字幕、评论、弹幕、推荐或多 P 已完成。
- 当前所有策略均保持 `admissionEligible=false`，后续需要独立 review、多账号/布局漂移覆盖和恢复语义验证。

## 生命周期核对

- 4 个 Profile 的账号安全状态在本轮后均为 `ready`，活动租约为 0，隔离页为 0。
- 主登录 Profile 的既有保留页没有被关闭或劫持；新建的搜索 Profile 仅用于本地公开搜索 canary，页面保持保留供复核。
- 弹幕能力未在本轮扩展，现有 danmaku artifact 与代码保持不变。
