# B站账号公开档案、图文与合集/系列 Source Reconnaissance v1.0

- 状态：真实登录 Profile 上的人类流程、DOM 结构与 Network route 已证明；生产策略未 admission
- 日期：2026-07-20
- 页面角色：账号主页、图文目录、专栏详情、合集/系列总览、系列详情
- 浏览器：可见持久 Collection Profile；本轮未加载平台交互 runner
- 生产 response routes：未修改
- Admission eligible：否

## A. 本轮问题与保存边界

本轮回答三个独立问题：

1. `account_profile`：账号主页上哪些公开资料需要进入长期账号档案，DOM 与候选 response 怎样互证；
2. `article`：UP 主图文/专栏目录的真实页面角色是什么，正文究竟来自 DOM 还是独立 XHR；
3. `collection_series`：合集和系列怎样发现稳定 ID、打开详情、保持顺序并分页枚举条目。

项目所有者已决定：目标账号页面公开可见的信息可以进入长期账号档案。因此公开简介、公告中由账号自己发布的联系方式也属于可保存内容，但只保存在 ignored runtime artifact；侦察文档和 Git 不写样本昵称、简介、公告、联系方式、专栏标题、视频标题或当前登录用户身份。

仍然禁止读取或保存 Cookie、Token、Authorization、请求头、请求体、签名值、浏览器 storage、当前登录账号档案、完整 HAR 和页面未正常呈现的隐藏字段。

## B. Run 与动作账本

浏览路径：

```text
账号规范主页
  -> 点击“投稿”一次
  -> 点击“图文”一次
  -> 点击“专栏”筛选一次
  -> 点击“合集和系列”一次
  -> 点击第一个系列“查看更多”一次
  -> 展开排序菜单一次
  -> 点击系列“下一页”一次
  -> 从已观察到的公开专栏卡片 URL 导航到 /opus/<id> 一次
```

每个动作都使用浏览器级输入，`attemptCount=1`。没有点击关注、发消息、点赞、投币、收藏、分享、评论、播放全部或排序选项；没有刷新、失败重放、复制 API 请求或重放签名 query。

## C. `account_profile` 公开表面

### C.1 视觉事实

账号主页公开显示：

- 头像、横幅、昵称与公开简介；
- 等级、会员或其他公开身份标识；
- 关注数、粉丝数、获赞数、播放数；
- 投稿总数、合集和系列总数；
- 主页、动态、投稿、合集和系列入口；
- 代表作和视频预览；
- 充电人数；
- 公告全文；
- 关注与发消息控件。

关注和发消息只记录为状态改变控件存在，不进入默认只读动作计划。

### C.2 DOM 事实

本次页面的公开结构候选：

| 对象 | 当前 DOM 结构 | 使用方式 |
|---|---|---|
| 昵称 | `.nickname` | 结合规范 MID 页面、位置和候选 response 互证，不能只依赖类名 |
| 简介 | `.pure-text` | 保存完整公开文本，同时记录文本摘要和捕获时间 |
| 统计标签 | `.nav-statistics__item-text` | 与同容器 `.nav-statistics__item-num` 成对读取 |
| 投稿/合集计数 | `.nav-tab__item-text` + `.nav-tab__item-num` | 入口 URL、标签和计数共同证明页面角色 |
| 公告 | `.ann-section` | 保存公开全文；不得把其中联系方式误判为认证材料 |
| 头像/标识图片 | 页面顶部可见 `img` 与父容器 | 对 `hdslb.com` 媒体路径去 `@...webp/avif` 变体后互证 |
| 横幅 | 账号头部视觉容器 | 可能是 CSS 背景而不是普通 `img`，需独立媒体 projector |

长期档案应保存 `capturedAt`，因为昵称、简介、头像、横幅、标识、公告和统计都会变化。公开统计是时间点快照，不能冒充永久值。

### C.3 候选 Network routes

账号主页当前观察到的主要 200 route：

