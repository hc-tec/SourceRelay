# Collector 实现状态

> **2026-08-05 当前基线（覆盖旧快照中的能力计数）。** 当前 user-owned-browser `/v2` 服务使用 Collector Service schema v3，能力目录共 **21 项**：**18 项 `direct_ready`**，其中 **15 项通过浏览器扩展执行**（B 站 10 项、小红书 5 项），另有 **3 项 Zhihu/全网官方 API provider**；3 项仍为不可调度迁移边界。Gateway registry、extension runner、artifact reader、OpenAPI、JavaScript/Python SDK 的 18 项 direct 集合已通过一致性回归。新增 route-admission 矩阵逐项覆盖 15 个浏览器 direct capability，所有项目都能生成对应签名 work item。当前版本仍为 `0.7.17`，MV3 build fingerprint 为 `f8aa62d588b15a9cd3e5175a470f9c448e47e1c495ef5176c4734dbf76c5ab78`，control-surface revision 为 `16`。

本次本地完整验证 `npm run verify:collector` 已通过：100 个测试文件 / 356 个测试、9 个真实本地 MV3/Gateway 集成与 E2E、构建和 artifact 门禁全部通过；真实低频 B 站 canary 的视频详情、站内搜索、双页搜索、动态、评论以及 JS/Python SDK 入口均通过。旧的 `python_knowledge_pack` canary 入口已移除，因为该上层应用脚本不属于核心仓库；知识包应在 AgentKit 仓库验证，不得让核心 canary 引用不存在的文件。

当前 `bilibili.discussion` 的 `/v2` direct 请求目标是扩展自有 `collector_work_tab`；旧验收表中“用户已选页面”的描述属于历史实现，不代表现在的上层请求契约。

- 分支：`feat/browser-extension-system`
- 状态日期：2026-07-26
- 权威决策：[collector-grilling-decision-log.md](collector-grilling-decision-log.md)
- 产品规格：[platform-strategy-product-spec.md](platform-strategy-product-spec.md)
- 冲突审计：[collector-decision-audit.md](collector-decision-audit.md)
- 页面池架构：[managed-page-pool-browser-host-mvp.md](managed-page-pool-browser-host-mvp.md)
- 正式浏览器所有权：[user-owned-browser-extension-mode.md](user-owned-browser-extension-mode.md)
- 数据源勘察门禁：[source-reconnaissance-workflow.md](source-reconnaissance-workflow.md)
- 账号安全熔断门禁：[account-safety-circuit-breaker.md](account-safety-circuit-breaker.md)

## 1. 当前结论

> **2026-07-27 生产边界更新。** 正式产品部署为用户日常 Chrome/Edge 中的配对扩展，依托用户已存在的登录会话；Collector 不管理 Browser Profile，也不得启动或关闭用户浏览器。`bilibili.video_detail`、固定首页 `bilibili.native_search` 和固定两页 `bilibili.native_search_batch` 已通过 `browserBindingId`、签名 work item、扩展自有 work tab、固定 DOM 投影和 `/v2/collect` 完成 direct-mode MVP；其余旧能力仍是 `profileId` + Browser Host + Playwright 持久 context 的受管测试/隔离账号路径，不能被 `/v2` fallback 调用。详见[用户自有浏览器扩展模式](user-owned-browser-extension-mode.md)。

> **2026-07-26 部署入口已收束。** 正式 `npm run start:user-browser`（Gateway package 中的 `npm start` 同义）运行独立的 `user-browser-server.js`：它的依赖图没有 Browser Host、受管浏览器注册表、Profile runner 或 Playwright 控制层；默认状态根为 `%LOCALAPPDATA%\PersonalIntelligenceCollector\gateway`，且若该目录混入旧 `profiles/` / `browser-host/` 状态会拒绝启动。`npm run prepare:user-browser-deployment` 将 MV3 制品放入稳定的用户目录，用户只需一次性在自己的 Chrome/Edge 手动安装并配对。旧通道必须显式执行 `start:isolated-browser`，不能出现在正式 Console、API 或默认启动中。真实本地集成测试已用 production MV3、真实原生 loopback permission 和 direct Gateway 验证配对，并断言 direct state 不产生旧隔离运行目录。

同日先完成安装/配对/绑定，再完成第二个真实检查点：实际 MV3 扩展在普通临时 Chromium 中接收 Gateway 签名、一次 claim 的 B站详情 work item，创建并保留自己的 work tab，最多导航一次并把 bounded 首屏 DOM 投影经 HMAC 回传为本地产物。随后第三个真实检查点发布固定首页 `bilibili.native_search`：调用方只提供关键词，Gateway 固定综合/相关性/第 1 页并签名目标，扩展一次导航后仅投影可见规范 BV 视频卡片，排除直播、广告、课程等混合对象；不点击、滚动、翻页、读取 response body 或调用站内签名接口。2026-07-27 的第四个检查点发布 `bilibili.native_search_batch`：同一关键词被 Gateway 固定为第 1、2 页的签名 URL，扩展在同一个自有 work tab 中最多两次连续导航，每页最多 12 张规范 BV 卡，零 DOM 语义动作和零 response body；真实 production MV3 + direct Gateway + Testbench canary 得到 `search_batch_ready`、24 项受控投影、两次 action 各一次。没有 fake Gateway、fake 页面、受管 Profile、任意 selector/script/CDP 或平台输入重试。搜索关键词/URL 在终态 operation 和 artifact 中只保留 SHA-256 摘要。`/v1/collect` 仍是旧 `profileId` 测试 API；直接生产 MVP 在 `/v2`，其余能力必须独立迁移。

Collector 已经从 fixture POC 迁移到最小权限 MV3 扩展加 loopback Gateway 的产品控制面。B站匿名单页和固定两页关键词搜索均已获得真实 direct canary；其他平台和深度能力仍须按能力独立迁移与验证。

