# Official Source Provider 边界

日期：2026-08-04
状态：已实现，三项知乎官方能力已通过真实 Gateway E2E

## 结论

Collector Core 不应把所有数据源都强行塞进浏览器扩展。平台公开网页与用户登录态相关的
能力继续由 `BrowserProvider` 执行；平台正式提供的服务器 API 由
`OfficialApiProvider` 执行。两条路径在执行层隔离，在 Core 资源模型上统一：

```text
上层应用 / JS SDK / Python SDK
                │
                ▼
        Collector Gateway /v2
                │
       Source Provider Registry
          ┌─────┴─────────┐
          │               │
          ▼               ▼
 BrowserProvider     OfficialApiProvider
          │               │
 MV3 Extension       Zhihu Open Platform
```

这不是 workflow 层。Core 只提供可被 MCP、Skills 或其他上层应用调用的稳定数据源能力、
Operation、Artifact、幂等和审计；跨平台研究流程仍属于仓库外上层。

## 统一面与隔离面

两种 Provider 统一复用：

- `POST /v2/collect`；
- `clientRequestId` 和 restart-safe 幂等账本；
- `GET /v2/collect/operations/{operationId}`；
- capability-bound Artifact 与 `/v2` UTF-8 分窗读取；
- `/v2/capabilities`、OpenAPI、审计、JS SDK 和 Python SDK；
- 一次 `collect` 不自动重试；结果未知时只能用相同 ID 和相同请求查询或回放。

执行面必须保持隔离：

| 约束 | Browser Provider | Official API Provider |
| --- | --- | --- |
| `executionProvider` | `browser_extension` | `official_api` |
| `browserBindingId` | 必填 UUID | 禁止出现 |
| `executionTarget` | 已登记浏览器 target | 固定 `official_api` |
| 执行进程 | MV3 扩展 | Gateway |
| 浏览器/窗口 | 可能使用 | 永不使用 |
| 平台凭证 | 用户浏览器自身登录态 | Gateway-only 启动环境变量或当前 Console session |
| Artifact | 浏览器投影/归档 | 官方 JSON 语义原文归档 |

Extension 能力矩阵只包含 15 项浏览器能力；Gateway/OpenAPI/JS/Python 的 direct 能力矩阵
包含 18 项。跨语言矩阵会单独核对 3 项 `official_api`，不会要求扩展编译与它无关的能力。

## 第一阶段知乎能力

| Capability | 官方 route | 输入上限 | 平台 |
| --- | --- | --- | --- |
| `zhihu.search.public_content.v1` | `/api/v1/content/zhihu_search` | `Count <= 10` | `zhihu` |
| `zhihu.hot_list.public_content.v1` | `/api/v1/content/hot_list` | `Limit <= 30` | `zhihu` |
| `web.search.global.zhihu_provider.v1` | `/api/v1/content/global_search` | `Count <= 20` | `web` |

全网搜索只开放固定的 `SearchDB`、`site`、`publishedAfter`，由 Gateway 构造官方
`Filter`。调用方不能传任意 Filter；`zhihu.com` 及其子域名也不能走全网搜索，知乎内容
必须使用站内搜索能力。

官方入口：

- <https://developer.zhihu.com/>
- <https://developer.zhihu.com/docs>
- <https://developer.zhihu.com/api/v1/content/zhihu_search>
- <https://developer.zhihu.com/api/v1/content/hot_list>
- <https://developer.zhihu.com/api/v1/content/global_search>

## 凭证边界

知乎 Access Secret 只能进入 Gateway 进程。支持两种注入入口：启动时的
`ZHIHU_ACCESS_SECRET` 环境变量（优先级最高），或 Gateway Console 的本地配置入口：

