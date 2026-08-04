# 小红书 JS/Python SDK 消费者验收（v0.7.17）

日期：2026-08-04
结论：通过；5 项真实 Operation/Artifact 均可被 JS 与 Python SDK 完整读取和复算，但历史回复项只具备只读验收条件，不能误报为 Collector Service 幂等提交闭环。

## 验收边界

- 运行中的正式 Gateway：`http://127.0.0.1:43127`；release `0.7.17`，service schema `3`。
- 使用用户常用浏览器中已经配对并在线的扩展；本次不控制浏览器，不创建或管理 Profile。
- 不导航、不刷新、不点击、不滚动、不打开或关闭 tab，不读取或导出认证材料。
- 不生成新的平台任务，不换用新的 request ID，不修改幂等账本。
- 原始搜索词、browser binding ID、Local API token、页面 URL 和 Artifact 正文均不写入仓库。
- Artifact 只在进程内经 `/v2` metadata/window 读取并按 UTF-8 复算完整 SHA-256。

## 历史证据边界

共享证据清单位于 `docs/validation/xiaohongshu-sdk-reconciliation-v0.7.17.json`，其中：

- 4 项保存了可核对的 `/v2/collect` 幂等记录，验收模式为 `idempotent_collect`；
- `xiaohongshu.note.public_comment_replies.v1` 的成功 Operation 来自早期内部真实验证入口。运行态日志包含扩展 claim/result，但没有 `collector.operation.queued`，持久幂等账本也没有该 Operation 的 client request 映射；该项只能使用 `retained_operation_read`。

不得把回复项与另一个失败或已不可用 Operation 的 client request 映射拼接。验收器因此不提交该项，也不篡改账本来制造一次假幂等成功。

## 五项真实产物

| Case | 模式 | Operation | Artifact | 字节数 | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `xiaohongshu.public-notes-search` | `idempotent_collect` | `e80f967f-a984-4c27-99f3-d9fe71072b38` | `eea7bd7b-5d34-44ba-84b6-4dec90992666` | 5577 | `sha256:444880be31088da22dbb8fa1677d7ca0059af01e527918a39e455a58d7b9a0fe` |
| `xiaohongshu.note-public-detail` | `idempotent_collect` | `6a908257-e95d-4874-a94f-d0d3675f430b` | `49c82735-6a64-4ae8-8ab1-4d8e2e1dbbe9` | 4371 | `sha256:1ffebd84d88b4c995cdf5ee205f9f14315ec8d310b6e9da5b17a56e8f6b78683` |
| `xiaohongshu.note-public-comments` | `idempotent_collect` | `d8362dbd-35b8-47c8-b50c-674b6f1e29af` | `b3c12bca-a9af-4215-83bd-32ddf881fd23` | 11135 | `sha256:2ccfa9b716c28172c0df312e1473b1528410cbabaaa1bd64578a87eacbad1320` |
| `xiaohongshu.note-public-comment-replies` | `retained_operation_read` | `27fe8232-c753-4ad5-8961-8fab968f0af7` | `88891659-eeaf-400c-a9c9-036564d3b2d4` | 1869 | `sha256:c57d30aef67fcb45ac70f7f83c15f6146a9325c948703d137e1677d21e69734a` |
| `xiaohongshu.account-public-notes` | `idempotent_collect` | `4d1f6b49-a53a-4d4c-83b2-5e0ac2096357` | `64c24c6f-66c7-440c-938e-4f6b979f6429` | 7019 | `sha256:dd87e541da9a4ace43e358c9d2575576567ba0921c3c7aa164970e54b9430bb7` |

JS 与 Python 对每项都确认：Operation ID、capability、`completed` 状态、terminal reason、Operation artifact reference、Artifact capability/ID、metadata byte length、metadata SHA-256 和完整 window SHA-256 一致。每个当前 Artifact 均由一个 UTF-8 window 完整读取。

## 真实消费者结果

| 运行入口 | Case | 幂等提交 | 既有 Operation 读取 | 新 Core Operation | 扩展 claim | 扩展 result | 平台动作 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| JS Testbench | 5 | 4 | 1 | 0 | 0 | 0 | 0 |
| Python smoke app | 5 | 4 | 1 | 0 | 0 | 0 | 0 |

每次运行前后均按 operational log `eventId` 做集合差分。两次运行各新增 4 条 `collector.operation.idempotent_replay`；均没有 `collector.operation.queued`、`extension.work.claimed` 或 `extension.work.result_accepted`。

## 验收中发现并修复的 SDK 问题

1. Python smoke facade 的 B站/小红书搜索入口遗漏 typed builder 必填的 `client_request_id`，真实调用会直接抛 `TypeError`。两个入口现均使用 `create_client_request_id()`，并验证生成值为 UUID v4。
2. 真实 Artifact 的 ID 位置存在两种已发布形状：部分 payload 使用顶层 `artifactId`，详情/评论等使用 `summary.artifactId`。原 JS/Python 模型只读取顶层，导致真实详情产物被错误投影为 `null`。两套 SDK 现采用“顶层优先、summary 回退”，且在两处同时存在但不一致时 fail closed。

## 分层门禁

- JS Testbench：`19/19`。
- Python smoke app：`7/7`。
- JavaScript SDK：`13/13`。
- Python SDK：`20/20`。
- Python smoke 与 SDK：`compileall` 通过。
- `git diff --check`：通过。

这些单元测试只验证 builder、模型、facade 与证据清单等纯逻辑；真实能力结论来自上述正式 Gateway、历史 Operation/Artifact 和 operational log，不使用 fake 页面、fake XHR 或 fake Gateway。

## 运行后状态

- 目标 browser binding：`online`。
- 小红书 safety：`ready`；`manualUnlockRequired=false`；无 active operation。
- 本轮 `sdk-xhs-*` 临时 Local API Client：活动数 `0`，均已撤销。
- 浏览器和现有小红书页面没有被关闭、重启或刷新。

## 后续补证

回复项若要升级为完整的 SDK 提交闭环，只能在未来单独批准一次新的低频真实 canary：先由正式 typed builder 生成新的 client request ID，再从 `/v2/collect` 创建并保留对应幂等记录。不能把本次只读验收改写成已经完成，也不能通过手工编辑 Gateway 状态补齐。