2026-07-29 小红书核心 direct 能力登记更新：`xiaohongshu.search.public_notes.v1`、`xiaohongshu.note.public_detail.v1`、`xiaohongshu.note.public_comments.v1`、`xiaohongshu.note.public_comment_replies.v1` 与 `xiaohongshu.account.public_notes.v1` 已有真实 Gateway→Extension 闭环。主页能力支持两种执行目标：已有公开主页 tab 的零导航有界采集，以及上层一次性提供短时公开主页链接的单次导航采集。短链 canary（run `25326ef9-3d5e-415d-956e-141e2a31ad24`）在同一已有小红书 tab 内完成一次主页导航、2 次可信滚动，返回 `profile_notes_ready` 和 6 条公开笔记；已有主页 tab canary（run `4de777ab-a250-4da4-9a9e-93898020466a`）完成 0 次导航、0 次滚动并返回 6 条公开笔记。两个样本的 `networkMatchedPayloadCount=0`、`networkBodyBytesRead=0`，均由 Network-first DOM fallback 完成，不能宣称主页 Network/XHR 正文投影已被真实验证。临时链接路径只接受公开主页 URL，最多 20 次可信滚动和 200 条公开笔记；连续两次无新增返回 `profile_notes_ready`，达到滚动或投影上限则返回 `profile_notes_budget_exhausted` 并保留部分 artifact。完整 URL、签名、响应正文和响应 URL 不进入 artifact 或长期档案。已有主页 tab 模式仍保持最多 3 次滚动和 40 条投影。静态 Strategy Registry、OpenAPI 与 direct dispatch 状态同步为 `direct_ready / gateway_extension_real_e2e_passed`；未批准的 response route 仍为空。

2026-07-30 小红书 Network-first 修复与真实回归：搜索回车会把 Explore 替换为新的 `/search_result` document；旧实现只在 Explore 注入 MAIN-world observer，导致首个搜索正文永远丢失。现改为在可信输入前注册按 workId 命名、`document_start`、`persistAcrossSessions=false` 的短时搜索 observer，任务结束或 worker 中断恢复时注销；不扩大调用方 URL/tab/selector/script 能力。隔离验证浏览器真实 run `0ab3a332-de03-4982-8165-e40f62cd217f` 完成 Gateway→Extension→artifact 搜索闭环：一次基线导航、一次语义搜索、无平台重试，18 条公开卡片，`matchedPayloadCount=1`、`bodyBytesRead=58830`、`rawPayloadStored=false`、`responseUrlsStored=false`。独立 Host 侦察确认对应公开内容响应为 `so.xiaohongshu.com/api/sns/web/v2/search/notes`，`200 application/json`，`data.items` 20 项，响应正文只在内存中读取并降为字段形状；该 route 尚未偷渡进旧的 metadata capability 或静态 `approvedResponseRouteIds`。

同一构建的真实深度回归：笔记详情仍完成“搜索卡片 → 同文档浮层 → 一次可信点击 → 原地关闭”，但 Network 正文与当前 DOM 笔记身份未形成足够安全的同一性证据，因此结果保持 `dom_fallback`，不能把 `matchedPayloadCount=1` 误报为详情正文已绑定。评论 run `915c9c51-4398-4136-b7a2-7b0ccdbd2fbb` 返回 `hybrid`、26 条评论、`matchedPayloadCount=1`、`bodyBytesRead=9083`、`cursorObserved=true`；回复 run `d8c92fcd-9f89-415d-8446-e5e5f43bbe66` 返回 `network_projection`、1 条回复、`matchedPayloadCount=1`、`bodyBytesRead=1748`、`cursorObserved=true`、动作触发响应计数为 0（说明回复正文来自同一 overlay 已有响应，未盲点或重放）。主页自然发现 run `24fb4834-9f7c-48ef-abaf-efa1f57a775d` 仍证明头像可信点击、新 tab handoff、`xsec_token` 内存观察和 30 条目录，但主页响应投影为 `0/0`，继续保留 DOM fallback 结论。

同日另一条全新短链 canary 暴露了多主页候选下的真实边界：短链导航已经成功到达目标主页，但旧扩展在全局查询公开 profile tabs 时返回 `xiaohongshu_public_profile_tab_ambiguous`，没有生成 artifact、没有重试或新 tab。修复后改为让短链 work 内部绑定刚刚导航的 tab，再核对该 tab 的 document；已有主页 tab 模式仍坚持唯一公开主页前置条件。新构建指纹为 `5bfc2e447312699caa018d6310e23cf1cc608c03f755d3b75058b72fa2501a4b`，纯逻辑门禁已通过，但由于失败链接已经消费，不能把本次修复误报成已通过真实回归。

随后使用另一条此前未导航过的全新短时链接，在风险误报修复后的构建 `ebf228c5df7c5a921ec165ab6e964f08760aa94f1ce28b8f2be9a4b15a87c3a9` 上完成真实回归：run `d0682997-c4bb-40d2-b81a-b897090a1442`、operation `3ba55d52-2388-4422-a031-d5423455fa5e`、artifact `55ba7e65-2432-40cb-8796-f045e7556e06` 均为 `completed / profile_notes_ready`；1 次基线导航、1 次主页导航、7 次可信滚动、0 次自动平台重试，返回 135 条公开笔记目录投影。此次真实 canary 同时证明了 work 内部 tab 绑定和主页正文风险误报修复；Network matched payload/body bytes 均为 0，结果仍是 DOM fallback，主页 Network/XHR 正文投影、笔记详情和评论不在该能力已验证范围内。

当前编译路径的 `bilibili.search.breadth.dom.v2 @ 0.2.0` 已在 UTF-8 中文关键词“人工智能”上完成受管 Collection Profile 真实 canary：视频类型/最新发布第 1 页与第 2 页各 20 条、综合/相关性第 1 页 20 条，导航均一次、自动重试均为 0。早期 PowerShell 请求体编码错误把关键词变成 `????` 的 run 已明确排除，不计入能力证据。独立 page 1/page 2 run 有 5 个重复 BVID；随后 Gateway batch runner 在同一任务上下文内真实顺序采集两页并合并为 40 条 unique，`duplicateCount=0`、`search_batch_ready`，并对真实空结果完成 `search_batch_empty` 的 page 1 终止（不再发出 page 2 导航）。2026-07-24 又完成了正确 UTF-8 双页 batch 的 checkpoint 持久化：2 页、40 条 unique、checkpoint `completed`、`inFlightPage=null`；随后真实终止一个 `inFlightPage=1` 的 Gateway batch，重启后 resume 返回 409 `recovery_outcome_unknown`，没有重放平台动作；同一 checkpoint 再通过本地显式 `resolve(abandon)` 处置，保留 `state=outcome_unknown / inFlightPage=1` 和 `resolvedAt`，后续 resume 仍返回 409 且不触碰页面。随后先用两次真实双页 artifact 验证 coverage 漂移，再用新隔离 Profile 完成 3 个真实完整 batch；新 coverage `39fb7c35-888e-44fd-b73a-a28385647c68` 同时记录 4 个 attempted artifact、1 个 page pool 失败 artifact 和 3 个成功样本，`meanOverlap=0.9 / meanJaccard=0.8206913859 / meanDrift=0.1793086141 / maxPairDrift=0.2608695652`，machine precheck 为 `candidate_for_independent_review`。coverage manifest 未保存原始 BVID，Profile 与临时 Gateway 已清理。不能把 machine candidate 或三样本 coverage 推广为 admission。v2 仍为 `build_ready / admissionEligible=false`；下一步是独立 review 与更多时间间隔样本。

