# B站十四类数据能力范围 v1

- 状态：Accepted implementation scope
- 日期：2026-07-22
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

## 5. 2026-07-20 起始状态（历史基线）

| capability | 当前可证明状态 |
|---|---|
| `native_search` | 历史 v1 曾完成匿名首个渲染页、最多 20 条的 admission；当前编译路径为 `bilibili.search.breadth.dom.v2`，已收敛为综合相关性或视频相关性/最新发布、页码 1–2、每次一页最多 20 条的本地契约与 production MV3 DOM 投影。2026-07-23 以 UTF-8 中文关键词“人工智能”真实完成视频/最新发布第 1 页和第 2 页（各 20 条）以及综合/相关性第 1 页（20 条）；登录浮层存在时仍能读取公开结果。独立 page 1/page 2 run 曾出现 5 个重复 BVID；随后新增的有界 batch runner 在同一任务内顺序采集两页，真实保存 40 条 unique、`duplicateCount=0`、`state=completed`、`terminalReason=search_batch_ready`，并真实验证空结果的 `search_batch_empty` page 1 终止。必须同时保留这些事实：batch 去重和空态终止已真实运行，但实时结果漂移使重复比例仍需长期 coverage。v1 的实证不会自动覆盖 v2，故当前 v2 仍为 `build_ready`，待跨任务漂移/重复比例、恢复语义与独立 review 后再决定 admission。详见[原生搜索 DOM v2 真实闭环](../validation/bilibili-native-search-dom-v2.0.0.md)。 |
| `video_detail` | `0.7.8` 已完成“完成的账号目录 artifact → 显式选中 BVID → 单条详情 artifact”的真实受管浏览器物化：来源 digest/页码、一次导航账本和子 artifact 已闭环。两个目录样本真实取得标题、可见元数据、播放器容器、标签与创作者（团队/标准作者布局），但无可投影简介；其中 `BV1BoKD6ZEir` 的目录卡明确标为“充电专属”，而未标该记号的样本也为空。匿名可见页面对照已直接证明该 BVID 的“专属视频 / 试看中 / 开通充电”播放器门禁；`0.7.11` 已把这个正向门禁事实建模为 `charge_exclusive_trial`。详情首屏完成只要求稳定 document、规范 BVID、可见标题和可见播放器；播放器控制条属于字幕/播放等独立交互能力，不得阻塞零交互元数据投影。`0.7.13` 的正常公开视频 canary 已证明 document binding 仍存在但被错误的控制条 gating 阻塞；修复后的 `0.7.14` 已在一次受管导航中真实完成标题、简介、创作者、8 个标签和选集摘要的闭环。未命中时只能是 `indeterminate`，空字段仍只能按 `present/absent` 解释，且 `playerVisible` 不等于可播放或已获受限内容。当前正式静态策略为 `bilibili.video.detail.dom.v2 @ 0.4.0`，严格限于一次导航的可见首屏 DOM 投影，登记为 `build_ready`；历史 v1 或早期实证不会自动形成 v2 admission。详情 response body、字幕、弹幕、评论和推荐继续排除。详见[目录到详情真实闭环](../validation/bilibili-account-video-detail-materialization-v0.1.md)与[详情 DOM 侦察](../reconnaissance/bilibili/video-detail-dom-mvp-v0.1.md)。 |
| `transcript` | 登录态真实闭环两次取得 509/509 段；仍 research-only |
| `danmaku` | 独立真实侦察证明播放器覆盖层和“弹幕列表”均可读；`bilibili.video.danmaku.dom.v1 @ 0.1.0` 已完成生产 MV3 + Browser Host + Gateway 有界真实 canary：一次导航、一次可信打开、一次可信内嵌滚动，取得 47/62 条唯一 DOM 行并保存 artifact | 仍为 `build_ready / research-only`，`admissionEligible=false`；当前固定一次滚动预算存在虚拟列表间隔，尚未证明全量连续覆盖、多样本稳定性或 admission；二进制响应仍不进入 projector |
| `discussion` | 已证明排序与楼中楼动作到 route 的因果；正文 projector 尚未 admission |
| `account_profile` | 历史 research-only Gateway runner 已真实保存稳定 MID、昵称、简介、头像、横幅、公开标识、8 个统计/导航字段、公告、充电区、代表作和 7 条 route metadata；其历史 Network metadata 不会进入正式路径。正式 `bilibili.account.profile.dom.v2` 已完成 Gateway → Browser Host/PageLease → Native Messaging → MV3 精确 document binding 的 production bundle 与真实本地 Chromium 回路，artifact 已改为严格 DOM-only，策略登记为 `build_ready`。尚缺受管 Collection Profile 的一次真实闭环、风险/登录样本和多账号漂移覆盖，故仍未 admission。 |
| `account_inventory` | 旧 research runner 已完成真实 9 页 / 330 条视频目录，逐页 DOM/response 身份摘要一致、跨页 0 重复、末页 10 条、manifest/page digest 可恢复。正式策略表现已登记 `bilibili.account.video-inventory.dom.v1 @ 0.1.0`，但其严格边界仅是一次导航、零页面交互、首个渲染投稿页、最多 40 条卡片，因此为 `build_ready` 而非“全量目录”。新增受管浏览器 DOM v0.2 已在真实登录 Profile 中完成直接数字页码第 1–7 页 / 262 条的连续可信分页闭环；页数为 40/40/40/40/40/40/22、跨页 0 重复、每次点击窗口内目录 route 均为成功状态。`0.7.7` 还在真实 exact-target tab 复用后重新导航的路径中验证了 document-binding 修复；全量穷尽性、恢复、排序/筛选和 admission 仍是独立缺口。详见[七页真实闭环](../validation/bilibili-account-video-pagination-three-page-v0.2.md)。 |
| `article` | research runner 已真实完成 1 页 / 1 条专栏目录与单篇详情：目录按 Opus ID 合并 DOM 双 anchor、`has_more=false` 诚实终止；详情从已验证目录 artifact 绑定账号，保存 1376 字、15 个保序块、4 个媒体引用、10 个标签和五类公开指标；多页 cursor、删除/锁定/外链样本、MV3 正式策略与 admission 仍未完成 |
| `collection_series` | research runner 已真实保存 11 个总览项和稳定 series ID；独立单系列 runner 又完成 5 页 / 129 条默认顺序全目录，页数为 30/30/30/30/9、DOM/response 全匹配、跨页 0 重复、artifact digest 与敏感字段扫描通过；planner 全系列遍历、season/边缘样本、MV3 正式策略与 admission 仍未完成 |
| 其余六类（含统一 coverage） | 未形成正式生产闭环 |

