# Collector 上层 API 与采集能力全面验收（2026-07-30）

> **2026-08-05 当前基线修正。** 本文主体记录的是 2026-07-30 的历史验收快照；当前运行时应以以下数字为准：能力目录 **21 项**，其中 **18 项 `direct_ready`**（15 项浏览器扩展 direct capability + 3 项官方 API provider），3 项不可调度迁移边界。当前服务 schema 为 `v3`，版本保持 `0.7.17`。15 项浏览器 direct capability 已由 Gateway route-admission 矩阵逐项验证，新增测试位于 `poc/collector-gateway/test/user-browser-collector-service-routes.unit.test.ts`；完整 `npm run verify:collector` 已通过。历史段落中的 18/15、旧 build fingerprint 和旧 canary 数字不应作为当前运行时计数。

另一个需要注意的历史差异：当前 `bilibili.discussion` 走扩展自有 `collector_work_tab`，不要求上层提交或选择 tab；历史表格中“用户已选页面”的表述不再是 v3 `/v2/collect` 契约。

## 结论

当前 user-owned-browser 直连服务的能力目录共有 **18 项**：

- **15 项 `direct_ready`**：可以由上层应用通过 `@intelligence/collector-client` 提交；
- **3 项登记但不可调度**：仍然必须由上层识别为迁移边界，不能因为目录中存在就提交。

15 项可调度能力已经完成以下层次的验证：

1. 生产 Gateway、MV3 扩展和隔离验证浏览器的真实本地闭环；
2. B 站公开页面的真实 direct canary 和已完成 artifact 的逐项读取；
3. 小红书真实搜索、公开主页、笔记详情、评论和回复闭环；
4. 上层客户端、Gateway 目录、OpenAPI request/operation/artifact 枚举的一致性回归。

本轮没有接触用户日常浏览器 Profile，没有读取或导出 Cookie、密码、Storage、平台登录 Token 或原始 Network 正文，没有执行点赞、关注、收藏、评论、私信、发布或删除。

## 当前运行时基线

```yaml
collectorVersion: 0.7.17
controlSurfaceRevision: 16
buildFingerprint: 2ae59f234e845cce2dc2d00a58e2b93b3b9710d4b6c10b6bc6a42725a0e50456
gatewayMode: user_owned_browser_extension
browserHostFallback: forbidden
```

Gateway 只接受 loopback 上的已配对扩展和带 scope 的本地服务 token。上层请求不能携带任意 URL、tab ID、selector、脚本、坐标、CDP 命令、分页列表或 Network route/body。

## 18 项能力目录

### 15 项 `direct_ready`

| 平台 | 能力 | 真实闭环证据 | 上层执行边界 |
| --- | --- | --- | --- |
| B 站 | `bilibili.native_search` | 当前构建 live canary 与历史 direct artifact 均完成；固定综合相关性第 1 页，一次导航 | `collector_work_tab`；只提交 query |
| B 站 | `bilibili.native_search_batch` | 本轮当前构建真实 canary 通过；第 1、2 页各一次签名导航，artifact `capturedPages=2`、`itemCount>0` | `collector_work_tab`；固定综合/相关性两页，零页面语义动作 |
| B 站 | `bilibili.account_profile` | 已完成真实 artifact 读取，operation/artifact 均 `completed` 且 capability 匹配 | 规范 UP 主主页输入 |
| B 站 | `bilibili.account_inventory` | 已完成真实 artifact 读取；公开投稿首屏投影可读 | 只读首屏，不含分页 |
| B 站 | `bilibili.video_detail` | 当前构建 detail live canary 通过，且已完成 artifact 读取 | 规范公开视频详情，一次导航 |
| B 站 | `bilibili.discussion` | 用户已选页 direct canary 与真实 artifact 读取通过；同 document 被动投影评论 | 需要用户先在页面把评论区加载出来并选择当前页 |
| B 站 | `bilibili.danmaku` | 真实 artifact 读取通过；证明当前页面可见弹幕 DOM 投影路径 | 只读当前可见 DOM，不承诺完整历史弹幕 |
| B 站 | `bilibili.dynamic` | 真实 artifact 读取通过；公开动态流投影完成 | 规范 UP 主主页动态首屏 |
| B 站 | `bilibili.collection_series.overview` | 真实 artifact 读取通过；固定网络元数据与 DOM 概览均完成 | 公开合集/系列概览 |
| B 站 | `bilibili.collection_series.detail` | 真实 artifact 读取通过；使用已发现的合法详情候选 | 固定详情页预算，不接受任意 URL |
| 小红书 | `xiaohongshu.search.public_notes.v1` | run `3972e0df-07bb-4572-9693-88c9cc735988`；搜索 19 张卡片，并完成一条详情、评论和回复组合闭环 | 既有 Explore 页；query-only；可选有界详情/评论/回复预算 |
| 小红书 | `xiaohongshu.account.public_notes.v1` | run `23de4a7c-d379-4b23-b0bc-e1c4fd766d5b`（已有主页 tab，0 导航，40 条）；run `e03c226c-92dc-4b51-881b-97c26d0b3e3c`（短时主页链接，1 导航，131 条）；run `d2488df5-3e4b-4476-955d-5f078f5eec14`（从笔记头像自然发现，1 次尝试，24 条） | 现有公开主页、一次性短时主页链接或笔记头像自然发现；短时 token 不持久化 |
| 小红书 | `xiaohongshu.note.public_detail.v1` | 组合 run 中详情 1 条，`dom_fallback`，公开正文投影长度 643 | 已有搜索/主页页内原地打开详情 overlay，不接受 caller URL |
| 小红书 | `xiaohongshu.note.public_comments.v1` | 组合 run 中评论 12 条；Network matched payload 1，观察到 cursor，滚动预算 1 | 已打开的同 document overlay；有界 trusted scroll |
| 小红书 | `xiaohongshu.note.public_comment_replies.v1` | 组合 run 中回复 1 条，`network_projection`；不需要额外页面导航 | 已打开的同 document overlay；有界 thread budget |

