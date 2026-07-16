# 中文平台数据源：按网站与动作选择 GitHub 项目

> 调研日期：2026-07-16
>
> 当前目标：为 Personal Intelligence Gateway 选择可按需调用的数据源实现；不建设 DeepResearch 分析层，不做 RSSHub，不把项目 README 中的“支持平台”直接当作已接入能力。

## 一句话结论

没有一个仓库适合承包所有中文网站。正确选型单位不是“网站”，而是：

```text
网站 × 动作 × 认证方式 × 输出类型
```

同一个 B站就可能需要：

```text
关键词搜索   -> Maxun / BrowserWing 公开页面
热门榜       -> NewsNow 或 DailyHotApi
已知视频详情 -> yt-dlp / lux 的只读元数据
正文/字幕    -> 另一个显式动作，不能混入 keyword_search
```

统一的是 Gateway 的 Capability 契约，不是底层仓库。

### 原始数据保存原则

当前不需要把每个仓库、每个平台的所有字段预先拆开并归一化入库。更符合按需数据源的方式是：

```text
原始 JSON / HTML / Markdown / 媒体元数据本地落盘
  + 最小 manifest（来源、时间、动作、执行能力、原文件、hash）
  + 可选轻量预览结果
```

标题、作者、热度、摘要和平台特有字段尽量保留在原始文件中，以后由 AI 在读取时解释。Gateway 只必须确保原始数据可找回、可溯源、可判断新旧和失败/降级状态。数据库是可选索引，不是数据本体。

## 1. 本轮核验方法

GitHub REST API 在当前网络环境触发匿名 403 限额，因此本轮没有使用星数排序，也没有把旧缓存描述成实时结果。实时证据来自：

1. `git ls-remote --symref`：确认仓库存在、默认分支和 HEAD；
2. GitHub commit Atom feed：确认默认分支最近提交时间；
3. `raw.githubusercontent.com`：读取 README、License 和关键源文件；
4. GitHub tree 页面：确认数据源模块和代码目录；
5. 当前 Gateway 的真实运行结果：区分“仓库候选”和“已经验证的 Capability”。

最近提交时间只说明代码仍有变化，不说明对应平台动作现在一定可用。所有候选仍需进入：

```text
fixed public sample
-> isolated POC
-> field and quality validation
-> license/compliance check
-> Capability Draft
-> promote
```

## 2. 先拆动作

| 动作 | 例子 | 合适项目类型 | 不能混淆成 |
|---|---|---|---|
| `keyword_search` | 小红书内搜“低空经济” | 平台页面 Adapter、平台客户端 | 热榜、指定账号更新 |
| `hotlist_fetch` | 微博热搜、知乎热榜 | NewsNow、DailyHotApi | 任意关键词搜索 |
| `account_feed` | 某公众号、UP 主、微博用户的新内容 | WeRSS、weibo-crawler、平台客户端 | 全平台索引 |
| `article_detail` | 公众号文章、新闻、知乎专栏 | Trafilatura、Browser detail recipe | 视频详情、问答聚合 |
| `video_detail` | B站/抖音已知视频 URL | yt-dlp、lux、专用解析器 | 关键词搜索 |
| `post_detail` | 小红书笔记、微博、贴吧帖子 | xhs、aiotieba、专用 Profile Adapter | 通用网页长文 |
| `qa_detail` | 知乎问题与回答 | 页面/专用只读 Adapter | 把整个页面聚合成一篇文章 |

Gateway 应新增这些动作，而不是继续让所有仓库输出 `search_response` 或 `article`。

## 3. 仓库实时核验表

### 3.1 底层公共能力