2026-07-20 已完成第 101–170 题 Browser Host / 受管多页面池产品设计、一致性审计，以及 Checkpoint 2 的独立 Contracts 与 Browser Host Core。Host 现在是页面账本唯一写入者，提供当前用户单实例、Windows Named Pipe/HMAC、controller generation、真实持久 Chromium、每 Profile 三页池、PageLease、idle/stale/quarantine/retain/reclaim、去敏 Snapshot/Journal 和显式关闭边界。真实可见 Chromium 门禁已证明失效 endpoint 替换、第二次 launcher 调用复用同一 Host PID/Chromium PID/Browser Session、Gateway controller 重连不关闭浏览器、release 后页面复用、idle stale 无平台输入 reconcile、retained 保护、意外导航隔离、两阶段回收和 command replay 去重；门禁加载生产扩展但只使用 `about:` / `data:`，`livePlatformRequests=0`，不冒充平台验证。

当前分支仍处于零兼容切换前的中间态：Browser Host/Contracts 自身 typecheck、build 和真实生命周期门禁为绿色，但旧 Gateway 仍直接持有 Playwright、单页面 helper 与旧 Console page lifecycle，Gateway/Extension/runner 尚未使用新 PageLease 与 Native Messaging 边界。因此整体 Collector 还不能描述为已经完成新页面池迁移；Checkpoint 3 必须一次性删除旧路径，不恢复旧字段，不加入 adapter、dual write、legacy endpoint 或 fallback。

已完成的 B站 dynamic 真实侦察和两页 raw-first artifact contract 已接入新 Host/PageLease/Native Messaging/Gateway 控制链路做低频 canary：新 Gateway 复用运行中的 Browser Host，不关闭 retained tab；两页共 24 条动态、0 重复、0 unresolved card evidence，`budget_exhausted` 作为有界预算终态。该能力仍是 research-only，尚未覆盖 feed 终点、边缘样本、MV3 正式 admission。

B站弹幕已完成独立、无扩展的真实三面侦察，并完成生产 DOM-first 有界 canary。公开播放器覆盖层可读当前弹幕；真实打开“弹幕列表”后，DOM 提供 `data-index`、时间、文本和发送时间，且列表是需要可信内嵌滚动的虚拟长列表。Network 观察确认 `/x/v2/dm/web/view` 与 `/x/v2/dm/wbi/web/seg.so` 为 `application/octet-stream` 二进制响应；本轮没有读取 body，也没有把二进制协议误加入 JSON projector。生产 canary 已完成一次导航、一次可信打开、一次可信滚动，取得 47/62 条 unique DOM 行并保存 raw-first artifact，页面 retained、账号安全回到 `ready`；结果诚实为 `partial / budget_exhausted`。当前 `danmaku` 仍为 `build_ready / research-only / admissionEligible=false`，下一步是可恢复的虚拟列表连续覆盖、多样本与 review，不是增加动作重试。

B站字幕目前已具备“按需真实采集”的产品底层能力，但仍是 research-only validation、`admissionEligible=false`，没有进入正式 Task production routes。v0.4.23 的 Gateway + 生产 MV3 扩展已在真实登录 Profile 中完成轨道目录、中文选择、字幕正文和本地 raw-first artifact 闭环；这证明能力可用，不等于把单一样本升级为正式策略 admission。

B站账号目录已新增独立 research-only runner，并使用保存的登录 Collection Profile 完成真实 9 页 / 330 条公开视频投稿目录：末页 10 条、跨页 0 重复、九页 DOM/response 身份摘要与标题全部互证，账号昵称、简介、头像也与公开页面一致。artifact 采用逐页 JSON、manifest 和 SHA-256 恢复校验，敏感字段扫描为 0；第二个一页预算 run 复用原目标 tab，没有累积新 B站标签页。该能力仍未迁移到 MV3 response projector，`admissionEligible=false`，不能冒充正式生产策略。

B站账号主页、图文/专栏与合集/系列先完成真实三面侦察：公开档案字段、`/upload/opus` 的全部图文/专栏分面、`/opus/<id>` 服务端正文 DOM，以及系列总览、详情、排序和第二页均已证明。文章正文首选 DOM raw-first artifact；合集关系使用平台系列 ID 与定义顺序，不能用推荐卡或发布时间替代。随后账号档案、系列总览、单系列完整目录、专栏目录和单篇正文均已形成 Gateway research runner；MV3 正式策略与 admission 仍未完成。

随后 `account_profile` 独立 research runner 完成真实 artifact：一次主页导航保存头像、横幅、公开标识、8 个统计/导航字段、公告、充电区与 3 个代表作，七条 route 仅保留 metadata；manifest/profile snapshot digest、重启读取契约和敏感字段扫描均通过。当前登录用户明确排除，公开简介/公告只存在 ignored runtime。该 runner 仍由 Gateway 读 DOM，尚未 admission。

`collection_series` 已完成两层 research 闭环。总览 runner 保存 11 个稳定 series ID，标题、声明数量、32 个 DOM 可见预览及 1 个 0 条系列均与 response 互证。独立单系列 runner 随后从该总览 artifact 选择稳定 ID，真实完成 5 页 / 129 条默认顺序全目录，页数为 30/30/30/30/9、DOM/response 五页精确一致、标题全匹配、跨页 0 重复；五个动作各尝试一次。元数据、schema、逐页文件和 manifest digest 读取验证及敏感字段扫描均通过。它仍是单系列 research 样本，planner 全系列遍历、season、恢复、MV3 迁移与 admission 尚未完成。

`article` 也完成目录与详情两层 research 闭环。目录 runner 先等待 `type=all` 基线，再用一次可信点击进入专栏分面；真实样本得到 1 页 / 1 个唯一 Opus、0 重复、`has_more=false`。详情请求必须引用该目录 artifact，Gateway 用来源 manifest/page digest 证明账号归属，不从无链接的详情作者 DOM 猜 MID；最终保存 1376 字、15 个保序块、4 个规范媒体引用、10 个标签、legacy `cv` ID 和 like/coin/favorite/forward/comment 五类公开指标。评论正文保持独立，目录 cursor 值、认证材料和 query 值均未落盘。多页 feed、边缘样本、MV3 迁移与 admission 尚未完成。

