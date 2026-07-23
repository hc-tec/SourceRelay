# B 站视频弹幕 DOM MVP 真实闭环 v0.1

> 验证日期：2026-07-23（Asia/Shanghai）
> 目标：`BV1qZSLBYEpa`
> 策略：`bilibili.video.danmaku.dom.v1 @ 0.1.0`
> 结论：**真实闭环 proved；有界预算结果 partial；尚不 admission**

## 本轮回答的问题

验证生产 Browser Host + MV3 + Gateway 链路能否在真实 B 站视频页上完成一条有界的 DOM-first 弹幕采集流程：

```text
一次导航
  -> 一次可信打开“弹幕列表”
  -> 读取第一窗口 DOM
  -> 一次可信的列表内滚动
  -> 读取第二窗口 DOM
  -> 按 data-index 去重并保存 raw-first artifact
```

本轮不读取 `seg.so` 二进制响应正文，不下载音视频，不发送评论或其他改变平台状态的动作。

## Run 摘要

```yaml
runId: 6e55cc89-c993-4ba0-aa71-2c20aa1898b8
artifactId: 7dea60cc-ac67-4e7c-8f87-d083e397c080
platform: bilibili
targetRole: video_detail
targetIdentity: BV1qZSLBYEpa
browserMode: visible persistent managed Collection Profile
browserLifecycle: managed_profile_session
authenticated: anonymous_public_read
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
navigationCount: 1
outcome: partial
state: partial
terminalReason: budget_exhausted
admissionEligible: false
```

## 三面证据

### 视觉

动作后的视觉证据显示：

- 播放器仍可见，播放器覆盖层显示公开弹幕文本；
- 右侧“弹幕列表”面板可见，包含“时间 / 弹幕内容 / 发送时间”三列；
- 第二窗口滚动后列表内容和滚动位置发生变化；
- 页面仍保留在目标视频页，没有打开新的扩展页、重定向页或额外平台标签页。

视觉截图仅保存在 Gateway runtime 的 ignored `visual-evidence/` 目录，不进入 Git。

### DOM

第一窗口和第二窗口均由生产 MV3 DOM projector 读取，主要字段为：

```text
li.bui-long-list-item[data-index]
  .dm-info-time       -> time
  .dm-info-dm         -> content
  .dm-info-date       -> sentAt
```

本次最终 DOM 快照还证明：

```yaml
bvid: BV1qZSLBYEpa
playerVisible: true
danmakuOverlayVisible: true
danmakuEnabled: true
listOpen: true
listContainerVisible: true
listTotalEstimate: 62
listOffset: 1147
listRowsInFinalWindow: 15
overlayItemsInFinalSnapshot: 2
loginGateVisible: true
risk.verificationRequired: false
risk.rateLimited: false
risk.sourceUnavailable: false
```

`loginGateVisible=true` 只代表播放器的登录提示仍可见；本样本的公开弹幕列表已经正常显示，不能把该提示误报为列表不可读。

### Network

本产品 canary 使用 DOM-only 策略，未读取或保存 response body、请求头、请求体、Cookie 或 Token。此前独立人工侦察已经记录过以下去 query route 的公开 metadata：

```text
GET /x/v2/dm/web/view
GET /x/v2/dm/wbi/web/seg.so
```

两者均曾观察为 `application/octet-stream`；该历史 metadata 不被本次 DOM artifact 当作字段来源，也不构成 binary projector 的 admission 证据。

## 动作账本

| action | 真实输入 | attempted | count | 后置条件 |
|---|---|---:|---:|---|
| `navigate` | Playwright `page.goto` | 是 | 1 | 目标 document 成功绑定，页面身份为目标 BVID |
| `open_list` | 浏览器级 mouse move + mouse down/up | 是 | 1 | 列表面板可见，首个 DOM 窗口有行 |
| `scroll_list` | 列表容器内浏览器级 wheel 720px | 是 | 1 | `listOffset` 增大，虚拟列表窗口推进 |

没有自动重试，没有使用 `element.click()`，没有在动作结果未知后重放动作。

## 覆盖与完整性

```yaml
windowsCaptured: 2
firstWindow: data-index 0..31
secondWindow: data-index 47..61
uniqueRows: 47
duplicateRows: 0
totalEstimate: 62
partial: true
terminalReason: budget_exhausted
```

第一、第二窗口之间存在 `32..46` 的虚拟列表间隔。该结果符合当前固定的一次滚动预算，但不能解释为 62 条已全部取得。因此 runner 诚实返回 `partial / budget_exhausted`，而不是 `danmaku_ready`。

## 生命周期与安全

- 目标页由 managed Browser Host 保留为 `retained_after_run`；没有关闭用户既有 Profile；
- profile snapshot：1 个 retained managed page、0 个 leased page、0 个 quarantined page、扩展 runtime marker 精确匹配；
- account safety：run 结束后回到 `ready`；
- 只保存目标 URL digest、公开 DOM 字段、覆盖状态、截图摘要和哈希；没有保存 Profile ID、Cookie、Token、请求头、请求体或完整 HAR。

## 结论与下一门槛

本轮证明了 `danmaku` 的生产基础链路和两个低频可信动作可用，且修复了一个 Host probe 层级 bug：`readProbe` 返回 DOM 状态本身，ready 回调不应再次读取 `candidate.dom`。

当前仍保持：

```yaml
maturity: build_ready
admissionEligible: false
productionStatus: research-only
```

下一门槛不是继续增加动作重试，而是设计可恢复的虚拟列表预算（例如按可见窗口推进并验证连续覆盖），增加至少一个不同弹幕密度/访问状态样本，完成 review 后再讨论 admission。二进制 `seg.so` projector 仍是独立研究，不得由本次 DOM 成功自动升级。
