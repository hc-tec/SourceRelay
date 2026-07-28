# 小红书公开博主主页入口侦察 v0.1

## 结论

`blocked`，但阻断事实已经得到可靠证明。2026-07-28，在独立、可见、持久的 `xiaohongshu_validation` 验证浏览器中，搜索结果页首个可见笔记卡作者入口是一个明确的 `new_tab` 目标。按照项目的小红书风控边界，扩展不能点击该入口，也不能随后关闭、接管或复用它打开的新页面。

因此不能把下面这条“由平台页面自动发现作者并进入主页”的路径写进生产能力：

```text
公开搜索结果
→ 点击笔记卡作者
→ 打开博主主页
→ 采集公开笔记
```

这条“由平台页面自动发现作者”的路径仍必须以“已经存在的公开博主主页 tab”为前置条件；调用方不能通过它提交 URL、tab ID、selector 或脚本。

这条结论只针对“从笔记卡或详情浮层自动发现作者入口”的路径。产品随后增加了一个不同的、一次性受控入口：上层应用可以在短时有效期内直接提供一个公开博主主页链接。该链接不是由扩展从页面推导出来的，也不允许作为长期账号档案保存；Gateway 只在未完成 work item 的短生命周期内使用它，扩展在唯一已有的小红书 tab 内导航一次，然后执行有界的 Network/XHR 投影与可信滚动。该入口的设计记录见
[`xiaohongshu-ephemeral-profile-link-v0.1.md`](../../design/xiaohongshu-ephemeral-profile-link-v0.1.md)，目前仍等待真实有效链接完成独立 live canary，不能把 `implementation_ready_live_e2e_pending` 误报成真实平台已验收。

2026-07-29 已对“同页笔记详情浮层 → 浮层内作者入口”完成独立真实验证。稳定公开标题 canary 经站内搜索和一次详情点击进入同页详情浮层后，固定 DOM 探针只选择评论标题上方、详情大浮层内部的顶部作者入口；结果仍为明确 `new_tab`。因此搜索卡作者和详情浮层作者两条入口都不能安全用于生产自动到达公开主页。

```yaml
beforeSurface: note_detail_overlay
authorTargetMode: new_tab
semanticAction:
  attempted: false
  attemptCount: 0
finalSurface: null
networkResponseCount: 0
automaticRetries: 0
```

本轮没有点击、没有新 tab、没有刷新、没有直接跳转 profile URL。现有主页 tab 路径和短时链接路径都继续保持 `direct_canary_pending / implementation_ready_live_e2e_pending`；前者要求浏览器中自然存在唯一公开主页 tab，后者要求上层应用提供真实仍有效的主页链接，二者都必须分别完成正式 canary。

## Run 摘要

```yaml
runId: 65d92416-fdb2-4555-9f2c-12a64e44e89d
objective: 证明搜索结果卡作者入口能否在不创建新 tab 的情况下进入公开博主主页
platform: xiaohongshu
targetRole: account
targetIdentity: retained public search -> first visible public-note author
browserMode: visible persistent validation profile
browserLifecycle: managed_profile_session
authenticated: true
extensionInteractionLoaded: passive
existingPlatformRunnerUsed: false
navigationCount: 0
semanticActionCount: 0
automaticRetries: 0
outcome: blocked
```

## 基线与 DOM 证据

独立基线 run `b6c45d26-f9d5-4736-bdbc-4ea6a5c51ed8` 使用一次官方 Explore 导航和一次可信搜索建立搜索结果页：

```yaml
renderedCardCount: 22
projectedPublicItems: 13
productPlatformNavigations: 0
semanticActions: 1
automaticRetries: 0
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
```

作者入口侦察随后重租同一个 `retained_for_review` 页面，没有导航或刷新。固定 DOM 探针只在可见 `section.note-item` 内寻找同源 `/user/profile/` 类型作者 anchor，并且不返回具体 href 或用户身份值。

侦察事实：

```yaml
publicSurface: search
renderedCardCount: 22
targetKind: public_note_author
targetMode: new_tab
pointerHitTarget: true
semanticActionAttempted: false
responseBodiesRead: false
networkResponses: 0
verificationRequired: false
rateLimited: false
sourceUnavailable: false
```

作者显示文本只保留 SHA-256 digest：

```text
de6ba2fa60b77fd56bb8fd244cd6dad2a95fdbfaaac8ae10e9d6bc72bbd5ba65
```

基线视觉证据：`60abeb5d-10c1-4b01-9bd3-50bf37c6a6f4`。

作者入口前置条件视觉证据：`38e012a6-8de1-4282-aa4b-755402c075a8`。

## 动作账本

```yaml
actionId: 74faa6ed-c0d0-463f-8e1c-b3cd9905fb1b
intent: 在同一个 tab 内进入首个公开笔记作者主页
precondition:
  checked: true
  satisfied: false
input:
  layer: browser
  kind: click
attempted: false
attemptCount: 0
outcome: prerequisite_unmet
reason: author anchor explicitly targets a new tab
```

没有为了验证猜测而点击一次再关闭新页面，也没有用脚本修改 `target`、拦截 `window.open`、重放 href 或直接导航 profile URL。

## 生命周期发现与修复

本轮同时暴露并修复了两个验证浏览器生命周期问题：

1. Browser Host 冷启动后，Chromium 恢复的 tab 不会自动进入 PageLedger；固定验证命令现在支持收养唯一的公开 Explore/search/profile 页，调用方不提供 URL 或 tab ID。
2. 第一版收养逻辑在没有候选页时先关闭唯一 `about:blank`，会导致 Chromium 关闭整个窗口。现在只有确认存在一个合格平台页、且关闭后仍至少保留一个页面时，才清理额外空白页；失败收养保持浏览器不变。

同一 Host 会话内，固定收养命令也可以无 URL 地重租唯一 `retained_for_review` 小红书公开页，避免 SPA route 与最初 Explore target digest 不同造成错误的新 tab 分配。

## 产品含义

当前可以安全进入设计的边界是：

```text
already-existing public profile tab
→ internally discover unique eligible document
→ zero navigation
→ zero new tab
→ arm current-document Network projection
→ bounded low-frequency scroll
→ public profile + public note projection
→ URL-free artifact
```

另有一个独立入口（不改变上面的作者入口结论）：

```text
上层应用提供短时公开 profile URL
→ 同一已有小红书 tab 一次导航
→ 核验公开 profile document 与风险状态
→ Network/XHR 投影优先，DOM 补齐
→ 最多 20 次可信滚动 / 200 条投影
→ URL-free artifact
```

该入口只表示“在固定预算和当前可见页面范围内的一次短时目录采集”，不代表平台账号历史的无界全量；达到滚动或投影预算时必须按预算终止，不能伪装成已证明的历史终点。

仍未证明、不能标记 ready：

- 如何在无需调用方提供短时链接、也无需现成 profile tab 的情况下安全到达公开博主主页；
- 主页首屏公开信息的稳定 DOM/Network 结构；
- 一次低频滚动是否触发公开 `user_posted` 类响应；
- 多页/全部笔记的游标、结束条件与预算；短时链接入口当前只承诺固定的 20 次滚动 / 200 条投影预算。

## 残留

- 最终搜索页：`retained_for_review`；
- 浏览器所有者：`xiaohongshu_validation`；
- 扩展页：0；
- 作者点击：0；
- 新 tab：0；
- 本轮结束后不再执行真实平台动作；
- 用户日常浏览器未触碰。
