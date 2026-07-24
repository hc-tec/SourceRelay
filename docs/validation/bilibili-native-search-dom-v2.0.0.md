# B 站原生搜索 DOM v2 真实闭环 v2.0.0

> 验证日期：2026-07-23（Asia/Shanghai）
> 平台：B 站桌面原生搜索
> 查询：中文关键词“人工智能”（artifact 只保存 query digest）
> 策略：`bilibili.search.breadth.dom.v2 @ 0.2.0`
> 结论：**真实首屏闭环 proved；尚不 admission**

## 关键纠正

本轮第一次手动请求使用了 PowerShell 默认字符串发送，中文请求体在进入 Gateway 前被替换成 `????`，该 run 的 `authentication_required` 结果不计入任何证据。随后改用明确的 UTF-8 字节请求体重新执行独立 run，并在真实页面截图中确认搜索框显示“人工智能”，因此以下结果只引用 UTF-8 修正后的 run。

## Run 摘要

```yaml
runId: 7dd3dd1e-05ea-4d80-bca5-8e41a331fa00
artifactId: 0c6eb5ea-34b9-45cc-8dd4-0ea7ebe9b660
browserMode: visible persistent managed Collection Profile
browserLifecycle: managed_profile_session
authenticated: anonymous_public_read
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
navigationCount: 1
navigationRetryCount: 0
resultType: video
sort: newest
page: 1
state: completed
terminalReason: search_ready
admissionEligible: false
```

## 真实证据

### 视觉

基线截图显示：

- 搜索输入框显示中文“人工智能”，没有出现 `????`；
- “视频”类型标签处于选中态；
- “最新发布”排序按钮处于选中态；
- 页面可见视频卡片网格，未把登录浮层遮挡误判为无结果。

### DOM

生产 MV3 DOM projector 取得：

```yaml
resultType: video
sort: newest
page: 1
semanticResultCardCount: 30
visibleVideoCardCount: 20
capturedItems: 20
unresolvedCardCount: 0
allItemsHadCanonicalBvUrls: true
loginOverlayVisible: true
risk.verificationRequired: false
risk.rateLimited: false
risk.sourceUnavailable: false
```

登录浮层只表示匿名用户不能使用登录后功能；公开搜索结果仍然完整渲染，因此 `loginOverlayVisible=true` 不阻塞本次公开首屏结果。

### Network

本次生产策略不读取请求头、请求体、响应正文或 Cookie/Token，只使用导航后的可见 DOM。此前原生搜索人工侦察已独立证明类型、排序和分页对应的第一方 route metadata；该历史 metadata 不成为本次结果字段来源。

## 动作账本

| action | 输入 | attempted | count | 结果 |
|---|---|---:|---:|---|
| `navigate_native_search` | Gateway 受管 Playwright `page.goto` | 是 | 1 | 目标搜索文档绑定，结果稳定可读 |

没有点击、滚动、自动重试或第二次导航。搜索关键词只在短时导航和 observer binding 中使用，持久 artifact 只保存 digest。

## 生命周期与安全

- 目标搜索页由 managed Browser Host 保留为 `retained_after_run`；
- run 结束后 account safety 回到 `ready`；
- artifact 保存 20 条公开可见视频卡片、BVID、规范 URL、标题、可见文本和安全封面引用；
- 未保存 Cookie、Token、请求头、请求体、完整 query 或 HAR；
- 本次 run 只证明视频类型、最新发布、第一页、最多 20 条，不覆盖综合排序、第二页、更多筛选或完整搜索终点。

## 后续有界变体

在同一 UTF-8 请求约束下又执行了两个独立 run：

| run | 类型 | 排序 | 页码 | 结果 | 备注 |
|---|---|---|---:|---|---|
| `a6318f7b-dcc9-472c-950c-c54de4704efc` | video | newest | 2 | 20/20，`search_ready` | 与第 1 页比较有 5 个重复 BVID，不能宣称跨页无重复 |
| `91a24a7d-1f09-4f32-b44d-d39b64b836a4` | comprehensive | relevance | 1 | 20/20，`search_ready` | 综合页公开视频卡片可投影，混合对象仍被排除 |

这些 run 进一步证明了类型和排序枚举的真实可行性。Gateway 先补上按稳定 BVID 合并页窗口的纯逻辑 helper，并用单元测试固定“保留首个页面顺序、记录重复 BVID、重复即 partial”的规则；随后才接入下一节记录的有界多页 runner。跨页任务仍必须在同一任务上下文内保存 query/type/sort/page、页间 BVID 去重和终止原因；本轮独立 run 的 5 个重复项是必须保留的边界事实。

## 有界批量搜索真实 canary

在上述独立 run 之后，Gateway 已接入有界的双页 batch runner，并在隔离的临时 Collection Profile 中完成一次真实闭环。该任务仍使用生产 MV3 DOM projector 和可见 Playwright Chromium；没有读取 response body，也没有把原始查询写入持久 artifact。

