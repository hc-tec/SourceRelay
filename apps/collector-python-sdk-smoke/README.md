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

## 分层

```text
main.py
  → service.py       上层能力状态门禁
  → intelligence_collector  Python SDK
  → local Gateway / paired extension
```

此应用中的 fake client 只用于测试上层“不可调度能力不得提交”的纯逻辑，不代表真实平台
能力。真实平台闭环必须使用项目的 live canary。

## 测试

```powershell
python -m pytest -q
```