后续不得使用单一 `bilibili_supported=true`。Console 和 DeepResearch adapter 必须读取此矩阵中每项独立的 maturity、`last_verified_at`、登录类别、覆盖与缺口。

## 6. 2026-07-23 实时进展

在公开版本保持 `0.7.17 / rev 15` 的前提下，当前 production MV3 + Browser Host + Native Messaging 已在受管 Collection Profile 对 `7481602` 完成一次真实账号档案 run 和一次真实投稿目录首页 run：

| capability | 当前增量证据 | 仍然保留的边界 |
|---|---|---|
| `account_profile` | `bilibili.account.profile.dom.v2 @ 0.1.0`：`completed / profile_captured`；身份、头像、横幅、8 个公开字段、公告、充电区已保存到本地 artifact | 仍为 `build_ready`；多账号/布局漂移、风险样本和独立 review/admission 未完成 |
| `account_inventory` | `bilibili.account.video-inventory.dom.v1 @ 0.1.0`：首页 40/40，并完成 2 页与 7 页有限分页；7 页为 263/263 unique、0 duplicate、0 unresolved | 仍只承诺声明页数（当前最多 7 页）；超出预算的全量分页、恢复、排序/筛选和独立 review/admission 未完成 |

两次 run 均使用一次导航、无平台交互重放、无 response body 读取，且 `admissionEligible=false`。这份增量证据记录在[账号档案与投稿目录 MV3 真实闭环](../validation/bilibili-account-profile-inventory-mv3-v0.1.md)。

