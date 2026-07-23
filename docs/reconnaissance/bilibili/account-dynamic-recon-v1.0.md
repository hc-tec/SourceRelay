# B站账号动态真实侦察与 research runner v1.0

- 日期：2026-07-20
- 真实目标：`https://space.bilibili.com/7481602/dynamic`
- 能力：`dynamic`
- 策略候选：`bilibili.dynamic.account-feed.response-dom.v1 @ 1.0.0`
- 当前成熟度：research-only，`admissionEligible=false`
- 最终两页 artifact：`5ec5bef2-1517-4dd4-b5f0-7b1748e7223e`
- 最终 manifest SHA-256：`a6282dbf54d31370e61554cafd88645d2f64ee151a2a518680173026bde2094d`

## 1. 本轮只回答什么

本轮不把“能打开一个 UP 主动态页”冒充完整 B站动态能力，只回答以下窄问题：

1. 账号完整动态页的规范页面、筛选、卡片和 feed route 是什么；
2. DOM 没有稳定动态 ID 时，怎样把 response 稳定 ID 与人眼可见卡片可靠互证；
3. 一次可信滚动能否取得第二页，并证明 cursor 链、DOM 累计条目与 response 一致；
4. 视频、图文、预约、转发、专属占位等不同动态是否能进入同一 raw-first artifact；
5. 任务结束后是否保留页面并复用同一个工作 tab，而不是打开后立即关闭或不断新增 tab。

所有真实平台动作遵守 at-most-once：每个独立 run 中一次导航最多一次，一次滚动最多一次；失败后不在同一 run 补点。没有读取或保存 Cookie、Token、Authorization、请求头、请求体、浏览器 storage、WBI 值或 cursor 值，也没有点击关注、充电、点赞、评论、抽奖、预约或任何解锁控件。

## 2. 人类视角、DOM 与 Network 并行侦察

### 2.1 页面与首屏

独立可见 DevTools Profile 只导航一次到：

```text
https://space.bilibili.com/7481602/dynamic
```

页面标题、头像区和 MID 均对应目标账号。匿名侦察窗口显示登录提示，但公开动态正常可见；没有验证码、异常访问、412、429 或空 feed。主内容左侧只有两个可见筛选：

```text
全部 | 视频
```

真正持有 active 状态的是父节点：

```text
.side-nav__item.active
```

首屏存在 12 个渲染卡片：

```text
.bili-dyn-list__item
```

每个卡片都没有 `id`、`data-did`、`data-dynamic-id` 或其他稳定动态 ID，也没有公开的动态详情 anchor。因此 DOM 不能生成、猜测或替代 response `id_str`。

### 2.2 首屏实际覆盖的卡片

该账号是一个有效的混合类型样本，而不是“纯视频”样本。首屏同时出现：

- 公开视频卡：主链接为 `a.bili-dyn-card-video`，规范目标为 `/video/<BVID>`；
- 公开图文/预约卡：正文在 `.dyn-card-opus`，预约附加卡在 `.bili-dyn-card-reserve`；“去观看”是 `div`，不是可直接保存的规范 anchor；
- 转发卡：外层正文为 `.bili-dyn-content__forw__desc`，原对象作者区为 `.bili-dyn-content__orig__author`；
- 公开可见的充电专属占位：`.dyn-blocked-mask` 只显示档位、占位标题和解锁说明；
- 页脚三个动作槽都可能带通用 `forward` class，因此不能用 class 名里出现 `forward` 判断该卡是不是转发动态。

首屏全部卡片还有一个装扮权益链接 `/h5/mall/equity-link/collect-home`。它不是动态主对象，不能覆盖视频、Opus 或 response 动态 ID。

### 2.3 Feed route 与一次滚动

规范 feed response 为：

```text
GET https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space
```

只长期保存 route、状态、body 大小/摘要和 query key 名；`host_mid` 与 `offset` 的值只在当前 run 内核对。首屏请求满足：

```text
host_mid = 当前目标（仅内存核对）
offset = 空（仅内存核对）
status = 200
```

随后只发送一次浏览器级 `End` 键滚动。DOM 从 12 条增加为 24 条，并新增第二个相同 route 的 200 response；第二个 response 使用上一页返回的非空 offset。没有再次滚动、刷新或重发请求，页面没有验证码、风险提示或加载失败。

