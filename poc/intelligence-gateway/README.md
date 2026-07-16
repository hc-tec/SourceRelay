# Personal Intelligence Gateway

这是一个面向中文公开信息收集的按需能力运行时。它把不同获取方式收敛为一致、可发现、可计划、可执行的 API，同时保留每个来源真实的认证、范围、降级和验证边界。

当前接入：

- `bilibili`：由本地 Maxun Robot 执行关键词搜索；
- `xiaohongshu`：由 BrowserWing 使用隔离且持久化的 Chrome Profile 执行人工登录后的搜索；
- `web`：由本机 SearXNG 聚合公开搜索结果，也支持 `site` 限定知乎、新闻站等域名；
- `hotlist_fetch`：由自托管 NewsNow 按 `platform + feed_id` 获取热榜，完整原始 JSON 保存为本地 artifact；
- `forum_threads/post_detail`：由 aiotieba 匿名读取指定公开贴吧和已知主题，完整返回保存为本地 artifact；
- `article_detail`：匿名读取一个已知的公开公众号文章 URL，完整原始 HTML 保存为本地 artifact；
- `account_posts`：通过 BrowserWing 匿名读取一个已知微博 UID 的首个公开渲染页，白名单原始 JSON 保存为本地 artifact；
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
.\scripts\start-newsnow.ps1
.\scripts\start.ps1
.\scripts\status.ps1
```

API 文档：`http://127.0.0.1:8765/docs`

停止：

```powershell
.\scripts\stop.ps1
.\scripts\stop-searxng.ps1
.\scripts\stop-newsnow.ps1
```

## API 示例

### 按需能力发现与执行