本轮又在独立、可关闭的临时 Collection Profile 对 `BV1qZSLBYEpa` 完成一次真实视频详情闭环：`completed / detail_ready`，一次导航、零 hover/click/scroll、零自动重试，标题、简介、创作者、8 个标签和选集摘要均已捕获，`accessStatus=indeterminate`。临时 Profile 已关闭；登录 Collection Profile 的两个 retained 成功页保持不变。该证据只把 `video_detail` 的首屏 MVP 标记为“真实闭环已复核”，不把字幕、弹幕、评论、全量选集或推荐内容视为已完成。详见[视频详情 DOM MVP](../reconnaissance/bilibili/video-detail-dom-mvp-v0.1.md)。

评论能力本轮完成了新的匿名 Shadow DOM 结构复核：`#commentapp > bili-comments` 的开放 shadow tree 中可稳定发现 `最热/最新` 与首个 `点击查看` 语义控件，滚动后 `/x/v2/reply/wbi/main` 返回 200；一次全页面文本误点打开登录对话框，已记录为 `inconclusive` 并停止，不计入能力完成度。`discussion` 仍保持“route 因果已研究、response projector 未 admission”，下一步只在登录 Profile 清理出可用页面后做严格组件 scoped 的认证动作闭环。

2026-07-23 又完成了 `bilibili.video.discussion.dom.v1 @ 0.1.0` 的独立临时 Profile 产品 canary：一次导航、一次可信滚动、0 次点击，捕获 2 条根评论；页面视觉与 DOM 均显示评论已就绪，但匿名登录门禁使 run 诚实结束为 `partial / login_required`，目标页面保留在 `retained_for_review`，response body 与 production response routes 仍为空。此次 canary 修复了“评论宿主出现但仍在加载时误报完成”和 Shadow DOM `<style>` 污染评论文本两个问题；该策略仍为 `build_ready`，`admissionEligible=false`，最新排序与楼中楼动作没有在本次 run 中尝试。

随后对登录 Profile 的排序动作做了严格单动作验证。真实组件复核补上了 Shadow DOM slot 文本投影以及 `#sort-actions` 的 `hot/time` 状态解析，代码已提交为 `dbfb15c`；但一次可信“最新”点击的后置结果仍为 `outcome_unknown`，页面已 quarantine、账号安全已锁定，未重试、未刷新、未升级 `discussion` maturity。排序和楼中楼仍必须分别完成新的安全解锁后真实闭环，当前 `discussion` 继续保持 `build_ready / admissionEligible=false`。

随后在固定安全解锁后的新 run 中，`BV1qZSLBYEpa` 已完成一次真实 `select_latest_comments` 闭环：导航 1 次、可信滚动 1 次、排序点击 1 次、自动重试 0 次；动作前 `latestState=inactive`，动作后 `latestState=active`，视觉显示“最新”选中，`/x/v2/reply/wbi/main` 返回 200，捕获 20 条根评论，页面 `retained_after_run`，账号安全回到 `ready`。证据 artifact 为 `a977831d-7a5a-427b-aa2b-fd6e53d6bac8`，该事实只把排序动作标记为真实已验证，不改变 `discussion` 的 `admissionEligible=false`。