- 不从 `/v2/collect` 调用方接收；
- 不进入 JS/Python builder；
- 不进入 Extension work item；
- Console 配置默认持久化到本机 Gateway 状态目录（`zhihu-credential.json`，0600），重启后仍有效；环境变量配置的生命周期由启动进程决定；
- 不写 `.env`、普通配置、Git、Artifact、审计或 operational log；
- capability catalog 只公开 `runtimeState: ready | credential_required`；该运行时字段不参与
  `capabilityCatalogDigest`，因此凭证配置变化不会改变静态兼容身份；
- OpenAPI 明确声明 caller-supplied platform credential 被排除。

缺少凭证时能力仍可发现，但 `runtimeState=credential_required`。Core 保留精确的运行时错误；
AgentKit MCP 会在 `POST /v2/collect` 前 fail-closed，返回
`official_provider_credential_required`，并把处理动作指向 Gateway 配置，不回退到浏览器登录
路线。配置状态可通过 Console 同源入口或 `/v2/capabilities` 的公开 readiness 字段核对；MCP
和 SDK 都不能接收平台 Secret。

## 网络和失败语义

Provider 固定使用 `https://developer.zhihu.com`、固定 route、GET、
`redirect: error`、20 秒超时、UTF-8 JSON、8 MiB 响应上限，且不自动重试。如果官方
响应意外反射当前 Secret，Provider 会在写 Artifact 前拒绝响应。成功条件同时
检查 HTTP status 和官方业务 `Code === 0`，因为官方鉴权失败可能仍返回 HTTP 200。

稳定 HTTP 映射：

| Gateway HTTP | 典型错误 |
| --- | --- |
| 400 | 调用参数或官方参数拒绝 |
| 409 | 本地未配置凭证、鉴权失败、幂等冲突/未知结果 |
| 429 | 官方限流或额度耗尽 |
| 502 | 官方 5xx、非法 JSON/MIME/origin/过大响应 |
| 503 | 上游连接不可用 |
| 504 | 上游超时 |

失败请求会把幂等记录冻结为 `rejected`。相同 `clientRequestId` 的回放返回同一失败，不会
再次请求上游；调用方明确决定重试时必须生成新 ID。

## Artifact 语义

成功请求同步生成 completed Operation：

```json
{
  "browserBindingId": null,
  "executionTarget": "official_api",
  "state": "completed",
  "terminalReason": "official_api_response_ready"
}
```

Artifact 保存经过严格契约验证、但未做业务字段投影的官方 JSON envelope。它是语义上的
raw-first JSON，不承诺保留 HTTP wire 的空白或字段字节顺序。请求侧只保存：

- query 的 SHA-256，不保存 query 原文；
- count/limit；
- 全网搜索固定 `SearchDB` 与已规范化过滤字段；
- provider route、capture time、response digest 和 provenance。

## 当前明确不支持

截至 2026-08-04，官方第一阶段能力不声称支持：

- 无限分页；站内搜索响应当前 `HasMore=false`，不能伪造下一页；
- 任意问题的全部回答或单回答独立详情 API；
- 全部一级评论、二级回复树；
- 任意答主的完整创作归档；
- 任意用户关注、收藏或账号私有数据。

官方“用户内容”能力只适用于 Secret 所属账号本人或经过 OAuth 的第三方用户，不纳入当前
公开情报 Core。知乎直答属于生成/分析能力，不是原始数据源，也不进入本 Provider。

## 测试门槛

完成定义同时要求：

1. Provider/解析/存储/幂等/Artifact 基础测试通过；
2. JS 与 Python builder/validation 对齐；
3. Core 边界、18 项能力矩阵、OpenAPI 与完整单元测试通过；
4. 使用临时 Gateway、临时 client 和真实 Secret 分别请求三项能力；
5. 同一请求回放不产生第二个 Operation/Artifact；
6. 状态目录扫描不存在 Secret；
7. 浏览器绑定数、浏览器进程和窗口增量均为 0。

真实证据见 [`zhihu-official-api-provider-v0.1.md`](../validation/zhihu-official-api-provider-v0.1.md)。
