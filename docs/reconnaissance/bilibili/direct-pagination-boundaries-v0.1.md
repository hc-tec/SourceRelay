# B站 direct 分页边界侦察 v0.1

- 日期：2026-07-27
- 目标：只判断两种分页场景能否作为日常浏览器扩展 direct-mode 的下一步依据；不把旧 Browser Host 代码或历史 artifact 当作本轮证据。
- 环境：专用、可见、临时 persistent Chromium Profile；匿名状态；未加载 Collector Extension，未连接 Gateway，也未附着用户日常浏览器。
- 数据边界：本文不保存搜索词、账号标识、截图、Cookie、Token、请求 query/header/body 或 response body；只记录去敏的页面状态和 Network route metadata。

## 结论

| 场景 | 人类流程实证 | direct 产品结论 |
| --- | --- | --- |
| B站站内搜索第 2 页 | **proved** | 可以实现为固定、签名的第 1 页 -> 第 2 页原生 URL 导航；当前代码仍须经过独立的扩展/Gateway canary 后才可标为 `direct_ready`。 |
| UP 主投稿视频分页 | **inconclusive** | 继续保持 `direct_migration_required`；不得用旧可信 click、刷新或重试伪造迁移完成。 |

## 1. 站内搜索第 2 页：proved

### Run 摘要

```yaml
runId: bilibili-native-search-page-two-20260727
objective: 确认公开站内搜索从第 1 页进入相邻第 2 页的真实人类流程与页面/网络后置条件
platform: bilibili
targetRole: search
targetIdentity: native-search-query-redacted
browserMode: visible persistent profile
browserLifecycle: temporary_recon
authenticated: false
extensionInteractionLoaded: false
existingPlatformRunnerUsed: false
outcome: proved
```

### 观察与动作账本

1. 在导航前启动 Network 观察，打开一个去敏的公开站内搜索第 1 页；视觉和 DOM 都能看到第 2 页数字按钮。
2. 读取实时可见性、边界与未选中状态后，对第 2 页按钮执行了一次浏览器级可信 click；没有调用 `HTMLElement.click()`、合成事件、刷新或重试。
3. 动作后，视觉上进入第 2 页；DOM 中第 2 页按钮为 active。页面 URL 出现平台临时参数，但其规范语义仍是原关键词与 `page=2`。
4. 动作后新增 `GET https://api.bilibili.com/x/web-interface/wbi/search/type`，状态 `200`，initiator 为 `fetch`。该记录只保存去 query/hash 的 route 与状态，未读取 response body。

动作预算：初始导航 1；语义 click 1；scroll 0；hover 0；没有自动重放。

### 产品含义

- 扩展 batch 不需要点击分页器：Gateway 只接收 `query`，固定生成、签名并顺序导航规范第 1、2 页 URL。
- 每页只允许受控 DOM 投影；不读取网络正文、不提供任意 URL、页码、selector、脚本、tab 或 Network 控制接口。
- 页面把短时 `o`、`vt` 等参数加到实际 URL 时，观察层可将其规范化；签名输入仍只以 `query + page` 的严格规范 URL 为准。

## 2. UP 主投稿视频分页：inconclusive

在一个去敏的公开 UP 主投稿视频页中，页面同时出现了“视频数量存在”和内容区空白的矛盾状态；“视频”导航项已经处于 active。

- 没有点击分页、滚动、刷新、重试或继续操作。
- 没有把旧 Browser Host 的可信输入实现、已有历史 artifact 或“理论上有下一页”当作 direct 证据。
- 因为首页非空/分页控件/内容 readiness 没有同时成立，本轮不足以定义安全的页面 2 后置条件。

因此 `bilibili.account_inventory.pagination` 继续停留在 `direct_migration_required`。只有在已登录的隔离验证 Profile 中重新完成视觉、DOM 与 Network 三面实证后，才允许设计新的 direct 执行器。

## 3. 清理与边界

临时页面、浏览器、Profile、截图/snapshot/console 文件均已关闭或删除；没有保留调试端口、Gateway 或扩展会话。用户日常浏览器、已登录状态和已配对扩展没有被读取、复制、关闭或改动。