```yaml
batchId: de52d6b2-367c-46be-a178-9a2e51766db8
artifactId: 427bbd8e-37c2-4479-bbc7-bcd1b040ab05
profile: 9d8b8c87-5ae9-4bd2-a6f9-e49fa3943d3b
query: sha256_only_in_persisted_artifacts
queryPlaintextForCanary: 人工智能
resultType: video
sort: newest
requestedPages: [1, 2]
capturedPages: 2
uniqueItems: 40
duplicateCount: 0
unresolvedCardCount: 0
partial: false
state: completed
terminalReason: search_batch_ready
strategy: bilibili.search.breadth.dom.v2 @ 0.2.0
admissionEligible: false
```

批量 manifest 关联了两个单页 run：第 1 页 `ca485fea-694e-460c-8a72-3efad87911db`（20 条）和第 2 页 `7ff98729-64e2-476c-af68-e4eaa34b711b`（20 条）。合并文件的 SHA-256 为 `8538ce6a6de71b1662413b259b1f4e0064ed00fa3a98c9f2e7b4a323ead4c86f`；artifact 只保留 query digest、页面结果和 coverage，不保存 Cookie、Token、请求头、请求体或完整 HAR。

本次 batch 在两页之间没有重复 BVID，但不能覆盖前一节独立 run 观察到的 5 个重复 BVID。B 站搜索结果会随时间变化，因而“本次 `duplicateCount=0`”只能作为本次任务的事实，不能推广为分页永不重复。batch runner 当前最多执行两页，遇到某页失败或 partial 会停止后续页，不自动重放平台导航；重复出现时按契约终止为 `partial / search_batch_duplicates`。

临时 Gateway、Browser Host 和 Profile 已在 canary 结束后显式关闭；43131 监听端口已清理，其他受管 Gateway（43127/43128/43129）未受影响。

### 空结果终止 canary

批量 canary 随后使用同一隔离 Profile 做了一次真实空结果验证，请求页预算为 `[1, 2]`。第一次复跑的截图已经显示空页面，但旧 DOM projector 只寻找 `empty` / `no-result` 类名，漏掉了真实的 `.search-nodata-container` / `.no-data`，并把匿名顶部 `.login-panel-popover` 误当成阻断式登录弹层，因而错误终止为 `authentication_required`。该失败只作为 bug 证据，不计入空结果能力。

修正真实 DOM 分类器并重新构建后，第二次独立 run 的结果为：

```yaml
batchId: 9b9a12e3-dac9-454d-9113-68633c7256e0
artifactId: ac12da63-4ecb-4069-808d-f22a867e00ef
query: sha256_only_in_persisted_artifacts
queryDigest: ebc9195f0fd605ba86361b068b6678147d3836348d287f614374153f096070a1
requestedPages: [1, 2]
capturedPages: 1
uniqueItems: 0
duplicateCount: 0
unresolvedCardCount: 0
state: completed
terminalReason: search_batch_empty
page2Navigation: not_dispatched
admissionEligible: false
```

视觉证据显示搜索框、视频类型、最新发布排序和 B 站真实空态文案“今天真是寂寞如雪啊~”；DOM 证据对应 `.search-nodata-container` 与 `.no-data`，动作账本只有一次 page 1 导航。batch 在空态成立后不再导航 page 2，`capturedPages=1` 是有意的稳定终止，不是异常丢页；未读取 response body、请求参数值或认证材料。

## 2026-07-24 checkpoint / recovery 增量

为避免进程在页间切换或平台导航期间崩溃后盲目重放，Gateway 新增了本地 batch checkpoint：

```text
GET  /v1/bilibili-native-search-batch-checkpoints
POST /v1/profiles/:profileId/bilibili/search/native/batch/resume
POST /v1/profiles/:profileId/bilibili/search/native/batch/resolve
```

checkpoint 只保存 `batchId`、Profile ID、搜索类型/排序/页码、query digest、已完成页的 artifact 引用、`inFlightPage` 和终态；不保存原始 query、Cookie、Token、请求头、请求体或响应正文。每个页动作前先原子写入 `inFlightPage`，单页 runner 返回并成功保存页 artifact 后才清空它。恢复时会重新校验页 artifact 的 run ID、页码、搜索选择和 query digest，只复用已经完成的页；如果发现 `inFlightPage` 非空，接口返回 `bilibili_native_search_batch_recovery_outcome_unknown`，绝不自动重放该页。

未知动作结果的 checkpoint 只能由本地显式处置接口归档：请求体必须包含 `batchId`、`disposition=abandon` 和固定 acknowledgement `acknowledge_unknown_platform_action`。处置只写入 checkpoint 的 `resolution`（含 `resolvedAt`），保留原始 `state=outcome_unknown` 与 `inFlightPage`，不删除 artifact、不关闭或导航页面、不解锁账号安全，也不改变平台状态；当前 Gateway 进程仍持有该 batch 时会先返回 `bilibili_native_search_batch_checkpoint_active`，只有进程重启后确认没有本地执行者才能处置；已经处置的 checkpoint 后续仍以 HTTP 409 拒绝 resume。旧 checkpoint 没有 `resolution` 字段时会按 `null` 兼容读取，不会伪造已处置事实。