### 3 项登记但不可调度

| 能力 | `dispatchState` | 上层含义 |
| --- | --- | --- |
| `bilibili.account_inventory.pagination` | `direct_migration_required` | 投稿分页还没有迁移到 user-owned-browser direct work 协议；不能把首屏能力扩展解释成可分页 |
| `bilibili.transcript` | `trusted_interaction_migration_required` | 需要可信 hover/click 打开字幕菜单并观察文本轨道；当前目录登记只用于显示边界，不进入 collect request union |
| `xiaohongshu.current_page.network_metadata` | `policy_ready_route_admission_required` | 当前页 Network 元数据策略已登记，但还没有获准的公开内容 route；不能读取任意网络正文 |

## 真实平台证据

### B 站当前构建固定两页搜索

本轮使用独立的、持久的、可见验证浏览器和临时 Gateway，命令为：

```powershell
Set-Location D:\AIProject\inteligence\poc
$env:COLLECTOR_LIVE_CANARY='1'
$env:COLLECTOR_LIVE_CANARY_SCOPE='native_search_batch'
npx playwright test --config playwright.live-canary.config.ts --project live-canary
```

最终结果为 `1 passed`。真实 artifact 交叉证明：

- operation：`completed / search_batch_ready`；
- `bilibili.native_search_batch` operation 与 artifact capability 一致；
- `requestedPages=[1,2]`、`observedPages=[1,2]`、`capturedPages=2`；
- `itemCount>0`；
- page 1、page 2 动作均 `attempted=true`、`attemptCount=1`、`outcome=completed`；
- 总导航 `attemptCount=2`，`semanticActions=0`；
- `responseBodies=not_read`；
- 第二页 work tab 保持可见，截图只写入 ignored runtime 目录，没有进入 Git。

第一次运行只在本地断言阶段失败：artifact 按契约包含 `actionId` 和 `errorCode` 字段，原断言漏写了这两个字段；Gateway 与平台操作当时已成功完成。修正断言后以新的独立 run 重测并通过，没有在原会话中重放导航。

当前构建的 detail + 单页 native search canary 也已通过（`1 passed`）；这两项使用真实公开 B 站页面、production MV3、临时 Gateway 和真实 artifact。

### Python SDK 当前构建真实闭环

本轮新增 `COLLECTOR_LIVE_CANARY_SCOPE=python_sdk` canary。Node harness 只负责创建独立
验证浏览器、配对 production MV3 和签发最小 scope token；能力发现、OpenAPI 读取、binding
发现、catalog-only 拒绝、任务投递、operation 轮询和 artifact 读取全部由 Python SDK 完成。

最终结果为 `1 passed`，并满足：

- 运行时目录 18 项，`direct_ready` 15 项；
- Python 静态 allowlist 与运行时 direct-ready 集合一致；
- OpenAPI 的 5 条业务 paths 完整；
- `xiaohongshu.current_page.network_metadata` 在 Python SDK 本地校验层被拒绝；
- 真实 `bilibili.native_search` operation 为 `completed`；
- operation capability 与 artifact capability 均为 `bilibili.native_search`；
- 真实公开 B 站搜索至少返回一条受控公开视频卡片；
- 只执行一次平台搜索导航，没有读取原始 response body。

### Python SDK 本轮能力化 builder 与模型回归