| 能力 | origin + pathname | 结论 |
|---|---|---|
| 公开身份 | `https://api.bilibili.com/x/space/wbi/acc/info` | 只允许保存与公开 DOM 互证的白名单 |
| 关注/粉丝 | `https://api.bilibili.com/x/relation/stat` | 时间点公开统计 |
| 获赞/播放 | `https://api.bilibili.com/x/space/upstat` | 时间点公开统计 |
| 投稿类型计数 | `https://api.bilibili.com/x/space/navnum` | 视频/图文/音频等公开数量 |
| 公告 | `https://api.bilibili.com/x/space/notice` | 与 `.ann-section` 公开全文互证 |
| 代表作 | `https://api.bilibili.com/x/space/masterpiece` | 独立 highlight，不得并入全量投稿目录 |
| 首页合集预览 | `https://api.bilibili.com/x/polymer/web-space/home/seasons_series` | 只证明预览，不代表合集全目录 |

同一页面还会请求当前登录用户、消息、收藏、关系状态、广告、推荐和遥测 route。尤其 `/x/space/v2/myinfo`、`/x/web-interface/nav`、消息与 passport route 不属于目标账号公开档案，projector 必须显式排除。

## D. `article`：图文目录和 `/opus/<id>` 正文

### D.1 页面角色

“投稿”默认进入：

```text
https://space.bilibili.com/<mid>/upload/video
```

点击“图文”后实际进入：

```text
https://space.bilibili.com/<mid>/upload/opus
```

当前页面提供三个内容筛选：

```text
全部图文 | 专栏 | 动态
```

因此旧的 `/upload/article` 不能作为当前规范页面假设。`article` 与 `dynamic` 在产品能力矩阵中仍是两类能力，即使页面把它们聚合在同一个“全部图文”入口。

### D.2 目录 routes

| 动作/筛选 | 新增 route | 当前含义 |
|---|---|---|
| 打开全部图文 | `https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/space` | 账号公开 opus feed；需研究 cursor 与滚动终点 |
| 选择专栏 | `https://api.bilibili.com/x/article/up/lists` | 专栏列表候选；当前卡片仍规范到 `/opus/<id>` |

样本页面公开声明图文总数非零，首屏卡片包括标题/摘要、图片、时间/作者语境和公开统计。尚未证明大量图文账号的无限滚动、cursor、最终终点、删除/锁定内容和采集中新增内容，因此目录仍为 `partial`。

### D.3 专栏详情正文

从专栏筛选的真实公开卡片进入：

```text
https://www.bilibili.com/opus/<opus-id>
```

视觉和 DOM 同时证明：

- 标题：`.opus-module-title__text`；
- 作者公开身份：`.opus-module-author`、`.opus-module-author__name`、头像；
- 发布时间：`.opus-module-author__pub__text`；
- 正文：`.opus-module-content.opus-paragraph-children`；
- 公开声明/版权：`.opus-module-copyright`；
- 底部与侧边工具栏：点赞、投币、收藏、分享、评论数量；只读统计，不点击；
- 旧版入口：`.side-toolbar__btn` 的公开控件。

本样本正文 DOM 一次加载出完整长文本、多个段落和多张正文图。页面导航后没有出现独立的正文 JSON API；正文来自服务器返回的 document DOM。XHR 主要是评论能力：

```text
/x/v2/reply/subject/description
/x/v2/reply/subject/interaction-status
/x/v2/reply/wbi/main
```

产品含义：专栏正文首选 DOM raw-first artifact，而不是继续寻找或重放传统 API。保存标题、作者、发布时间、正文富文本顺序、图片规范引用、公开统计、规范 URL 与 DOM 文本/媒体摘要；评论仍进入独立 `discussion` 阶段。

## E. `collection_series`

### E.1 总览

点击“合集和系列”后进入：

```text
https://space.bilibili.com/<mid>/lists
```

总览页面由以下 route 驱动：

```text
GET https://api.bilibili.com/x/polymer/web-space/seasons_series_list
```