使用正确的 UTF-8 code point 请求方式，对同一隔离 Collection Profile 完成了一次新的真实双页 batch：

```yaml
batchId: fa7a92b9-67de-43a1-a3bc-7fbbcd7ad8cb
artifactId: 7db363bb-dbfb-46bd-ac95-91217e6ec10c
queryDigest: 161332dd5ba244f14566d9ccfc214dbbd620bcd401cded068fc230e3d4e2815b
requestedPages: [1, 2]
capturedPages: 2
uniqueItems: 40
duplicateCount: 0
unresolvedCardCount: 0
state: completed
terminalReason: search_batch_ready
checkpointState: completed
checkpointInFlightPage: null
checkpointPageRuns: [1, 2]
nativeBridgeConnected: true
admissionEligible: false
```

该 run 的 checkpoint 与 batch artifact 均在真实 Gateway 重启前后可读，页面 1、2 均只执行一次；结束时 Profile、Browser Host 和 43131 临时 Gateway 已显式清理。此前另一次内联脚本把中文 query 变成 `????` 的 run 仍按 UTF-8 规则排除，不计入本次证据。

随后又做了一次真实 Gateway 中断 canary：在 batch checkpoint 已持久化 `inFlightPage=1`、尚无页级结果时终止 Gateway 进程；重新启动 Gateway 后，checkpoint 仍为 `state=running / inFlightPage=1 / pageRuns=[] / artifactId=null`。对该 batch 调用 resume 得到 HTTP 409 和 `bilibili_native_search_batch_recovery_outcome_unknown`，checkpoint 不发生变化，也没有重放第 1 页；最后通过隔离 Host 的显式 exit 清理浏览器。这个 canary 证明了“未知动作结果拒绝重放”，不证明导航已经抵达 B 站页面后置条件；页面动作是否已发出仍按未知处理。账号安全门禁因进程中断保持人工解锁状态，符合风险停止规则。

随后对同一中断 checkpoint 执行了一次本地 `resolve`：处置后仍为 `state=outcome_unknown / inFlightPage=1`，新增 `resolution.disposition=abandon` 与 `resolvedAt`；重启读取仍保留该证据，再次 resume 返回 HTTP 409 `bilibili_native_search_batch_checkpoint_not_resumable`，没有创建新 artifact，也没有触碰 B 站页面。该步骤只证明未知动作的人工处置边界，不把未知页面结果升级为成功。

## 2026-07-24 跨任务漂移 coverage 增量

为比较同一中文查询在不同采集时刻的结果稳定性，Gateway 新增了只读本地 coverage 路由：

```text
POST /v1/bilibili-native-search-batch-coverage-artifacts
GET  /v1/bilibili-native-search-batch-coverage-artifacts
GET  /v1/bilibili-native-search-batch-coverage-artifacts/:coverageId
```

请求只提交已保存 batch artifact 的 ID，最多 5 个；计算要求所有样本都是相同 query digest、搜索类型/排序/页窗口、完整且无页内重复的 `search_batch_ready` artifact。比较在内存中基于稳定 BVID 集合计算 intersection、union、overlap、Jaccard 和 drift；coverage manifest 只保存样本 artifact ID、query digest、计数和比例，不保存原始 query 或 BVID 列表。

对两个真实 UTF-8 “人工智能”双页 batch artifact 做了本地 Gateway route 验证：

```yaml
coverageId: beb42cef-db5f-4a48-90a9-37ece8ae2ac6
sampleArtifactIds:
  - 427bbd8e-37c2-4479-bbc7-bcd1b040ab05
  - 7db363bb-dbfb-46bd-ac95-91217e6ec10c
sampleCount: 2
pairCount: 1
leftUniqueItems: 40
rightUniqueItems: 40
intersectionCount: 0
unionCount: 80
overlapRate: 0
jaccardRate: 0
driftRate: 1
```

coverage artifact 重启读取和 SHA-256 manifest 校验均通过，原始 BVID 扫描为 0。这个两样本事实说明 B 站搜索结果会随采集时刻发生显著漂移，不能把一次双页 40 条结果推广为稳定分页；它仍不是 admission，只是把长期 coverage 的测量能力和当前风险证据补齐。

## 结论

`bilibili.search.breadth.dom.v2 @ 0.2.0` 已在 UTF-8 中文查询上完成一次真实生产首屏闭环，但当前策略仍保持：

```yaml
maturity: build_ready
admissionEligible: false
productionStatus: research-only
```

下一门槛不再是“有没有 batch runner”或“能否识别空结果”，而是继续积累跨任务漂移/重复比例样本并完成独立 review；不能把本次 batch 的 40 条 unique 结果、两样本 drift=1、空结果终止或旧的 v1 admission 自动扩大为 v2 admission。
