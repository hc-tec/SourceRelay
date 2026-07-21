# B 站 UP 主视频清单首屏：DOM-only MVP 契约 v0.1

- 日期：2026-07-21
- 状态：已完成独立匿名实网侦察与受管 Profile 产品闭环
- 示例账号：`https://space.bilibili.com/7481602`
- 目标页面：`https://space.bilibili.com/7481602/upload/video`

## 1. 要解决的问题

当用户给出一个规范 B 站 UP 主主页时，系统能否在受管浏览器的**同一精确投稿目录页面**中，以一次导航、零页面交互的方式，保存当前首屏可见的视频投稿卡片，作为“某博主的所有视频”场景的安全入口。

这不是全量枚举承诺。它只回答“该账号此刻第一页公开可见的投稿是什么”；第 2 页及以后、排序、筛选、图文、音频、合集与系列都必须另建策略和动作预算。

## 2. 当前页面事实（独立匿名实网侦察）

2026-07-21 在独立、匿名、无扩展的可见 Chromium 临时会话中，页面一次导航后可同时看到：

- 账号头部、投稿导航和“TA 的视频”页面角色；
- 可见 `.video-list.grid-mode`；
- 可见 `.bili-video-card__wrap` 投稿卡片；
- 卡片封面与标题入口均指向 `www.bilibili.com/video/BV…`；
- 平台为这些公开链接附加了 query，因此身份必须只从 pathname 提取 BVID，query 不能进入 artifact；
- 登录浮层可见，但不遮蔽首屏视频卡片。

旧研究中“匿名目录必然 412 且空 DOM”的结论已经过期，不能继续作为当前页面状态机的依据。此次侦察没有点击登录、关闭浮层、排序、筛选、分页、播放或打开任何视频，也没有读取 Network response、request header、Cookie、Token 或 query 值。截图和 CLI 临时材料已清理。

## 3. MVP 边界

```text
最大页面数                     1
最大卡片数                     40
目标页面导航                    1 次
页面交互                        0 次
response / XHR 采集             0 条
自动平台重试                    0 次
截图                            1 份 runtime 视觉证据
终态页面                        retained_for_review
```

允许持久化的公开 DOM 投影：

```text
规范 MID 与规范主页
规范投稿视频目录身份（不带 query）
首屏可见视频卡片：BVID、规范视频 URL、标题、bounded visible text、公开封面引用（若可见）
可见卡片数、登录浮层 / 验证 / 限流 / 不可用布尔状态
```

明确排除：第 2 页及以后、排序/筛选操作、全量总数推断、response body、请求 query/header/body、Cookie/Token、作者动态、图文、音频、合集、字幕、评论、推荐和任意 DOM/JS/selector 输入接口。

## 4. 证据与完成语义

一个 `page_one_ready` 结果至少需要：

1. Browser Host 的精确 lease、run 与 document generation；
2. source-specific Extension binding 得到的确切 Chrome document ID；
3. 当前 URL 规范化后仍等于目标 `/upload/video` 页面；
4. 页面 URL MID 与 DOM 提取 MID 相同；
5. 可见 `.video-list` 与至少一张可见、可规范化 BVID 的卡片；
6. 一份导航后的视觉证据。

登录浮层本身不是失败；只有页面没有卡片且登录/验证/风险信号阻止页面完成时，才记录相应 partial / failed 终态。若页面身份、document 或导航结果未知，立即结束当前 run，不重放导航。

## 5. 分层设计

```text
Browser Host
  -> 精确 page lease、一次导航、视觉证据、终态页面保留

MV3 Extension
  -> 精确 tab/document/run binding
  -> 固定的 account-video-list DOM 投影
  -> pathname 提取 BVID，丢弃 URL query

Gateway
  -> MID 输入校验、动作账本、账号安全、去敏 artifact、coverage
```

本策略不复用旧的 `arc/search` response runner。旧 runner 只可作为字段和失败语义的历史参考；当前实现的能力来源是受管浏览器中的公开可见页面。

## 6. 后续能力分界

```text
投稿视频首页       -> 本文 MVP
受控分页            -> 独立 account_inventory.pagination 策略
排序 / 筛选         -> 独立 account_inventory.filter 策略
单条视频详情        -> 已验证 bilibili.video.detail.dom.v2
图文 / 音频         -> 独立页面角色与策略
合集 / 系列         -> 独立 collection_series 策略
```

只有首页真实闭环通过后，才讨论分页。不能把一页 DOM 成功误报为“已抓完一个 UP 主的全部视频”。

## 7. 受管 Profile 产品闭环（2026-07-21）

在完成独立匿名侦察后，以**另一条受管、登录的 B 站 Collection Profile 产品路径**执行了一次闭环。此次验证不是重新进行人类可行性侦察，而是验证 Browser Host、MV3 Extension 与 Gateway 能否把已经证明的首页 DOM 方案安全地交付为产品能力。

### 7.1 启动与版本证据

在执行前，账号安全状态为 `ready`，没有 active run，也没有 managed page lease。由于此前运行中的 worker 是 `0.7.5 / revision 9`，先在无 lease 时按显式生命周期关闭该 Profile 和 Browser Host，再以同一受管状态目录启动 `0.7.6 / revision 10`：

```text
headless probe                    true
initial runtime                   0.7.5 / revision 9
final runtime                     0.7.6 / revision 10
Native Messaging                  connected
managed pages before product run  0
active leases before product run  0
```

该升级只服务于版本切换；它不是每次 run 结束后关闭浏览器的策略。

### 7.2 真实结果

对本文规范 UP 主主页仅提交了一次产品 run。结果为：

```text
state                            completed
terminal reason                  page_one_ready
captured visible cards           40
unresolved cards                 0
navigation                       1
hover / click / scroll           0 / 0 / 0
automatic platform retry         0
response observations            0
runtime visual evidence          present
terminal managed page            retained_for_review
active leases after run          0
Account Safety after run         ready
```

Gateway 仅核对了去敏 artifact 的 digest、数量、动作账本和 safeguard 摘要；未将标题、原始链接 query、截图、Cookie、Token、请求 header/body 或 response body 输出到文档或 Git。artifact 同时证明：

```text
request headers                  not_read
request body                     not_read
cookies and tokens               not_read
network query / fragment values  not_read
response bodies                  not_read
```

### 7.3 结论与不能越过的边界

结论是 `proved`：在当前真实页面上，产品能以固定 DOM 投影、安全 document binding 和一次受控导航，可靠取得**当前首屏可见**的公开视频卡片。登录浮层并不自动阻断这项页面能力。

这次结果**不**证明以下命题：

- “该 UP 主所有投稿均已获取”；
- 当前 40 张卡片等于其总投稿数；
- 第 2 页、排序、筛选、图文、音频、合集或系列可用；
- 评论、字幕、播放器操作或任何主动交互已可自动化。

本 MVP 故意不读取 XHR/response。后续任何需要 hover、点击、展开、分页、筛选、评论或字幕的能力，都必须先重新按视觉、DOM、Network 三面实证，并为每个语义动作建立单独的 at-most-once 动作账本。
