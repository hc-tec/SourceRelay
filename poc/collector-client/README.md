# Collector Client

`@intelligence/collector-client` 是给本地上层应用使用的薄客户端。它只调用
user-owned-browser direct API，不管理浏览器、不读取 Profile/Cookie，也不暴露任意
URL、tab、selector、脚本、CDP 或 Network 接口。

## 最小用法

```js
import { CollectorClient } from '@intelligence/collector-client';

const collector = new CollectorClient({
  origin: 'http://127.0.0.1:43127',
  token: process.env.COLLECTOR_SERVICE_TOKEN
});

const bindings = await collector.listBrowserBindings();
const binding = bindings.find((value) => value.state === 'online');
if (!binding) throw new Error('no_online_browser_binding');

const { operation, artifact } = await collector.collectAndWait({
  schemaVersion: 2,
  browserBindingId: binding.browserBindingId,
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.search.public_notes.v1',
  executionTarget: 'existing_public_explore_tab',
  input: { query: '人工智能', maximumDetails: 3 }
});

if (operation.state !== 'completed' && operation.state !== 'partial') {
  throw new Error(operation.errorCode ?? 'collector_operation_not_successful');
}
console.log(artifact?.artifact);
```

## 方法边界

- `listDirectCapabilities()`：读取客户端当前允许提交的 direct capability 名称；它不能替代 Gateway 的 `dispatchState`、预算和绑定状态检查；
- `listCapabilities()`：读取能力目录；上层应只提交 `dispatchState: direct_ready` 的能力；
- `readOpenApi()`：读取当前 `/v2` OpenAPI 3.1 机器契约，构造请求前应优先使用它核对输入边界；
- `listBrowserBindings()`：读取已配对浏览器绑定的安全摘要；
- `collect(request)`：只提交一次 `POST /v2/collect`，不会自动重试平台任务；
- `getOperation(operationId)`：读取一次 operation；
- `waitOperation(operationId)`：只轮询本地 operation，不重新提交任务；
- `readArtifact(operationId)`：重新读取 operation，并从 capability 匹配的受控 path 读取 artifact；
- `collectAndWait(request)`：组合提交、等待和 artifact 读取。

客户端会拒绝非 loopback origin、非法 token、未知 direct capability、额外顶层字段和
不符合 operation capability 的 artifact path。Gateway 仍是最终的请求校验和权限边界。

`collect()` 的 POST 没有自动重试。如果调用方在网络超时后无法确认是否已经排队，应该先
使用原 operation 追踪机制或人工检查，而不是盲目再次提交；幂等键会在后续协议版本中单独
设计。