这证明“公开全部动态 + 一次滚动分页”在人类浏览器中可行。它不证明 feed 已到终点，因为第二页仍声明 `has_more=true`。

## 3. 产品投影与互证契约

### 3.1 Response 最小硬结构

每条 response item 只保存以下公开、可解释字段：

- `id_str` 形成稳定动态 ID；
- 动态类型、major 类型、目标账号 MID、显示名；
- 可见发布时间文本、动作说明和时间戳；
- 原创公开文本与 major 标题；
- 视频、Opus、专栏、直播、公开 URL 或动态 fallback 主身份；
- 置顶标识与 comment/forward/like 公开计数；
- 转发源稳定动态 ID、类型、作者、文本与主对象；
- `public | restricted_placeholder` 访问状态。

未知 response 对象、当前登录用户字段、签名/query 值和 cursor 不落盘。转发外层 `basic.jump_url` 若只是 B站首页，不能冒充主对象，必须回退到外层稳定动态 ID。

### 3.2 DOM raw-first 卡片

DOM 卡片按页面顺序保存：

- 外层公开作者与发布时间文本；
- 完整可见卡片文本；
- 去 query/hash 的公开链接；
- 去临时变体的公开图片引用和 alt；
- `video | opus | blocked | other` 卡片角色；
- `blockedPlaceholder / reservation / forwarded` 三个结构信号。

专属内容只保存页面公开可见的占位信息，不点击档位按钮，不尝试解锁，也不推断被遮挡正文。

### 3.3 同序互证

由于 DOM 没有动态 ID，互证采用以下组合，而不是伪造 ID：

```text
response 稳定动态 ID
  + response 外层作者/发布时间
  + response 主对象、正文或 major 标题
  + DOM 同序累计卡片
  + DOM 规范主链接、文本和结构角色
```

每页必须满足：

- response 累计 item 数等于 DOM 累计卡片数；
- 本页全部作者、发布时间、访问状态与转发状态一致；
- 可交叉链接的视频/文章/直播主身份全部匹配；
- 每卡至少有主链接、正文/标题或受限占位结构证据之一；
- 跨页 response 稳定动态 ID 不重复。

两个真实页面差异已经写入规范化规则：

1. response 富文本把表情保存为 `[捂眼]`，DOM 渲染成 `<img alt="[捂眼]">`，`innerText` 会少掉表情；只有 card media alt 确实包含同一标记时才允许消除差异；
2. 抽奖文案在 DOM 和 response 之间可能多一个零宽格式字符；互证会移除 Unicode `Cf` 格式控制符，但不删除普通正文字符。

## 4. 模块与产品职责

实现按职责拆开：

```text
bilibili-dynamic-contract.ts
  -> 输入、稳定类型、覆盖和安全契约

bilibili-dynamic-dom.ts
  -> 页面身份、筛选、累计卡片与风险信号

bilibili-dynamic-response.ts
  -> 精确 route/cursor 链、bounded response、同序互证

bilibili-dynamic.ts
  -> 一次导航、至多 N-1 次可信滚动、deadline 和动作账本

bilibili-dynamic-artifacts.ts
  -> manifest、逐页 JSON、SHA-256 和重启读取
```

Gateway 新增：

```text
GET  /v1/dynamic-artifacts
GET  /v1/dynamic-artifacts/<artifact-id>
POST /v1/profiles/<profile-id>/reconnaissance/bilibili-dynamic
```

账号安全新增 `authenticated_dynamic_reconnaissance`。最大 20 页对应一次导航加最多 19 次滚动，正好不超过单 run 20 个语义 action ID；总 deadline 为 60 秒。

## 5. 真实产品闭环

### 5.1 两个诚实保留的失败 artifact

第一次产品 run 在首屏停止：

```text
artifact = f8f3ded6-8c65-4874-bf0e-6c8d34211c63
captured = 1 page / 12 items
card evidence = 11 / 12
terminal = dom_response_mismatch
cause = response 表情文本与 DOM img alt 的表现差异
```

修复后另开独立 run；首屏 12/12 通过，一次滚动得到第二页，但第二页停止：

