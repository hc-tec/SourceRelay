# Personal Intelligence Gateway

这是一个面向中文公开信息收集的按需能力运行时。它把不同获取方式收敛为一致、可发现、可计划、可执行的 API，同时保留每个来源真实的认证、范围、降级和验证边界。

当前接入：

- `bilibili`：由本地 Maxun Robot 执行关键词搜索；
- `xiaohongshu`：由 BrowserWing 使用隔离且持久化的 Chrome Profile 执行人工登录后的搜索；
- `web`：由本机 SearXNG 聚合公开搜索结果，也支持 `site` 限定知乎、新闻站等域名；
- `/fetch`：Trafilatura 抽取公开 HTML/text 页面的正文和元数据；
- `/jobs/search`：把耗时搜索放入 SQLite 持久化作业。
- 情报库：搜索结果自动写入 `documents`、`observations` 和 `search_runs`，区分新增、变化和重复出现。
- Capability Runtime：版本化能力清单、任务规划、统一执行、健康检查、Profile 状态和安全 fallback。

## 安全与边界

- 网关不读取、返回或记录浏览器 Cookie；小红书登录只能由用户在隔离浏览器中人工完成。
- Maxun API Key 只从工作区内被忽略的本地文件读取，日志和响应不会显示它。
- 正文抽取拒绝回环、私网、链路本地、多播、保留地址和带账号密码的 URL；每一次重定向都会重新做 DNS 与地址检查。
- 正文下载最多跟随 5 次重定向、最多读取 5 MB，且只接受 HTML、XHTML 和纯文本。
- 这里只提供公开信息工具链，不提供绕过验证码、登录、安全机制或平台访问限制的行为。
- 平台页面和排序随时可能变化；`partial=true` 表示结果并非平台完整索引。

## 快速开始

前置条件：Python 3.11+、PowerShell、Docker Desktop；Maxun 与 BrowserWing 按各自 POC 已启动并配置。

```powershell
cd D:\AIProject\inteligence\poc\intelligence-gateway
.\scripts\setup.ps1
.\scripts\start-searxng.ps1
.\scripts\start.ps1
.\scripts\status.ps1
```

API 文档：`http://127.0.0.1:8765/docs`

停止：

```powershell
.\scripts\stop.ps1
.\scripts\stop-searxng.ps1
```

## API 示例

### 按需能力发现与执行

列出已经注册的能力：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/capabilities
```

当前四个经过验证的能力：

```text
bilibili.keyword_search.maxun.v1
xiaohongshu.keyword_search.browserwing.v1
web.keyword_search.searxng.v1
web.article_extract.trafilatura.v1
```

运行时还可以包含已经通过样本验证并晋升的生成能力。本轮真实生成：

```text
baidu.keyword_search.browserwing_recipe.v1
```

### 未知公开网站生成按需搜索能力

`0.4.0` 新增 Draft Capability Factory，用于把一个尚未接入的公开网站逐步变成受控能力：

```text
POST /capability-drafts
GET  /capability-drafts
GET  /capability-drafts/{draft_id}
POST /capability-drafts/{draft_id}/inspect
POST /capability-drafts/{draft_id}/validate
POST /capability-drafts/{draft_id}/promote
```

生命周期是：

```text
proposed -> inspected -> validated -> promoted
                         \-> failed
