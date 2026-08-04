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

为避免把公开内容样本变成长期身份记录，验证文档不保存 query、标题、正文、作者或 URL；只
保存 capability、计数、字节数和内容摘要。

## 基础框架测试

真实 E2E 之前已通过：

- TypeScript typecheck；
- JS SDK：14/14；
- Python SDK：24/24；
- 定向 Gateway Provider/route/Artifact/矩阵：25/25；
- 全仓 unit：100 个 test files、354 个 tests；
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