页面公开显示每个系列的标题、声明条目数、若干视频预览、“播放全部”和“查看更多”。预览卡片不能冒充系列完整条目关系。

### E.2 系列详情和分页

点击某个“查看更多”一次后进入稳定详情页：

```text
https://space.bilibili.com/<mid>/lists/<series-id>?type=series
```

新增 200 route：

```text
GET https://api.bilibili.com/x/series/series
GET https://api.bilibili.com/x/series/archives
```

`/x/series/series` 提供系列身份/元数据候选；`/x/series/archives` 提供当前系列条目页，控制 query key 包括 `series_id`、`mid`、`pn`、`ps`、`sort`、`only_normal`。只保存 key 名，不保存或重放签名/上下文值。

真实样本详情：

```text
declared items = 129
visible unique BVID on page 1 = 30
numeric page controls = 1..5
sort options = 默认排序 / 倒序排序
```

点击“下一页”一次后：

```text
response route = /x/series/archives
response status = 200
response page = 2（仅在当次控制中核对）
DOM active page = 2
visible unique BVID = 30
page 1/page 2 overlap = 0
```

系列定义的顺序是产品数据，不能用发布时间重新排序后冒充。projector 必须保存 `seriesId`、系列类型、标题/说明、声明总数、当前 sort 角色、条目位置、页码、BVID、规范 URL、终点和去重结果。

## F. 产品分层

```text
Gateway 浏览器控制层
  -> 可信导航、图文筛选、系列详情、排序展开和分页点击
  -> 每个语义动作 at-most-once，遇到风险/断网/上下文漂移停止

MV3 Extension
  -> 精确 space.bilibili.com / www.bilibili.com tab-document-run 绑定
  -> account profile、opus、series DOM 投影
  -> 精确 response 白名单 projector，不读取 request headers/body

Gateway Enumeration Coordinator
  -> 账号/图文 cursor/系列页账本、去重、声明终点、恢复与 artifact
```

不能把账号视频目录的 admission 继承给图文、正文、合集或系列；四者需要各自 strategy/version、真实样本和 review。

## G. Profile 交接经验

本轮曾为“无扩展干净侦察”用 `--disable-extensions` 启动同一个产品 Profile。交还 Gateway 后，扩展配对仍在，但 Chrome 把原有 B站 optional origins 报为 `missing`。系统没有重复提交权限动作：第一次 Gateway 权限请求已打开原生对话框但本地 HTTP 回执超时；随后 Windows UI Automation 只在同时匹配扩展名与两个精确 B站 scope 的唯一对话框中 Invoke 一次“允许”。最终恢复为：

```text
extension 0.4.24
paired = true
strategyPermission = granted
account safety = ready
active run = null
```

以后复用产品 Profile 做干净侦察时，不再以 `--disable-extensions` 启动同一目录。生产扩展没有静态平台 content script，可以保持被动加载，同时把 `existingPlatformRunnerUsed=false` 写进 run。必须在 Profile 交还后核对 worker marker、配对、精确权限和账号安全状态；回执丢失时先读状态或处理已经存在的唯一原生对话框，禁止重复发权限请求。

## H. 下一门槛

1. 为 `article` 分开 `opus_inventory`、`opus_detail` 与 `discussion`，实现 cursor/滚动终点和正文 raw-first artifact；
2. 由 planner 使用总览 artifact 的稳定 ID 逐个调用单系列 runner，补 season、0 条系列、单页系列、采集中变化与中断恢复样本；
3. 把当前 Gateway research projector 迁移到生产 MV3 Extension，保持可信输入、response 观察与 Gateway 账本的职责边界；
4. 扩展权限只增加经审查的 `https://space.bilibili.com/*`，不能扩大为 `<all_urls>`；
5. 各能力完成多样本真实 E2E 与人工 review 后分别 admission，不能让单系列成功替代整个 `collection_series`。

## I. `account_profile` research runner 真实闭环