2026-07-18 检查点补充：B站视频详情字段的独立 Validation Run `v1.4.0` 已 accepted，但正式多阶段 Task 在当前页面 document / content-script 生命周期中仍出现 `gateway_stage_watchdog_expired`，因此该详情策略已降为 `suspended`。任务 stage 窗口在 Evidence 或 blocked 后自动关闭；详情控制面修正仍须用真实单 stage 与双 stage 任务复验。扩展启动阶段的重复页/闪退先在 v0.4.23 去除了 `chrome://extensions` 和可见 context 自动恢复，但仍会因历史 `lastExtensionVersion` 与实际 worker 状态分离而永久 mismatch；v0.4.24 已改为每次冷启动先 headless 读取实际 marker，不匹配才 reload 一次并跨 context 复核，复核前不打开可见窗口。

同日新增隔离的 `parallel_dom_and_network_metadata` Source Reconnaissance：DOM checkpoint、页面生命周期、扩展 validation/documentId 与 B站域名 XHR/fetch metadata 使用同一 run 时间轴。该模式不读取请求头/体、响应正文、Cookie 或 Token，不改变 production response routes，也不产生可 admission 的 Evidence。Google Chrome DevTools CLI 已在独立临时 Profile 中自动安装/重载生产扩展、触发 action、识别 service worker/Control 页并完成 B站 Fetch/XHR 去 query/hash 交叉观察，不再需要用户手工加载或点击扩展完成这类测试。

2026-07-19 新增认证 Profile 的有界交互勘察 runner：固定最多五个只读语义动作，每个动作三秒网络差分窗，观察 Fetch/XHR/texttrack 的 origin、pathname、query key、MIME、状态和声明尺寸；平台 API、`hdslb.com` CDN 与第三方/未知来源分开分类。该 runner 不读取请求头/体、响应正文、Cookie 或 Token，不修改 production route，结果仍不具备 admission 资格。

同一 runner 另有默认关闭的 `schema_only` 研究模式：仅允许四条精确 B站 API route 与路径含 subtitle 的平台 CDN 响应，单响应 512 KiB、总计 1 MiB；JSON 只输出过滤敏感字段后的路径、类型和数组规模，非 JSON 只输出内容类别、大小和摘要，原始正文不落盘。该模式仍不改变 production route 或策略成熟度。

用户指出断网、弱网、验证码和异常恢复可能导致重复平台动作并带来封号风险后，所有 B站认证实网研究曾立即暂停并写入 `locked / user_safety_pause`。账号安全门禁完成后，早期逐次授权 run 暴露了旧 MV3 service worker、权限和 synthetic interaction 问题。项目所有者随后授予仓库范围内的持续开发/验证权限；产品动作账本、预算、Profile 绑定和风险停止仍保留。v0.4.23 已用真实启动和真实字幕 run 验证 control-surface revision、运行时代码 marker、可信浏览器输入与 at-most-once 控制循环。

实现已加入 `account-safety.json` 原子状态、崩溃遗留 run 启动锁定、固定 acknowledgement 解锁、同 action ID 二次拒绝、60 秒 run deadline、三次 Fetch/XHR failure 中止和正式 task dispatch 风险门禁。早期“启动时关闭恢复 HTTP(S) tab”的逻辑已经删除；当前设计改为 Browser Host session 所有权账本，未知 tab 一律 unmanaged。按用户最新决定，正常完成、普通失败、断网和超时均由 `running` 直接回到 `ready`，不再存在计时冷却；验证码、风控、限流、登录失效、中断和显式账号暂停仍进入 `locked`。持久记录升级为 schema v2，旧 v1 `cooldown` JSON 会一次性迁移为 `ready`。

该 run 暴露的结果语义随后已修正：字幕控件点击后必须在 2.5 秒内满足菜单后置条件，否则 `open_caption_menu=postcondition_unmet`；依赖动作记为 `select_caption_language=prerequisite_unmet / attempted=false`。run 新增 scope objective，只有全部 required actions 完成才能标记 `completed`。认证 interaction 结果现在原子保存为不含 Profile ID、原始 URL、正文和未知 DOM 字段的 ignored runtime artifact；列表只返回 compact summary，详情按 record ID 读取完整安全 schema 投影。

同日人工与 DevTools 联合侦察真正复现字幕操作：真实页面把规范 URL 追加为唯一的 `vd_source` query；hover `.bpx-player-ctrl-subtitle` 即展开菜单；中文项的正确交互节点是 `.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]`，选中后该父节点获得 `bpx-state-active`，字幕面板可见。Network 真实读取到 87175 字节、509 段的公开 AI 字幕 JSON，并确认 `lang=zh` 与 `body[].from/to/content`。扩展升级到 v0.4.18，修复 observed-document URL 规范化、精确父节点选择和真实后置条件；扩展与 Gateway 全构建门禁通过，但这仍未证明 v0.4.18 产品控制循环能够完成可信交互。

v0.4.18 的第一次真实闭环提交在账号 run 和平台导航之前返回 HTTP 400：生产扩展已加载、已配对，`strategyPermission` 却为 `missing`，账号 `lastRunAt` 未变化且没有新增 artifact。纯本地 Control 页权限恢复重新获得精确 B站 origins；关闭并重启 Profile/Gateway 后复核 `extensionLoaded=true / extensionPaired=true / strategyPermission=granted / manifest=0.4.18`。

第二次 v0.4.18 产品 run 只提交一次并返回 HTTP 201，但最终为 `inconclusive / partial`：轨道目录捕获到 1 条，`open_caption_menu=postcondition_unmet`，中文选择因前置条件不满足而未尝试，字幕正文和 segment 均未捕获。随后执行了一次完全绕开 Collector 扩展、Gateway 和既有字幕脚本的干净浏览器可行性研究：从视觉上先显现播放器控制栏，DOM 取得字幕按钮与中文父项的实时边界框，再用浏览器级真实 mouse move/hover 和一次 click 完成中文切换；页面出现 `bpx-state-active` 与可见字幕面板，Network 同时返回 87175 字节、`lang=zh`、509 段的真实字幕 JSON。由此已经证明网页操作可行，v0.4.18 的错误位于 content-script synthetic interaction 执行层，产品闭环仍保持 `partial`。

v0.4.19 把可信 mouse move/hover/click 迁到 Gateway Playwright 控制层，并发现两个页面时序事实：字幕控件约在导航后 7.8 秒才挂载；`locator.isVisible()` 会忽略祖先 `.bpx-player-control-bottom { opacity: 0 }`，不能作为控制栏肉眼已显示的证据。实现改为等待控件挂载，基于 `.bpx-player-video-area` 而非整个 player container 计算 reveal 位置，并用祖先 `opacity > 0.5` 验证后置条件。真实 run `f659f549-aa76-47ad-b97c-195706a4d430` 随后首次得到 `completed / satisfied / captureCount=2 / segmentCount=509`。

