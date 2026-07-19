# B站 UP 主公开档案与投稿目录 Source Reconnaissance v1.0

- 状态：账号身份、登录门禁与 9 页 / 330 条全目录真实 research 闭环已证明；正式 MV3 策略与 admission 未完成
- 日期：2026-07-20
- Evidence objective：`account_context + account_archive`
- 页面角色：公开视频详情入口、UP 主主页、投稿视频目录
- 账号类别：anonymous 与 user-managed authenticated 对照
- Production response routes：空
- Admission eligible：否

## A. 需求与边界

本轮只回答：Collector 能否从一个已知公开视频进入稳定 UP 主身份，在账号页面取得公开档案，并以可恢复、可去重的分页目录枚举当前公开投稿。

必需数据：

- 规范主页与稳定 MID；
- 页面公开可见的昵称、简介、统计和公开字段；
- 投稿类型计数；
- 视频 BVID、规范 URL、标题、公开时间、时长、封面引用及卡片可见统计；
- 页码、每页条数、声明总数、去重和终止条件；
- 匿名/登录差异、风险状态和失败语义。

禁止读取或保存 Cookie、Token、请求头、请求体、签名值、浏览器 storage、完整 HAR、隐藏账号字段和当前登录用户身份。原始 response 只在临时目录中做 schema/白名单研究，完成后删除。

## B. 人类浏览路径

```text
已知公开视频
  -> 从页面公开 UP 主链接确认规范主页与 MID

独立匿名 run
  -> 打开规范主页一次
  -> 观察账号档案和首屏投稿
  -> 点击“投稿”一次
  -> 遇到目录 412 与矛盾空状态后停止

独立登录态 run
  -> 使用保存的 B站 Collection Profile
  -> 直接打开规范投稿视频页一次
  -> 核对第一页 DOM 与页面响应
  -> 点击“下一页”一次
  -> 核对第二页 active 状态、DOM、响应和去重
  -> 停止，不进入第三页
```

语义动作账本：

| run | action | attempted | count | outcome |
|---|---|---:|---:|---|
| anonymous | `open_account_upload` | true | 1 | 页面进入目录，但请求 412，矛盾空状态 |
| authenticated | `open_inventory_page_2` | true | 1 | 第二页 active，response 200，40 条互证 |

没有刷新、后退重做、匿名重试、第三页点击或自动登录。

## C. 页面角色与状态矩阵

| role | 规范 URL 规则 | success | auth/risk | unavailable |
|---|---|---|---|---|
| profile | `https://space.bilibili.com/<mid>` | MID、公开档案、内容入口可见 | 匿名会显示登录提示但档案仍可见 | 验证、限流、布局未知时停止 |
| upload video | `https://space.bilibili.com/<mid>/upload/video` | 类型计数、排序、卡片和分页可见 | 本样本匿名目录请求 412；登录态 200 | 计数非零但空 DOM 属于矛盾状态，不是 no_results |
| dynamic | `https://space.bilibili.com/<mid>/dynamic` | 本轮未验证 | 未验证 | 保持 gap |
| lists | `https://space.bilibili.com/<mid>/lists` | 本轮只确认入口与数量可见 | 未验证 | 保持 gap |

## D. 视觉与 DOM 事实

匿名主页公开呈现：

- 稳定 MID 对应的账号主页；
- 昵称、简介、头像/头图、关注与粉丝统计；
- 主页、动态、投稿、合集和系列入口；
- 代表作与视频卡片；
- 最新发布、最多播放、最多收藏；
- 公告与其他页面公开字段。

登录态投稿目录公开呈现：

- 投稿总数由视频、图文、音频构成；
- 视频目录声明 330 项；
- 每页 40 条；
- 分页按钮 1–9、下一页和“共 9 页 / 330 个”；
- 第二页按钮在一次点击后具有 `vui_button--active` 后置条件；
- 第一、第二页各 40 个唯一 BVID，跨页重复为 0。

选择器不能只依赖单个 class。生产策略至少同时使用页面角色、MID URL、BVID 规范链接、分页按钮公开文本、active 状态和响应页码互证。

## E. XHR/fetch 事实

主页导航出现的候选精确 route：

| 数据表面 | origin + pathname | 本轮状态 |
|---|---|---|
| 账号公开档案 | `https://api.bilibili.com/x/space/wbi/acc/info` | 200；只允许映射与 DOM 公开字段一致的白名单 |
| 关系统计 | `https://api.bilibili.com/x/relation/stat` | 200；只映射页面公开统计 |
| 账号统计 | `https://api.bilibili.com/x/space/upstat` | 200；只映射页面公开统计 |
| 内容类型计数 | `https://api.bilibili.com/x/space/navnum` | 200 |
| 视频投稿目录 | `https://api.bilibili.com/x/space/wbi/arc/search` | 匿名目录页 412；登录态 page 1/2 均 200 |
| 专栏目录 | `https://api.bilibili.com/x/space/wbi/article` | 200 候选；本轮未做字段映射 |
| 合集/系列 | `https://api.bilibili.com/x/polymer/web-space/home/seasons_series` | 200 候选；本轮未做字段映射 |
| 公告 | `https://api.bilibili.com/x/space/notice` | 200 候选；本轮未做字段映射 |

目录 route 的控制 query key 包含 `mid`、`order`、`pn`、`ps`、`special_type` 和 `tid`。页面同时携带时序、签名和设备上下文 key；策略不得保存、复制或重放其值，只观察当前页面自己产生的 response。

## F. 目录 response 白名单候选

登录态第一页：

```text
response page = 1
response page size = 40
declared total = 330
response unique BVID = 40
DOM unique BVID = 40
identity digest exact match = true
```

