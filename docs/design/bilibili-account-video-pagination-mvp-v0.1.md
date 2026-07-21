# B 站账号投稿分页 MVP：登录态单点击证明设计 v0.1

- 日期：2026-07-21
- 状态：设计已冻结，等待实现与真实闭环
- 前置事实：[匿名分页侦察](../reconnaissance/bilibili/account-video-pagination-recon-v0.1.md) 已证明控件和浏览器点击；匿名数据替换未证明（`412`）

## 1. 目标与刻意不做的事

本 MVP 只证明一个受管、已登录 Profile 能否从已验证的投稿目录第 1 页，通过**一次真实页码点击**得到第 2 页的 DOM 卡片。它不是“全量投稿采集器”。

```text
包含                           不包含
第 1 页 -> 第 2 页             第 3 页及以后
一次可信 click                 自动连续翻页
固定 DOM 卡片投影              response body / old API runner
去 query/hash 的 Network metadata  request/response header、query、Cookie、Token
一次视觉前后证据               点赞、关注、播放、评论、登录操作
```

## 2. 为什么需要新 Browser Host 原语

现有 Host 只有 `navigate_page` 与 `scroll_page`；没有可信 click。不能为分页把任意 selector、任意 JavaScript 或坐标接口开放给 Gateway，也不能让 Extension 用 synthetic event 代替人类输入。

因此新增的原语必须是**源专属且语义受限**的，例如：

```text
trusted_bilibili_account_video_page_click
  pageRole                 account_video_inventory
  action                   select_page
  targetPage               2 only (v0.1)
  exact PageLease/run      required
  expected document        required
  actionId                 at-most-once
  arbitrary selector/JS    impossible
  arbitrary x/y            impossible
```

Browser Host 内部可以使用由实网侦察证明的 DOM 语义来定位该按钮，但每次都必须重新读取当前 bounding box 和 `elementFromPoint`；侦察时的坐标不能进入生产代码。

## 3. 闭环状态机

```text
acquire exact retained page
  -> bind page-2 DOM observer
  -> fixed DOM preflight
  -> screenshot_before
  -> attach metadata-only Network window
  -> trusted page-2 click (once)
  -> immediate neutral-pointer relocation (one safety move, audited)
  -> wait boundedly for DOM page=2
  -> screenshot_after
  -> validate DOM fingerprint + Network route/status
  -> retained_for_review | quarantined
```

`neutral-pointer relocation` 不是第二次页码操作，也不触发新的点击。它只将点击后可能因页面回到顶部而落在视频卡片上的鼠标移到经验证的空白/非媒体区域；它必须有独立 action ledger 项并且只有一次机会。

## 4. 三面完成条件

只有三面同时成立才可写入 `page_two_ready`：

| 观察面 | 必要事实 |
| --- | --- |
| 视觉 | 点击前页码 1 为 active；点击后页码 2 为 active，并保存两张 runtime 截图。 |
| DOM | 第 2 页按钮在点击前可见、未禁用且未被遮挡；点击后固定投影报告 `activePage=2`，仍有合规卡片，且与第 1 页的去敏 BVID 集合指纹不同。 |
| Network | 点击窗口内新增 `GET /x/space/wbi/arc/search` 的去 query/hash metadata，状态为成功；不读取 body、headers 或 query。 |

仅满足 active 样式时是 `partial`；`412`、未出现目标 route、指纹未变、document/lease 不匹配、动作结果未知、验证码、异常访问、限流或网络失败均不得重试。

## 5. 数据和证据边界

```text
可持久化
  canonical account identity / target page / page role
  fixed DOM fields（BVID、标题、bounded text、无 query 的公开封面）
  active page、card count、BVID-set digest、动作账本、terminal reason
  网络 route path、method、status、phase（无 query）
  去敏截图 reference / digest

不可持久化或读取
  Cookie、Token、密码、storage state
  URL query / fragment、请求或响应 header/body
  任意 selector、任意脚本、任意 CDP 方法
```

## 6. 失败与生命周期

- 所有页面语义动作均为 at-most-once；本 MVP 的预算是 `navigation ≤ 1`、`scroll ≤ 1`、`page-2 click = 1`、`neutral pointer move ≤ 1`。
- 若初始保留页仍是规范投稿目录，可以复用；若用户已导航离开、document 不一致或租约失效，创建新的受管目标而不劫持用户页面。
- 成功或明确 partial 后保留目标页供复核；只有结果未知、上下文改变、浏览器崩溃或风险停止才隔离该页。
- 不关闭整个 Profile 来结束一次正常 run；关闭只允许显式 Profile/Host 生命周期或版本升级。

## 7. 非目标的旧实现

仓库中旧的账号 archive / response 导向模块最多只能作为字段和失败语义参考。这个 MVP 不接入其请求模拟、response 投影或多页循环；实际能力仍以 Browser Host 的可信输入和 MV3 的固定 DOM 投影为准。

## 8. 实施完成标准

1. 离线门禁证明新 Host 原语不允许任意坐标、任意 selector、重复 action 或越租约调用。
2. 独立真实 Chromium 本地门禁证明原语走真实鼠标而非 Extension synthetic click。
3. 受管登录 Profile 进行**一次**真实 page-2 canary；成功、partial 或 risk stop 均记录为独立 artifact。
4. 真实结果和约束追加到分页侦察文档；截图、Profile、原始运行材料一律不进 Git。