v0.4.23 修正了两个产品生命周期问题。第一，扩展 manifest 版本不再冒充运行时代码版本；service worker 发布编译期 runtime marker，版本变化时 headless context A 只 reload 一次，headless context B 精确核验，之后才打开唯一可见 Control。第二，字幕 run 终态不再关闭目标窗口；新独立 run 只复用仍停留于原规范目标的专用 tab。真实 runs `e50cf518-539d-40e3-ad30-41b44983180c` 与 `b5e46b00-eec6-4f1d-9cb0-c41fbf615e4a` 均完成 509 段闭环，OS 窗口树在两次 run 后始终只有 Control 与原 B站目标两个窗口，原目标窗口句柄不变、没有第三个窗口。

v0.4.24 继续修正 v0.4.23 遗留的 worker 采纳死锁：`lastExtensionVersion` 只是历史遥测，不能作为跳过 worker probe 的依据。真实验证故意把持久记录写成 `0.4.24`，同时保留实际 runtime `0.4.23`；新启动器在 headless A 读到该差异，只 reload 一次，在 headless B 核验 `0.4.24 / revision=2` 后才打开 Control，耗时 4.276 秒。随后同版本冷启动耗时 1.857 秒，只 probe、不 reload。两次均为 `chromeUiReloadAttempted=false / contextRestarted=false`；OS 审计只有一个 Chrome 根进程、一个可见 Control 窗口、一个标签，`chrome://extensions` 标签为 0，43128/43129 无监听。错误 API 现在还会返回 phase 与 expected/observed version/revision，避免再次只看到无上下文 mismatch。

该经验和项目所有者的常设实网授权已经固化为仓库内 [`recon-live-web-interactions`](../../skills/recon-live-web-interactions/SKILL.md)。今后不得让独立调试浏览器与 Gateway 同时占有生产 Collection Profile；但代理不再等待逐 run 聊天授权，而是在安全 preflight、独立 run、动作 at-most-once 和清理门禁满足后自主推进真实验证。

B站详情正式 Task 的 receipt / Evidence race 已加入控制面修复：accepted receipt 后最多 3 次、100ms 恢复 pending Evidence；Gateway poll 先恢复 pending 再取 work；content push 失败只安排本地 continuation，成功则立即清 watchdog。伪造平台页面与 fake Gateway 的集成诊断已删除；该修复必须通过新的真实单 stage 与双 stage 任务验证，`bilibili.video.detail.dom.v1 @ 1.4.0` 继续 `suspended`。

多 stage 推进使用显式任务状态 `waiting_for_user_resume`。非最终 stage 的 Evidence 完成后，任务不会后台取得下一 stage；Console-origin 保护的 `POST /v1/tasks/<task-id>/resume` 核对已批准计划中的下一个 pending stage 及其既有 Profile binding，并把任务放回调度队列。该端点没有时间等待，自身不启动浏览器、不导航、不修改计划，也不能代替 locked Profile 的人工解锁。单元测试覆盖立即显式恢复、精确下一 stage、重复恢复、completed 与 locked 拒绝；Console 和平台闭环仍只接受真实任务验证。

```text
已完成：P0 决策契约与构建门禁
已完成：P1a 扩展权限、控制页、EvidencePlan 与 stage lease
已完成：P1b Gateway 固定身份、显式配对与认证任务 preflight
已完成：P1c stage receipt、dispatch 重投去重与阻塞回报
已完成：P2a 受管 Collection / Validation Profile 生命周期与任务绑定
已完成：P2b B站匿名 breadth_search / visible_dom 真实验证与显式 admission
已完成：P2c 正式 B站 dispatch、认证 Evidence 回传、本地原始批次与 completed 闭环
已完成：B站字幕 production-extension validation 闭环、raw-first artifact、终态窗口保留与复用（尚未 admission）
已完成：B站 account_profile / account_inventory research runner 9 页 / 330 条真实闭环（尚未 admission）
已完成：B站 collection_series 总览 + 单系列 5 页 / 129 条 research 闭环（尚未 admission）
已完成：B站 article 单页目录 + 单篇 raw-first 详情 research 闭环（尚未 admission）
已完成设计：Browser Host / 多 PageLease / Native Messaging / 页面状态 / Console MVP（101–170）
已完成：Browser Host Contracts、单实例 Host 与真实本地 Chromium 页面池 foundation
待切换：Gateway/Extension/全部 runner 零兼容迁移并删除旧单 tab 路径
已验证：B站 dynamic 通过新页面池的两页低频真实 canary（仍待边缘样本、MV3 review 与 admission）
已完成：B站 danmaku DOM-first runner、真实 canary（47/62 unique，partial / budget_exhausted，尚未 admission）
未开始：P3 加密 Evidence Vault
未开始：P4 EvidencePackage / DeepResearch 正式接入
```

## 2. 已落地检查点

| Git 检查点 | 内容 | 能力含义 |
|---|---|---|
| `b3e7fdd` | P0 共享契约、移除 fixture / test build、生产构建门禁 | 只证明制品可构建和自动加载 |
| `1ec99cb` | optional host permission、控制页、EvidencePlan/preflight、专用窗口与 session lease | 只证明扩展控制面契约存在 |
| `95edf75` | loopback Gateway、P-256 固定身份、一次性签名配对 | 只证明配对双方可构建 |
| `e4a1816` | HMAC 轮询、签名 work item、Console task、preflight、formal-only 批准、stage receipt 与重投去重 | 当前策略会被阻断为 `live_validation_required` |
| `6334d17` | Gateway 受管持久 Profile、可见 Chromium、扩展自动加载、Profile API / Console 与任务绑定 | 只证明本地浏览器生命周期和绑定控制面，不证明平台可用 |
| P2b（本提交） | 独立 Validation Run、扩展版本恢复、B站 DOM v1.1、记录 review 与源码 admission | 只发布匿名 B站首屏关键词搜索标题与 BV URL |
| P2c（本提交） | Profile 级自动配对 / 精确权限 / 轮询、正式结果 HMAC 回传、原子 JSON batch / manifest、摘要幂等与任务 completed | 已以真实 B站页面验证单阶段正式闭环；仍不是加密 Vault |
| `5c994c0` | worker runtime marker、版本变化的 headless reload/verify、唯一可见 Control | 去除扩展页 UI 恢复与可见 context 自动重启，但历史版本提示仍可能与实际 worker 分离 |
| `eca3208` | 每次冷启动 marker-first probe、条件式单次 reload、结构化 mismatch diagnostics、v0.4.24 | 真实 poisoned Profile 与同版本重启均通过；可见窗口只在无界面核验成功后启动 |

## 3. 控制面边界

### 3.1 Manifest

