# Collector Client

`@intelligence/collector-client` 是给本地上层应用使用的薄客户端。它只调用 Gateway
已经登记的 direct provider：浏览器能力由用户日常浏览器中的扩展执行，官方数据能力由
Gateway 直接执行。SDK 不管理浏览器、不读取 Profile/Cookie、不接收平台凭证，也不暴露
任意 URL、tab、selector、脚本、CDP 或 Network 接口。

## 最小用法

```js
import {
  CollectorClient,
  createClientRequestId,
  xiaohongshuPublicNotesSearch
} from '@intelligence/collector-client';

const collector = new CollectorClient({
  origin: 'http://127.0.0.1:43127',
  token: process.env.COLLECTOR_SERVICE_TOKEN
});

const bindings = await collector.listBrowserBindings();
const binding = bindings.find((value) => value.state === 'online');
if (!binding) throw new Error('no_online_browser_binding');

const request = xiaohongshuPublicNotesSearch({
  clientRequestId: createClientRequestId(),
  browserBindingId: binding.browserBindingId,
  query: '人工智能',
  maximumDetails: 3
});
const { operation, artifact } = await collector.collectAndWait(request);

if (operation.state !== 'completed' && operation.state !== 'partial') {
  throw new Error(operation.errorCode ?? 'collector_operation_not_successful');
}
console.log(artifact?.artifact);
```

## 宿主 Gateway 契约 smoke（不触发平台动作）

在已经运行的用户宿主 Gateway 上验证 SDK 与 Core 契约时，使用下面的命令：

```powershell
$env:COLLECTOR_SERVICE_ORIGIN = 'http://127.0.0.1:43127'
$env:COLLECTOR_SERVICE_TOKEN = 'cst_...'
npm run smoke:gateway-contract
```

该命令只读取状态、能力目录、OpenAPI、release 和在线浏览器绑定，构造一个 B 站 typed
request，并验证不可调度迁移能力在 SDK 本地被拒绝。它不会调用 `POST /v2/collect`，
不会导航平台页面，也不会接管或控制浏览器。真实平台闭环必须使用项目的隔离 Profile
live canary，例如 `COLLECTOR_LIVE_CANARY_SCOPE=javascript_sdk`。

## 方法边界

- `listDirectCapabilities()`：读取客户端当前允许提交的 direct capability 名称；它不能替代 Gateway 的 `dispatchState`、预算和绑定状态检查；
- `listCapabilities()`：读取能力目录；上层应只提交 `dispatchState: direct_ready` 的能力，并在
  Official Provider 能力上先确认 `runtimeState=ready`；
- `readCapabilityCatalog()`：读取带 SHA-256 身份、18 项 direct contract 和实时 readiness 字段的
  完整能力目录；`runtimeState` 不改变静态 catalog digest；
- `readRelease()`：读取 Core release manifest，确认本地扩展、Gateway、Browser Host 和服务 schema 的兼容性；
- `readOpenApi()`：读取当前 `/v2` OpenAPI 3.1 机器契约，构造请求前应优先使用它核对输入边界；
- `listBrowserBindings()`：读取已配对浏览器绑定的安全摘要；
- `collect(request)`：只提交一次 `POST /v2/collect`，不会自动重试平台任务；
- `getOperation(operationId)`：读取一次 operation；
- `waitOperation(operationId)`：只轮询本地 operation，不重新提交任务；
- `readArtifact(operationId)`：重新读取 operation，并从 capability 匹配的受控 path 读取 artifact；
- `readArtifactMetadata(artifactId)`：读取 Artifact 大小、摘要、状态和保留信息，不加载正文；
- `readArtifactContentWindow(artifactId, { offset, maxBytes })`：按 UTF-8 边界读取最多 64 KiB 的规范 JSON 窗口；
- `collectAndWait(request)`：组合提交、等待和 artifact 读取。
- `collectModel(request)`、`getOperationModel(operationId)`、`waitOperationModel(operationId)`、
  `readArtifactModel(operationId)`、`collectAndWaitModel(request)`：返回稳定字段投影并
  保留 detached `raw` 的结构化模型。

## 能力化请求 builders

上层应用优先使用 builder，而不是复制 wire-level JSON。builder 会固定
`schemaVersion`、平台、能力和 execution target，并在本地校验 B 站规范 BV/MID、合集
ID、搜索词，小红书短时 profile URL、详情序号以及评论/回复/滚动预算。Gateway 仍是
最终权限和输入边界。

```js
import {
  bilibiliNativeSearch,
  createClientRequestId,
  xiaohongshuAccountPublicNotes,
  zhihuOfficialSearch
} from '@intelligence/collector-client';

const searchRequest = bilibiliNativeSearch({
  clientRequestId: createClientRequestId(),
  browserBindingId: bindingId,
  query: 'DeepSeek'
});

const profileRequest = xiaohongshuAccountPublicNotes({
  clientRequestId: createClientRequestId(),
  browserBindingId: bindingId,
  maximumScrolls: 20,
  executionTarget: 'ephemeral_public_profile_url',
  profileUrl: shortLivedProfileUrl
});

const zhihuRequest = zhihuOfficialSearch({
  clientRequestId: createClientRequestId(),
  query: 'RAG',
  count: 10
});
```

当前 builder 覆盖全部 18 项 `direct_ready` 能力：15 项浏览器扩展能力，以及知乎官方
站内搜索、热榜、全网搜索 3 项官方 Provider 能力。官方 builder 不接受
`browserBindingId` 或 Access Secret；凭证只存在于 Gateway 进程，可通过启动环境变量或
Gateway Console 当前 session 配置。`runtimeState=credential_required` 时应先在 Gateway
边界配置并重新读取能力目录，不应回退到浏览器。小红书搜索/详情不接受调用方 URL；
短时主页链接只允许进入 `ephemeral_public_profile_url`，并保留签名 URL 原文。所有
builder 都拒绝 selector、脚本、tab ID、CDP 和任意 Network 控制字段。

## 结构化结果

`Operation`、`ArtifactReference`、`Artifact` 和 `CollectionResult` 只投影稳定包络字段，
同时保留 detached `raw`/`payload`。上层可以使用 `result.operation.state`、
`result.artifact.summary` 和 `result.result`，未来扩展字段仍可从 raw projection 读取。

客户端会拒绝非 loopback origin、非法 token、未知 direct capability、额外顶层字段和
不符合 operation capability 的 artifact path。Gateway 仍是最终的请求校验和权限边界。

每个 builder 都要求调用方提供 `clientRequestId`。一次逻辑提交必须保存同一份完整请求；
如果 POST 结果因断网而未知，只能用相同 ID 和相同规范请求重试。Core 会返回原 Operation、
明确的 outcome-unknown，或冲突，绝不会自动执行第二次平台动作。换了输入就必须生成新 ID。
SDK 本身仍不自动重试 POST。

## 源码分层

```text
src/
├─ transport.mjs   loopback HTTP、token、超时和有界 JSON
├─ validation.mjs  capability、request、operation、artifact path 校验
├─ requests.mjs    18 项能力化 request builder 与 URL/预算边界
├─ models.mjs      operation / artifact / collection 结构化 raw-first 模型
├─ client.mjs      collect / wait / artifact 工作流
├─ public.mjs      稳定公共 allowlist 导出
└─ index.mjs       包入口兼容导出
```

Python 上层应用使用对应的独立包
[`collector-python-client`](../collector-python-client/README.md)。两套 SDK 共享
`/v2/capabilities` 与 `/v2/openapi.json` 协议真源，但不互相导入，也不共享平台抓取或
浏览器控制代码。