在上述人工式侦察完成后，Gateway 增加独立的 `bilibili.account.profile.dom.v1 @ 1.0.0` research runner。它只执行一次规范账号主页导航；DOM projector 只接受账号头部、公开统计、账号导航、公告、充电区和代表作白名单，明确排除全站 header 和当前登录用户。Network 只保存七条目标 route 的 method、origin、pathname、status、query key 名和时间，不读取 response body、request header/body、Cookie 或 Token。

第一次真实 artifact `ca139760-fc5c-46f8-9590-5e334928cf75` 已完成核心身份，但 coverage 诚实显示 `bannerCaptured=false / chargeSectionCaptured=false`。原因不是平台缺少数据，而是横幅位于页面顶部 CSS/伪元素且可能使用协议相对媒体 URL，充电卡当前 DOM 不使用预设 `.charge-section` 类名。

修复后用独立 run 复验：

```text
artifact id = 3fbff896-aa28-4b47-babd-bceef7317a40
manifest sha256 = 5637efef14ac0083af732fd6a724d4313ce43a9dd52773a97c5b810e0e20376f
state = completed
terminal reason = profile_captured
identity captured = true
avatar captured = true
banner captured = true
badge count = 1
public field count = 8
announcement captured = true
charge section captured = true
highlight count = 3
observed target routes = 7
```

唯一 `open_account_profile` 动作为 `attempted=true / attemptCount=1 / completed`，账号安全终态为 `ready / activeRun=null`。artifact 读取时重新验证 manifest 与 `profile-snapshot.json` SHA-256；递归敏感字段扫描为 0，没有 Profile ID、当前登录用户字段、认证材料、本机路径、扩展 URL 或 query/fragment 值。

这证明目标账号公开档案已具备按需本地保存的 research 能力；它仍未迁移到生产 MV3 projector，也没有通过多账号、默认头像/横幅、无公告、无代表作、特殊认证标识和页面漂移样本，因此 `admissionEligible=false`。

## J. `collection_series` 总览 research runner 真实闭环

Gateway 随后增加独立的 `bilibili.collection-series.overview.response.v1 @ 1.0.0` research runner。唯一动作是导航规范 `/lists`；它只读取当前页面产生的精确 `seasons_series_list` response，长期保存 `meta` 与预览卡片白名单，同时把未知字段压缩为 schema path/type/array length，绝不持久化未知值。

第一轮真实 artifact `f91a0b54-0888-4fb2-bbe4-6e526ebf03e8` 为 `partial / response_projection_failed`。schema 证明当前响应为：

```text
data.items_lists.page
data.items_lists.seasons_list = []
data.items_lists.series_list = 11 items
series item = meta + archives + recent_aids
```

无值诊断进一步定位为 `item_0_cover_invalid`：公开 `hdslb.com` 封面使用 HTTP URL，而原 sanitizer 只接受原始 HTTPS。修复只允许 `http(s)://hdslb.com` 及子域，并确定性升级成 HTTPS、去 query/hash 和 `@...webp/avif` 变体；没有扩大主机范围。

第二阶段 response 投影成功，但 artifact `66cfc877-1de8-45a4-b66d-53f6e881ab38` 诚实记录 `dom_response_mismatch`。结构诊断确认：

- 每个正常区块最近容器是 `.video-list`；
- response 最多返回 6 个预览，DOM 只公开显示前 5 个，因此只要求每个 DOM 预览能在 response 找到；
- 一个 0 条系列没有视频或“查看更多”，旧逻辑错误向上爬到 `.contet-list`；
- 声明数量在 `.video-list__header` 组合文本中，不是独立纯数字叶节点。

最终真实 artifact：

```text
artifact id = f274a267-3d89-45de-b301-ee221a8a78b1
manifest sha256 = c741e0360b5525568f0c636dac29feaa9b9590da8f99a49de8f95323bcbb528c
state = completed
declared lists = 11
captured lists = 11
series = 11
seasons = 0
response preview items = 37
DOM visible preview BVIDs = 32
matched DOM preview BVIDs = 32
zero-item series = 1
terminal reason = overview_captured
```

