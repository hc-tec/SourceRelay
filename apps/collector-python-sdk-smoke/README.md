# Collector Python SDK Smoke App

这是给上层 Python 应用开发者参考的最小应用，不实现任何平台爬取逻辑。它只通过
`intelligence-collector-client` 调用已配对的 user-owned-browser Collector `/v2` API。

## 安装

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-python-client
python -m pip install -e ".[dev]"

Set-Location D:\AIProject\inteligence\apps\collector-python-sdk-smoke
python -m pip install -e ".[dev]"
```

设置本地 Gateway token（不要写入文件、命令历史或 Git）：

```powershell
$env:COLLECTOR_SERVICE_ORIGIN = 'http://127.0.0.1:43127'
$env:COLLECTOR_SERVICE_TOKEN = 'cst_...'
```

## 命令

```powershell
collector-python-sdk capabilities
collector-python-sdk openapi
collector-python-sdk bindings
collector-python-sdk collect .\request.json
collector-python-sdk bilibili-search "DeepSeek"
collector-python-sdk bilibili-search "DeepSeek" --batch
collector-python-sdk xiaohongshu-search "人工智能" --maximum-details 3
```

`request.json` 必须是一个 UTF-8 JSON 对象。应用会先读取运行时能力目录，只允许
`dispatchState: direct_ready` 的 capability，然后交给 Python SDK 做严格的顶层请求校验、
一次投递、有界轮询和 capability-bound artifact 读取。

示例 `request.json`：

```json
{
  "schemaVersion": 2,
  "browserBindingId": "11111111-1111-4111-8111-111111111111",
  "platform": "bilibili",
  "capability": "bilibili.native_search",
  "executionTarget": "collector_work_tab",
  "input": {
    "query": "DeepSeek"
  }
}
```

上层应用不能通过本示例传入任意 URL、tab ID、selector、脚本、坐标、CDP 或 Network
body；Gateway 仍是最终的权限和输入边界。

`bilibili-search` 和 `xiaohongshu-search` 是推荐的 typed builder 示例。它们自动从
在线 browser binding 摘取 `browserBindingId`（也可用 `--browser-binding-id` 明确指定），
调用 Python SDK 的能力化 builder，并以结构化 `CollectionResult` 的 raw projection
输出结果。评论/回复预算只能通过小红书 builder 的有界参数开启：

```powershell
collector-python-sdk xiaohongshu-search "人工智能" `
  --maximum-details 3 `
  --comments-maximum-scrolls 2 `
  --replies-maximum-threads 1
```

旧的 `collect request.json` 命令仍保留，适合调试已登记协议字典；新上层业务应直接
使用 `intelligence_collector` 的 builder，不要复制 wire-level JSON。

## 分层

```text
main.py
  → service.py       上层能力状态门禁 + typed builder facade
  → intelligence_collector  Python SDK
  → local Gateway / paired extension
```

此应用中的 fake client 只用于测试上层“不可调度能力不得提交”的纯逻辑，不代表真实平台
能力。真实平台闭环必须使用项目的 live canary。

## 测试

```powershell
python -m pytest -q
```

## 小红书已完成矩阵的 Python SDK 对账

Python 参考应用提供与 JS Testbench 对等的零新增平台动作验收。它从共享去敏证据清单读取
5 个已完成 Operation，全部使用 Python typed builder 重建原请求，以原 `clientRequestId`
做幂等提交，并要求 Gateway 返回完全相同的 Operation、Artifact、字节数和 SHA-256。
Artifact 正文只在进程内用于 UTF-8 window 与完整哈希验证，不会输出。

运行时提供原始搜索词和同一在线验证 binding；不得把它们写入仓库：

```powershell
$env:COLLECTOR_SERVICE_TOKEN = '<least-privilege temporary token>'
$env:COLLECTOR_SERVICE_BINDING_ID = '<the original online validation binding ID>'
$env:COLLECTOR_XIAOHONGSHU_RECONCILE_QUERY = '<original query matching the committed digest>'
collector-python-sdk-xiaohongshu-reconcile
```

共享证据位于
[`docs/validation/xiaohongshu-sdk-reconciliation-v0.7.17.json`](../../docs/validation/xiaohongshu-sdk-reconciliation-v0.7.17.json)。
脚本不会生成新请求 ID、不会修改请求参数、不会自动重试，也不会在对账失败后创建另一套
平台任务。共享清单的 5 项都必须具有真实 Collector Service 幂等记录，不接受只读替代项。
