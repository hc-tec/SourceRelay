# B站 `user_selected_tab` 投稿首页被动观察：真实 canary v0.1

- 日期：2026-07-27
- 结论：**proved**
- 目标角色：`account_video_inventory.first_page`
- 目标标识：`public-account-video-inventory-redacted`
- 数据边界：本文不保存帐号 ID、昵称、视频标题、视频 URL、BVID、截图、Cookie、Token、Storage 内容、请求 query/header/body 或 response body。

本记录验证一个窄的产品闭环，而不是把用户浏览器变成通用自动化器：用户（本次为隔离验证浏览器中的真实生产扩展控制面）明确选择当前已打开的 B站投稿首页；上层只提交固定 capability 和规范账号 URL；扩展随后只在这一个 tab/document 上做一次被动 DOM 投影。

它与“扩展创建工作标签页后导航”的 `collector_work_tab` 是两条不同路径。任何 tab ID、window ID、document ID、selector、脚本、坐标、URL 变体、页码或点击计划都没有离开扩展。

## 1. Run 摘要

```yaml
runId: bilibili-user-selected-tab-inventory-canary-20260727
objective: 证明已显式选择的公开投稿首页可完成一次零 work 导航的受限 DOM artifact 闭环
platform: bilibili
targetRole: account
targetIdentity: public-account-video-inventory-redacted
browserMode: visible persistent isolated validation profile
browserLifecycle: temporary_product_validation
authenticated: true
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
navigationInstructions: 1
outcome: proved
```

使用的是生产构建 MV3（`0.7.17`，build fingerprint 前缀 `4b972013e538`）、真实 loopback Gateway 和隔离验证 Profile。没有接管、读取、复制、关闭或修改用户日常浏览器及其登录状态。

## 2. 动作账本与预算

| 动作 | 输入层 | 次数 | 结果 |
| --- | --- | ---: | --- |
| 打开公开投稿首页 | 浏览器导航 | 1 个导航指令 | 页面稳定为规范投稿首页 |
| 在编译后的扩展控制面选择当前页 | 浏览器级可信点击 | 1 | 创建短时、单次 tab/document lease |
| `user_selected_tab` work | 扩展被动观察 | 1 | `completed / inventory_ready` |
| work 发起的平台导航 | 无 | 0 | 符合零导航预算 |
| work 发起的平台语义输入（click/scroll/filter/sort） | 无 | 0 | 符合零动作预算 |

浏览器为这一次导航指令报告了 3 个 main-document navigation event；本 run 没有重新发出导航指令，最终 document 仍是同一个规范投稿首页。这两个计数必须区分：前者是浏览器页面结算事实，后者才是产品动作预算。

## 3. 三面证据

### 视觉

可见的隔离 Chromium 中，投稿首页首屏正常显示；在扩展控制面完成选择后，控制面显示已显式选择状态。两张截图仅存于 ignored runtime，已作为短期证据使用，不进入 Git。

### DOM

- 首屏稳定时观察到 40 张公开视频卡片；
- 活动页码为第 1 页；
- work artifact 投影了 40 项，`visibleCardCount` 为 40；
- work 终态为 `completed`，终止原因为 `inventory_ready`；
- 扩展只在选择时绑定精确 document；提交 work 前不会新建、替换或接管任何平台 tab。

### Network

导航前开始记录 metadata，只保留去 query/hash 的 method、origin、path、status 和 MIME。基线中包含投稿页自身的公开页面和目录加载请求，例如：

```text
GET https://space.bilibili.com/:redacted/upload/video -> 200 text/html
GET https://api.bilibili.com/x/space/wbi/arc/search -> 200 application/json
```

没有读取任何 response body。扩展选择完成后的新增 B站 Network metadata 数量为 **0**；因此本闭环没有把选择动作错误地归因为一次新的页面请求，也没有通过 XHR 正文绕过页面边界。

## 4. Artifact 与安全语义

Gateway 返回的 capability-bound artifact 已满足以下可审计条件：

```text
executionTarget: user_selected_tab
operationState: completed
terminalReason: inventory_ready
action.kind: passive_observation
action.attemptCount: 1
safeguards.acquisition: user_selected_tab_passive_dom_projection
safeguards.targetTabSelection: user_selected_tab
safeguards.targetPage: user_selected_tab_retained
```

这证明的不是“任意 tab 可被 API 控制”，而是以下严格链路：

```text
扩展 UI 的明确选择
  -> 120 秒、单次 session lease
  -> 已签名的固定 account_inventory work
  -> 原 tab / 原 document 上的被动 DOM 投影
  -> capability-bound artifact
```

如果 selection 已过期、tab 被关闭、document 改变、目标账号不匹配或用户选择的是第 2 页，work 必须以对应的 `user_selected_tab_*` 停止原因结束；不能寻找替代 tab、自动翻页或回退到 `collector_work_tab`。

## 5. 同时修复的控制面缺口

真实 canary 首次暴露了一个产品问题：Gateway 配对成功后，控制面原先只刷新“已连接”文字，未重新渲染“用户已选页面”区域，导致选择按钮保留初始禁用状态。现已改为配对成功后重新渲染完整本地控制面，并用本次真实 canary 覆盖该修复。

## 6. 未证明的边界

本记录**没有**证明下列能力，不能据此开放：

1. 投稿第 2 页或任意页的自动翻页、点击页码、滚动或排序；
2. 用户未选择页面时的任意 tab 搜索、接管或替代；
3. 字幕菜单点击、字幕轨道、评论区滚动/展开、弹幕、筛选或更多详情；
4. 对用户日常浏览器的 Playwright/CDP/Browser Host 自动控制；
5. native extension popup 在真实日常浏览器中的自动化可点击性。本次为可审查性打开同一编译 `control.html`，并以浏览器级可信输入点击；日常浏览器产品仍由用户主动使用 popup。

每一种后续交互都必须作为新的 typed capability，先完成真实视觉、DOM、Network 三面侦察，再独立进行 canary。

## 7. 清理

本次临时 loopback Gateway、临时 Gateway state、canary Chromium context、临时配对记录、运行 state JSON 和截图均不进入 Git。验证结束后没有 residual canary process；清理审计完成后，隔离 validation browser 已以同一生产构建重新启动为受管 ready 状态，用户日常浏览器与已经运行的用户自有 Gateway 没有被改动。