- 安装时 API permissions：`alarms`、`storage`、`scripting`；
- 安装时 `host_permissions`：空；
- optional loopback：`http://127.0.0.1/*`，只用于固定身份 Gateway；
- optional 平台 origins：B站、知乎、微博、小红书的精确域名；
- 静态平台 `content_scripts`：空；
- `externally_connectable`：不存在；
- `<all_urls>`、通配 scheme / host、`localhost`、`cookies`、`debugger`、`webRequest`、`downloads`：禁止。

Chrome match pattern 不能限定 loopback 端口，因此扩展另外固定 `GatewayPairingRecord.loopbackOrigin`，验证 Gateway public-key fingerprint 和 P-256 签名，并对每个请求使用 extension instance、短时 timestamp、nonce、body digest 和 HMAC pairing authorization。任意网页和未配对 localhost 服务不能充当控制端。

### 3.2 任务执行

```text
Console 创建 ResearchTask
  -> paired extension 认证轮询
  -> 验证 Gateway 签名 / identity / nonce / expiry
  -> extension 生成平台 × 目标 capability preflight
  -> Gateway Console 展示计划
  -> 只有全部 stage = ready + formal 才允许用户批准
  -> dispatch 前扩展重新计算权限、策略 ID / version / maturity
  -> 专用可见 Collection Window
  -> session-only stage lease
  -> 精确任务 tab 动态注入固定 content.js
  -> 扩展按 task / stage / lease 暂存待提交结果
  -> HMAC POST /v1/extension/evidence
  -> Gateway 重建白名单结果并校验策略 / 来源 / 预算
  -> runtime/evidence 原子 JSON batch + manifest
  -> lease completed + task completed
```

B站 `bilibili.search.breadth.dom.v1 @ 1.1.0` 具有已审查的匿名 live-validation reference，因此在 Profile、任务同意和精确 host permission 均满足时可返回 `ready / formal`。知乎、微博和小红书仍为 `build_ready / liveValidation = null`，其 preflight 继续返回 `live_validation_required / experimental`，不能批准。

Research Task 必须按平台绑定由 Gateway 注册的 Collection Profile。Gateway 只接受逻辑 Profile ID，并在服务端重新解析平台、类型和账号类别；扩展收到签名任务后再次拒绝 Validation、anonymous、跨平台或畸形绑定。Profile 绑定不提升策略成熟度，也不授予平台权限。

### 3.3 受管浏览器 Profile

- `collection`：只能使用 `user_managed` 账号类别，用于未来正式采集任务；
- `validation`：允许 `anonymous` 或 `user_managed`，仅用于逐能力真实验证，不能绑定 Research Task；
- Gateway 内部生成 UUID 并推导 `runtime/profiles/<profile-id>`，API 不接受或返回任意目录；
- 始终使用可见 Playwright Chromium，自动加载生产扩展并打开其控制页；
- 不启动 Chrome / Edge 日常 Profile，不复用 BrowserWing / Maxun 或旧 POC Profile；
- 同一平台默认只运行一个 Profile，关闭进程后目录保留；
- UI 只暴露逻辑账号标签、expected visible identity 和运行 / 扩展 / 配对布尔状态；
- B站 `collection + user_managed` Profile 提供固定官方登录页入口；API 不接受任意 URL、不返回页面内容，扫码与验证码只由用户执行；
- B站登录状态探针使用独立短时官方首页，只返回公开页头账号入口/“登录”入口布尔信号和 `authenticated / anonymous / indeterminate` 三态，不读取身份内容或浏览器凭据；
- Collection Profile 另提供“配对 Gateway”“授予当前平台精确权限”“立即轮询任务”入口；一次性配对码只在 Gateway 进程和受管扩展页面之间传递，Profile API 不返回；
- 可选固定代理只接收无凭据、带 host 和 port 的 `http`、`https` 或 `socks5` server URL，不接受代理用户名或密码。

### 3.4 重启和页面漂移

- Gateway identity 和扩展配对授权持久化在本地 `runtime/` / `chrome.storage.local`；
- Profile 注册表和浏览器原生 Profile 数据持久化在 Gateway `runtime/`，Gateway 重启后可重新启动；
- 页面和 stage lease 只保存在 `chrome.storage.session`，浏览器重启后失效；
- 手工导航导致任务 URL 摘要变化时标记 `task_context_changed`；
- 撤销平台权限时活动 lease 标记 `permission_revoked`；
- 撤销 Gateway 配对时停止轮询并取消活动 lease；
- 当前 Gateway Research Task 队列只在内存中保存，重启恢复必须等加密任务/Vault 状态设计完成，不能把临时明文队列误写成正式持久化；
- 已完成的原始 Evidence batch 与 task manifest 保存到忽略的 `runtime/evidence/<task-id>/`，Gateway 启动时重新核验 JSON 形状与 result digest 后恢复 batch 摘要；任务问题和待处理计划仍不持久化；
- dispatch 在 receipt 丢失时按同一 task / stage 重投新签名 envelope；扩展先查找现有 lease，已有 active / completed lease 时只补发 receipt，不重复创建窗口；
- dispatch 前权限或策略状态变化会回传固定 `blocked` error code，Gateway 停止重投。

## 4. 构建门禁状态

扩展门禁：

- TypeScript 编译；
- production bundle；
- MV3 Manifest；
- API / optional origin 精确清单；
- 禁止宽权限、静态 MAIN-world、持久平台注册脚本和 test / fixture 入口；
- Playwright 临时空 Profile 自动加载；
- MV3 service worker 启动；
- fresh Profile 零 optional origin grant；
- fresh Profile 零平台注册脚本；
- Collector 内部控制页加载。

Gateway 门禁：

- TypeScript 编译；
- Node 22 bundle；
- 只包含 `127.0.0.1` bind；
- 不包含 `0.0.0.0` all-interface bind；
- 不引入未审查的 Express / Fastify / Koa HTTP 表面。
- 正式 Evidence 路由、`responseObservation = disabled` 安全元数据和 Profile 显式轮询必须保留在 bundle 中。

这些都是构建门禁，不是平台测试，也不证明配对或任务控制已经完成真实环境验证。

### 4.1 P2a 本地功能验证

P2a 另外在隔离的 Gateway runtime 和可见浏览器中完成了本地功能验证；该过程没有打开任何平台页面，也没有使用登录态：

