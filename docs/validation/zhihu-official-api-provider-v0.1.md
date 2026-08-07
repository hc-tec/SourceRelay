# 知乎 Official API Provider v0.1 真实验证

日期：2026-08-04
分支：`feat/zhihu-collector`
版本：保持 `0.7.17`，本轮没有因新增能力升级版本

## 验证结论

三项知乎官方能力均已通过真实的：

```text
JS SDK builder
  → 临时 Collector Gateway /v2/collect
  → Zhihu OfficialApiProvider
  → developer.zhihu.com
  → completed Operation
  → Core Artifact metadata
  → UTF-8 Artifact content windows
  → 同请求幂等回放
```

不是直接 curl 冒充产品闭环，也没有使用 fake Gateway、fake XHR、页面 clone 或测试浏览器。

## 真实 E2E 结果

运行入口：

```powershell
$env:ZHIHU_ACCESS_SECRET = '<Gateway-only secret>'
npm run validate:zhihu-official-provider
Remove-Item Env:\ZHIHU_ACCESS_SECRET
```

执行时创建随机临时端口、临时 Gateway state 和临时 Collector Service client；结束后撤销
client、停止临时 Gateway 并删除临时目录。没有启动、重启、关闭或控制用户浏览器。

| Capability | HTTP/业务结果 | Items | Artifact bytes | Canonical Artifact SHA-256 | Replay |
| --- | --- | ---: | ---: | --- | --- |
| `zhihu.search.public_content.v1` | success / `Code=0` | 1 | 3497 | `sha256:9209d4d7df79bd103d8c66d1dbe0d6698b26a300b1c2b8815eb30db5caf2bab9` | 同 Operation/Artifact |
| `zhihu.hot_list.public_content.v1` | success / `Code=0` | 1 | 2100 | `sha256:2cf2c5dea9e037f559044985b43fa87c2cf791778c231bfd71ccfcec867d84cf` | 同 Operation/Artifact |
| `web.search.global.zhihu_provider.v1` | success / `Code=0` | 1 | 2519 | `sha256:c1ec2415a95b68c1309d6558b27b290a33d8530da3911c3903e8feef8d1f91f2` | 同 Operation/Artifact |

汇总：

- 官方 capability：3；
- 真实上游请求：3，每项一次，无自动重试；
- persisted Operation：3；
- persisted Artifact：3；
- `browserBindingRequired=false`；
- browser process started：false；
- browser window delta：0；
- Secret persisted：false。

## 后续独立复验与限流

完整三能力成功后，又在完成 OpenAPI 模块拆分和官方 `Content-Type` header 对齐后发起了
三次彼此独立的新 canary。三次都在第一项站内搜索收到官方 429：

```text
zhihu_official_api_rate_limited
```

Gateway 正确返回 HTTP 429，SDK 保留同一机器错误码；验证脚本没有自动重试，也没有继续
请求热榜或全网搜索。临时 client、Gateway 和状态目录仍在 `finally` 中清理。该结果记录
的是官方当前限流状态，不覆盖前一轮三能力真实成功证据，也不被描述成第二次完整通过。
后续人工重新执行 live gate 应等官方额度/限流窗口恢复，不能在 CI 中循环重试。

## 最终加固版本复验成功

随后使用项目所有者新提供、具备可用实名额度的 Gateway-only 凭证，对最终加固代码重新
执行了一次完整 gate。文档不记录凭证值、所属用户身份、query、标题、正文、作者或 URL。

本轮结果：

| Capability | Items | Artifact bytes | Canonical Artifact SHA-256 | Replay |
| --- | ---: | ---: | --- | --- |
| `zhihu.search.public_content.v1` | 1 | 4579 | `sha256:71b81990d4d1e933c22c41b5071c7e918c5fdd588e2e3ff1fd22a25117cf2c9c` | 同 Operation/Artifact |
| `zhihu.hot_list.public_content.v1` | 1 | 2084 | `sha256:6d9c6038d434c87d5c2e9244493f6633c03c553ea2de8cd9f89570fd92055417` | 同 Operation/Artifact |
| `web.search.global.zhihu_provider.v1` | 1 | 8675 | `sha256:9a4c242a636bd51f35e6848d48c84d36d8e53c1b1dc837d01eb89ef585f8cbb2` | 同 Operation/Artifact |

汇总：

- final hardened code：通过；
- official capability：3；
- live platform requests：3，每项一次，无自动重试；
- completed Operation：3；
- persisted Artifact：3；
- idempotent replay：三项全部稳定；
- `browserBindingRequired=false`；
- browser process started：false；
- browser window delta：0；
- Secret persisted：false。

