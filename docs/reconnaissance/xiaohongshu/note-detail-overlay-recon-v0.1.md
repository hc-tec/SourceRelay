# 小红书搜索卡片同页详情浮层侦察 v0.1

日期：2026-07-28  
结论：`proved`

## 目标

只回答一个问题：在已经存在的公开搜索结果页中，点击公开笔记卡片主图，是否会在不刷新、不新建 tab 的情况下打开详情；打开后，详情浮层里的作者入口是否仍然会新建 tab。

这不是生产扩展闭环验证，也不证明公开主页采集已经 `direct_ready`。

## 环境与边界

- 真实小红书网站；
- 专用、可见、持久 `xiaohongshu_validation` Profile；
- Browser Host 从 controller 获取到 release 始终保持同一个 IPC 连接；
- 页面由已经验证的固定流程建立：一次官方 Explore 基线导航，再通过可见搜索框执行一次可信搜索；
- 未使用保存的搜索、详情或主页 URL；
- 未读取 Cookie、Token、Header、Storage 或认证材料；
- 扩展只作为被动运行时存在，本轮没有调用生产平台 runner；
- 最终页面按 `retained_for_review` 保留。

## Run 摘要

```yaml
runId: 7963980e-cc8f-4d0d-8155-d9486abb4a9e
objective: prove_same_document_note_detail_overlay_and_inspect_author_target
platform: xiaohongshu
targetRole: detail
targetIdentity: public-search-first-visible-note
browserMode: visible persistent profile
browserLifecycle: managed_profile_session
authenticated: true
extensionInteractionLoaded: false
existingPlatformRunnerUsed: false
navigationCount: 0
semanticActionCount: 1
automaticRetries: 0
outcome: proved
```

## 人类流程与三面证据

动作前，人眼可见公开搜索结果卡片瀑布流。DOM 显示 22 个 `section.note-item`；第一张可见卡的主图是实际的人类点击面，其中心点由 `elementFromPoint` 命中卡片内部。命中链没有声明 `_blank` 的 anchor，因此前置条件成立。

Browser Host 将鼠标移动到实时主图中心，然后只点击一次：

```yaml
actionId: 01576eae-0157-40ad-9a64-ea9b137a5bac
intent: open_public_note_detail
input:
  layer: browser
  kind: mouse_click
  trustedPath: playwright
attempted: true
attemptCount: 1
outcome: completed
```

动作后证据：

- 视觉：中央出现公开笔记详情浮层，左侧为笔记媒体，右侧为作者、标题、正文、公开互动计数和评论入口；
- DOM：可见详情容器存在且含公开正文；
- 浏览器：context page 数量不变，没有新 tab；
- document：`performance.timeOrigin` 前后相同，证明没有创建新的页面 document；
- Network：动作监听窗口内新增 XHR/Fetch 为 0，因此本次详情内容不能声称来自动作后 Network response；
- 风险：`loginRequired=false`、`verificationRequired=false`、`rateLimited=false`、`sourceUnavailable=false`。

## 作者入口结论

详情浮层中的可见作者 anchor 已被 DOM 和命中测试共同确认，但其目标模式为：

```text
targetMode = new_tab
pointerHitTarget = true
```

因此本轮没有点击作者入口。搜索页直接作者入口与详情浮层作者入口都会创建新 tab，不能作为小红书生产采集服务自动建立公开主页的路径。

## 产品含义

已证明的安全能力：

```text
已有公开搜索页
→ 内部发现可见 note-item 主图
→ 一次可信点击
→ 同 document 详情浮层
→ DOM 读取公开详情
→ 后续可在浮层内侦察评论加载 Network
```

不能实现的自动路径：

```text
搜索作者入口 / 浮层作者入口
→ 点击
→ 公开主页
```

原因不是 selector 不稳定，而是两处真实作者 anchor 都明确要求新 tab。`xiaohongshu.account.public_notes.v1` 因此继续要求浏览器中本来就存在唯一公开主页 tab，不能接受主页 URL，也不能由服务创建主页页。

详情能力应采用 Network-first、DOM fallback：本次点击没有产生新增 XHR/Fetch，因而公开标题、正文、作者和互动计数必须允许从已渲染浮层 DOM 投影；评论是否能够用 Network 投影需另做一次有界滚动或评论区交互侦察。

## 清理与残留

- 自动重试：0；
- 新 tab：0；
- 页面刷新：0；
- 平台导航：0；
- 页面关闭：0；
- 调试临时端口：0；
- 最终详情浮层页面：有意保留，由 `xiaohongshu_validation` Browser Host 管理，关闭条件为显式停止该验证 Profile。