```text
artifact = 14e549f2-fb81-4f19-b2fe-d2762f8acd8d
captured = 2 pages / 24 unique items
page 1 card evidence = 12 / 12
page 2 card evidence = 11 / 12
terminal = dom_response_mismatch
cause = 抽奖文案的零宽格式字符
```

失败证据没有被成功结果覆盖，也没有在同一 run 补导航或补滚动。

### 5.2 最终两页预算成功

最终独立 run：

```text
run id = 659a1b48-77de-4779-bf51-0bb58e32b7da
artifact id = 5ec5bef2-1517-4dd4-b5f0-7b1748e7223e
manifest sha256 = a6282dbf54d31370e61554cafd88645d2f64ee151a2a518680173026bde2094d
state = partial
errorCode = null
terminal reason = budget_exhausted
captured pages = 2
page items = 12, 12
captured items = 24
unique items = 24
duplicate items = 0
forwarded items = 4
restricted placeholder items = 9
```

`partial` 不代表失败：请求预算明确只有两页，而第二页仍有后续 cursor，所以诚实终态必须是 `budget_exhausted`，不能写成完整账号 feed。

类型分布：

```text
DYNAMIC_TYPE_ARTICLE = 1
DYNAMIC_TYPE_AV = 6
DYNAMIC_TYPE_DRAW = 13
DYNAMIC_TYPE_FORWARD = 4

MAJOR_TYPE_ARCHIVE = 6
MAJOR_TYPE_BLOCKED = 9
MAJOR_TYPE_OPUS = 5
major none = 4
```

两页 response 均为 200；body 分别为 98819 和 106339 字节。每页的累计 DOM 数、同序卡片证据、访问状态、转发状态、作者与发布时间全部 12/12；可交叉链接的主身份每页均为 3/3。动作账本只有：

```text
open_dynamic_inventory -> attempted=true / attemptCount=1 / completed
load_dynamic_page_2    -> attempted=true / attemptCount=1 / completed
```

artifact 只有 `manifest.json`、`page-001.json`、`page-002.json`。读取接口重新验证 manifest 和逐页摘要。扫描结果：

```text
forbidden persisted matches = 0
persisted URLs with query or fragment = 0
persisted media transform suffixes = 0
nextOffset property = absent
stable dynamic IDs = 24 total / 24 unique
```

## 6. 页面生命周期缺陷与修复

用户指出真实用户不会“刚进入页面就立即关闭”。源码审计确认两个直接根因：

1. 冷启动 `#closeRestoredWebPages` 会关闭所有恢复出来的 HTTP(S) tab；
2. 旧认证 interaction reconnaissance 在 `finally` 中无条件 `page.close()`；
3. 各 research runner 只复用“当前 URL 与新目标完全一致”的 tab，跨主页、动态、投稿、系列和文章时会不断新建。

修复后的统一规则：

- 删除冷启动清除 web tab 的逻辑；headless worker probe 使用 offline context，不对恢复页发平台请求；
- 认证 interaction、登录状态检查和所有 B站 research runner 结束后保留目标页；
- 同一 Collection Profile 维护一个受管工作 tab；只要它仍停在上个 run 记录的规范页面，下个目标就在同一 tab 导航；
- 只持久化上个受管目标 `origin + pathname` 的 SHA-256，不保存 query；若浏览器环境本身恢复该 tab，Gateway 重启后可重新认领；
- 用户若手动把受管 tab 导航到其他页面，系统不劫持、不关闭它，而是创建新的受管 tab；
- Profile 状态只公开页数与所有权健康度，不公开浏览 URL。

真实本地 Chromium 生命周期门禁证明：跨目标复用同一个 Page；模拟用户手动导航后，原 Page 保持打开并创建新 Page；`livePlatformRequests=0`，不冒充 B站 E2E。

保存的 B站 Profile 又完成真实同窗口验证：

```text
account_profile artifact = 77f21fd0-b013-4ed1-871b-268d14c9567b
account_profile target selection = created_new_managed_tab

dynamic artifact = 3bb752a1-f42d-44c3-8d5c-a18833d68f65
dynamic target selection = reused_retained_managed_tab
dynamic action = attempted=true / attemptCount=1 / completed

Chrome PID = 34196 -> 34196
window handle = 5908336 -> 5908336
web pages = 1 -> 1
extension pages = 1 -> 1
managed work tab open/on expected page = true -> true
```