- Console 通过真实 UI 创建 B站匿名 Validation Profile；
- Gateway 重启后保留相同逻辑 Profile ID、账号标签和注册记录；
- Console 启动按钮创建非 headless 的持久 Playwright Chromium，进程参数包含生产扩展加载且不包含 headless flag；
- Gateway 状态返回 `running = true`、`extensionLoaded = true`、`extensionPaired = false`，未把未配对状态冒充成功；
- 关闭后受管浏览器进程归零，Profile ID 与 `lastLaunchedAt` 保留；再次启动复用同一 Profile；
- 同平台第二个运行 Profile 返回 `profile_platform_concurrency_rejected`；
- 任意 `path` 字段、匿名 Collection Profile 和把 Validation Profile 绑定 Research Task 均被服务端拒绝；
- 合法同平台 Collection Profile 可写入签名任务契约的 `profileBindings`；
- 无凭据的固定 `socks5://host:port` 配置可以通过 Gateway 启动解析。

这只证明本地 Profile 生命周期、生产扩展自动加载和任务绑定边界可工作。扩展与 Gateway 的显式配对、平台权限、平台页面、登录身份核对、DOM 策略和数据采集仍需各自验证；这些结果不能升级任何平台 strategy maturity。

### 4.2 P2b B站真实验证与 admission

- Validation Run 只接受 `validation + bilibili + anonymous` Profile，不复用 Research Task 或正式 stage lease；
- 使用真实 Chrome optional host permission；自动化只能操作浏览器原生权限对话框，不修改 Profile Preferences；
- 运行窗口 30 秒到期，只允许原生搜索导航、可见 DOM、首个渲染页面、最多 20 条和 0 次页面交互；
- production response route 保持为空，验证记录明确写入 `responseObservation = disabled`；
- `v1.0.0` 虽返回 20 个规范 BV URL，但标题误取“稍后再看”缩略图覆盖层，记录 `1220b4bc-4763-4087-8c83-e85b108e544a` 已以 `title_projection_captured_thumbnail_overlay` 拒绝；
- `v1.1.0` 按同一 BV URL 聚合多个可见 anchor，优先 `h3[title]` / anchor title / aria-label / heading text，并拒绝没有语义字符的覆盖层标题；
- `v1.1.0` 记录 `bb91e996-7758-4447-ba94-486bc99b7872` 返回 20 条可读标题、20 条规范 BV URL、`results_visible / completed`，人工 review 为 accepted；
- 运行时记录只保存在忽略的 Gateway runtime；仓库仅提交不含原查询和标题的[脱敏 admission 记录](../validation/bilibili-search-breadth-dom-v1.1.0.json)；
- 策略 admission 由源码中的精确 record ID / verifiedAt 显式完成，运行成功本身不会修改 maturity。

该 admission 不证明登录、翻页、排序穷尽、详情、评论、账号归档、response observation 或其他平台能力。

### 4.3 P2c 正式 B站 Research Task 全链路

2026-07-17 使用受管、可见、持久 Collection Profile 完成一次正式任务；不需要登录，也没有读取浏览器凭据或页面响应：

- Collection Profile `ee439ada-a7d7-436f-a898-e959004316ee` 通过 Profile API 发起配对；Windows UI Automation 只识别并 Invoke Chromium 原生“允许”按钮，分别批准 loopback 与 B站两个精确站点范围，没有修改 `Preferences`；
- Chromium service worker 对无正文 `GET /v1/extension/work` 会省略 `Origin`。实测首次被 `extension_origin_required` 阻断后，Gateway 将规则收紧为：pairing claim 与 CORS preflight 始终要求精确扩展 Origin；已配对实际请求若携带 Origin 则必须匹配，省略时仍必须通过 extension ID / instance、timestamp、nonce、body digest 与 HMAC 全部认证；
- Collector Core `0.3.0` 的正式任务 `5f00540a-9a8d-4422-a7a3-46e657ba5664` 唯一 stage 返回 `ready / formal`，策略为 `bilibili.search.breadth.dom.v1 @ 1.1.0`，live-validation record 为 `bb91e996-7758-4447-ba94-486bc99b7872`；
- 显式批准后，扩展验证 Gateway P-256 签名和 plan digest，创建专用 Collection Window 与短时 lease，读取首个渲染页面的 20 条可见标题和规范 BV URL；
- Evidence batch `14216fae-5306-4e43-8171-4c5309a03707` 已落入本地 runtime；result canonical SHA-256 为 `eca7221cf28caa174cc963e74d7f140e58a6a9c97f50db8de4ab6de2c9d043f2`，独立重算一致；
- batch 的 `sourceUrl` 为去查询参数的 `https://search.bilibili.com/all`，`responseObservation = disabled`，`browserCredentialData = not_collected`，没有 Cookie、Token、header、request 或 response 字段；
- Gateway task 最终为 `completed`，item count 为 20。该 runtime 记录被 `.gitignore` 排除，不把真实查询结果提交到仓库。

这个闭环只证明已经 admission 的 B站匿名 breadth stage 可用于正式本地采集；它不扩大策略的页面、动作、登录或数据类型范围。

### 4.4 账号安全门禁与字幕 schema-only 单次实网验证

2026-07-19 在用户明确批准且仅批准一次后，对唯一 `collection + bilibili + user_managed` Profile 执行 subtitle-only 交互勘察：

- preflight 为 `ready`、`manualUnlockRequired=false`、无 active run；
- 唯一 POST 返回 HTTP 201，runner 为 `completed / errorCode=null`；
- `open_caption_menu` 为 `attempted=true / completed`，但动作尾窗内只看到字幕控件标签；
- `select_caption_language` 为 `attempted=false / option_unavailable`，没有盲点、坐标点击或重试；
- 观察 111 条网络 metadata，0 条因上限丢弃，2 条 Fetch/XHR failure，未达到 3 条中止阈值；
- `/x/player/wbi/v2` 映射为 3263 字节 JSON，只保留路径、类型、数组规模和 SHA-256；
- `/x/v2/subtitle/web/view` 映射为 408 字节 binary，只保留大小和 SHA-256，没有猜测正文；
- JSON 候选包含播放器、账号与区域相关的混合路径，生产 projector 因此必须使用字幕字段显式白名单，不能持久化整个通用对象；
- 当时版本在 run 结束后写入过旧 `cooldown` 状态；该状态现已从产品和持久 schema 删除并迁移为 `ready`。没有验证码/风控 hard lock；Profile 正常关闭后停止 Gateway；43127 监听器、可见 Chrome、DevTools MCP 和 Gateway 进程均为 0；
- production response routes 保持为空，`admissionEligible=false`，本轮结果不升级任何策略成熟度。

实网完成后的离线修复又通过两类零平台请求验证：

