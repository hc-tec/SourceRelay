# Collector 运行日志规范

Collector 的运行日志与采集产物、服务审计是三条不同的数据边界：

| 数据 | 用途 | 是否保存页面内容 |
| --- | --- | --- |
| Operational Log | 定位启动、请求、命令、标签页、扩展 work 阶段和失败耗时 | 否 |
| Collector Service Audit | 记录上层应用调用了哪个已登记能力以及授权结果 | 否 |
| Artifact | 保存能力允许的公开投影，供上层应用分析 | 按能力契约决定 |

## 当前日志覆盖范围

Gateway 和 Browser Host 现在写入统一的 `schemaVersion: 1` JSONL 事件：

- HTTP 请求完成：方法、无查询参数的 pathname、状态码、请求 ID、耗时；
- Gateway 启动、就绪、关闭；
- 上层能力入队和入队失败；
- 扩展 work claim、扩展阶段诊断、结果接收/拒绝；
- Browser Host controller 连接/断开；
- Browser Host 命令完成、失败、拒绝、幂等重放；
- Profile 和 managed page ledger 生命周期。

每个事件至少包含：`eventId`、`occurredAt`、`component`、`level`、`eventType`、
`requestId`/`commandId`/`operationId`/`workId`（可为空）、`capability`、`durationMs`、
`outcome`、`errorCode` 和受限 `details`。

## 文件位置与保留策略

运行时状态目录下：

```text
<stateDirectory>/operational-logs/gateway.active.jsonl
<stateDirectory>/operational-logs/browser_host.active.jsonl
<stateDirectory>/operational-logs/*.sealed.jsonl
```

- 单个 active 文件超过 8 MiB 自动封存；
- 封存文件保留最多 7 天、总量最多 64 MiB；
- 文件以 UTF-8 JSONL 写入，权限为当前用户可读写（Windows 下由目录 ACL 负责）；
- 日志写入失败不会阻塞采集请求，但会输出一条本地 stderr 告警；
- 启动时会跳过损坏行，不会因为单行损坏导致 Gateway/Host 无法启动。

## 脱敏边界

日志不是第二个数据仓库。以下内容不会进入日志：Cookie、Token、Authorization、密码、
Storage、Profile 路径、查询词、请求正文、响应正文、HTML、页面文本、selector、脚本和
任意 URL 参数。`details` 只保留有限层数、键数量、数组长度和字符串长度；敏感键会变成
`[redacted]`。

日志可以记录数量、阶段、状态码、耗时、错误码、能力名、artifact ID 和哈希摘要。需要
查看公开内容时读取对应 artifact，不要通过放宽日志脱敏来“临时排查”。

## 查询宿主浏览器 Gateway 日志

user-browser Gateway 提供仅限 loopback 同源 Console 的查询入口：

```text
GET /v2/observability/logs?limit=100
GET /v2/observability/logs?level=error&operationId=<uuid>
GET /v2/observability/logs?eventType=extension.work.result_accepted
```

该入口不是上层应用采集 API，也不接受 Token、URL、selector 或任意日志写入内容。上层
应用应通过 operation/artifact API 获取业务结果；开发者排查运行问题时使用 request ID、
operation ID 或 work ID 关联事件。

## 排查顺序

1. 先根据 HTTP 响应头 `x-collector-request-id` 定位请求链；
2. 再用 `operationId` 查看 `collector.operation.queued`、`extension.work.claimed`、
   扩展阶段诊断和 `extension.work.result_accepted`；
3. 若涉及隔离验证浏览器，再用 Browser Host 的 `commandId` 和 `browser.command.*` 事件；
4. 最后检查 artifact summary 和对应的真实运行证据，不把“日志有请求”误判为“采集成功”。

未知终态、标签页被接管、验证码或风险停止必须保留为明确失败/停止事件，不能通过自动
重试把日志改写成成功。
