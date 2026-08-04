# 小红书 JS/Python SDK 消费者验收（v0.7.17）

日期：2026-08-04

结论：通过。搜索、详情、一级评论、二级评论和博主笔记 5 项真实能力都具有正式 `/v2/collect` 幂等记录；JavaScript 与 Python SDK 均完成 5/5 typed-builder replay、Operation/Artifact 身份核对和完整 SHA-256 复算，且消费者对账阶段没有新增平台动作。

## 验收边界

- 正式 Gateway：`http://127.0.0.1:43127`；release `0.7.17`，service schema `3`。
- 真实补证只使用项目管理、已登录的持久小红书隔离验证浏览器；不接管用户日常浏览器。
- 不导出 Cookie、Token、密码或浏览器 storage state，不绕过验证码、风控、访问控制或限流。
- 原始搜索词、browser binding ID、Local API token、页面 URL 和 Artifact 正文均不写入仓库。
- Artifact 只在进程内通过 `/v2` metadata/window 读取，并按 UTF-8 复算完整 SHA-256。
- 每个真实平台 run 只有一次预定义动作预算；失败不会重放同一 request ID，也不会刷新或重启浏览器。

## 回复能力的根因修复

早期回复 Operation 能真实完成并生成 Artifact，但无法通过 Collector Service 做持久 replay。新的正式 canary 证明根因位于 Gateway 回复队列：

```text
clientRequestId
  → 幂等账本预留 Operation A
  → 回复队列忽略 A，又随机生成 Operation B
  → 首次响应/扩展/Artifact 使用 B
  → replay 按账本查 A，返回 collector_service_idempotency_operation_unavailable
```

`enqueueXiaohongshuNotePublicCommentReplies()` 现与其余 direct capability 一致，使用 `this.#operationId(input.operationId)`，不再自行生成第二个 ID。新增两层基础回归：

1. 队列测试断言调用方指定的回复 Operation ID 被原样写入、claim 和持久化。
2. `/v2/collect` route 测试断言 ledger、queue、首次响应和同 request ID replay 四处使用同一 Operation ID，且队列中只有一个 work item。

修复后，停止态 canary 已先证明同 ID replay 不再分裂；随后完成态 canary 证明 ledger、queue、Operation、Artifact 和 replay 全链身份一致。

## 完成态回复真实 canary

为避免在没有楼中楼的笔记上重复操作，按真实人类流程建立前置状态：

1. Browser Host 收养唯一 `retained_for_review` 验证页，不新开页、不关闭页。
2. 固定导航 1 次到官方 Explore，可信站内搜索 1 次；自动重试 0，投影 18 个结果。
3. 正式详情能力点击 rank 1 一次，在同一 search document 打开并保留详情浮层。
4. 正式评论能力实际滚动 2 次，Network+DOM hybrid 投影 37 条一级评论。
5. 正式回复能力请求 1 个线程，从已观察 Network 数据投影出 1 条公开回复，因此无需再次点击展开。

完成态回复证据：

| 字段 | 结果 |
| --- | --- |
| Capability | `xiaohongshu.note.public_comment_replies.v1` |
| Operation | `2260c539-d07b-483b-9031-331da8d112e9` |
| Artifact | `557d7aaa-2c01-4c26-8ab0-70e653f3b633` |
| 终态 | `completed / comment_replies_ready` |
| Capture mode | `network_projection` |
| Reply count | `1` |
| Semantic actions | `0` |
| Navigations / reloads / new tabs | `0 / 0 / 0` |
| Bytes | `1972` |
| SHA-256 | `sha256:fa15467aba46952fae3428a0df4f5e10a086c4afe9f60bb9eb2db9540b975259` |

首次提交的 operational log 精确包含 1 次 `collector.operation.queued`、1 次 `extension.work.claimed` 和 1 次 `extension.work.result_accepted`。紧接着的同 request ID replay 只新增 1 次 `collector.operation.idempotent_replay`，返回同一 Operation 和 Artifact，没有第二次扩展 claim 或平台动作。

## 五项正式幂等证据

共享清单位于 `docs/validation/xiaohongshu-sdk-reconciliation-v0.7.17.json`。5 项都必须是 `idempotent_collect`，不再接受只读替代项。

