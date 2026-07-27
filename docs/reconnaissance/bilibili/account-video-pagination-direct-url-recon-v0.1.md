# B 站 UP 主投稿目录分页：direct URL 侦察 v0.1

- 日期：2026-07-27
- 结论：**未发现可证明的第 2 页规范 document URL；不得进入 direct 自动翻页实现。**
- 目标角色：`account_video_inventory.pagination`
- 目标标识：`public-account-video-inventory-redacted`
- 数据边界：本文不保存帐号 ID、昵称、视频标题、视频 URL、BVID、截图、Cookie、Token、Storage、请求 query/header/body 或 response body。

相关的人类分页流程已在 [v0.2](account-video-pagination-recon-v0.2.md) 中被证明。本轮是一个不同的窄问题：不再点击第 2 页，只检查页面是否已经公开暴露一个可让 Gateway 固定派生并签名的第 2 页 document URL。

## 1. Run 摘要

```yaml
runId: bilibili-account-video-document-url-20260727
objective: 发现或否定投稿目录第 2 页的静态规范 document URL 来源
platform: bilibili
targetRole: account
targetIdentity: public-account-video-inventory-redacted
browserMode: visible persistent isolated validation profile
browserLifecycle: temporary_recon
authenticated: true
extensionInteractionLoaded: false
existingPlatformRunnerUsed: false
navigationCount: 1
outcome: inconclusive
```

只发生一次初始导航。没有滚动、hover、click、刷新、重试、脚本注入、response body 读取或 Gateway/Browser Host 平台 runner 调用。

## 2. 三面观察

### 视觉

在可见的隔离验证浏览器中打开第 1 页并完成一次本地截图留存；截图只作为短期运行材料，已删除且未进入 Git。页面在 `1280 × 720` CSS viewport 中正常显示公开视频卡片和分页控件，无登录、验证码、安全验证、限流或源页面不可用信号。

### DOM

第 1 页稳定时有 40 张视频卡片；分页控件同时包含“数字第 2 页”和“下一页”。对两个实际控件及其祖先链接关系做了只读检查：

| 控件 | tag | disabled | 自身 `href` | 祖先 `href` | `data-*` URL 线索 | `onclick` property |
| --- | --- | --- | --- | --- | --- |
| 数字第 2 页 | `button` | `false` | 无 | 无 | 无 | 无 |
| 下一页 | `button` | `false` | 无 | 无 | 无 | 无 |

页面当前 document URL 的去敏形状为：

```text
https://space.bilibili.com/:redacted/upload/video
query keys: none
hash: none
```

页面没有 `link[rel="canonical"]`。因此在点击前的公开 DOM 中，没有第 2 页的可验证 document URL，也没有用于安全固定派生的参数来源。

### Network

导航前启动 Network metadata 观察，仅记录去 query/hash 的 method、route、status 和 MIME。可见目录数据相关记录：

```text
GET https://api.bilibili.com/x/space/wbi/arc/search -> 200 application/json
```

没有读取请求 query、header、body 或 response body。这个 route 只能说明目录内容由页面内部请求补充，不能证明一个可导航的页面 URL，更不是 Gateway 直接接入该 API 的依据。

## 3. 结论与产品边界

本轮不是“第 2 页不存在”的证明：第 2 页的人类 click 后可以成功替换内容，已由 [v0.2](account-video-pagination-recon-v0.2.md) 证明。它证明的是更窄的事实：**第 1 页公开 DOM 没有暴露一个可安全复用的第 2 页 document URL。**

为保持日常浏览器边界，能力仍为：

```text
bilibili.account_inventory.pagination
status: direct_migration_required
```

以下实现一律不允许作为 direct fallback：

1. `element.click()`、合成 `MouseEvent` 或 content-script synthetic input；
2. 用 Browser Host、Playwright、CDP、全局鼠标或 `chrome.debugger` 接管用户日常浏览器；
3. 根据目录 XHR route 猜测 `page`、`pn`、签名或其他 query；
4. 读取或调用该请求的正文以绕过 document URL 缺口。

下一条可行产品路径是 `user_selected_tab` 观察模式：用户在自己选择的投稿页完成一次真实翻页后，扩展仅以精确 tab/document/run 绑定观察 DOM 和受控 Network metadata，并投影已公开、受预算约束的结果。它必须作为独立能力设计和验证，不能被标记为现有 direct capability 的完成。

## 4. 清理

临时 Playwright context 在 run 结束时关闭。侦察脚本、状态 JSON 和截图仅存在于 ignored runtime，已在本去敏记录完成后删除；隔离 validation Profile 随后交还受管验证浏览器。用户日常浏览器及其登录状态未被读取、复制、关闭或改变。
