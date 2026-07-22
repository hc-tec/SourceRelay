# B站十四类数据能力范围 v1

- 状态：Accepted implementation scope
- 日期：2026-07-20
- 产品边界：Collector Core 浏览器扩展、Gateway 受管浏览器控制层、持久 Collection Profile、本地 raw-first Evidence
- 验证规则：每类能力独立 reconnaissance、策略版本、真实平台验证、review 与 admission

## 1. 完整能力矩阵

“支持 B站”必须拆成以下十四类数据能力。任意一类成功都不能替代其他能力的验收。

| # | capability key | 主要对象 | 必需结果 | 默认边界 |
|---:|---|---|---|---|
| 1 | `native_search` | 平台内查询结果 | 查询、类型、筛选、排序、排名、分页、规范内容 ID/URL | 声明页数和结果预算 |
| 2 | `account_profile` | UP 主公开档案 | MID、规范主页、页面公开身份、简介、统计与公开字段快照 | 目标账号长期档案；不读取隐藏状态 |
| 3 | `account_inventory` | UP 主当前可遍历投稿目录 | 视频/图文/音频等目录、分页、去重、终点和恢复账本 | 先目录，详情另行物化 |
| 4 | `video_detail` | 单个视频 | BVID/AID/CID、标题、简介、作者、标签、统计、状态 | 已知 URL 或选中目录项 |
| 5 | `transcript` | 字幕/文字稿 | 轨道目录、语言、人工/AI 类别、时间轴与正文 | 不下载原始音视频 |
| 6 | `danmaku` | 视频时间轴弹幕 | 文本、视频时间点、公开属性、采样/完整性条件 | 明确时间和数量预算 |
| 7 | `discussion` | 评论与楼中楼 | 排序、根评论、回复树、分页、UP 主互动状态、覆盖 | 热门/最新与 root/reply 预算分开 |
| 8 | `dynamic` | 账号动态 | 正文、媒体引用、转发链、话题、提及、公开统计 | 不执行投票或互动 |
| 9 | `article` | 专栏/图文 | 标题、正文、图片引用、时间、作者、公开统计 | 正文与评论分阶段 |
| 10 | `collection_series` | 合集与系列 | 稳定 ID、标题、说明、条目顺序、目录覆盖 | 不以推荐卡代替合集关系 |
| 11 | `live_replay` | 直播间与公开回放 | 房间 ID、状态、标题、公告、时间、回放目录 | 实时弹幕另建有时长的任务 |
| 12 | `trend_snapshot` | 热榜、排行和热点 | 榜单角色、排名、条目、捕获时间和来源 | 只承诺时间点快照 |
| 13 | `relationship_snapshot` | 提及、合作、引用、推荐关系 | source/target、关系类型、页面语境、捕获时间 | 推荐关系不得冒充作者声明 |
| 14 | `provenance_coverage` | 所有能力的证据控制面 | strategy/version、来源、时间、页数、游标、去重、终止和哈希 | 每次任务强制存在 |

## 2. raw-first 与最小硬结构

平台字段不全部拆成关系数据库列。每个对象的安全 DOM 投影或精确 response 白名单投影可以按平台原结构保存，AI 在读取时解释。以下字段必须硬结构化，不能交给模型猜测：

```text
capability_key / object_type
stable_platform_id / canonical_url
parent_object_id / account_mid
captured_at / page_role / authentication_class
query / filter / sort / discovery_position
strategy_id / strategy_version
artifact_file / media_type / sha256
coverage / terminal_reason / status
```

“raw”不包含 Cookie、Token、请求头、请求体、签名参数、浏览器存储、隐藏页面状态或完整 HAR。response 中未在页面正常呈现的字段只能用于当次控制或被丢弃，不能因其存在就扩大长期档案。

## 3. 二进制媒体边界

默认保存规范媒体引用、封面/缩略图、公开说明、字幕和必要的本地截图。原始视频、音频、直播流、附件或批量关键帧只有在任务显式要求、预算允许且公开可正常访问时才进入独立媒体阶段。临时签名地址和需要认证重放的媒体请求不得成为长期证据。

## 4. B站核心完成条件

十四类能力只有在各自真实验证后才能显示为可用。B站核心纵向闭环至少要求：

