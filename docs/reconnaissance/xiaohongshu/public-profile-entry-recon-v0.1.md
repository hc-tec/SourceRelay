# 小红书公开博主主页入口侦察 v0.1

## 结论

`blocked`，但阻断事实已经得到可靠证明。2026-07-28，在独立、可见、持久的 `xiaohongshu_validation` 验证浏览器中，搜索结果页首个可见笔记卡作者入口是一个明确的 `new_tab` 目标。按照项目的小红书风控边界，扩展不能点击该入口，也不能随后关闭、接管或复用它打开的新页面。

因此不能把下面这条路径写进生产能力：

```text
公开搜索结果
→ 点击笔记卡作者
→ 打开博主主页
→ 采集公开笔记
```

`xiaohongshu.account.public_notes.v1` 现阶段必须以“已经存在的公开博主主页 tab”为前置条件，调用方仍不能提交 URL、tab ID、selector 或脚本。另一条待独立实证的候选路径是“同页笔记详情浮层 → 浮层内作者入口”，但本轮没有继续点击。

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

仍未证明、不能标记 ready：

- 如何在无需现成 profile tab 的情况下安全到达公开博主主页；
- 主页首屏公开信息的稳定 DOM/Network 结构；
- 一次低频滚动是否触发公开 `user_posted` 类响应；
- 多页/全部笔记的游标、结束条件与预算。

## 残留

- 最终搜索页：`retained_for_review`；
- 浏览器所有者：`xiaohongshu_validation`；
- 扩展页：0；
- 作者点击：0；
- 新 tab：0；
- 本轮结束后不再执行真实平台动作；
- 用户日常浏览器未触碰。