随后又以独立预算完成了首个根评论的 `expand_first_thread`：导航 1 次、可信滚动 1 次、入口点击 1 次、自动重试 0 次；动作后 `firstThreadExpanded=true`、`replyPaginationVisible=true`，`/x/v2/reply/reply` 返回 200，视觉与 DOM 均显示回复树，页面仍 `retained_after_run`。证据 artifact 为 `d61f90f8-b179-4dce-9d74-641e603dc2b6`。未点击下一页、未展开第二个根评论、未读取 response body；回复分页覆盖、正文 projector 与完整性仍未完成。

本轮对 `bili-comment-reply-renderer` 的真实 Shadow DOM 字段做了窄复核，并把 `author/content/publishedAt/likeCount`、当前页分页状态与 `replyCoverage` 纳入讨论 MVP 的 DOM 投影契约。预算固定为一个已选 root、一个可见回复页、最多 20 条；不读取 response body、不点击下一页、不宣称全量。页面池同时修复了尾斜杠与合法 `vd_source` 变体导致的 retained exact-target 误判；该修复已通过状态机单测，但需要下一次 Browser Host 生命周期切换后重新做认证三面闭环，`discussion` 当前仍为 `build_ready / admissionEligible=false`。

随后使用独立的未运行 B 站 Collection Profile 启动新 Browser Host/Gateway，避免关闭原有登录 Profile 的 retained tabs。新构建 marker-first probe 精确通过（`0.7.17 / rev 15`，build fingerprint `3070e9e5d7998615ccc15bf2f6ef13273a199e29a3225d51e9c4b7ba9e4b9692`，Native Messaging 已连接）；用户完成该 Profile 登录后，对 `BV1qZSLBYEpa` 完成一次严格 scoped 的认证楼中楼 DOM MVP：导航 1 次、可信滚动 1 次、`expand_first_thread` 可信点击 1 次、自动重试 0 次，捕获 20 条根评论和当前可见 10 条回复，`replyPageCount=165`，`replyCoverage=current_page`，`/x/v2/reply/reply` GET 200，视觉/DOM/Network 三面均成立，页面 retained、账号安全回到 `ready`。回复 artifact 为 `ca1ee990-45d4-4fcd-9363-8fe829dd84e3`。当前只把单 root 当前页的 `author/content/publishedAt/likeCount` 投影视为已真实闭环；没有点击下一页、没有展开第二个 root、没有读取 response body，因此 `discussion` 仍为 `research-only / admissionEligible=false`，全量分页、多个 root、完整性和 response projector 仍是独立缺口。

2026-07-23 同日完成了独立的 B 站弹幕人工可行性侦察。导航基线即可看到播放器覆盖层弹幕；一次真实打开“弹幕列表”后，右侧三列 DOM (`时间` / `弹幕内容` / `发送时间`) 出现，`li.bui-long-list-item[data-index]` 可投影公开字段。一次真实内嵌滚动将当前 DOM 行推进到 `data-index=30..58`，`ul` 的总高度约 4776px（24px 行高，约 199 个位置），确认必须按虚拟列表位置和预算推进，不能使用普通页面 scroll 或单快照。Network 只记录去 query 的 `/x/v2/dm/web/view` 与 `/x/v2/dm/wbi/web/seg.so`，两者均返回 `application/octet-stream`；未读取或保存响应正文，故暂不引入 binary projector。证据详见[视频弹幕真实侦察](../reconnaissance/bilibili/video-danmaku-recon-v1.0.md)。该结果只证明人工流程，`danmaku` 仍为 `research-only / admissionEligible=false`。

随后使用独立的 managed Collection Profile 对同一目标完成 `bilibili.video.danmaku.dom.v1 @ 0.1.0` 真实 canary：导航 1 次、可信打开弹幕列表 1 次、可信内嵌滚动 1 次、自动重试 0 次；视觉和 DOM 均证明列表打开，两个窗口取得 47 条 unique 行，列表估计总数 62，页面 retained，账号安全回到 `ready`。由于当前预算只推进一个 720px 虚拟窗口，结果诚实为 `partial / budget_exhausted`，仍不具备 admission 资格。证据详见[视频弹幕 DOM MVP 真实闭环](../validation/bilibili-video-danmaku-dom-mvp-v0.1.md)。

