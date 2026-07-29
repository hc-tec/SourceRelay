# 小红书临时博主主页链接采集设计 v0.1

## 目标

允许上层应用在一次短时任务中提供一个小红书公开博主主页链接，并在链接仍有效时快速采集公开笔记。该入口与“浏览器中自然存在的 profile tab”模式分开计量，不把临时链接变成长期账号档案。

## 入口边界

临时链接只允许作为一次性任务输入：

- 仅接受 `https://www.xiaohongshu.com/user/profile/<public-id>` 主页路径；
- 不接受任意域名、笔记详情路径、搜索路径、脚本、selector、tab/document ID 或 route；
- 可携带短时 query/signature，但只存在于未完成任务的短期本地队列中；
- 不进入 artifact、operation summary、日志、截图说明、长期 profile 或错误消息；
- Gateway 重启、任务过期、导航失败或页面身份不匹配时立即清除并停止，不重放。

## 一次性执行链

```text
上层提交短时主页链接
→ Gateway 校验 HTTPS/主机/主页路径并设置短 TTL
→ 选择唯一已有的小红书公开 tab
→ 在同一 tab 只导航一次到临时主页链接
→ 核对仍是公开 profile document、无新 tab、无登录/验证/限流
→ 导航前注册一次性 `document_start` Network observer，导航后在新 profile document 上复用首批投影（首屏已有 DOM 可作为 fallback）
→ 先读 Network note-card projection
→ 合并已可见 DOM note-card fallback
→ 只做有界可信滚动，直到达到 20 次滚动、200 条笔记、或连续两次滚动没有新增条目
→ URL-free artifact
```

不能为了链接失效而刷新、换 tab、重复导航、重试或绕过风控。临时链接 work 使用固定 `120s` 的一次性 TTL（不续租、不因滚动进度延长）；导航预算为 `1`，滚动预算为 `1–20`，投影上限为 `200`。这些是产品可审计的固定预算，不能解释成无限抓取。自然存在的 profile tab 仍保持 `1–3` 次滚动和 `40` 条投影上限。

## 终态

至少区分：

- `profile_url_invalid`：不是允许的主页链接；
- `profile_url_expired`：导航后没有形成公开 profile 页面；
- `profile_url_navigation_failed`：一次导航失败；
- `profile_url_context_changed`：出现新 tab、非目标 document 或平台身份变化；
- `run_deadline_exceeded`：任务在短链任务 TTL 内未能完成；停止后不再导航、刷新或重放；
- `login_required`、`verification_required`、`rate_limited`、`source_unavailable`；
- `profile_notes_ready`：连续两次可信滚动没有新增条目，取得 Network/DOM 合并结果并在当前可遍历范围内自然停止；
- `profile_notes_budget_exhausted`：仍有投影结果，但达到滚动或投影上限；artifact 保留部分结果，不能解释为已到达平台终点。

## 与现有能力的关系

现有 `xiaohongshu.account.public_notes.v1` 继续表示：

```text
existing_public_profile_tab
→ zero navigation
```

临时链接入口应使用独立 execution target（必要时独立 capability/version），避免上层误以为现有零导航能力可以接受 URL，也避免把链接输入泄漏到长期 artifact。

隔离验证浏览器的真实入口支持通过短时环境变量传入链接：

```powershell
$env:COLLECTOR_XIAOHONGSHU_PROFILE_URL = 'https://www.xiaohongshu.com/user/profile/<temporary-id>?<short-lived-signature>'
npm run validate:xiaohongshu-gateway-account-notes-e2e
Remove-Item Env:COLLECTOR_XIAOHONGSHU_PROFILE_URL
```

验证脚本不会把该环境变量写入运行摘要；没有提供时仍执行原有的“自然 profile tab 前置条件”侦察。

## 短链的自然发现入口（已完成 live canary）

短时主页链接不一定由上层人工复制提供。小红书主页或站内搜索结果中的公开笔记卡通常同时显示作者头像；产品可以把“作者头像 → 公开主页”作为一个独立、受限的自然入口：

