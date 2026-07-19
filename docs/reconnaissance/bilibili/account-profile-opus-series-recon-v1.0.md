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

1. 为 `account_profile` 定义公开字段的 raw-first DOM/response 合并契约，显式排除当前登录用户和消息 route；
2. 为 `article` 分开 `opus_inventory`、`opus_detail` 与 `discussion`，研究 cursor/滚动终点；
3. 为 `collection_series` 分开总览和每个系列的有界枚举，保持平台定义顺序；
4. 扩展权限只增加经审查的 `https://space.bilibili.com/*`，不能扩大为 `<all_urls>`；
5. 完成生产 MV3 projector、Gateway coordinator、ignored runtime artifact、真实 E2E 与人工 review 后再 admission。

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
