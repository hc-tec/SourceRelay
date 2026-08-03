# Collector Client

`@intelligence/collector-client` 是给本地上层应用使用的薄客户端。它只调用
user-owned-browser direct API，不管理浏览器、不读取 Profile/Cookie，也不暴露任意
URL、tab、selector、脚本、CDP 或 Network 接口。

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

## 方法边界

- `listDirectCapabilities()`：读取客户端当前允许提交的 direct capability 名称；它不能替代 Gateway 的 `dispatchState`、预算和绑定状态检查；
- `listCapabilities()`：读取能力目录；上层应只提交 `dispatchState: direct_ready` 的能力；
- `readCapabilityCatalog()`：读取带 SHA-256 身份和 15 项 direct contract 的完整能力目录；
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
  xiaohongshuAccountPublicNotes
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
```

当前 builder 覆盖全部 15 项 `direct_ready` 能力。小红书搜索/详情不接受调用方 URL；
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
├─ requests.mjs    15 项能力化 request builder 与 URL/预算边界
├─ models.mjs      operation / artifact / collection 结构化 raw-first 模型
├─ client.mjs      collect / wait / artifact 工作流
├─ public.mjs      稳定公共 allowlist 导出
└─ index.mjs       包入口兼容导出
```

Python 上层应用使用对应的独立包
[`collector-python-client`](../collector-python-client/README.md)。两套 SDK 共享
`/v2/capabilities` 与 `/v2/openapi.json` 协议真源，但不互相导入，也不共享平台抓取或
浏览器控制代码。