1. `native_search` 支持声明的筛选、排序和多页覆盖；
2. `account_profile` 与 `account_inventory` 能在持久 Profile 中识别账号、分页、恢复和诚实终止；
3. `video_detail` 支持公开视频、多 P 与不可用状态；
4. `transcript` 区分可用、多语言、无字幕、登录门禁与异常状态；
5. `danmaku`、`discussion` 分别具有明确预算和覆盖；
6. `dynamic`、`article`、`collection_series`、`live_replay` 不被“视频可用”掩盖；
7. `trend_snapshot` 与 `relationship_snapshot` 明确时间点和算法语境；
8. 所有结果都包含 `provenance_coverage`、本地 artifact 和失败语义；
9. 构建门禁和当前策略版本的真实网站 E2E 均通过；fixture、假 XHR 或页面克隆不能计入完成度。

## 5. 2026-07-20 起始状态

| capability | 当前可证明状态 |
|---|---|
| `native_search` | 正式 admission 仅覆盖匿名首个渲染页、最多 20 条 |
| `video_detail` | `0.7.8` 已完成“完成的账号目录 artifact → 显式选中 BVID → 单条详情 artifact”的真实受管浏览器物化：来源 digest/页码、一次导航账本和子 artifact 已闭环。两个目录样本真实取得标题、可见元数据、播放器容器、标签与创作者（团队/标准作者布局），但无可投影简介；其中 `BV1BoKD6ZEir` 的目录卡明确标为“充电专属”，而未标该记号的样本也为空。匿名可见页面对照已直接证明该 BVID 的“专属视频 / 试看中 / 开通充电”播放器门禁；`0.7.9` 已把这个正向门禁事实建模为 `charge_exclusive_trial`，但受管登录 Profile 的新版 Extension 闭环尚待验证。未命中时只能是 `indeterminate`，空字段仍只能按 `present/absent` 解释，且 `playerVisible` 不等于可播放或已获受限内容。策略保持 `admissionEligible=false`；详情 response body、字幕、弹幕、评论和推荐继续排除。详见[目录到详情真实闭环](../validation/bilibili-account-video-detail-materialization-v0.1.md)与[详情 DOM 侦察](../reconnaissance/bilibili/video-detail-dom-mvp-v0.1.md)。 |
| `transcript` | 登录态真实闭环两次取得 509/509 段；仍 research-only |
| `discussion` | 已证明排序与楼中楼动作到 route 的因果；正文 projector 尚未 admission |
| `account_profile` | research-only Gateway runner 已真实保存稳定 MID、昵称、简介、头像、横幅、公开标识、8 个统计/导航字段、公告、充电区、代表作和 7 条 route metadata；artifact digest 与敏感字段扫描通过，正式 MV3 策略和多账号覆盖仍未 admission |
| `account_inventory` | 旧 research runner 已完成真实 9 页 / 330 条视频目录，逐页 DOM/response 身份摘要一致、跨页 0 重复、末页 10 条、manifest/page digest 可恢复。新增受管浏览器 DOM v0.2 已在真实登录 Profile 中完成直接数字页码第 1–7 页 / 262 条的连续可信分页闭环；页数为 40/40/40/40/40/40/22、跨页 0 重复、每次点击窗口内目录 route 均为成功状态。`0.7.7` 还在真实 exact-target tab 复用后重新导航的路径中验证了 document-binding 修复；全量穷尽性、恢复、排序/筛选和 admission 仍是独立缺口。详见[七页真实闭环](../validation/bilibili-account-video-pagination-three-page-v0.2.md)。 |
| `article` | research runner 已真实完成 1 页 / 1 条专栏目录与单篇详情：目录按 Opus ID 合并 DOM 双 anchor、`has_more=false` 诚实终止；详情从已验证目录 artifact 绑定账号，保存 1376 字、15 个保序块、4 个媒体引用、10 个标签和五类公开指标；多页 cursor、删除/锁定/外链样本、MV3 正式策略与 admission 仍未完成 |
| `collection_series` | research runner 已真实保存 11 个总览项和稳定 series ID；独立单系列 runner 又完成 5 页 / 129 条默认顺序全目录，页数为 30/30/30/30/9、DOM/response 全匹配、跨页 0 重复、artifact digest 与敏感字段扫描通过；planner 全系列遍历、season/边缘样本、MV3 正式策略与 admission 仍未完成 |
| 其余六类（含统一 coverage） | 未形成正式生产闭环 |

后续不得使用单一 `bilibili_supported=true`。Console 和 DeepResearch adapter 必须读取此矩阵中每项独立的 maturity、`last_verified_at`、登录类别、覆盖与缺口。