```

- `create` 只登记平台、公开起始 URL 和样本查询；私网、回环与带凭据 URL 会被拒绝；
- `inspect` 只导航并识别可见搜索输入和提交控件，不提交查询；
- `validate` 才使用样本词做一次真实、只读搜索，并要求至少两条带标题和 HTTP(S) URL 的结果，同时要求结果与样本词相关；
- `promote` 只接受 `validated` Draft，将确定性 recipe 写入 `runtime/capabilities/*.json`，随后重新加载 Capability Catalog；
- 生成能力可立即被 `/tasks/plan` 发现并由 `/tasks/execute` 调用，也支持 `persistence=none`；
- Draft Explorer 与小红书 Adapter 共享同一个 BrowserWing 锁，避免并发控制同一 Profile。

百度真实样本生成的 recipe 为：

```json
{
  "start_url": "https://www.baidu.com/",
  "input_selector": "#chat-textarea",
  "submit_selector": "#chat-submit-button",
  "result_item_selector": "h3",
  "expected_host": "www.baidu.com"
}
```

第一版边界很明确：只生成公开站点的 `keyword_search`；只读取首个渲染结果页；不自动登录、不处理或绕过验证码；选择器和标题/URL 抽取是启发式的，网站改版后必须重新验证。初始 URL 会做公共地址校验，结果页还会限制在起始主机或其子域；但浏览器导航层并不等同于带逐跳 DNS 校验的安全 HTTP 下载器，因此当前服务仍只绑定本机，不应作为多租户任意 URL 浏览服务暴露。

只规划、不执行：

```powershell
$body = @{
  platform = "zhihu"
  action = "keyword_search"
  input = @{ query = "个人知识库"; limit = 5 }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/tasks/plan `
  -ContentType application/json -Body $body
```

由于目前没有注册知乎站内搜索 Adapter，计划会明确选择：

```text
web.keyword_search.searxng.v1
site = zhihu.com
degraded = true
```

按需执行且不落库：

```powershell
$body = @{
  platform = "bilibili"
  action = "keyword_search"
  input = @{ query = "DeepSeek"; limit = 5 }
  options = @{
    allow_fallback = $true
    fallback_on_no_results = $true
    persistence = "none"
  }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/tasks/execute `
  -ContentType application/json -Body $body
```

`persistence`：

- `none`：只在当前请求返回结果，不写入 documents、observations 或 search_runs；
- `result_only`：把结果和运行记录写入当前情报库。

检查能力依赖，但不执行真实搜索：

```text
POST /capabilities/{capability_id}/check
```

用 Manifest 中配置的安全样本做真实验证：

```text
POST /capabilities/{capability_id}/verify
```

`verify` 会真实访问目标来源；登录平台仍只使用用户人工登录的隔离 Profile。

查看受管理的 Profile 状态：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/profiles
Invoke-RestMethod http://127.0.0.1:8765/profiles/xiaohongshu/status
```

Profile API 只返回引用、就绪状态和认证状态，不返回 Cookie、Token、密码或本地 Profile 路径。

### 兼容接口

B站关键词搜索：

```powershell
$body = @{ source = "bilibili"; query = "DeepSeek"; limit = 10 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/search -ContentType application/json -Body $body
```

小红书搜索（依赖已经人工登录的隔离 Profile）：

```powershell
$body = @{ source = "xiaohongshu"; query = "DeepSeek"; limit = 10 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/search -ContentType application/json -Body $body
```

全网或限定域名搜索：

```powershell
$body = @{ source = "web"; query = "个人知识库"; limit = 10 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/search -ContentType application/json -Body $body

$body = @{ source = "web"; query = "个人知识库"; site = "zhihu.com"; limit = 10 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/search -ContentType application/json -Body $body
```

抽取公开新闻正文：

```powershell
$body = @{ url = "https://example.com/news/article" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/fetch -ContentType application/json -Body $body
```

异步搜索：

```powershell
$body = @{ source = "bilibili"; query = "低空经济"; limit = 10 } | ConvertTo-Json
$job = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/jobs/search -ContentType application/json -Body $body
Invoke-RestMethod -Uri "http://127.0.0.1:8765/jobs/$($job.job_id)"
```

## 情报库与变化检测

每次成功或无结果的搜索都会生成一个 `run_id`。有结果时，响应还包含：

```json
{
  "run_id": "...",
  "persistence": {
    "run_id": "...",
    "new_count": 5,
    "changed_count": 0,
    "seen_count": 0
  }
}
```

语义：

- `new`：第一次发现该来源下的规范 URL，或无 URL 时第一次发现该“标题+作者”；
- `changed`：同一文档再次出现，但标题、作者、摘要、发布时间或稳定来源指标发生变化；
- `seen`：文档再次出现且内容没有变化；搜索引擎自身的 score/engine 波动不会制造 changed。

查询：

```powershell
# 总量与来源分布
Invoke-RestMethod http://127.0.0.1:8765/library/stats

# 搜索已经积累的文档
Invoke-RestMethod "http://127.0.0.1:8765/documents?source=web&q=知识库&limit=20"

# 查看新增或变化记录
Invoke-RestMethod "http://127.0.0.1:8765/changes?change_type=new&limit=50"
Invoke-RestMethod "http://127.0.0.1:8765/changes?change_type=changed&limit=50"

# 搜索运行历史
Invoke-RestMethod "http://127.0.0.1:8765/runs?source=web&limit=20"

# 相同标题的跨来源候选聚类
Invoke-RestMethod "http://127.0.0.1:8765/clusters?min_documents=2&limit=20"
```

跨来源 fingerprint 目前是确定性的标题归一化哈希，只用于候选聚类，不等同于已经完成语义实体消歧。标题不同但讲述同一事件的内容仍需要后续实体/事件层。

## 状态语义

- `success`：拿到了可规范化结果；
- `no_results`：来源可用，但当前查询没有结果；
- `authentication_required`：隔离浏览器登录已缺失或过期，HTTP 424；
- `source_unavailable`：来源或本地依赖不可用，HTTP 503；
- `misconfigured`：本地配置缺失，HTTP 503；
- `error`：其他显式错误。

失败不会被伪装成 `200 + []`。`no_results` 才会使用 HTTP 200，并返回 `ok=false`。

## 开发验证

```powershell
.\.venv\Scripts\python.exe -m compileall app
.\.venv\Scripts\python.exe -m pytest
```