因此，前述 429 可以归因到原凭证的额度或限流状态，不是 Gateway Provider、SDK、
OpenAPI 模块拆分、`Content-Type` 对齐或响应凭证反射防线引入的功能回归。

为避免把公开内容样本变成长期身份记录，验证文档不保存 query、标题、正文、作者或 URL；只
保存 capability、计数、字节数和内容摘要。

## 基础框架测试

真实 E2E 之前已通过：

- TypeScript typecheck；
- JS SDK：15/15；
- Python SDK：25/25；
- 定向 Gateway Provider/route/Artifact/矩阵：25/25；
- 全仓 unit：101 个 test files、371 个 tests；
- `verify:core-boundaries`；
- provider-aware 18 项 `verify:core-capability-matrix`；
- `build:user-browser-runtime`；
- 无平台请求的临时 Gateway API smoke，catalog 21、direct contract 18。

Provider 单元覆盖：

- 固定 origin/route/GET/redirect policy；
- query/count/SearchDB/固定 Filter 构造；
- HTTP 429 与业务错误码；
- MIME、response origin、8 MiB 上限；
- 上游响应意外反射 Secret 时在持久化前拒绝；
- 单次调用无自动重试；
- Artifact query digest、Secret/query 非持久化；
- Operation/Artifact restart-safe；
- route-level replay 不第二次调用 Provider。

## 运行态凭证与 catalog 身份修复（2026-08-05）

此前 capability catalog 的 `runtimeState`（`ready` / `credential_required`）被错误地纳入
`capabilityCatalogDigest`，导致同一发布版本在有无 `ZHIHU_ACCESS_SECRET` 时出现两个 digest，
从而阻断上层 MCP 的正式兼容性门禁。Core 现在通过
`capabilities.catalog_digest_excludes_runtime_state.v1` 明确声明：运行态 readiness 仍公开给
调用方，但不参与静态 catalog 身份。修复后的有凭证和无凭证进程使用同一稳定 digest；对应的
AgentKit MCP L3 证据见其仓库的 `developer-readiness-zhihu-l3-matrix.md`。

## Console 配置引导（2026-08-07）

Gateway Console 现在提供独立的 Official Provider 配置卡片，首次使用时会把知乎官方数据
与 B站/小红书浏览器数据分成两条路径。Console 配置只向当前 Gateway 进程注入凭证，不会
启动浏览器、安装扩展或发出知乎上游请求；保存动作只做本地格式校验，真实有效性和额度
仍在首次实际 capability 调用时由官方 API 判断。

新增的本地管理入口：

- `GET /v2/official-providers`：只返回 Gateway-only 配置状态和能力键，不返回凭证；
- `POST /v2/official-providers/zhihu/credential`：通过 Console 同源请求配置当前进程凭证；
- `POST /v2/official-providers/zhihu/credential/clear`：移除当前进程凭证，不影响浏览器绑定。

Console session 凭证不会写入扩展、Artifact、审计、运行日志或 Git；Gateway 重启后需要
重新配置。启动环境变量 `ZHIHU_ACCESS_SECRET` 仍然受支持，并在 Console 中显示为“启动
环境变量”。本轮使用真实浏览器渲染检查了路径选择、知乎配置和本地应用 token 创建；没有
访问知乎平台，也没有产生 live platform request。

AgentKit readiness follow-up（2026-08-07）：打包 MCP 现在会在读取能力 Resource 和 Official
Provider Tool 提交前刷新 `runtimeState`。无凭证发布 Core 的 L2 路径在 Core POST 前返回
`official_provider_credential_required`，没有创建 Official Provider Operation；有凭证的当前
Gateway 进程完成了一次 `count=1` 的真实只读知乎搜索 canary，并通过 Operation、Artifact
metadata 和完整 UTF-8 chunk SHA-256 校验。MCP 返回的配置提示只有
`configure_gateway_official_provider` / `gateway_only`，不包含平台 Secret，也不回退到浏览器。

## 验证中发现并修复的问题

三项 capability 共用一个 `ZhihuOfficialArtifactStore`。初版全局 Artifact ID 搜索会对同一
ID 调用三次 store，并把同一个对象误认为三个 capability 的命中，最终抛出 identity
collision。修复后每个 reader 除 ID 外还必须校验 Artifact 自身 capability；真实 `/v2`
Artifact metadata 和 content window 随后通过。

跨语言能力矩阵初版也错误假设“所有 direct capability 必须编译进扩展”。现在矩阵分别
验证：

- Gateway/OpenAPI/JS/Python：18 项；
- MV3 Extension：15 项 browser provider；
- Official contract/registry：3 项 official provider。

这两处都属于基础架构问题，不是通过补 fixture 绕过。