| 仓库 | 最近默认分支提交 | License | 本轮确认 | 判断 |
|---|---|---|---|---|
| [browserwing/browserwing](https://github.com/browserwing/browserwing) | 2026-05-13 | MIT | 浏览器能力运行时；当前本地已有公开搜索 recipe 和人工 Profile Adapter | 保留为页面探索、登录 Profile 和已验证 recipe executor |
| [getmaxun/maxun](https://github.com/getmaxun/maxun) | 2026-07-15 | AGPL-3.0 | 可录制公开页面流程；当前已用于 B站搜索 | 保留现有 POC；商业/网络服务部署前评估 AGPL |
| [searxng/searxng](https://github.com/searxng/searxng) | 2026-07-15 | AGPL-3.0 | 全网和 `site:` 外部发现；上游引擎会限流/CAPTCHA | 继续作为低成本首选，后接 Bing/搜狗低频 recipe fallback |
| [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 2026-07-10 | Non-Commercial Learning License 1.1 | README 明确列出小红书、抖音、快手、B站、微博、贴吧、知乎的搜索/帖子/作者/评论 | 作为功能和字段参照；不进入默认商业安全底座 |

MediaCrawler 最接近“一个项目覆盖多平台”，但它恰好证明统一仓库不等于适合直接集成：许可证限制、强登录、多平台风控和评论深度采集都与当前默认底座边界冲突。

### 3.2 小红书

| 仓库/实现 | 最近提交 | License | 真实能力证据 | 适合动作 | 风险 |
|---|---|---|---|---|---|
| 当前 BrowserWing Adapter | 本地已验证 | MIT runtime + 自有 Adapter | 人工 Profile 下 `DeepSeek` 再次实测返回 5 条；一次曾原生失败后外部降级 | `keyword_search` | 登录态和页面结构会漂移；低频串行 |
| [ReaJason/xhs](https://github.com/ReaJason/xhs) | 2025-07-01 | MIT | `core.py` 有 `get_note_by_keyword`、`get_note_by_id`、用户笔记、评论；也有点赞、收藏、评论、发布等写方法 | `post_detail`、搜索对照、账号内容 | 需要 Cookie/签名/xsec token；必须只读白名单，禁止暴露写方法 |
| [JoeanAmier/XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) | 2026-07-14 | GPL-3.0 | README 明确支持搜索结果作品/用户链接、账号发布/收藏/点赞/专辑链接、作品信息和媒体 | 已知作品详情、链接解析 POC | 自动滚动默认关闭且有封号提示；GPL；不应默认下载媒体 |
| MediaCrawler | 2026-07-10 | 非商业学习许可 | 搜索、帖子、作者、评论 | 行为与字段参考 | 不能作为默认集成许可证 |

推荐组合：

```text
keyword_search -> 当前 BrowserWing 人工 Profile Adapter
post_detail    -> 先对比 BrowserWing 页面详情与 xhs 只读客户端
account_feed   -> xhs 只读 POC，必须人工 Profile 引用和频率限制
media_download -> 非当前目标
```

`xhs` 不能整包包装成工具，因为它同时包含写操作。Gateway Adapter 只能显式调用读取方法，代码层不导出 `comment_note`、`like_note`、`collect_note`、`create_note` 等能力。

### 3.3 公众号

| 仓库/实现 | 最近提交 | License | 实际范围 | 判断 |
|---|---|---|---|---|
| Gateway + SearXNG | 当前运行 | AGPL 服务 | `site:mp.weixin.qq.com` 外部发现；已加入壳页和查询证据过滤 | 只能作为不完整的外部发现；当前真实样本三层全部失败时显式返回 503 |
| [rachelos/we-mp-rss](https://github.com/rachelos/we-mp-rss)（WeRSS） | 2026-06-14 | MIT | 扫码授权、添加公众号订阅、文章 API | 2026-07 Issue 显示微信登录页变化后无法生成二维码；等待修复，不接入 |
| [cooderl/wewe-rss](https://github.com/cooderl/wewe-rss) | 2026-03-20 | MIT | 微信读书账号、公众号历史、JSON Feed | 二维码现场可生成，但强依赖闭源 `weread.111965.xyz`，Token 失效和空文章 Issue 长期未解；淘汰 |
| [wechat-article/wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) | 2026-07-15 | MIT | 用自己的公众号后台搜索并导出其他公众号文章 | 活跃但要求用户拥有公众号；公共代理有额度，最新源码仍记录 token，反查公众号 API 新近失效；不接入 |
| [lukelei2025/wechat-article-claw](https://github.com/lukelei2025/wechat-article-claw) | 2026-03-26 | 未发现 License | Playwright 登录公众号后台，保存 Cookie/Token 后抓历史 | README/SKILL 要求向 Agent 粘贴完整凭证并写 `credentials.json`；直接淘汰 |
| [qiye45/wechatDownload](https://github.com/qiye45/wechatDownload) | 2026-06-21 | 未发现标准开源 License | Windows/macOS 桌面成品、本地 MCP、已知文章与批量下载 | GitHub 无核心源码且限制仅学习交流、24 小时删除；可作手工工具，不作 Gateway 依赖 |
| [CharlesPikachu/DecryptLogin](https://github.com/CharlesPikachu/DecryptLogin) | 2022-08-29 | Apache-2.0 | 旧式多平台登录模块 | 只参考认证抽象；不依赖旧登录协议 |
| 若干新 `wechat-official-account-crawler` | 2026 年仍有新仓库 | 多个未发现 License | 多数包装 WeWe RSS 或需要已知文章链接 | 不因名字新就当全局搜索；无许可证不集成 |

推荐组合：

```text
外部关键词发现  -> SearXNG / Bing / 搜狗，严格相关性门禁
已知文章正文    -> Gateway 专用 public HTML Adapter；完整 HTML raw-first
已知公众号历史  -> 当前无通过凭证、安全和 Issue 门槛的 Provider，保持缺口
全公众号搜索    -> 当前无可信开源默认方案，保持缺口
```

Issue 审计（2026-07-16）改变了原先的二选一计划：WeRSS [#425](https://github.com/rachelos/we-mp-rss/issues/425) 显示微信登录页面变化导致二维码提取失败，[#419](https://github.com/rachelos/we-mp-rss/issues/419) 指出本地登录状态不能证明服务端会话有效；WeWe RSS [#463](https://github.com/cooderl/wewe-rss/issues/463)、[#427](https://github.com/cooderl/wewe-rss/issues/427)、[#455](https://github.com/cooderl/wewe-rss/issues/455) 分别反映整体失效、Token 快速失效和订阅后无文章，[#385](https://github.com/cooderl/wewe-rss/issues/385) 暴露闭源中转的凭证信任争议。容器能启动或二维码能生成不能覆盖这些风险。

后续所有平台仓库选型都把 Issue 纳入正式证据链：至少检查近 30/90/180 天的登录、空数据、风控、镜像版本、维护响应、关联 PR/Release 和闭源外部依赖；“零 Issue”也要结合用户量、License 和源码凭证流判断。

### 3.4 B站

| 仓库/实现 | 最近提交 | License | 适合动作 | 结论 |
|---|---|---|---|---|
| 当前 Maxun Robot | 本地已验证 | AGPL-3.0 | `keyword_search` | 保留；下一步提升相关性和规范 BV URL 比例 |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | 2026-07-14 | Unlicense / public domain | 已知 URL 元数据、媒体格式、字幕；可 `--dump-single-json --skip-download` | `video_detail` 首选 POC，只取公开元数据，不默认下载 |
| [iawia002/lux](https://github.com/iawia002/lux) | 2025-12-29 | MIT | B站 `-j` JSON 元数据、合集；也覆盖抖音/微博/快手已知 URL | `video_detail` 第二候选；与 yt-dlp 做同 URL 字段/成功率对照 |
| [Nemo2011/bilibili-api](https://github.com/Nemo2011/bilibili-api) | 2026-07-06 关停声明 | 不再作为候选 | 非公开 API、认证与访问控制逆向 | README 明确“停止维护并永久关停”，不得复用 |
| [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) | 2026-01-30 | deprecated | 非公开 API 文档收集 | 因律师函停止维护并删除代码，不得复用 |

推荐组合：

```text
keyword_search -> Maxun 公开页面
hotlist_fetch  -> NewsNow / DailyHotApi
video_detail   -> yt-dlp metadata-only，lux 对照
字幕/媒体      -> 以后单列动作与用户授权，不进入默认详情
```

2026-07-16 后续实施状态：Gateway `0.8.0` 已实现 `bilibili.video_detail.yt-dlp.v1`。yt-dlp 2026.7.4 对两个不同公开 BV URL 均成功，完整原始 JSON 约 30 KB，存在作者、简介、时间、时长、播放/点赞/评论、字幕和 formats 等字段；这些字段只保留在 raw artifact，不拆入数据库。lux 0.24.1 `-j` 对同两个 URL 也成功且没有生成媒体文件，但 JSON 主要为 streams/caption，因此保留为对照而不是默认 provider。

### 3.5 知乎

本轮 GitHub HTML 搜索按最近更新排序，没有发现一个同时满足“维护活跃、许可清晰、站内关键词搜索且无需绕过认证”的专用仓库。搜索结果多数是个人小爬虫、课程项目或小说下载器。

| 方案 | 当前证据 | 推荐动作 |
|---|---|---|
| SearXNG / Bing / 搜狗 `site:zhihu.com` | 外部发现已真实运行；覆盖受引擎状态影响 | 当前 `keyword_search` 降级路径 |
| `zhihu.detail_fetch.browserwing_recipe.v1` | 两篇不同专栏真实通过 3,358 / 1,916 字 | `article_detail` |
| NewsNow / DailyHotApi | 均有知乎热榜/知乎日报来源 | `hotlist_fetch` |
| MediaCrawler | 声明搜索、帖子、作者、评论，但非商业学习许可 | 字段与流程参考 |

结论：当前不为了“专用仓库”而接入一个低维护个人项目。知乎先保持外部发现 + 公开详情 recipe；以后对问题/回答设计独立 `qa_detail`。

### 3.6 微博

| 仓库 | 最近提交 | License | 实际范围 | 判断 |
|---|---|---|---|---|
| [dataabc/weibo-crawler](https://github.com/dataabc/weibo-crawler) | 2026-06-24 | 根目录未发现 License | 一个或多个指定用户，用户信息、微博、评论/转发、增量更新；Cookie 可选 | 很适合 `account_feed` 语义，但无许可证不能默认复制/分发 |
| [dataabc/weiboSpider](https://github.com/dataabc/weiboSpider) | 2026-02-04 | 根目录未发现 License | 指定用户微博和媒体，需要 Cookie | 同上；不是关键词搜索 |
| NewsNow / DailyHotApi | 2026-06 / 2026-03 | MIT | 微博热搜 | `hotlist_fetch` 推荐 |
| MediaCrawler | 2026-07-10 | 非商业学习许可 | 关键词、帖子、作者、评论 | 只作参考 |

推荐组合：

```text
hotlist_fetch -> NewsNow 主，DailyHotApi 备
account_feed  -> 先自行做公开页面只读 Adapter；dataabc 用作字段参考
keyword_search -> BrowserWing 人工 Profile 小样本，未验证前保持 L0
```

GitHub 仓库公开可读不等于其代码自动获得开源许可。没有 License 的 dataabc 仓库不能直接复制进 Gateway。

### 3.7 抖音与快手

| 仓库/方案 | 最近提交 | License | 真实声明 | 判断 |
|---|---|---|---|---|
| [Evil0ctal/Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API) | 2025-10-12 | Apache-2.0 | 抖音/TikTok/Bilibili API 和链接解析；依赖 X-Bogus/A-Bogus；README 要求浏览器 Cookie，Demo 不保证可用 | 适合已知 URL `video_detail` 隔离 POC；不直接承诺搜索 |
| [JoeanAmier/TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader) | 2026-07-14 | GPL-3.0（文件名为小写 `license`） | 抖音搜索、热榜、账号、作品、评论等；README 明确加密参数算法已过期且不再维护 | 功能表不能视为当前可用；不作默认 Adapter |
| lux | 2025-12-29 | MIT | 抖音、快手、微博已知 URL 提取 | 可做 metadata-only 对照 |
| NewsNow / DailyHotApi | 2026-06 / 2026-03 | MIT | 抖音/快手热榜 | `hotlist_fetch` 低风险首选 |
| MediaCrawler | 2026-07-10 | 非商业学习许可 | 抖音、快手搜索/帖子/作者/评论 | 参考，不默认集成 |

推荐先接热榜，再做已知 URL 视频详情。关键词搜索最后做人工 Profile 小样本，不把已失效的签名算法补全工作当成默认数据源能力。

### 3.8 贴吧

| 仓库 | 最近提交 | License | 实际范围 | 判断 |
|---|---|---|---|---|
| [lumina37/aiotieba](https://github.com/lumina37/aiotieba) / 旧路径 `Starry-OvO/aiotieba` | 2026-06-24 | Unlicense / public domain | 异步贴吧客户端，数十个常用 API | 最适合做按需只读 `forum_threads/post_detail` POC |
| [TiebaMeow/TiebaScraper](https://github.com/TiebaMeow/TiebaScraper) | 2026-03-23 | MIT | 指定贴吧实时监控、历史回溯、PostgreSQL/Redis、WebSocket | 工程完整，但偏持续监控，不是当前默认运行模型 |
| NewsNow / DailyHotApi | 2026-06 / 2026-03 | MIT | 贴吧热榜/热议榜 | `hotlist_fetch` |
| MediaCrawler | 2026-07-10 | 非商业学习许可 | 贴吧关键词、帖子、作者、评论 | 参考 |

实施结果（2026-07-16）：Gateway `0.9.0` 已用 PyPI 稳定版 aiotieba 4.7.1 建成匿名只读薄 Adapter。`python吧` 主题列表真实得到 10 条；从中选择两个不同公开 tid，帖子详情分别得到 6 条与 2 条。完整返回转成约 23 KB、9.8 KB、3.5 KB 的本地 raw JSON，数据库不变。正式白名单仅有 `get_threads/get_posts`，不传 BDUSS/STOKEN，`get_posts` 固定不请求楼中楼；aiotieba 包内其他写操作对 Gateway 不可达。TiebaScraper 留作未来明确需要长期指定吧监控时再评估。

### 3.9 新闻、热点与公共站点

| 仓库 | 最近提交 | License | 本轮代码证据 | 判断 |
|---|---|---|---|---|
| [ourongxing/newsnow](https://github.com/ourongxing/newsnow) | 2026-06-30 | MIT | `server/sources` 当前实际 44 个模块：B站、抖音、快手、微博、知乎、贴吧、36氪、澎湃、腾讯、今日头条等 | `hotlist_fetch` 首选数据源 |
| [imsyy/DailyHotApi](https://github.com/imsyy/DailyHotApi) | 2026-03-11 | MIT | 源码实际 56 个 route 文件，覆盖 B站、微博、知乎、抖音、快手、贴吧及大量新闻路线 | 结构简单，适合作为 NewsNow 对照与候选 fallback；在线实例未实测 |
| [sansan0/TrendRadar](https://github.com/sansan0/TrendRadar) | 2026-07-08 | GPL-3.0 | README 明确使用 NewsNow API，并增加关键词、排名时间线、AI 分析和推送 | 属于监控/分析上层，不作为 Gateway 原始数据源依赖 |

NewsNow 当前 44 个源文件：

```text
36kr, baidu, bilibili, douban, douyin, github, hackernews,
ithome, juejin, kuaishou, linuxdo, producthunt, sspai,
thepaper, tieba, toutiao, v2ex, weibo, xueqiu, zhihu ...
```

它提供的是热榜或最新内容，不是任意关键词搜索。接入时应新增 `hotlist_fetch`，不能伪装成 `keyword_search`。

#### NewsNow 接入级契约

本轮直接核验了 `server/api/s/index.ts`、`shared/types.ts` 和 B站源实现。单源接口是：

```http
GET /api/s?id=<source-id>
GET /api/s?id=<source-id>&latest=true
```

正常响应为：

```json
{
  "status": "success | cache",
  "id": "bilibili-hot-video",
  "updatedTime": 1234567890,
  "items": [],
  "info": {
    "LICENCE": "MIT",
    "Github": "https://github.com/ourongxing/newsnow"
  }
}
```

每次 getter 最多保留 30 条。代码会先考虑每个源的 `interval`，再考虑全局 TTL；请求新数据失败但仍有旧缓存时，返回 `status=cache` 和旧 `updatedTime`，无缓存才返回 HTTP 500。`latest=true` 不是无条件强制刷新，还会受源刷新间隔、服务器登录开关和当前用户状态影响。

同一平台可能有多个完全不同的榜单。B站当前就有：

```text
bilibili             -> 热搜词（重定向语义）
bilibili-hot-search  -> 热搜词
bilibili-hot-video   -> 热门视频
bilibili-ranking     -> 排行视频
```

所以不能只用 `platform=bilibili`。`feed_id` 必须保留 NewsNow 的真实 source id，否则会把热搜词、热门视频和排行视频混在一起。

#### DailyHotApi 接入级契约

本轮浅克隆并直接读取了 2026-03-11 默认分支。当前实际有 56 个 `src/routes/*.ts` 路由文件，根路由为：

```http
GET /all
GET /<route-id>
GET /<route-id>?limit=20
GET /<route-id>?cache=false
GET /<route-id>?rss=true
```

部分路由还有 `type`、`range`、`game`、`province` 等源特有参数。JSON 响应的公共形状为：

```json
{
  "code": 200,
  "name": "bilibili",
  "title": "哔哩哔哩",
  "type": "热榜 · 全站",
  "description": "...",
  "link": "https://www.bilibili.com/v/popular/rank/all",
  "total": 20,
  "updateTime": "2026-07-16T00:00:00.000Z",
  "fromCache": true,
  "data": [
    {
      "id": "BV...",
      "title": "...",
      "cover": "...",
      "author": "...",
      "desc": "...",
      "hot": 123,
      "timestamp": 1234567890000,
      "url": "...",
      "mobileUrl": "..."
    }
  ]
}
```

缓存默认 TTL 为 3600 秒，先尝试 Redis，不可用则使用进程内 NodeCache；`?cache=false` 是删除当前 URL 缓存后重新请求。与 NewsNow 不同，DailyHotApi 没有“刷新失败时回退过期缓存”的明确实现：上游或解析失败会进入全局 500，而默认错误体是 HTML 页，不是稳定 JSON 错误契约。

还需注意：底层缓存 key 主要使用上游 URL，不是 Gateway 请求的完整语义；B站主接口调用在源码中固定了 `noCache=false`，因此 Gateway 不应把 `cache=false` 解释为所有路由都严格强制最新。

DailyHotApi 的公开演示域名 `api-hot.imsyy.top` 在当前调研网络中无法解析，所以本轮结论是“源码契约已核验，在线实例未实测”，不将它 promote 为当前可用 Capability。

#### Gateway 的热榜动作

建议新增的输入只固定调用语义，不试图统一所有内容字段：

```yaml
action: hotlist_fetch
input:
  platform: bilibili
  feed_id: bilibili-hot-video
  limit: 20
  force_latest: false
```

执行后优先保存：

```text
artifact manifest
  platform / action / feed_id
  provider / capability_id
  requested_at / fetched_at
  provider_status / from_cache / upstream_updated_at
  source_url / raw_file / sha256
  attempted_capabilities / degraded / warnings

raw payload
  NewsNow 或 DailyHotApi 的完整原始 JSON
```

Gateway 可以当次临时提取 `rank/title/url/external_id` 便于显示和引用，但这不是要求把 `HotlistItem` 的每个可能字段入库。作者、热度、图片、摘要和平台特有指标保留在 raw payload 中，以后由 AI 按需读取。

2026-07-16 后续实施状态：Gateway `0.7.0` 已按上述契约实现 NewsNow Connector 和 raw artifact。自托管真实样本中，B站三个 feed、微博、知乎、快手、贴吧、36氪和澎湃通过；抖音返回 NewsNow HTTP 500，仍为 `declared_unverified`。所有成功与失败响应都尽可能保留原始文件，调用前后情报数据库不变。

### 3.10 通用网页抽取

| 仓库 | 最近提交 | License | 适合范围 | 边界 |
|---|---|---|---|---|
| 当前 Trafilatura | 当前已集成 | Apache-2.0 | 公共 HTML 长文 direct first | 不执行 JS |
| [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) | 2026-07-15 | Apache-2.0 | JS 页面、结构化/Markdown、会话与安全加固 Docker API | 可作为下一种通用公开 JS 详情候选，但不能替代平台搜索 |
| [D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling) | 2026-07-15 | BSD-3-Clause | 动态 Fetcher、自适应 selector、Spider | README 宣称绕过 Turnstile/反机器人；若评估只能使用公开读取和解析能力，禁用绕过路径 |
| [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) | 2026-07-16 | AGPL-3.0 | search/scrape/crawl/交互、Markdown/JSON | 自托管依赖和 AGPL 成本较高；不优先于现有 Trafilatura + Browser recipe |

通用工具解决“如何读取普通网页”，不能创造公众号全局搜索、小红书站内索引或抖音签名能力。

## 4. 按平台推荐矩阵

| 平台 | 关键词搜索 | 热榜 | 指定账号/清单 | 已知 URL 详情 | 当前推荐 |
|---|---|---|---|---|---|
| B站 | Maxun | NewsNow | 后续公开页面/专用 Adapter | yt-dlp 主、lux 对照 | 先做 `video_detail` |
| 小红书 | BrowserWing 人工 Profile | 暂不优先 | xhs 只读 POC | BrowserWing vs xhs | 先做详情对照，不开放写操作 |
| 公众号 | SearXNG/Bing/搜狗外部发现 | 无可信全局热榜 | WeRSS 或 WeWe RSS 二选一 | Trafilatura/Browser detail | 先测已知文章和已知公众号，不宣称全局搜索 |
| 知乎 | 外部 `site:` 发现 | NewsNow | 暂无推荐独立仓库 | Browser detail；以后 `qa_detail` | 保持当前组合 |
| 微博 | BrowserWing 已验证已知 UID 首个公开渲染页；不等于全局搜索 | NewsNow | 自有只读 Adapter；dataabc 参考 | 通用/专用详情 | 热搜与已知账号首页已分成独立 Capability，账号历史仍待审计 |
| 抖音 | 暂无正式能力 | NewsNow | 后续人工 Profile | Evil0ctal/lux 隔离 POC | 先热榜和已知 URL |
| 快手 | 暂无正式能力 | NewsNow | 后续人工 Profile | lux 对照 | 先热榜 |
| 贴吧 | aiotieba `forum_threads` 已验证 | NewsNow | aiotieba 指定吧 | aiotieba `post_detail` 已验证 | 匿名、只读、raw-first；不开放整包 API |
| 新闻/政务 | SearXNG + Bing/搜狗 | NewsNow | 站点清单 | Trafilatura direct first | 当前最成熟 |

## 5. 推荐接入批次

### 批次 A：低风险、高复用

1. **NewsNow `hotlist_fetch` Adapter**
   - 理由：MIT、44 个实际源模块、覆盖多个当前缺口平台；
   - 只做按需调用，不默认启用持续调度；
   - 使用 `platform + feed_id` 识别榜单，不把一个平台的多个榜单混成一个开关；
   - 完整保存原始 JSON 和最小 manifest，当次只提取排名、标题、URL 等必需预览字段；
   - 对每个 feed 固定样本验证 URL 域名、空结果、`success/cache` 和上游失败语义；
   - DailyHotApi 先只做对照和备选 provider，在本地实例通过固定样本前不自动进入 fallback 链。

2. **B站 `video_detail`：yt-dlp metadata-only**
   - 使用 `--dump-single-json --skip-download`；
   - 不默认下载视频，不接受付费/会员内容；
   - 与 lux `-j` 对同一公开视频做字段和成功率对照。

3. **贴吧 aiotieba 只读 Adapter**
   - 只允许获取吧首页主题、指定主题和回复；
   - 不开放登录写操作、发帖、回复或吧务；
   - 先用一个公开贴吧和两个主题做小样本。

### 批次 B：平台认证和详情

4. **小红书 post detail 对照**
   - BrowserWing 页面详情与 `xhs.get_note_by_id` 对照；
   - xsec token 只作为短期执行输入，不进入文档库；
   - 只选公开笔记，不测试评论写入或账号交互。

5. **公众号已知公开文章与账号历史分离**
   - 公开 `mp.weixin.qq.com/s/...` 文章已由 Gateway 专用 Adapter 匿名读取并 raw-first 保存；
   - WeRSS 与 WeWe RSS 经 Issue 和凭证链审计均未通过，账号历史保持缺口；
   - 不把单篇公开文章能力扩写成订阅、账号历史或全公众号搜索。

### 批次 C：高风控平台

6. 微博 BrowserWing 搜索与指定账号只读 Adapter；
7. 抖音已知 URL 解析；
8. 快手已知 URL 解析；
9. 各平台关键词搜索只有在固定样本、人工认证边界和许可证都通过后才 promote。

## 6. 明确不选或暂缓

| 项目/路线 | 原因 |
|---|---|
| RSSHub | 用户已明确不走这条实施路线 |
| MediaCrawler 直接集成 | 非商业学习许可证，不是默认商业安全底座 |
| bilibili-api / bilibili-API-collect | README 明确永久关停，涉及非公开 API 和律师函 |
| TikTokDownloader 默认接入 | 加密参数算法已失效且不再维护；功能清单不等于当前可执行 |
| dataabc 代码直接复制 | 当前根目录未发现 License |
| Scrapling 的反机器人/Turnstile 绕过 | 超出当前公开、合规、只读边界 |
| TrendRadar 作为原始数据源 | 它消费 NewsNow 并提供分析/推送，应留在 Gateway 上层 |
| 任意仓库整包工具化 | 可能同时暴露点赞、评论、发布、下载、批量采集等越界动作 |

## 7. 对 DeepResearch 的意义

以后调研 DeerFlow、天工系 DeepResearch 时，不再问它们“支持不支持小红书/B站”。正确问题是：

1. 能否把 Gateway 的 `keyword_search/hotlist_fetch/account_feed/detail` 当作独立工具；
2. 能否保留 `attempted_capabilities`、`degraded`、`partial` 和来源 URL；
3. 能否在数据源失败时继续换源，而不是得出“网上没有信息”；
4. 能否让分析层完全不接触 Cookie、Token 和人工 Profile；
5. 能否把不同资源类型的证据分别引用，而不是把热榜、搜索、账号更新混成一个列表。

所以当前优先级仍然是：

```text
按平台选仓库
-> 做只读 Adapter
-> 固定样本真实验证
-> 统一 Capability
-> 再让 DeepResearch 做查询规划和分析
```

## 8. 主要资料

- [BrowserWing](https://github.com/browserwing/browserwing)
- [Maxun](https://github.com/getmaxun/maxun)
- [SearXNG](https://github.com/searxng/searxng)
- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)
- [xhs](https://github.com/ReaJason/xhs)
- [XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader)
- [WeRSS](https://github.com/rachelos/we-mp-rss)
- [WeWe RSS](https://github.com/cooderl/wewe-rss)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [lux](https://github.com/iawia002/lux)
- [weibo-crawler](https://github.com/dataabc/weibo-crawler)
- [weiboSpider](https://github.com/dataabc/weiboSpider)
- [Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)
- [TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader)
- [aiotieba](https://github.com/lumina37/aiotieba)
- [TiebaScraper](https://github.com/TiebaMeow/TiebaScraper)
- [NewsNow](https://github.com/ourongxing/newsnow)
- [DailyHotApi](https://github.com/imsyy/DailyHotApi)
- [TrendRadar](https://github.com/sansan0/TrendRadar)
- [Crawl4AI](https://github.com/unclecode/crawl4ai)
- [Scrapling](https://github.com/D4Vinci/Scrapling)
- [Firecrawl](https://github.com/firecrawl/firecrawl)
- [bilibili-api 关停声明](https://github.com/Nemo2011/bilibili-api)
- [bilibili-API-collect 关停声明](https://github.com/SocialSisterYi/bilibili-API-collect)