登录态第二页：

```text
response page = 2
response page size = 40
declared total = 330
response unique BVID = 40
DOM unique BVID = 40
identity digest exact match = true
page 1/page 2 overlap = 0
combined unique BVID = 80
```

首版长期目录只应投影当前卡片可见或用于稳定身份/覆盖的字段：

```text
bvid
title
created
length
pic
play
video_review
page.pn / page.ps / page.count
```

`w_rid`、`wts`、设备图片字段和请求上下文完全丢弃。response 中的其他字段必须逐项完成页面可见性映射后才能加入长期 Evidence；不能保存整个通用对象。

## G. 匿名矛盾空状态

匿名主页公开显示视频数量非零，进入投稿目录后：

```text
/x/space/wbi/arc/search -> HTTP 412
DOM -> “空间主人还没投过视频”
```

这两个事实互相矛盾，因此正确终态是 `authentication_required_or_risk_limited / partial`，不是 `no_results`。禁止刷新、代理轮换、复制签名或将旧主页 response 冒充当前目录页成功。

## H. 候选生产设计

```text
bilibili.account.archive.response.v1

Gateway Playwright browser controller
  -> 打开规范投稿目录
  -> 读取实时分页控件
  -> 每页按钮只点击一次
  -> 网络/验证/上下文异常立即停止

MV3 Extension
  -> 精确 tab/document/run 绑定
  -> DOM BVID/标题/active page cross-check
  -> 精确 arc/search 白名单 response 投影
  -> 不读取 header/request body/Cookie/Token

Gateway
  -> 单一 Enumeration Coordinator
  -> BVID 去重账本、页码、声明总数与恢复检查点
  -> raw-first page artifact + manifest + coverage
```

账号档案、视频目录、图文目录、动态与合集是独立子能力。首个正式策略不得把尚未验证的动态、专栏或合集正文一起 admission。

## I. 下一 admission 门槛

1. 在代码中实现 account/profile 与 paged video inventory 的独立契约；
2. 浏览器控制层执行可信分页，扩展只观察 DOM/response；
3. 用登录 Collection Profile 完成 9 页或在真实风险/预算处诚实 partial；
4. 每页 BVID response/DOM 精确匹配，跨页去重与总数对账；
5. 验证零投稿账号、单页账号、最后一页不足 40 条、置顶/重排、内容新增和登录失效；
6. 构建、权限、敏感字段扫描、真实 E2E 和人工 review 通过后才允许 admission。

## J. Research runner 真实全目录闭环

人工式可行性完成后，Gateway 增加了独立的 research-only account archive runner。它使用受管、可见、持久 B站 Collection Profile 做可信导航与分页，同时读取当前页面自己产生的精确 `arc/search` response；每一页只有在 active 页码、DOM BVID 集合和 response BVID 集合三者一致后才提交 Evidence。

第一次真实 runner run 在第 3 页诚实停止：按钮已经变为 active，但旧卡片尚未完成替换，旧版等待条件过早读取了第 2 页 DOM。artifact `04b2e697-50e6-4a9b-8e16-953cca3b2c9c` 因此记录为 `partial / dom_response_mismatch`，没有补点或重试。修复后的后置条件要求：

```text
active page = expected page
DOM BVID set = current response BVID set
DOM identity digest = response identity digest
```

最新完整真实 artifact：

```text
artifact id = 2fa4b163-5865-41be-849d-88c888e4072e
manifest sha256 = c1527245e635d1d06738e95a4c80a2a05bcfd67c2b0e94bfc736dfc97378dcc8
state = completed
declared total = 330
declared pages = 9
captured pages = 9
page item counts = 40,40,40,40,40,40,40,40,10
unique items = 330
duplicate items = 0
terminal reason = declared_terminal_reached
```

九页全部满足：HTTP 200、response/DOM BVID 集合精确一致、身份摘要一致、标题完整映射。`open_account_inventory` 与页 2–9 的八个分页动作均为 `attempted=true / attemptCount=1 / completed`。修正 B站 CDN 图片变体映射后，目标账号昵称、简介和头像也全部通过页面公开内容互证。

随后用一页预算执行独立生命周期检查。artifact `78fb1061-ec3b-4c6d-a6df-769df6b98501` 明确记录 `targetTabSelection=reused_matching_managed_tab`，只导航一次、没有翻页，也没有为同一目标新建第二个 B站 tab。终态为预期的 `partial / budget_exhausted`，账号安全状态回到 `ready`，无 active run。

两个新 artifact 均通过读取时 manifest/page SHA-256 复核和敏感字段扫描：不包含 Profile ID、Cookie/Token 值、Authorization、request header/body 值、query/fragment 值、浏览器目录或扩展 URL。目标账号公开资料只保存在 ignored runtime，不提交样本昵称、简介内容或公开联系方式。

## K. 当前产品结论

当前人工可行性与 Gateway research runner 真实闭环均为 `proved`，但正式产品能力仍为 `not_admitted`。现在已经证明的不是“B站所有账号数据都完成”，而是：对这个真实登录样本，稳定账号身份和当前公开视频投稿目录可以安全、可恢复地完整枚举。

正式 admission 仍需：

1. 将精确 response 观察迁移到生产 MV3 Extension，由 Gateway 只负责可信输入、页账本与 artifact；
2. 保持精确 `space.bilibili.com` optional permission，不扩大为 `<all_urls>`；
3. 真实验证零投稿、单页、置顶/重排、采集中新增内容、登录失效和风险停止；
4. 将图文、音频、动态、专栏正文、合集与系列分别建立独立 capability 和策略版本；
5. 完成当前版本的人工 review 后，才允许把 `bilibili.account.archive.response.v1` 加入 production route。