列出已经注册的能力：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/capabilities
```

当前 20 个静态能力：19 个已验证，1 个保持声明未验证。已验证：

```text
bilibili.keyword_search.maxun.v1
xiaohongshu.keyword_search.browserwing.v1
web.keyword_search.searxng.v1
web.article_extract.trafilatura.v1
web.detail_fetch.trafilatura.v1
bilibili.hotlist_fetch.newsnow-hot-search.v1
bilibili.hotlist_fetch.newsnow-hot-video.v1
bilibili.hotlist_fetch.newsnow-ranking.v1
weibo.hotlist_fetch.newsnow.v1
weibo.account_posts.browserwing.v1
zhihu.hotlist_fetch.newsnow.v1
kuaishou.hotlist_fetch.newsnow.v1
tieba.hotlist_fetch.newsnow.v1
36kr.hotlist_fetch.newsnow.v1
thepaper.hotlist_fetch.newsnow.v1
bilibili.video_detail.yt-dlp.v1
tieba.forum_threads.aiotieba.v1
tieba.post_detail.aiotieba.v1
wechat_official.article_detail.public-html.v1
```

保持 `declared_unverified`、不会被 Planner 选择：

```text
douyin.hotlist_fetch.newsnow.v1
```

运行时还可以包含已经通过样本验证并晋升的生成能力。本轮真实生成：

```text
baidu.keyword_search.browserwing_recipe.v1
bing.keyword_search.browserwing_recipe.v1
sogou.keyword_search.browserwing_recipe.v1
csdn.keyword_search.browserwing_recipe.v1
gov-cn.detail_fetch.browserwing_recipe.v1
zhihu.detail_fetch.browserwing_recipe.v1
```

### 按需热榜与本地原始 artifact

`0.7.0` 新增独立 `hotlist_fetch`，不把热榜伪装成关键词搜索。同一平台可以有多个 feed，例如 B站：

```text
bilibili-hot-search -> 热搜词
bilibili-hot-video  -> 热门视频
bilibili-ranking    -> 排行视频
```

调用示例：

```powershell
$body = @{
  platform = "bilibili"
  action = "hotlist_fetch"
  input = @{
    feed_id = "bilibili-hot-video"
    limit = 5
    force_latest = $false
  }
  options = @{ persistence = "none" }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/tasks/execute `
  -ContentType application/json -Body $body
```

响应只提供当次使用的轻量预览：

```json
{
  "platform": "bilibili",
  "feed_id": "bilibili-hot-video",
  "provider": "newsnow",
  "provider_status": "success",
  "from_cache": false,
  "upstream_updated_at": 1234567890,
  "items": [
    {
      "rank": 1,
      "external_id": "BV...",
      "title": "...",
      "url": "https://www.bilibili.com/video/BV..."
    }
  ],
  "artifact": {
    "manifest_file": "artifacts/newsnow/2026-07-16/<run-id>/manifest.json",
    "raw_file": "artifacts/newsnow/2026-07-16/<run-id>/raw.json",
    "sha256": "..."
  }
}
```

`raw.json` 保留 NewsNow 完整原始响应，包括平台特有的 `extra`、图片、摘要和指标；`manifest.json` 只保留来源、时间、Capability、feed、缓存状态、原文件与 SHA-256。它们位于被 Git 忽略的 `runtime/artifacts/`，不把内容字段拆入 SQLite。

数据源语义：

- `provider_status=success`：NewsNow 返回当前或 source interval 内的数据；
- `provider_status=cache`：NewsNow 在 TTL 或上游失败回退路径中返回缓存，必须结合 `upstream_updated_at` 判断新旧；
- `force_latest=true` 只映射 NewsNow `latest=true`，不承诺绕过 source interval 和服务器状态；
- HTTP 错误、非 JSON、feed 不匹配或预览字段漂移都显式返回 `source_unavailable`，并尽可能保留失败原始响应；
- 原始 artifact 不保存请求头、Cookie、Token、密码或验证码。

2026-07-16 自托管固定样本中，B站三个 feed、微博、知乎、快手、贴吧、36氪和澎湃成功；抖音上游请求在 NewsNow 中返回 HTTP 500，所以仍为 `declared_unverified`。公共实例受 Cloudflare 403 限制，正式能力使用自托管实例。

### B站已知视频详情：yt-dlp metadata-only

`0.8.0` 新增 `video_detail`，当前只接受已知、公开、规范的 B站视频 URL：

```text
https://www.bilibili.com/video/BV...
https://www.bilibili.com/video/BV...?p=2
```

不接受短链、HTTP、播放列表、非视频路径、带凭据 URL 或除数字 `p` 以外的查询参数。调用示例：

```powershell
$body = @{
  platform = "bilibili"
  action = "video_detail"
  input = @{
    url = "https://www.bilibili.com/video/BV1XTNR69Etx"
  }
  options = @{ persistence = "none" }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/tasks/execute `
  -ContentType application/json -Body $body
```

当次预览只返回：

```json
{
  "platform": "bilibili",
  "provider": "yt-dlp",
  "provider_version": "2026.7.4",
  "video": {
    "external_id": "BV1XTNR69Etx",
    "title": "...",
    "url": "https://www.bilibili.com/video/BV1XTNR69Etx"
  },
  "artifact": {
    "manifest_file": "artifacts/yt-dlp/2026-07-16/<run-id>/manifest.json",
    "raw_file": "artifacts/yt-dlp/2026-07-16/<run-id>/raw.json",
    "sha256": "..."
  }
}
```

`raw.json` 保留 yt-dlp 完整元数据，真实样本已确认包含 `id/title/description/uploader/uploader_id/timestamp/duration/view_count/like_count/comment_count/thumbnail/subtitles/formats`。Gateway 不把这些平台字段拆入 SQLite，后续由 AI 按需读取原始 JSON。`formats` 可能包含有时效的公开媒体分发 URL，因此 artifact 必须保持本地、被 Git 忽略，后续应配置保留周期。

固定安全参数：

```text
--ignore-config
--no-config-locations
--no-playlist
--skip-download
--dump-single-json
```

因此能力不读取用户全局 yt-dlp 配置，不传 Cookie，不写字幕/封面/视频文件，不处理播放列表。元数据显示 `needs_auth/premium_only/subscriber_only` 时返回认证边界，不自动提供 Cookie 或绕过付费限制。失败时 stderr 不保存到 artifact 或 API，避免工具诊断意外携带敏感信息。

如果当前网络需要代理，可在本地 `.env` 中设置：

```dotenv
YTDLP_PROXY=http://127.0.0.1:7897
```

manifest 只记录 `proxy_used=true/false`，不记录代理 URL，避免未来带凭据的代理地址被落盘。

真实对照：

| 工具 | 版本 | 两个 BV URL | JSON 大小 | 主要特点 | 默认角色 |
|---|---:|---:|---:|---|---|
| yt-dlp | 2026.7.4 | 2/2 成功 | 30,803 / 31,217 bytes | 作者、简介、时间、统计、字幕、formats 更完整 | 正式 `video_detail` |
| lux | 0.24.1 | 2/2 成功 | 7,201 / 7,332 bytes | 主要为 `streams/caption`，JSON 更小 | 隔离对照，不进入默认链 |

lux 对照使用 `-j`，两次运行均没有在工作目录生成媒体文件。

### 贴吧指定吧与已知主题：aiotieba 匿名只读

`0.9.0` 新增两个不同语义的能力：

```text
forum_threads -> 输入 forum_name，读取指定公开贴吧的一页主题
post_detail   -> 输入已知 thread_id，读取该公开主题的一页帖子
```

调用示例：

```powershell
$threads = @{
  platform = "tieba"
  action = "forum_threads"
  input = @{ forum_name = "python"; page = 1; limit = 10 }
  options = @{ persistence = "result_only" }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/tasks/execute `
  -ContentType application/json -Body $threads
```

响应只提供 `thread_id/title/url` 或 `post_id/floor/text_preview/url` 等轻量预览。aiotieba 的嵌套 dataclass 返回会转换为完整 JSON，保存到：

```text
runtime/artifacts/aiotieba/YYYY-MM-DD/<run-id>/manifest.json
runtime/artifacts/aiotieba/YYYY-MM-DD/<run-id>/raw.json
```

安全边界：

- 固定使用空 BDUSS/STOKEN 的匿名 Client，不需要人工登录；
- Adapter 只调用 `Client.get_threads` 与 `Client.get_posts`，不暴露 aiotieba 的发帖、回复、点赞、关注、删除或吧务 API；
- `post_detail` 当前固定 `with_comments=false`，不顺带抓取楼中楼；
- 原始对象序列化只遍历返回 dataclass 的公开字段，显式排除 `err/account/bduss/stoken/cookie/token` 等字段；
- `persistence=result_only` 也不写 SQLite，durable result 是本地 raw artifact；
- `AIOTIEBA_PROXY=true` 时从标准 `HTTP_PROXY/HTTPS_PROXY` 环境读取代理，manifest 只记录 `proxy_used` 布尔值，不记录代理 URL。

2026-07-16 固定样本中，aiotieba 4.7.1 匿名读取 `python吧` 得到 10 个主题；再对两个不同公开 tid 读取帖子，分别得到 6 条与 2 条，raw JSON 约 23 KB、9.8 KB 与 3.5 KB。两项 Capability 已提升为 `verified`。

### 公众号已知公开文章：匿名 public HTML

`0.10.0` 新增独立动作 `article_detail`。它只接受规范的公开短链接：

```text
https://mp.weixin.qq.com/s/<public-article-id>
```

调用示例：

```powershell
$body = @{
  platform = "wechat_official"
  action = "article_detail"
  input = @{ url = "https://mp.weixin.qq.com/s/eFsIOWDXfs9DbcNmr2vtjQ" }
  options = @{ persistence = "result_only" }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/tasks/execute `
  -ContentType application/json -Body $body
```

响应只返回文章 ID、标题、公众号名、发布时间和最多 4,000 字预览；完整微信 HTML 保存到：

```text
runtime/artifacts/wechat-public-html/YYYY-MM-DD/<run-id>/raw.html
```

边界：

- 不使用公众号后台、微信读书、Cookie、Token、扫码登录或闭源中转；
- 不跟随重定向，不接受查询参数、其他微信主机、带凭据 URL 或非 `/s/<id>` 路径；
- 最大读取 5 MB，只接受 HTML；
- 必须同时识别 `js_content`、有效标题和至少 50 字正文；壳页、安全验证页和结构漂移返回 `source_unavailable`；
- 页面明确写明“已被发布者删除”或“因违规无法查看”时返回 `no_results`，原始页面仍落 artifact；
- `WECHAT_ARTICLE_PROXY` 可指定本地 HTTP 代理，但 manifest 只记录 `proxy_used`，不记录代理 URL；
- 这是“已知文章详情”，不是公众号历史列表、订阅或全局搜索。

2026-07-16 固定样本中，两篇不同公众号公开文章成功，原始 HTML 为 3,840,273 / 3,139,751 bytes；一个删除样本正确返回 `no_results`。同两篇有效文章使用通用 Trafilatura 均返回 `no_results`，因此保留微信专用 Adapter，而不是降低通用正文质量门槛。

WeRSS 与 WeWe RSS 经 Issue 审计后均未进入 Gateway：前者当前新登录二维码流程失效，后者依赖闭源中转且长期存在 Token 失效与部分公众号无文章问题。Gateway 不会为了账号历史覆盖而索取或接收用户 Cookie/Token。

### 微博已知账号首个公开页面：BrowserWing 匿名只读

`0.11.0` 新增独立动作 `account_posts`。输入是 5—20 位数字微博 UID，`limit` 最大为 10；它只读取 `https://m.weibo.cn/u/<uid>` 已经公开渲染的第一页，不滚动、不分页、不点击、不点赞、不评论、不关注。

```powershell
$body = @{
  platform = "weibo"
  action = "account_posts"
  input = @{ account_id = "2803301701"; limit = 10 }
  options = @{ persistence = "result_only" }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/tasks/execute `
  -ContentType application/json -Body $body
```

页面 Vue 对象虽然含有完整 `mblog`，但也可能含 `user_token` 和带时效签名的媒体地址。因此 Adapter 不序列化完整对象，而是在浏览器页面内直接构造公开字段白名单：微博 ID、时间、正文 HTML、来源、互动计数、图片 ID、有限的 `page_info` 与公开用户信息。Cookie、local/session storage、Profile 路径、`user_token`、`stream_url` 和签名媒体 URL 不会进入脚本输出、Gateway 响应或 artifact。

轻量 API 响应只返回 `post_id/text_preview/url/published_text`；白名单 JSON 保存在：

```text
runtime/artifacts/browserwing-weibo/YYYY-MM-DD/<run-id>/manifest.json
runtime/artifacts/browserwing-weibo/YYYY-MM-DD/<run-id>/raw.json
```

2026-07-16 匿名固定样本中，人民日报 UID `2803301701` 与央视新闻 UID `2656274875` 均返回 10 条公开微博，脚本 JSON 分别为 31,127 / 32,300 bytes；Gateway 正式 raw artifact 使用紧凑 JSON，人民日报样本为 20,649 bytes。两份脚本样本和正式 artifact 均检查过，不含上述敏感或时效字段。该能力是“已知账号第一页”，不是微博全局搜索、完整账号历史或持续监控。

### 人工登录与持久 Profile

当公开路径确实不足、且平台允许用户本人在浏览器中访问时，Gateway 可以使用 BrowserWing 的隔离持久 Profile。当前配置将 Chrome `user_data_dir` 固定在被 Git 忽略的 POC `runtime/chrome-user-data`，BrowserWing 停止和重启后仍复用这个目录。小红书已验证过 Profile 重启复用。

边界：

- 用户只在可见 Chrome 窗口中人工登录；
- Gateway 不索取、导出、返回或记录 Cookie、Token、密码、验证码和二维码；
- 持久的是 Chrome Profile 中由浏览器自行管理的会话，不是 Gateway 凭据表；
- Profile 目录存在只能说明本地依赖存在，不能证明登录仍有效；
- 平台仍可主动让会话过期、触发验证或要求重新登录，因此 `authentication_state` 默认为 `unknown_until_search`；
- 每个需登录的 Capability 都必须用固定样本真实执行才能判断当前认证状态；
- 不把 BrowserWing Profile 直接转成 yt-dlp `--cookies-from-browser`。如果 B站未来确实需要登录内容，应新建独立、人工授权、只读的 B站 Profile Adapter，不改变当前无登录 yt-dlp Capability 的安全含义。

当前已有的可见登录入口支持小红书、知乎和微博：

```powershell
cd D:\AIProject\inteligence\poc\browserwing
.\scripts\start-login-session.ps1 -Platform xiaohongshu
.\scripts\start-login-session.ps1 -Platform zhihu
.\scripts\start-login-session.ps1 -Platform weibo
```

只有当后续固定样本明确返回 `authentication_required`时，才需要用户协助重新登录。

### 未知公开网站生成按需搜索或详情能力

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

- `create` 登记平台、动作和公开起始 URL；`keyword_search` 必须提供样本查询，`detail_fetch` 不需要伪造查询词；私网、回环与带凭据 URL 会被拒绝；
- 搜索 `inspect` 只识别可见输入和提交控件；详情 `inspect` 只对标题、正文容器、段落、链接密度和文本长度提出候选；
- 搜索 `validate` 使用样本词做一次真实、只读搜索并要求结果相关；详情 `validate` 重放同一公开 URL，要求最终主机仍在边界内、标题非空且正文至少 200 字；
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

搜索 recipe 只读取首个渲染结果页。详情 recipe 只读取验证过的正文容器 `innerText`，不点击、不提交表单、不滚动翻页、不展开全文，也不读取 Cookie 或 localStorage。两类 recipe 都不会自动登录、处理验证码或绕过付费保护；选择器失效、正文过短、最终主机越界和认证门禁都会显式失败。浏览器导航层并不等同于带逐跳 DNS 校验的安全 HTTP 下载器，因此当前服务仍只绑定本机，不应作为多租户任意 URL 浏览服务暴露。完整决策见 [浏览器渲染详情 ADR](../../docs/design/browser-rendered-detail-capability.md)。

### 生成能力可靠性与漂移隔离

`0.4.1` 为运行时生成的 Manifest 增加可靠性状态：

```text
GET  /capabilities/{capability_id}/reliability
POST /capabilities/{capability_id}/verify
```

每次精确 verify 会记录：

- 最近验证状态与时间；
- 最近成功和失败时间；
- 连续失败次数；
- 最近错误与 warnings；
- 自动阻止时间。

默认策略：

```text
成功                 -> verified，连续失败清零
第 1、2 次连续失败   -> degraded，仍允许执行并保留 fallback
第 3 次连续失败      -> blocked，Planner 不再执行旧 recipe
blocked 后精确验证成功 -> verified，恢复 Planner 资格
```

当生成能力进入 `blocked` 时，Planner 会直接选择它配置的 fallback，并带上 `degraded=true` 和阻止原因。`verify` 始终精确执行 URL 中指定的 capability，不通过 Planner 重选，因此修复后的 recipe 即使仍处于 blocked，也能通过一次真实验证恢复。

BrowserWing 会话还有一次受控自愈：如果导航明确返回连接已关闭、控制连接失效等诊断，Draft Explorer 会在共享 Profile 锁内替换默认浏览器实例并重试一次。普通网站错误不会无限触发浏览器重启。

已晋升 Draft 在修复选择器后可以重新 `validate -> promote`。如果 recipe 确实变化，运行时 Manifest 会递增 patch 版本、写入新 recipe，并以这次成功验证清零连续失败和 blocked 状态；重复 promote 且 recipe 未变化时保持幂等。

### 多站点 Draft 横向回归

除百度外，`0.4.1` 又用三个公开搜索入口做了“样本验证 + 不同查询执行”：

| 平台 | 验证样本 | 验证结果 | recipe 结果容器 | 不同查询 | 执行结果 |
|---|---|---:|---|---|---:|
| Bing 中文搜索 | 开源情报 | 7 条 | `h2` | 个人知识库 | 5 条 |
| 搜狗 | 个人知识库 | 10 条 | `div.vrwrap` | 开源情报工具 | 5 条 |
| CSDN | Python Agent | 10 条 | `h3` | FastAPI Agent | 5 条 |

生成的运行时能力：

```text
bing.keyword_search.browserwing_recipe.v1
sogou.keyword_search.browserwing_recipe.v1
csdn.keyword_search.browserwing_recipe.v1
```

Bing 还验证了两个通用边界：入口从 `cn.bing.com` 跳到 `www.bing.com` 后，系统会对导航后的最终 URL 再做公共 DNS/IP 检查，并以这个已检查主机作为 recipe 边界；“Search using voice”等负向提交控件会被降权，当没有可信按钮时优先使用搜索输入所属 form 提交。

三次不同查询均通过统一 `/tasks/execute`、使用 `persistence=none`，没有触发 fallback，也没有改变 documents、observations 和 search_runs 数量。

### 公共搜索冗余与来源质量

SearXNG 是全网和 `site:` 外部发现的低成本首选，但 `/health` 只能确认本地 JSON endpoint，不能保证 Brave、DuckDuckGo、Google、Startpage 等上游当前未被限流或 CAPTCHA。运行目录中存在已验证、无需登录的 Bing/搜狗 BrowserWing recipe 时，Planner 会形成低频冗余链：

```text
web.keyword_search.searxng.v1
  -> bing.keyword_search.browserwing_recipe.v1
  -> sogou.keyword_search.browserwing_recipe.v1
```

浏览器 fallback 只在 SearXNG `no_results/source_unavailable` 后执行。知乎、公众号、政务站等外部发现会把受验证的 hostname 作为内部 `site:` 查询约束，但响应仍保留用户原始 query。三层全部失败时，错误响应也返回 `attempted_capabilities`、最后执行能力和 `degraded`，不把能力链藏在日志里。

公众号外部发现另有高精度门槛：`mp.weixin.qq.com` 结果若标题只是“微信公众平台”等通用壳，或标题与摘要没有查询词证据，就会被过滤。全部过滤后明确返回 `no_results`，不会把平台入口、开发文档或无关小程序页面冒充公众号文章。

完整就绪等级、真实探测矩阵和 DeepResearch 分层边界见 [数据源层 ADR](../../docs/design/data-source-layer.md)。

### 搜索结果到分层详情

`0.5.0` 新增组合接口，`0.6.0` 将它升级为 direct-first 的分层详情链：

```text
POST /tasks/search-and-fetch
```

示例：

```json
{
  "platform": "bing",
  "query": "国务院 政府工作报告",
  "search_limit": 8,
  "detail_limit": 3,
  "include_tables": true,
  "options": {
    "allow_fallback": true,
    "persistence": "none"
  }
}
```

执行链：

```text
平台 keyword_search Capability
  -> 规范化并去重结果 URL
  -> 最多选择 5 条
  -> web.detail_fetch.trafilatura.v1
  -> 成功：直接返回
  -> no_results / source_unavailable
  -> 仅当 requested platform 已有 verified/degraded 且 host 匹配的 BrowserWing detail recipe
  -> platform.detail_fetch.browserwing_recipe.v1
  -> 逐条返回正文或显式错误
```

正文能力也可以独立调用：

```json
{
  "platform": "web",
  "action": "detail_fetch",
  "input": {"url": "https://www.gov.cn/example/article.html"},
  "options": {"persistence": "none"}
}
```

每条详情都返回 `attempted_capabilities`、`executed_capability_id` 和 `degraded`。Trafilatura 成功时 `degraded=false`；使用已注册的浏览器 recipe 时 `degraded=true`。没有 recipe、recipe 主机不匹配、能力已 blocked/retired 或遇到安全校验错误时，不会临时探索页面或盲目启动浏览器。

真实知乎专栏闭环：Trafilatura 对公开专栏返回 HTTP 403；`zhihu.detail_fetch.browserwing_recipe.v1` 随后读取样本文章 3,358 字，并用同一 recipe 读取另一篇文章 1,916 字。容器评分会惩罚包含多个主标题或多篇嵌套文章的聚合区，避免把推荐文章混入正文；修正后的 manifest 为 `1.0.1`。真实 `/tasks/search-and-fetch` 共处理 3 条：两条知乎专栏通过浏览器 fallback 成功，`https://www.zhihu.com/` 因不匹配 `zhuanlan.zhihu.com` 主机边界而只保留 Tier 1 的 `no_results`。前后数据库仍为 8 documents、13 observations、3 search runs。

组合任务不会因为一篇文章失败而丢弃其他成功正文。如果至少一篇成功，整体为 `success`；同时存在失败项时 `partial=true`。如果全部没有可读正文，整体为 `no_results`。返回正文不会由该接口写入情报库。BrowserWing Tier 2 只处理不需要登录即可看到的公开渲染正文；人工登录内容仍属于平台专用 Profile Adapter，不进入通用 Draft。

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

两种模式下，需要本地执行证据的 Connector 仍可写入被 Git 忽略的 raw artifact。对 `hotlist_fetch` 和 `video_detail`，数据库模型不适用，即使传入 `result_only` 也只保存原始 artifact，不写入 documents、observations 或 search_runs。

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

当前基线：`104 passed`。
