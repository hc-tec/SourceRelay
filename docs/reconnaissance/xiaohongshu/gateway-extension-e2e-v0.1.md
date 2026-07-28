# 小红书 User Browser Gateway → Extension 真实闭环 v0.1

## 结论

`proved`。2026-07-28，真实 User Browser Gateway 接收 query-only API 请求，经持久安全状态与签名工作队列派发给 `xiaohongshu_validation` 持久验证浏览器中的正式 MV3 扩展。扩展在既有公开 Explore tab 内执行一次可信站内搜索，Gateway 收到 `completed / search_ready` 结果、生成去敏 artifact，并通过带 scope 的 Collector Service API 成功返回 artifact。

该 run 补齐了此前仅有扩展侧 canary、尚未证明 Gateway 正式派发路径的缺口。因此 `xiaohongshu.search.public_notes.v1` 可以从 `direct_gateway_dispatch_pending` 进入 `direct_ready`。

## Run 摘要

```yaml
runIdentity: gateway-operation-22458ffa-2153-4a96-ae0a-d22229e0fabc
objective: 证明上层 API 到正式扩展再到去敏 artifact 的真实小红书公开搜索闭环
platform: xiaohongshu
targetRole: search
targetIdentity: public Explore -> same-tab public search
browserMode: visible persistent validation profile
browserLifecycle: managed_profile_session
authenticated: true
extensionInteractionLoaded: true
gatewayPath: user_browser_api_to_signed_queue_to_production_extension
validationBaselineNavigationCount: 1
productNavigationCount: 0
semanticActionCount: 1
automaticPlatformRetries: 0
operationState: completed
terminalReason: search_ready
artifactId: d6358a42-e049-49d2-8350-ec028681ce7b
outcome: proved
```

验证入口为 `poc/collector-browser-host/scripts/validate-xiaohongshu-gateway-e2e.mjs`。它启动一次临时 loopback Gateway，并通过固定 `pair_only` 控制契约把持久验证浏览器中的正式扩展配对到该 Gateway。控制契约不接受任意 URL、selector、tab、坐标、脚本或 CDP 命令，也不执行任何平台选择动作。

## 闭环证据

时间线中的关键事实：

1. 临时真实 Gateway 启动；
2. 受管页面 `page-1` 被精确租用，并仅为验证基线导航一次官方 Explore；
3. 基线视觉证据：`5e78d60b-b6c8-41ac-a49b-68fe422cd73f`；
4. 正式扩展完成 loopback 配对，`controlTargetDisposed=true`，没有遗留扩展页；
5. `/v2/collect` 返回 operation `22458ffa-2153-4a96-ae0a-d22229e0fabc`；
6. 扩展领取 Gateway 签名 work item，在同一 Explore tab 内执行一次可信搜索；
7. operation 到达 `completed / search_ready`；
8. Gateway 生成 artifact `d6358a42-e049-49d2-8350-ec028681ce7b`，随后 artifact API 读取成功；
9. 最终页面保留为 `retained_for_review`；事后只读视觉证据：`2a1ade16-484f-4ac5-9a4a-55ead53c6dcf`。

正式 result/artifact 契约同时证明：

- `navigation.attempted=false / attemptCount=0`；
- `semanticAction.attempted=true / attemptCount=1`；
- 公开投影至少包含 1 条笔记；
- `rawPayloadStored=false`；
- `responseUrlsStored=false`；
- `debuggerDetached=true`；
- artifact 使用 `queryDigest`，结构中禁止 `query`、URL、route、header、Cookie、Token、xsec token、raw payload、tab ID 和 document ID。

## 本地验收器误报

平台闭环完成后，第一版 E2E 验收器返回 `xiaohongshu_gateway_e2e_artifact_forbidden_material`。这不是平台动作或 Gateway 失败：验收器已经先确认 operation 完成并成功读取 artifact，随后使用了错误的全文字符串规则——它禁止 artifact 的公开笔记标题自然出现搜索词“咖啡豆”。搜索结果正文包含搜索词是正常公开数据，不能等同于保存了一个原始 `query` 字段。

本轮没有因此重放搜索。验收器已改为检查结构化敏感字段，并只在 Gateway 队列/审计元数据文件中检查原始 query；公开 artifact 内容仍由严格 schema、字段黑名单和 SHA-256 完整性检查约束。队列终态把原始 query 替换为 `queryDigest` 的不变量另有基础框架测试覆盖。

## 生命周期与残留

- 正式平台语义动作：1 次；没有自动重试；
- Gateway 与临时状态目录：已停止并删除；
- 扩展控制页：配对后已关闭，当前为 0 个；
- 受管浏览器：保持单一持久进程，没有闪退或重启循环；
- 最终搜索页：`retained_for_review`，所有者为 `xiaohongshu_validation`；
- 关闭条件：下一次显式停止/受管重建，或项目所有者要求关闭；
- 用户日常浏览器：未触碰。

## 最新构建回归 canary

在后续加入主页短链 observer 预注入与 worker 中断清理后，重新执行了一次同一真实 Gateway→Extension 搜索闭环，确认共享控制链没有回归：

```yaml
runId: 03185392-e3a5-43f8-8054-ef3ae1132ec7
validatedCapability: xiaohongshu.search.public_notes.v1
validationBaselineNavigations: 1
productPlatformNavigations: 0
semanticActions: 1
automaticPlatformRetries: 0
operationState: completed
terminalReason: search_ready
itemCount: 20
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
finalPageState: retained_for_review
```

该回归 run 没有为主页短链能力提供额外证据；`xiaohongshu.account.public_notes.v1` 仍需使用真实短时主页链接单独完成 live canary。