- contract verifier 覆盖菜单后置条件、依赖动作不投递、scope objective、artifact 原子恢复、Profile ID/未知 DOM 字段剔除，以及 compact-list/full-detail 分层；
- Playwright intercepted diagnostic 在生产扩展中真实完成 optional host permission 原生对话框、content injection、3 条 DOM 结果和权限撤销；另一个 Gateway diagnostic 完成字幕菜单、中文选择、JSON schema、binary 分类和目标页关闭；
- 两个 diagnostic 的所有 B站 URL 均在 BrowserContext 内本地 fulfill/abort，`livePlatformRequests=0`；它们不进入 `verify:build`，也不构成 platform validation 或 admission。

同日用户又给出第二张独立的一次性 subtitle-only / schema-only 授权票。系统没有后台恢复，直到收到新授权才提交唯一一次 POST。该 run 返回 `inconclusive / objective=partial`：字幕菜单在 2.5 秒内就绪，精确“中文”只点击一次；点击后选项仍可见且没有可验证的选中状态，因此严格记为 `postcondition_unmet`，没有补点或重试。动作窗首次捕获到 `aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>` 的 200 JSON schema，确认 `body[].content/from/to` 与根级 `lang` 结构；导航阶段播放器对象也确认了 `subtitle.subtitles[].lan/ai_type/subtitle_url` 等轨道目录结构。原始字段值与正文没有落盘，production response routes 仍为空，`admissionEligible=false`。Profile、Gateway、43127/43128、受管 Chrome 与 DevTools MCP 均已关闭，第二张授权已经消费。

完整证据与二进制/JSON 摘要见[字幕 Source Reconnaissance](../reconnaissance/bilibili/video-subtitle-recon-v1.0.md)。

## 5. 已知未完成项

| 领域 | 当前状态 | 下一门槛 |
|---|---|---|
| Gateway 配对 | Profile 级显式配对已通过真实 Chromium loopback 权限与 HMAC 轮询 | 后续补撤销、身份变化与失败恢复的产品验收 |
| Task dispatch | B站单阶段 preflight → approval → signed dispatch → lease → evidence → completed 已实测；多阶段使用无时间等待的显式 user resume，单元状态机已通过 | 详情策略重新 admission 后做真实双 stage 验证；再增加取消和加密重启恢复 |
| Profile | 受管持久生命周期、可见 Chromium、生产扩展自动加载、关闭/重启、并发门禁、任务绑定与 B站固定官方登录页入口已实现 | 平台认证动作仍只由用户执行；完成扫码后的可见身份与关闭/重启持久性核验 |
| B站 discovery | `v1.1.0 live_anonymous_verified`，正式闭环已验证；`v2 @ 0.2.0` 已真实验证 UTF-8 视频/最新发布第 1–2 页、综合/相关性第 1 页、空结果终止，并完成最多两页的 batch manifest、合并、页间 BVID 去重、checkpoint 持久化、未知动作拒绝重放和本地显式处置 | v2 仍不可 admission；补跨任务漂移/重复比例与独立 review；detail 策略不得复用 breadth admission |
| B站账号档案/投稿目录 | 保存的登录 Profile 已完成公开档案 artifact 与 9 页 / 330 条目录真实闭环；头像/横幅/公开标识/统计/公告/充电/代表作、逐页 digest、去重、声明终点、artifact 恢复与 tab 复用均通过 | 将 DOM/response 观察迁移到 MV3 Extension；补多账号档案、零投稿、单页、置顶/重排、采集中新增和登录失效样本后独立 review/admission |
| B站图文/专栏 | 保存的 Profile 已完成 1 页 / 1 条专栏目录与单篇详情 artifact；目录 DOM/response 精确互证，详情由来源目录 digest 绑定账号，保存完整文本、保序块、媒体、标签与五类指标；评论独立 | 补 `has_more=true` 多页、0 条、删除/锁定、超长/无图/外链、多账号样本；迁移 MV3 projector 后独立 review/admission |
| B站合集/系列 | 总览 artifact 已保存 11 个稳定 series ID 并完成 DOM/response/0 条系列互证；单系列 runner 已真实完成 5 页 / 129 条默认顺序全目录、五页精确互证、0 重复和可恢复 artifact | 由 planner 遍历所有系列；补 season、0 条/单页、采集中变化、中断恢复与多账号样本，迁移 MV3 projector 后独立 review/admission |
| B站字幕 | v0.4.23 已两次完成生产扩展/Gateway 真实 validation：三个必需动作完成、轨道目录与字幕正文各捕获一次、`lang=zh`、509/509 段、raw-first artifact 完整；终态窗口保留且下一 run 复用，无窗口堆积 | 扩展人工字幕、多语言、无字幕、锁定/删除、长视频与风险样本；保持 production route 为空和 `admissionEligible=false`，直到独立策略版本完成覆盖与正式 review |
| response observation | 生产 route 为空 | 先完成 wrapper 到期撤销、route projector 和 document race 验证 |
| Evidence | 认证回传、待提交重试、原子原始 JSON batch、task manifest、result SHA-256 与重启摘要恢复 | 加密 Vault、不可变审计、coverage 与删除/导出边界 |
| Gateway task persistence | 仅内存 | 与 Vault 密钥和 schema 一起设计加密恢复，不写普通明文队列 |
| 多 stage 用户续跑 | `waiting_for_user_resume`、精确 `/v1/tasks/<task-id>/resume`、Console 按钮及单元状态机已完成；没有计时等待，不会后台续跑，也不能用 resume 代替 manual unlock | 详情策略重新 admission 后验证真实两 stage；任务队列持久化前保持 Gateway 重启即清空 |
| DeepResearch | 未接入当前 Collector | 只读 EvidencePackage / Citation / Coverage / CollectionGapRequest |

## 6. 下一实现顺序

```text
P2a  Collection / Validation Profile launcher（完成）
  -> P2b B站匿名 discovery 真实验证与 admission（完成）
  -> P2c 正式 Gateway dispatch / Evidence 闭环（完成）
  -> B站 account profile / inventory research 闭环（完成，待 MV3 迁移与 admission）
  -> B站原生搜索 batch 的跨任务漂移/重复 coverage 与独立 review
  -> B站原生搜索 detail / multi-P / subtitle（各自独立策略与 admission）
  -> B站 dynamic 与 article feed 终点/边缘样本及 MV3 review
  -> B站 discussion / danmaku / collection planner / live replay
  -> B站 trend / relationship / 统一 provenance_coverage
  -> P3 encrypted Evidence Vault
  -> P4 DeepResearch EvidencePackage adapter
```

任何正式平台任务发布前，production response route 继续为空；任何 capability 未获得当前策略版本的真实验证记录与 review 前，Console 不得批准执行。认证 Profile 的新实网动作必须满足账号安全状态、Profile、预算、at-most-once 和风险停止门禁；项目开发/验证使用所有者已授予的常设权限，不再重复索要逐 run 聊天授权。系统不设置任何计时冷却。