11 个标题、11 个声明数量、11 个稳定 series ID 全部互证；response 中额外但未显示的预览没有被冒充为 DOM 可见项。唯一导航动作 `attemptCount=1 / completed`，账号安全回到 `ready / activeRun=null`。

artifact 包含 `overview.json`、`response-schema.json` 和 manifest，三类 SHA-256 均在读取时复核。敏感字段扫描为 0：没有 Profile ID、当前登录用户、认证材料、本机路径、网络 query 值或未知 response 值。

该检查点只证明合集/系列总览及稳定 ID 发现。单系列完整分页已经由下节的独立 runner 证明，但 planner 遍历全部系列、season、恢复与正式 MV3 策略仍未完成，因此整个 `collection_series` 仍未 admission。

## K. `collection_series` 单系列详情 research runner 真实闭环

Gateway 新增 `bilibili.collection-series.series-detail.response.v1 @ 1.0.0` research runner。每个 run 只处理总览 artifact 中的一个稳定 series ID；本次目标从 `f274a267-3d89-45de-b301-ee221a8a78b1` 读取，没有把账号或系列 ID 硬编码进 runner。页面始终保持平台默认排序，保存固定语义 `canonicalPageQuery=stable_type_series_only / sortRole=platform_default`，不保存 query 值。

实现按职责拆为 contract、DOM、response、coordinator 与 artifact store：

- `/x/series/series` 只投影公开系列身份、标题、说明、封面、声明数量和更新时间；
- `/x/series/archives` 只投影 BVID、规范 URL、标题、公开封面、时长、发布时间和页面可见统计；
- 每页必须满足 response/DOM BVID 集合精确一致、摘要一致、全部标题匹配、active page 正确；
- 跨页 BVID 发现重复立即停止；各页声明总数、page size 和预期条目数必须一致；
- 60 秒总 deadline，1 次详情导航加至多 19 次分页动作，每个语义 action ID 只能登记一次；
- response 未知值不落盘，只保存 schema path/type/array length、body digest、状态和 query key 名。

完整 Gateway 构建门禁通过后，先有意关闭旧 Gateway 管理的浏览器会话，再用原状态目录加载新代码。保存的 B站 Collection Profile 登录态被正常复用，真实 run 只提交一次：

```text
artifact id = 74c51a6b-ddb2-4011-8980-330dba19e471
manifest sha256 = 52415bc4b587f186524d6743d77dd9ee570eec5bda6319e334616784deee3ffe
state = completed
series = Python零基础
declared total = 129
declared pages = 5
captured page items = 30, 30, 30, 30, 9
captured items = 129
unique items = 129
duplicate items = 0
terminal reason = declared_terminal_reached
```

五页全部满足 response/DOM 身份摘要精确一致和标题全匹配。动作账本只有 `open_series_detail` 与四个 `open_series_page_N`，五个动作均为 `attempted=true / attemptCount=1 / completed`，没有失败重放。

artifact 包含 `metadata.json`、`metadata-response-schema.json`、五个逐页 JSON 和 manifest；读取接口重新验证 manifest、元数据、response schema 与每页 SHA-256。递归扫描没有 Profile ID、浏览器运行 ID、Cookie/Authorization 字段、请求头对象、网络 query 值、本机绝对路径或扩展 URL。run 后状态为：

```text
extension = 0.4.24
paired = true
strategyPermission = granted
chromeUiReloadAttempted = false
contextRestarted = false
account safety = ready
active run = null
```

这证明“给定稳定 series ID，按平台默认顺序完整枚举单个公开系列”已经具备可重复调用的 research 底层能力。它不证明所有系列、season、0 条/单页、采集中变动或断点恢复，也尚未迁移到生产 MV3 projector，因此 `admissionEligible=false`。