两个不同页面角色的 run 后，Chrome 没有关闭，窗口句柄没有变化，没有第二个 web tab；最终页面保留在 `7481602/dynamic`，账号安全为 `ready / activeRun=null`。

仍需诚实保留一个架构缺口：Gateway 进程退出会结束由 Playwright pipe 拥有的浏览器进程；真实测试证明 `--restore-last-session` 不能让该 web tab 自动恢复，因此该无效开关没有保留。若产品要求 Gateway 升级/崩溃时 OS 浏览器窗口也完全不关闭，需要独立 browser-host 与受保护的重连控制通道；这不是普通 tab 复用可以解决的问题。

## 7. 当前能说与不能说

已经能说：

- 给定规范账号主页，可以按预算取得动态 feed；
- 两页 cursor 链、24 个稳定动态 ID、DOM 同序卡片和跨页去重已在真实 Profile 中通过；
- 视频、图文、预约、转发、文章占位和专属占位可以进入同一安全 raw-first artifact；
- 普通连续任务不会在 run 后关闭页面，也不会因目标路径变化不断增加 tab。

仍不能说：

- 账号完整历史动态已经采完；
- `has_more=false` 终点、0 条/单页、置顶、删除原动态、直播卡、投票、长 feed 或采集中变化已经覆盖；
- 话题、提及、互动抽奖和预约字段已经全部硬结构化；当前完整可见文本仍主要由 AI 在 raw-first 卡片上解释；
- Gateway 重启时同一 OS 浏览器窗口可以无缝存活；
- MV3 正式 projector、独立 review 或 admission 已完成。

下一门槛是补 feed 终点和边缘样本，再把安全 response/DOM projector 迁移到 MV3。评论正文继续由 `discussion` 能力独立采集，不能塞进 dynamic inventory。

## 8. 2026-07-23 新 Gateway 两页动态 canary 与深度哨兵修复

在不重启当前 Browser Host、不中断已保留视频评论页的前提下，临时 Gateway 连接正在运行的新 Host，加载最新 Gateway 构建后重新验证同一账号动态页。首次 canary 暴露一个真实的投影缺陷：MV3 网络边界为超过安全递归深度的字段写入 `[truncated: depth limit]` 内部哨兵；某个普通 Opus 动态的 response 正文因此不可比较，而页面上仍然有公开可见正文，旧 cross-check 把它误判为 `card_evidence_mismatch`。

修复包含两部分：

1. Gateway 的 response projector 不再把 `[truncated: depth limit]` 当作公开字段；
2. 对 `primaryIdentity.kind=opus`、response 没有可比较正文、DOM 卡片仍为 `opus` 且作者/发布时间/访问状态一致的情况，采用明确的 DOM-only structural fallback。该 fallback 不把 `textMatch` 伪装成 `true`，只允许卡片整体互证通过；卡片类型、作者、发布时间或访问状态不一致时仍然失败。

真实复跑结果：

```yaml
runId: 6120c383-1899-441b-aecf-2b87813ac1e6
artifactId: b55952c4-dc71-4bd2-b1e4-b78bd6873cd5
targetAccount: 7481602
strategy: bilibili.dynamic.account-feed.response-dom.v1 @ 1.2.0
state: partial
terminalReason: budget_exhausted
navigationCount: 1
trustedScrollCount: 3
automaticRetry: 0
capturedPages: 2
capturedItems: 24
uniqueItems: 24
duplicateItems: 0
unresolvedCardEvidenceItems: 0
forwardedItems: 4
restrictedPlaceholderItems: 8
targetTabSelection: reused_matching_managed_tab
targetPage: retained_after_run
accountSafety: ready
```

两页中每页 12 条动态，DOM/response 累计数量一致，跨页稳定 ID 无重复，作者、发布时间、访问状态和转发状态均通过；视频、图文、普通 Opus、转发和充电专属公开占位仍按同一 raw-first artifact 保存。`partial / budget_exhausted` 是有意的预算终态：本 runner 只计划两页，而第二页仍返回后续 cursor，不能写成账号动态已到终点。

本次修复通过 31 个测试文件、100 个单元测试和 Gateway 构建；策略仍为 `research-only / admissionEligible=false`。尚未覆盖 feed 终点、置顶/删除/直播/投票等边缘样本，也没有把动态正文评论混入该能力。
