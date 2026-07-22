# B站账号档案与投稿目录 MV3 真实闭环 v0.1

- 状态：`build_ready`，真实 Collection Profile 闭环已通过；`admissionEligible=false`
- 日期：2026-07-23
- Profile：项目管理的 B站 `collection / user_managed` Profile
- 目标：`https://space.bilibili.com/7481602`（安州牧）
- 浏览器：持久 Chromium + Browser Host + Native Messaging + production MV3
- 扩展公开版本：`0.7.17` / control-surface revision `15`
- 本次构建指纹：`f04b4be1406199a92667c9c6007967467b9758be75deedc6362e349d9cd96f24`

## 结论

当前正式 runner 已经能够在受管 Collection Profile 中完成账号档案和投稿目录首页的真实闭环。两类能力均只读取页面公开可见 DOM，不读取响应正文、请求头、请求体、Cookie、Token 或浏览器 storage；结果保存为本地 raw-first artifact，不依赖关系数据库。

这次验证没有把能力自动升级为 production admission。`build_ready` 只表示当前实现、控制面和本次真实样本已经闭环；正式准入仍需独立 review、更多账号/布局样本、风险状态覆盖和当前策略版本的 live-validation reference。

## Run 1：账号档案

```text
runId: 4fe74d9a-bc85-45df-8dc3-7b94edc68a97
artifactId: bb7600d1-2ae1-47db-b3ab-3fb1ee5706c6
state: completed
terminalReason: profile_captured
strategy: bilibili.account.profile.dom.v2 @ 0.1.0
```

结果：

- 页面身份匹配 `7481602`，显示名“安州牧”；
- 捕获头像和横幅公开引用；
- 捕获 8 个公开字段：关注数、粉丝数、获赞数、播放数及主页/动态/投稿/合集和系列导航；
- 捕获公告和充电区可见文本；
- 当前观看者账号入口被排除；
- 导航 1 次、DOM 观察无页面交互，目标 tab 终态按产品规则保留。

## Run 2：投稿目录首页

```text
runId: edc8839b-e883-4381-995a-2f7e9a45e8fe
artifactId: 11850855-8c9a-4f62-b818-551f2d22cc17
state: completed
terminalReason: page_one_ready
strategy: bilibili.account.video-inventory.dom.v1 @ 0.1.0
```

结果：

- 规范目录目标为 `/7481602/upload/video`；
- 首个渲染页捕获 40 个可见视频卡片；
- `capturedItems=40`、`unresolvedCardCount=0`；
- 每个条目包含规范 BVID/视频 URL、标题、可见文本和封面引用；
- `loginOverlayVisible=false`，验证码、限流和来源不可用均为 false；
- 导航 1 次、无分页点击、无自动重试，目录 tab 终态保留。

## Run 3：投稿目录有限分页

```text
runId: 57b043c0-ea49-417f-9f2e-e8761e80fd0e
artifactId: cadfc8f7-437e-4f35-93bc-3b820989769d
state: completed
terminalReason: requested_page_budget_reached
requestedPages: 2
```

结果：

- 复用 Run 2 的投稿目录 tab；
- 捕获 2 页、80 个可见条目和 80 个唯一 BVID；
- `duplicateBvidCount=0`、`unresolvedCardCount=0`；
- `loginOverlayVisible=false`；
- 分页点击按声明预算执行，每个分页动作最多一次；
- 在达到请求页数后停止，没有把“还有更多页”伪装成全量终点。

同一分页 runner 随后在新的独立 run 中使用当前允许的 7 页上限完成扩展验证：

```text
runId: ef6e6a14-aec7-4d4f-9272-127ce5d3a21c
artifactId: fb61315a-5f38-4ab2-b423-e40a2c46cd3c
state: completed
terminalReason: requested_page_budget_reached
requestedPages: 7
capturedPages: 7
capturedItems: 263
uniqueBvidCount: 263
duplicateBvidCount: 0
unresolvedCardCount: 0
```

7 页 run 仍复用同一投稿目录 tab；每页一次可信分页动作，达到 7 页预算后停止。`263` 条是本次声明页数和捕获时间下的覆盖，不是账号投稿全量终点。

## 生命周期与安全观察

在部署当前构建时，headless marker probe 发现持久 worker 没有内部构建指纹，于是只执行了一次受控 `chrome.runtime.reload()`，随后精确复核通过；公开版本仍为 `0.7.17 / rev 15`，没有因为这次功能验证升级扩展版本。

验证过程中修复了两个影响后续能力矩阵的基础问题：

1. 账号档案统计字段没有 `href` 时，validator 错误地把可选字段缺失判为非法；现在缺失的可选链接按 `null` 处理。
2. 保留目标 tab 的账号档案 runner 使用固定 `open_account_profile` action ID，第二个独立 run 会被页面账本误判为重放；现在 action ID 按 run 生成，同一 run 仍保持 at-most-once，独立新 run 可以安全复用 retained tab。

失败的开发 run 产生的 quarantined tab 没有被静默关闭；成功的档案和目录 tab 按产品规则保留供复核。后续显式 Profile 维护动作应单独清理该已知 quarantine，不能把 run 终态自动关窗当作清理策略。

## 尚未声称完成的范围

- 账号投稿超出 7 页的全量分页、排序/筛选和中断恢复仍是独立能力；本次证明的是最多 7 页的有界目录闭环。
- 详情、字幕、评论/楼中楼、弹幕、动态、专栏、合集、直播回放、热榜和关系快照不由本次结果覆盖；
- response route 仍未进入正式 production response routes；
- 当前策略仍需 review/admission，不能对外显示为“B站全部能力已准入”。