| Case | Operation | Artifact | 字节数 | SHA-256 |
| --- | --- | --- | ---: | --- |
| `xiaohongshu.public-notes-search` | `e80f967f-a984-4c27-99f3-d9fe71072b38` | `eea7bd7b-5d34-44ba-84b6-4dec90992666` | 5577 | `sha256:444880be31088da22dbb8fa1677d7ca0059af01e527918a39e455a58d7b9a0fe` |
| `xiaohongshu.note-public-detail` | `6a908257-e95d-4874-a94f-d0d3675f430b` | `49c82735-6a64-4ae8-8ab1-4d8e2e1dbbe9` | 4371 | `sha256:1ffebd84d88b4c995cdf5ee205f9f14315ec8d310b6e9da5b17a56e8f6b78683` |
| `xiaohongshu.note-public-comments` | `468abce7-5fab-40e1-8bbb-d3c89eec0cb9` | `169be512-1976-4391-9c21-792d6d53088e` | 11595 | `sha256:847469f6b6d001a7a9f80f5ae6434fca451298379a7ab4cd33be3c40af935724` |
| `xiaohongshu.note-public-comment-replies` | `2260c539-d07b-483b-9031-331da8d112e9` | `557d7aaa-2c01-4c26-8ab0-70e653f3b633` | 1972 | `sha256:fa15467aba46952fae3428a0df4f5e10a086c4afe9f60bb9eb2db9540b975259` |
| `xiaohongshu.account-public-notes` | `4d1f6b49-a53a-4d4c-83b2-5e0ac2096357` | `64c24c6f-66c7-440c-938e-4f6b979f6429` | 7019 | `sha256:dd87e541da9a4ace43e358c9d2575576567ba0921c3c7aa164970e54b9430bb7` |

JS 与 Python 对每项都确认：Operation ID、capability、`completed` 状态、terminal reason、Operation artifact reference、Artifact capability/ID、metadata byte length、metadata SHA-256 和完整 window SHA-256 一致。每个 Artifact 当前均由一个 UTF-8 window 完整读取。

## JS/Python 真实消费者结果

| 运行入口 | Case | 幂等提交 | 新 Core Operation | 扩展 claim | 扩展 result | 平台动作 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| JS Testbench | 5 | 5 | 0 | 0 | 0 | 0 |
| Python smoke app | 5 | 5 | 0 | 0 | 0 | 0 |

每次消费者运行前后均按 operational log `eventId` 做集合差分。两次运行各新增 5 条 `collector.operation.idempotent_replay`；均没有 `collector.operation.queued`、`extension.work.claimed` 或 `extension.work.result_accepted`。

## 同轮修复的 SDK 问题

1. Python smoke facade 的 B站/小红书搜索入口遗漏 typed builder 必填的 `client_request_id`，真实调用会直接抛 `TypeError`。两个入口现均使用 `create_client_request_id()`，并验证生成值为 UUID v4。
2. 真实 Artifact 的 ID 位置存在两种已发布形状：部分 payload 使用顶层 `artifactId`，详情/评论等使用 `summary.artifactId`。原 JS/Python 模型只读取顶层，导致真实详情产物被错误投影为 `null`。两套 SDK 现采用“顶层优先、summary 回退”，且在两处同时存在但不一致时 fail closed。
3. 回复队列 Operation ID 与 Collector Service 幂等账本分裂的问题已按上文修复，并由真实完成态 replay 证明。

## 分层门禁

- JS Testbench：`19/19`。
- Python smoke app：`7/7`。
- JavaScript SDK：`13/13`。
- Python SDK：`20/20`。
- Gateway 关键队列/route 测试：`17/17`。
- Core 项目级门禁：`99` 个测试文件，`346/346`。
- Python smoke 与 SDK：`compileall` 通过。
- TypeScript typecheck：通过。
- `git diff --check`：通过。

这些单元测试只验证 builder、模型、facade、队列身份和证据清单等纯逻辑；真实能力结论来自正式 Gateway、真实验证浏览器、真实 Operation/Artifact 和 operational log，不使用 fake 页面、fake XHR 或 fake Gateway。

## 运行后状态

- 目标 browser binding：`online`。
- 小红书 safety：`ready`；`manualUnlockRequired=false`；无 active operation。
- 回复 ledger record：`accepted`，Operation ID 与 queue 完全一致。
- 回复 queue Operation：`completed`，Artifact ID 与共享证据一致。
- 所有 `sdk-xhs-*` 临时 Local API Client：活动数 `0`，均已撤销。
- 验证浏览器：运行中，active lease `0`；唯一受管页有意保留为 `retained_for_review`。
- 浏览器没有被关闭或重启；补证过程中没有页面刷新或新 tab。