在上述 live canary 之后，本轮把 Python SDK 从“通用 JSON 客户端”上移为能力化请求
构造器和 raw-first 结构化结果模型。新增 `requests.py` 覆盖全部 15 项
`direct_ready` 能力，固定 schema/platform/capability/execution target，并在提交前
校验 B 站规范 BV/MID、合集 ID、搜索词，小红书短时 profile URL、详情序号以及评论/
回复/滚动预算。新增 `models.py` 的 `Operation`、`ArtifactReference`、`Artifact` 和
`CollectionResult` 只投影稳定包络，保留 detached `raw`/`payload`。

新的独立真实 run 仍使用 `COLLECTOR_LIVE_CANARY_SCOPE=python_sdk`，通过 builder 构造
`bilibili.native_search` 请求，再由 `collect_and_wait_model()` 完成真实投递、轮询和
artifact 读取，结果 `1 passed`。因此这次变更没有扩大平台动作边界：真实搜索仍只有
一次导航，operation/artifact capability 一致，页面保持可见，response body 未读取。

同一边界又用 `COLLECTOR_LIVE_CANARY_SCOPE=javascript_sdk` 做了独立 JS SDK run：
`bilibiliNativeSearch()` 构造请求，`collectAndWaitModel()` 读取结构化结果，最终同样
为 `1 passed`。两次 run 使用不同的测试浏览器会话，没有在本地失败收尾后重放原会话的
平台动作。

### B 站其余能力

此前持久 Gateway 中已完成的真实 artifact 逐项读取覆盖：

```text
bilibili.video_detail
bilibili.account_profile
bilibili.account_inventory
bilibili.dynamic
bilibili.danmaku
bilibili.native_search
bilibili.collection_series.overview
bilibili.collection_series.detail
bilibili.discussion
```

每项都满足：operation `completed`、artifact route `200`、operation capability 与 artifact capability 相等；读取阶段不创建新任务、不触发新平台导航。固定两页能力另由本轮当前构建 canary 覆盖。

### 小红书组合闭环

组合 run `3972e0df-07bb-4572-9693-88c9cc735988` 覆盖搜索、详情、评论和回复：

```yaml
searchCards: 19
detailCount: 1
detailCapture: dom_fallback
detailPublicTextLength: 643
commentCount: 12
replyCount: 1
commentCapture: hybrid
replyCapture: network_projection
networkMatchedPayloadCount: 1
networkBodyBytesRead: 4621
cursorObserved: true
actionTriggeredResponseCount: 0
rawPayloadStored: false
responseUrlsStored: false
automaticPlatformRetries: 0
```

主页能力的三个 execution target 也分别真实覆盖：

| execution target | run | 结果 |
| --- | --- | --- |
| `existing_public_profile_tab` | `23de4a7c-d379-4b23-b0bc-e1c4fd766d5b` | 0 次产品导航、0 次滚动，40 条公开笔记卡，5 个匹配 Network payload |
| `ephemeral_public_profile_url` | `e03c226c-92dc-4b51-881b-97c26d0b3e3c` | 1 次导航、8 次有界滚动，131 条公开笔记卡，5 个匹配 Network payload |
| `discover_public_profile_from_note` | `d2488df5-3e4b-4476-955d-5f078f5eec14` | 头像自然发现 1 次尝试，观察到短时 token，24 条公开笔记卡，无自动重试 |

在某个搜索词的头像前置条件不满足时，系统记录 `prerequisite_unmet`、`attempted=false`，不点击、不刷新、不重试；这不是把失败伪装成成功，而是正确的风险停止语义。另一个公开样本“咖啡豆”上自然发现成功，见上表。

## 能力矩阵契约回归

新增测试：

```text
poc/collector-gateway/test/user-browser-direct-capability-matrix.unit.test.ts
```

它同时比较：

1. Gateway `listUserBrowserCapabilities()` 的 18 项目录；
2. `@intelligence/collector-client` 允许提交的 15 项集合；
3. OpenAPI `UserBrowserCollectRequest.oneOf` 的 15 个 request variant；
4. OpenAPI `Operation.capability` 和 `ArtifactResponse.capability` 的 15 项枚举。

回归第一次运行发现了一个实际漏项：`bilibili.native_search_batch` 已经在目录、客户端和 request union 中开放，但 OpenAPI 的 operation/artifact 枚举没有它。已在 `user-browser-collector-service-openapi.ts` 修复，并由矩阵测试永久锁定；以后新增 direct 能力时会立即暴露同类漂移。

