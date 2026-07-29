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
[`xiaohongshu-ephemeral-profile-link-v0.1.md`](../../design/xiaohongshu-ephemeral-profile-link-v0.1.md)。2026-07-29 已使用另一条全新的短时链接完成独立 live canary；该路径现在登记为 `direct_ready / gateway_extension_real_e2e_passed`。本次样本没有匹配到可投影的 Network 正文，6 条笔记由 DOM fallback 提供，不能把结果误报成主页 Network/XHR 已验收。

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

本轮没有点击、没有新 tab、没有刷新、没有直接跳转 profile URL。作者入口路径仍然禁止自动点击；已有主页 tab 的零导航路径仍要求浏览器中自然存在唯一公开主页 tab，并尚未完成独立 live canary。短时链接路径已由后续独立 run 完成正式 canary，要求上层应用提供真实仍有效的主页链接。

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
- 主页 Network/XHR 正文投影的稳定结构（本轮只证明 DOM fallback）；
- 一次低频滚动是否触发公开 `user_posted` 类响应；
- 多页/全部笔记的游标、结束条件与预算；短时链接入口当前只承诺固定的 20 次滚动 / 200 条投影预算。

## 2026-07-29 短链真实 canary 诊断

本轮使用调用方提供的一条短时公开主页链接，在 `xiaohongshu_validation` 隔离浏览器执行了真实 Gateway→Extension 链路。没有保存链接、签名、响应 URL 或原始正文，也没有触碰用户日常浏览器。

结果按动作顺序记录如下：

1. 初次运行在导航前发现多个公开小红书候选 tab，返回 `xiaohongshu_profile_entry_tab_ambiguous`；没有发出主页导航。
2. 收紧为“多个候选时只选择唯一 active 公开 tab”后，导航实际到达了公开主页。保留页视觉证据 `1c56ff91-b265-41b5-a03a-e58ff9710687` 显示了博主公开资料、统计和笔记卡片，但旧逻辑因聚合 `tabs.status=loading` 超时，误报 `xiaohongshu_profile_url_navigation_failed`。
3. 移除对聚合 loading 状态的依赖后，第三次运行暴露了 SPA 中间 Explore/Search route 被过早判为 `profile_url_expired`；视觉复核仍显示主页已到达，证据 `c77f7124-dc05-4e61-8738-646e8fa35154`。
4. 修正中间 route 等待逻辑后，最后一次运行使用的仍是旧 Gateway 制品（主页 work TTL 仍为 60 秒），在 20 次滚动预算尚未完成前未能交付终态 operation，最终验证页因 lease 过期进入 `quarantined / lease_expired`。该次没有形成可验收 artifact，不能标记能力 ready。

本轮产生的生产/验证修复：

- 短链 work TTL 固定为 `120s`，不续租；
- 主页导航以已提交的公开 profile 主文档为后置条件；
- SPA 中间公开 route 只在同一次导航窗口内等待，不刷新、不重导航；
- 多候选 tab 不接管后台页；只允许唯一 active 候选；
- 验证 Gateway 停止超时会强制清理本地子进程和管道，避免测试进程长时间悬挂。

短时链接入口的最终 live 回归已由新的链接完成；原链接和本次新链接都已经实际尝试过导航，后续不得重放。短链 canary 详情见 [`profile-link-gateway-extension-e2e-v0.1.md`](profile-link-gateway-extension-e2e-v0.1.md)。

## 残留

- 最终搜索页：`retained_for_review`；
- 浏览器所有者：`xiaohongshu_validation`；
- 扩展页：0；
- 作者点击：0；
- 新 tab：0；
- 本轮结束后不再执行真实平台动作；
- 用户日常浏览器未触碰。