同一新 Host 会话随后承载了 `bilibili.dynamic.account-feed.response-dom.v1 @ 1.2.0` 的两页真实 canary。首次运行发现 MV3 网络 JSON 深度哨兵被误当作公开正文，导致一个普通 Opus 卡片误报 `card_evidence_mismatch`；修复后，Gateway 将哨兵视为“response 文本不可比较”，仅在 DOM 卡片类型、作者、发布时间和访问状态一致时使用显式 DOM-only structural fallback。真实复跑 `6120c383-1899-441b-aecf-2b87813ac1e6` / `b55952c4-dc71-4bd2-b1e4-b78bd6873cd5` 捕获 2 页、24 条动态、24 个 unique、0 duplicate、0 unresolved，视频/图文/Opus/转发/专属占位均通过同序互证；`partial / budget_exhausted` 只表示两页预算耗尽，不能解释为账号 feed 已到终点。动态仍为 `research-only / admissionEligible=false`，下一门槛是 feed 终点、边缘样本、MV3 review/admission。

### 原生搜索双页 batch 增量

随后对 `bilibili.search.breadth.dom.v2 @ 0.2.0` 完成了同一任务上下文内的双页真实 batch canary。临时 Profile `9d8b8c87-5ae9-4bd2-a6f9-e49fa3943d3b` 使用中文查询“人工智能”、视频类型和最新发布排序，按 page 1 → page 2 顺序各执行一次单页 runner；两页各捕获 20 条，合并后 40 条 unique，`unresolvedCardCount=0`，`duplicateCount=0`，最终为 `completed / search_batch_ready`。批量 manifest `427bbd8e-37c2-4479-bbc7-bcd1b040ab05` 只持久化 query digest、coverage、逐页 artifact 引用和 merged 文件摘要，不保存原始 query、Cookie、Token、请求/响应正文或 HAR。

这个 batch 的零重复不能覆盖同日独立 page 1/page 2 run 观察到的 5 个重复 BVID；B 站搜索结果会随采集时刻漂移，重复比例、页间稳定性和终止语义必须在后续任务中持续记录。runner 当前最多两页，任何单页失败或 partial 都停止后续平台导航；重复则按契约进入 `partial / search_batch_duplicates`，不会自动重放。该增量只证明 batch 基础设施和一次真实样本，不改变 `native_search` 的 `build_ready / admissionEligible=false` 状态。

同一 Profile 随后完成了空结果终止 canary：第一次真实空态截图暴露旧分类器漏掉 `.search-nodata-container` / `.no-data`、并把 `.login-panel-popover` 误判为登录门禁；修复后独立 run `9b9a12e3-dac9-454d-9113-68633c7256e0` 在 page 1 得到 `uniqueItems=0`、`capturedPages=1`、`state=completed`、`terminalReason=search_batch_empty`，没有发出 page 2 导航。该事实补齐了空结果的稳定终止语义，但不改变 v2 的 admission 状态。

2026-07-24 又为原生搜索 batch 加入了持久 checkpoint 和显式 resume 边界：页动作开始前写入 `inFlightPage`，页级 artifact 成功后才记录完成；恢复只能复用已完成页 artifact，遇到非空 `inFlightPage` 必须返回 `recovery_outcome_unknown`，不得自动重放。真实 UTF-8 双页 canary `fa7a92b9-67de-43a1-a3bc-7fbbcd7ad8cb` 完成 2 页 / 40 条 unique，checkpoint 为 `completed`、`inFlightPage=null`、页级记录 `[1,2]`；此前 query 编码成 `????` 的 run 被明确排除。该能力已具备 build-ready 的本地恢复契约，但尚未完成真实进程中途终止后的平台恢复演练，因此 `native_search` 仍为 `build_ready / admissionEligible=false`。
