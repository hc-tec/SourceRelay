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
→ 在新 profile document 上注入受限 Network observer（首屏已有 DOM 可作为 fallback）
→ 先读 Network note-card projection
→ 合并已可见 DOM note-card fallback
→ 只做有界可信滚动，直到数据/预算/页面结束
→ URL-free artifact
```

不能为了链接失效而刷新、换 tab、重复导航、重试或绕过风控。临时链接模式的导航预算为 `1`；默认滚动和笔记上限仍必须是产品可审计的固定预算，不能解释成无限抓取。

## 终态

至少区分：

- `profile_url_invalid`：不是允许的主页链接；
- `profile_url_expired`：导航后没有形成公开 profile 页面；
- `profile_url_navigation_failed`：一次导航失败；
- `profile_url_context_changed`：出现新 tab、非目标 document 或平台身份变化；
- `login_required`、`verification_required`、`rate_limited`、`source_unavailable`；
- `profile_notes_ready`：在固定预算内取得 Network/DOM 合并结果。

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
