# B 站 work-tab 复用与生命周期真实 canary（2026-08-05）

## 结论

本轮先复现并修复了一个核心租赁状态机缺陷，再用真实公开 B 站页面验证修复后的生产 MV3 闭环：

`proved`。同一个真实 Chromium 会话内，第一次任务创建一个扩展自有 work tab，第二次任务复用
同一个 tab；平台页面数量始终为 1；任务结束后页面保持可见并进入 `idle_reusable`。没有关闭、
刷新或批量清理用户页面。

## 复现到的根因

正常终态的设计是保留 work tab 给用户复核，并将它标为 `idle_reusable`。原来的下一次获取逻辑
却把 `tab.active === true` 直接判定为 `idle_tab_active_before_reuse`，因此第一项完成后，第二项
必然收到 `work_tab_user_taken_over`，上层只能看到失败；这正是“任务成功但下一项又打开/失败”的
核心生命周期问题，而不是页面内容或搜索策略问题。

## 修复边界

- 正常释放不清空最后一个已验证的规范目标摘要；下一次获取会再次校验窗口归属和当前页面身份，
  允许扩展刚刚正常留下的前台 tab 复用。
- 空闲 tab 后续收到用户激活、用户切换到其他 tab、非规范导航、移动或关闭事件时，立即进入
  blocked/不可复用状态；不会抢回焦点、刷新、重放动作或创建替代 tab。
- 仍保持 MVP 的单 leased work tab 上限、`chrome.storage.session` 精确归属、没有普通 tab 枚举，
  以及 Worker 中断后的保守恢复规则。

## 真实平台证据

运行环境是全新、测试专用的 headed Chromium/Profile、production `collector-extension/dist`、
临时 loopback Gateway；没有接管用户日常浏览器，没有读取 Cookie/Token/response body，也没有
点赞、关注、收藏、评论、私信、发布或删除。

```powershell
Set-Location D:\AIProject\inteligence\poc
$env:COLLECTOR_LIVE_CANARY='1'
Remove-Item Env:COLLECTOR_LIVE_CANARY_SCOPE -ErrorAction SilentlyContinue
npx playwright test --config playwright.live-canary.config.ts --project live-canary --grep "direct extension work items read real Bilibili capabilities"
```

结果：`1 passed`（约 1.1 分钟）。同一 run 依次完成：

| 阶段 | 真实证据 |
| --- | --- |
| 视频详情任务 | artifact `safeguards.targetTabSelection=created_extension_work_tab`，`targetPage=idle_reusable`；页面为规范 `BV1qZSLBYEpa` |
| 复用前 | Chromium 中 B 站平台页面数为 1，详情 work tab 保持打开且可见 |
| 原生搜索任务 | artifact `safeguards.targetTabSelection=reused_extension_work_tab`，`targetPage=idle_reusable`；只执行一次固定综合/相关性/第 1 页导航 |
| 复用后 | 搜索页仍是同一个 Playwright `Page` 对象，B 站平台页面数仍为 1，页面可见 |
| 清理 | canary 自己创建的 Chromium、Gateway、临时 Profile 和临时端口由 harness 清理；没有残留 canary 进程 |

此前未修复版本的同一 canary 已真实失败为：

```text
failed:work_tab_user_taken_over:work_tab_user_taken_over
```

该失败发生在第二项任务获取阶段，证明本轮修复针对的是实际生产生命周期，而不是新增断言的
假阳性。

## 本地门禁

| 层级 | 结果 |
| --- | --- |
| work-tab 单元测试 | 14/14 通过；覆盖前台复用、MV3 Worker 恢复和用户切换后 quarantine |
| Core 全部单元/契约/边界/客户端 | 100 个 Vitest 文件、364 项通过；Core boundary 与 capability matrix 通过 |
| TypeScript tests typecheck | 通过 |
| production extension artifact gate | 通过；MV3、host permissions、静态平台脚本边界保持不变 |
| automatic production extension load | 通过；MV3 worker、control surface、runtime marker 与 build fingerprint 匹配 |

## Release asset 边界

本轮源码已经推送到 Core `main`（`298d303`），但 GitHub Actions 的 Core release workflow 只在
`workflow_dispatch` 或 `core-v*` tag 事件上运行。当前环境没有 `gh` CLI/API token，因此没有改写
已经发布的 `core-v0.7.17` tag，也没有假装公开 asset 已经更新。

- 最终源码在本机生成的待发布归档：`sourcerelay-core-0.7.17.tar.gz`
- 待发布归档 SHA-256：`b28e65f40e849c04daec116f6d898af5de53228960340b7804e11605b8ae0eb3`
- 当前 GitHub 公开 `core-v0.7.17` asset SHA-256：
  `ab444468be0209100371651de2e65284e07cee319bee8eed8db3822ded7784d7`

因此在 release workflow 被手动触发并完成之前，AgentKit 继续下载公开包时仍会得到旧归档；源码
修复本身不依赖这个待办，且不会影响当前本地 canary 结论。

## Release asset refresh follow-up（2026-08-07）

Core release workflow 已在 `ff816a5` 对同一 `core-v0.7.17` 发布锚点完成重新打包并成功发布。
当前公开归档已不再是上面的历史旧包，最新归档 SHA-256 为：

```text
f71960011dfc82c082198437a2c9a214a06a2bb5a2c0e3b52ee299ce0322e774
```

该 hash 已同步到 AgentKit 的两个发布 workflow 和开发者 runbook；AgentKit L2 应使用这份
公开归档重新验证 Core/MCP digest parity。

## 尚未声称的能力

本记录证明的是“正常终态复用 + 用户接管停止 + 单 work-tab 数量边界”。它不把历史版本已经
遗留的无归属孤儿 tab 自动清理，也不证明 Worker 在真实平台动作中断后的自动恢复；后者仍按
保守停止策略处理，并由独立的本地 Browser/扩展生命周期测试覆盖。
