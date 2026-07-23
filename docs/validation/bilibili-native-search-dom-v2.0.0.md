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

这些 run 进一步证明了类型和排序枚举的真实可行性，但没有把单页 runner 自动升级成多页任务。跨页任务必须在同一任务上下文内保存 query/type/sort/page、页间 BVID 去重和终止原因；本轮的 5 个重复项是必须保留的边界事实。

## 结论

`bilibili.search.breadth.dom.v2 @ 0.2.0` 已在 UTF-8 中文查询上完成一次真实生产首屏闭环，但当前策略仍保持：

```yaml
maturity: build_ready
admissionEligible: false
productionStatus: research-only
```

下一门槛是实现有界多页任务账本（页间去重、重复比例和恢复语义），再补空结果样本并做独立 review；不能把旧的 v1 admission 或本次单页 canary 自动扩大为 v2 admission。