```text
已有小红书主页/搜索页
→ 发现一张可见公开笔记卡的作者头像
→ 读取实时边界框与 target 行为
→ 浏览器级可信点击一次
→ 等待同一 tab 或平台自然打开的新 tab 完成主页渲染
→ 只在内存中观察 URL 何时出现 xsec_token
→ 校验规范 /user/profile/<id> 路径和公开主页后置条件
→ 把短链交给一次性的 profile notes work
```

这不是“任意新 tab 控制”或“直接 URL 导航”：

- 头像点击必须是一个预登记的语义动作，最多尝试一次；
- 如果页面自然使用新 tab，产品只接管这个由点击产生的目标页，不主动创建第二个 tab，不关闭原页后重试；
- 如果平台在原 tab 内完成 profile route 变化，则继续使用原 document，并重新读取 document generation；
- 等待 `xsec_token` 只允许有界本地等待，不刷新、不重放、不改写 URL；
- 完整 URL、`xsec_token`、`xsec_source`、响应 URL 和认证材料只存在于当前 work 的短生命周期内，不进入 artifact、日志、截图说明或长期档案；
- 主页 work 仍使用固定一次性 TTL，不因等待 token 或滚动而续租；
- 没有在 deadline 内得到规范主页和 token 时，终止为 `profile_url_token_unavailable`，不得自动再次点击头像。

该入口已经完成独立的真实 Gateway → Extension → artifact canary，不能把它与旧的人工 recon 或搜索能力混为一谈。2026-07-30（北京时间）最近一次去敏结果如下：

```yaml
runId: 19589c76-0e61-405c-8f0d-f65b4cca85f2
sourceSurface: explore
validationBrowser: xiaohongshu_validation
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
validationBaselineNavigations: 1
productPlatformNavigations: 0
profileLinkDiscovery:
  attempted: true
  attemptCount: 1
  targetMode: new_tab
  tokenObserved: true
scrollCount: 0
profileNoteItemCount: 2
networkMatchedPayloadCount: 0
networkBodyBytesRead: 0
rawPayloadStored: false
responseUrlsStored: false
browserHostHandoff: adopted_existing_page
finalPageState: retained_for_review
unmanagedPagesAfterCleanup: 1
automaticPlatformRetries: 0
```

事实结论：作者头像的可信浏览器级点击一次后，平台自然打开了新 tab；扩展只在内存中确认规范主页 URL 出现 `xsec_token`，随后主页目录 work 成功返回公开笔记卡片。该 canary 没有读取到可确认的主页 Network 正文（`0/0`），因此结果仍标记为 Network 未证明、DOM/页面投影成功，不能把它宣传成 Network-first 已通过。

生命周期结论：自然新 tab 最初会被 Browser Host 视为 unmanaged。验证器随后只使用 Host 已签发的来源 page alias/lease 做一次内部 handoff，关闭测试创建的来源页，把目标主页变为唯一 managed retained page；handoff 不接受 URL、tabId、selector，也不创建第二个 tab。最终 unmanaged 数回到启动基线的 `1`（仅保留验证浏览器自身的空白页），没有遗留额外 profile tab。

验证器此前出现过一次 `managed_page_extension_binding_missing`，根因是交接目标页没有稳定的扩展 tab 映射，而视觉证据接口错误地强制要求 extension binding。现已改为：视觉证据仍要求精确 page lease/run/record version，但不把扩展 tab binding 当作截图前置条件；交接后先释放为 `retained_for_review`，再走 retained-page 只读截图。该修复不扩大上层 API 的浏览器控制能力。

## 明确留待后续：媒体物化

小红书图片和视频通常使用短时 CDN 链接，不能把页面里看到的媒体 URL 当成长期可用地址。后续若要保留媒体，应单独设计“采集时立即下载”的受限媒体物化能力：在同一次页面文档和任务预算内下载、校验 MIME/大小、写入本地对象并以内容摘要关联笔记；不得把原始 CDN URL、请求头、Cookie 或签名写入长期 artifact。本 v0.1 只保存公开笔记卡片投影，不下载图片/视频，也不把媒体能力混入主页链接的 live canary。