## 测试分层结果

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| CollectorClient Node tests | `npm test --workspace @intelligence/collector-client` | 8 / 8 通过；覆盖提交一次、轮询不重提、artifact capability 绑定、任意控制字段拒绝、15 项 JS builder 和 raw-first 模型 |
| Python SDK tests | `Set-Location poc/collector-python-client; python -m pytest -q` | 15 / 15 通过；覆盖 transport、15 项 builder、URL/预算边界、raw-first 模型、一次提交、轮询超时和 artifact 绑定 |
| Python SDK 真实 Gateway canary | `COLLECTOR_LIVE_CANARY_SCOPE=python_sdk` | 1 / 1 通过；真实 MV3、Gateway、B站搜索和 artifact |
| Python 上层参考应用 | `Set-Location apps/collector-python-sdk-smoke; python -m pytest -q` | 3 / 3 通过；覆盖 direct-ready 门禁、不可调度能力不投递和 typed B站搜索 facade |
| Vitest 单元/领域/契约 | `Set-Location poc; npm run test:unit` | 84 个测试文件、298 项通过 |
| 真实 MV3 integration/E2E | `Set-Location poc; npm run test:real-local` | 8 / 8 通过；包含扩展启动、版本漂移拒绝、Profile 隔离、配对、端口占用、Gateway/Browser Host 生命周期 |
| 完整本地门禁 | `Set-Location poc; npm run test:all-local` | 单元与真实本地 8/8 均通过 |
| Testbench | `Set-Location apps/collector-gateway-testbench; npm run check` | 16 / 16 通过；包含全部 direct 输入映射和任意控制面拒绝 |
| 生产构建 | `Set-Location poc; npm run build:collector-runtime` | contracts、MV3 extension、Browser Host、Gateway 全部构建通过 |
| 当前构建 B 站 batch live canary | 见上方命令 | 1 / 1 通过 |
| 当前构建 Python builder live canary | `COLLECTOR_LIVE_CANARY_SCOPE=python_sdk` | 1 / 1 通过；真实 builder → Gateway → MV3 → B站搜索 → artifact |
| 当前构建 JavaScript builder live canary | `COLLECTOR_LIVE_CANARY_SCOPE=javascript_sdk` | 1 / 1 通过；真实 builder → Gateway → MV3 → B站搜索 → artifact |

## 上层应用可依赖的 API 面

上层应用应使用 `@intelligence/collector-client`（JavaScript）或
`intelligence-collector-client`（Python）的窄接口：

```text
listCapabilities()
readOpenApi()
listBrowserBindings()
collect(request)
waitOperation(operationId)
readArtifact(operationId)
collectAndWait(request)
```

其中：

- `collect()` 对一次 `POST /v2/collect` 做严格校验，不会为平台动作重试；
- `waitOperation()` 只轮询本地 operation 状态，不会重新提交任务；
- `readArtifact()` 从已完成 operation 的 capability-bound retrieval path 派生路径，不接受 caller 任意 URL；
- `listDirectCapabilities()` 返回客户端当前允许提交的 15 项名称，返回数组与内部校验状态隔离；
- 非 `direct_ready` 的 3 项不会出现在客户端可提交集合、request union、operation enum 或 artifact enum 中。

上层应用仍必须根据 `/v2/capabilities` 的 `dispatchState`、execution target 和预算选择请求，不能把 `direct_ready` 理解为无限制爬取，也不能自行增加分页、selector、脚本、tab 控制或 Network body 参数。

Python SDK 位于 `poc/collector-python-client`，使用 `asyncio` 和 snake_case 方法；它与
JS SDK 分包、分测试、分依赖，但共享同一份 `/v2` OpenAPI 与能力矩阵协议。

## 清理与风险边界

- 当前构建 live canary 的临时 Gateway、临时 Profile、扩展 context 和调试资源均在 `finally` 中关闭并删除。
- 隔离验证浏览器按项目策略保留其最终公开页供复核；它不是用户日常浏览器，扩展页为 0，未受管页为 1，实时平台请求为 0。
- 用户已有 `AGENTS.md` 修改和 `.playwright-cli/` 内容没有修改、暂存或提交。
- 小红书短时主页链接只在单次 run 内使用；不会保存 URL、`xsec_token`、Cookie 或 Storage。
- 小红书图像/视频临时 URL 的下载与长期保存尚未纳入本轮能力矩阵；当前 artifact 只保存受控公开投影。
- “评论区可读”不等于完整历史分页；“弹幕可读”不等于完整历史弹幕；字幕和投稿分页仍保持不可调度状态。

## Git 检查点

本轮提交：

```text
c338dd0 test(local): align extension lifecycle assertions with revision 16
1a2ee35 test(collector): lock direct capability matrix and batch canary
b72f573 docs(validation): record complete upper API capability matrix
230fa29 docs(client): document direct capability allowlist
b5f5b6c docs(validation): include client contract checkpoint
6be226a feat(sdk): add layered Python SDK and split JavaScript client
eaccfbe test(sdk): verify Python client live and add smoke app
```

上一阶段上层客户端提交：

```text
3f6dd0c feat(collector): add upper-layer direct API client
080f8ce refactor(testbench): reuse collector client
```

工作区中仅保留项目所有者已有的 `AGENTS.md` 修改和 `.playwright-cli/` 未跟踪材料；本轮实现、测试和报告均已提交。
