# 常见网站开源采集项目扩展调研

> 调研日期：2026-07-15  
> 目标：回答“是否还有更多项目，可以把各种常见网站纳入个人情报系统”  
> 范围：本轮只做项目、站点和能力边界调研，不继续修改 Intelligence Gateway。

## 一句话结论

有，而且候选项目比当前网关接入的来源多得多；但没有一个严格开源、许可清晰、商业安全且能同时完成所有常见网站“关键词搜索、热门榜、作者主页、详情、评论、正文和媒体下载”的项目。

目前最有价值的三类大覆盖项目是：

1. **BrowserWing**：本地实际注册 86 个内置脚本，站点类型最广，但脚本存在不代表现在可用；
2. **DailyHotApi / NewsNow**：分别发现 56 个热榜路由文件和 46 个服务端数据源模块，适合快速扩大热点入口，不负责平台完整关键词搜索；
3. **MediaCrawler**：中文社媒深度最强，覆盖小红书、抖音、快手、B站、微博、贴吧、知乎的关键词、帖子、作者和评论，但许可证限定非商业学习，不能作为默认集成底座。

因此合理路线不是“换成另一个万能项目”，而是把能力拆成：

```text
热榜发现       -> DailyHotApi / NewsNow / BrowserWing 公开脚本
全网外部发现   -> SearXNG site: 查询
中文社媒深搜   -> 专用 Adapter；MediaCrawler 仅作非商业评估参照
登录浏览器流程 -> BrowserWing / Maxun / EasySpider
已知链接详情   -> 平台专用客户端 + Trafilatura
媒体文件增强   -> yt-dlp / lux / gallery-dl
运行与积累     -> Intelligence Gateway + documents/observations/search_runs
```

## 1. 先定义“支持一个网站”到底是什么意思

很多项目都宣称支持几十乃至上千网站，但实际支持的动作完全不同。如果不拆开，就会严重高估覆盖率。

| 能力 | 例子 | 对个人情报的价值 |
|---|---|---|
| 热榜 | 微博热搜、知乎热榜、B站热门 | 发现全网正在发生什么；不能搜索任意关键词 |
| 平台关键词搜索 | 在小红书、抖音、微博内部搜索“低空经济” | 最接近用户原始需求；登录、风控和维护成本最高 |
| 指定作者/账号 | 获取某个 UP 主、博主、公众号的更新 | 适合关注清单；不等于全平台搜索 |
| 指定帖子/详情 | 已知 URL 后抓正文、指标、评论 | 适合发现后的内容补全 |
| 评论/二级评论 | 帖子舆情和观点分析 | 数据量大、个人信息和合规风险更高 |
| 外部 `site:` 发现 | 搜索引擎查 `site:zhihu.com` | 覆盖面广、成本低，但不是平台完整索引 |
| 媒体下载 | 已知视频 URL 下载视频、音频或图片 | 适合证据归档；不能负责发现内容 |
| 通用浏览器录制 | 给任意网站录制点击、搜索和抽取 | 扩展长尾网站快；仍需逐站维护 |

本报告后续所有“支持”都尽量注明属于哪一种能力。

## 2. BrowserWing：本地实际有 86 个内置脚本

通过当前安装的 BrowserWing `1.1.1-beta.1` 直接执行：

```powershell
browserwing ls --builtin --format=json --limit=200
```

得到：

| 项目 | 数量 |
|---|---:|
| 内置脚本总数 | 86 |
| 标记需要登录 | 23 |
| 带查询参数 | 24 |
| 读取类脚本 | 83 |
| 发布/回复类脚本 | 3 |

这 86 个脚本不是 86 个独立网站，也不是 86 个全部可用的搜索接口；同一平台可能有 hot、search、user、note、publish 多个脚本。

### 2.1 社媒和内容社区

声明入口包括：

- 小红书：热门、搜索、用户主页、笔记详情、发布；
- 微博：热搜、关键词搜索；
- 知乎：热榜、关键词搜索、知乎日报；
- 抖音：热搜；
- 百度贴吧：热议；
- 即刻：热门；
- Twitter/X：趋势、搜索、用户、发帖和回复；
- TikTok：Explore；
- Reddit、Bluesky：热门内容。

阶段性实测必须与声明分开：

- B站热门、微博热搜、今日头条、36氪、知乎日报、贴吧和掘金等公开脚本曾取得结果；
- 知乎热榜匿名访问会进入登录页；
- BrowserWing 内置小红书搜索使用过期页面流程，最终是我们自己的状态化 Adapter 通过；
- `weixin-hot` 实际是微信读书飙升榜，不是公众号文章热榜。

所以 BrowserWing 的价值是“大量站点起点 + 快速修 Adapter”，不是 86 个生产级连接器。

### 2.2 新闻、政务和国际媒体

声明入口包括：

- 今日头条、36氪、新浪博客；
- 国务院政策、国家法律法规数据库；
- Reuters 搜索；
- BBC、Google News、Bloomberg 热门内容。

普通新闻正文仍适合交给当前 Trafilatura 抽取，而不是让每个热榜脚本重复实现正文清洗。

### 2.3 电商、旅行和房产

声明入口包括：

- 淘宝搜索、京东搜索、闲鱼热门；
- 什么值得买、Amazon Best Sellers；
- 携程目的地/酒店搜索；
- 贝壳二手房、Steam 热销榜。

淘宝、京东和闲鱼等强登录平台当前只能作为人工登录后的低频 POC 候选，不应直接进入无人值守任务。

### 2.4 学术

声明入口包括：

- 中国知网；
- 万方；
- 百度学术；
- Google Scholar；
- arXiv。

这组入口值得单独实测，因为学术搜索字段、验证码、机构权限和详情访问边界与社媒不同。对 arXiv、OpenAlex、Crossref 等存在正式公开 API 的来源，应优先使用官方接口。

### 2.5 金融、招聘和技术社区

金融入口包括雪球、东方财富、同花顺、通达信、新浪财经、Yahoo Finance、Barchart、Binance；招聘和职场包括脉脉、LinkedIn、Boss直聘、牛客；技术社区包括 GitHub、Gitee、V2EX、掘金、Linux.do、Stack Overflow、Hacker News、Product Hunt、Hugging Face、DEV.to 和 Lobsters。

金融数据不能因为页面可抓就自动视为可用于交易或再分发；招聘和职场站点包含更多个人信息，也应采用更严格的数据最小化策略。

## 3. 大覆盖项目对比

维护时间来自 2026-07-15 当天的 GitHub API、默认分支提交 feed 或仓库 HEAD；后续可能变化。

| 项目 | 当前可确认覆盖 | 主要能力 | 许可证 | 最近活动 | 判断 |
|---|---|---|---|---|---|
| [BrowserWing](https://github.com/browserwing/browserwing) | 86 个内置脚本，23 个需登录 | 热榜、部分搜索、用户、详情、浏览器录制、MCP | MIT | 2026-05-13 push | 适合站点探索和选择性固化，不能整包视为稳定连接器 |
| [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 小红书、抖音、快手、B站、微博、贴吧、知乎 | 关键词、指定帖子、作者主页、评论、登录缓存、代理 | 非商业学习许可证 1.1 | 2026-07-10 push | 中文社媒能力最接近需求，但不能进入默认商业安全底座 |
| [DailyHotApi](https://github.com/imsyy/DailyHotApi) | 实际发现 56 个 `src/routes/*.ts` | 热榜 JSON API | MIT | 2026-03-11 push | 最适合快速扩大热点入口 |
| [NewsNow](https://github.com/ourongxing/newsnow) | 实际发现 46 个 `server/sources` 模块 | 热点聚合、缓存、自定义数据源 | MIT | 2026-07-07 push | 热点覆盖广，架构比单脚本清晰；不是任意关键词搜索 |
| [TrendRadar](https://github.com/sansan0/TrendRadar) | 热榜 + 自定义订阅源 | 关键词筛选、AI筛选、趋势、报告、推送、MCP | GPL-3.0 | 2026-07-08 push | 更接近情报应用层；底层热榜主要依赖聚合源 |
| [EasySpider](https://github.com/NaiboWang/EasySpider) | 任意可操作网页，需自己设计任务 | 可视化爬虫和浏览器自动化 | AGPL-3.0 | 2026-07-03 push | 适合补长尾网站，不提供现成全平台搜索目录 |
| [Crawlab](https://github.com/crawlab-team/crawlab) | 与语言/框架无关 | 分布式任务管理和爬虫运维 | BSD-3-Clause | 2026-02-10 push | 是调度/管理层，不增加站点覆盖 |
| [DecryptLogin](https://github.com/CharlesPikachu/DecryptLogin) | 微博、知乎、B站、豆瓣、淘宝、京东、贴吧、公众号等登录模块 | 登录 session 和示例爬虫 | Apache-2.0 | 2024-08-09 push | 可参考登录抽象，但维护较旧，不应直接依赖旧登录协议 |

### 3.1 MediaCrawler 的真实覆盖深度

当前 README 的功能表对七个平台都标记支持：

- 关键词搜索；
- 指定帖子 ID；
- 二级评论；
- 指定创作者主页；
- 登录态缓存；
- IP 代理池；
- 评论词云。

技术上它是最接近“一个项目覆盖中文社媒深搜”的候选；许可上却是最需要谨慎的候选。其根目录 LICENSE 明确写明：

- 仅限非商业学习目的；
- 不得用于大规模爬取；
- 商业使用需要书面同意。

因此合理用途是：

```text
隔离环境做功能评估
阅读其平台抽象和字段设计
对比我们自己的 Adapter 覆盖
```

不合理用途是直接复制进默认开源/商业产品，再把它描述为普通 MIT/Apache 依赖。

### 3.2 DailyHotApi 的 56 个热榜入口

从当前 `src/routes` 实际发现 56 个路由，包括：

- 社媒/内容：B站、微博、知乎、抖音、快手、贴吧、豆瓣小组、AcFun；
- 新闻：36氪、网易新闻、腾讯新闻、新浪新闻、澎湃、纽约时报、今日头条；
- 科技：IT之家、少数派、爱范儿、极客公园、虎嗅、掘金、V2EX、Linux.do、CSDN、51CTO、HelloGitHub、GitHub、Hacker News、Product Hunt；
- 社区：虎扑、NGA、Hostloc、NodeSeek、52破解、水木社区、简书；
- 消费：什么值得买、酷安、数字尾巴、游戏葡萄；
- 其他：地震、天气预警、历史上的今天、微信读书等。

这是扩展热点入口的高性价比项目，但不应把 `/douyin` 热点榜误写为“抖音任意关键词搜索”。

### 3.3 NewsNow 的 46 个服务端来源模块

当前 `server/sources` 目录实际发现 46 个模块或模块目录，包括：

- 百度、B站、抖音、快手、微博、知乎、贴吧、今日头条；
- 36氪、澎湃、腾讯、凤凰、参考消息、联合早报；
- IT之家、少数派、掘金、Linux.do、V2EX、GitHub、Product Hunt、Hacker News；
- 雪球、华尔街见闻、金十、财联社、格隆汇；
- 虎扑、懂球帝、爱奇艺、腾讯视频、Steam、什么值得买等。

它与 DailyHotApi 有大量重叠。两者不需要一起全部接入；可以先根据字段质量、响应稳定性、许可证义务和维护成本选择一个作为热榜主源，另一个只做降级备份。

### 3.4 TrendRadar 的位置

TrendRadar 更像“在热点源之上工作的个人情报产品”：

- 关键词和正则筛选；
- AI 兴趣过滤、翻译、分析简报；
- 跨平台趋势；
- 微信、飞书、钉钉、Telegram、邮件、ntfy、Bark、Slack 等推送；
- MCP 搜索和文章读取；
- 本地数据和报告。

它值得借鉴的是监控、筛选、报告和通知工作流，不是把它当作新的平台级搜索引擎。我们当前 Gateway 的 documents/observations/search_runs 已经覆盖了它一部分数据层思路，后续更适合参考其“任务和推送产品体验”。

## 4. 平台专用项目

### 4.1 小红书

| 项目 | 能力 | 许可证/维护 | 判断 |
|---|---|---|---|
| [XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) | 搜索结果作品/用户链接、账号作品、详情、媒体下载、API | GPL-3.0；2026-07-14 有提交 | 值得隔离 POC；依赖短期 `xsec_token`，与我们当前只存规范 ID 的策略不同 |
| [xhs](https://github.com/ReaJason/xhs) | Python 小红书客户端/数据提取 | MIT；2025-07-01 更新 | 可研究详情层和签名接口；页面/签名变化风险高 |
| MediaCrawler | 搜索、作者、帖子、评论 | 非商业学习许可 | 能力最完整，但许可阻止默认集成 |
| BrowserWing 自定义 Adapter | 人工登录后搜索首屏 | MIT；我们已实测 | 当前最可控，但详情和分页仍未通过 |

XHS-Downloader README 要求完整 URL 中携带 `xsec_token`。这意味着它更适合“短生命周期访问上下文中的详情增强”，不能把 token 混入长期文档 ID、公开日志或跨运行去重键。

### 4.2 抖音、TikTok 和快手

| 项目 | 能力 | 许可证/维护 | 判断 |
|---|---|---|---|
| [TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader) | 抖音搜索、热榜、账号、作品、评论、直播；TikTok 账号和媒体 | GPL-3.0；2026-07-14 更新 | 功能丰富，但 README 明确写明加密参数算法已经失效且不再维护，不能视为开箱即用 |
| [Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API) | 抖音/TikTok API、详情和下载；仓库描述还提到快手/B站 | Apache-2.0；2025-10-12 push | 适合已知链接解析和详情 POC；仍要实测每个平台当前端点 |
| MediaCrawler | 抖音、快手关键词/帖子/作者/评论 | 非商业学习许可 | 深度最好，但仅作评估参照 |
| BrowserWing | 抖音热搜、TikTok Explore | MIT | 主要是热榜，尚未证明抖音关键词搜索 |

TikTokDownloader 的案例特别说明：仓库最近仍有提交，不代表核心逆向算法仍然可用。维护活跃度和关键平台能力必须分开检查。

### 4.3 微博

| 项目 | 能力 | 许可证/维护 | 判断 |
|---|---|---|---|
| [weiboSpider](https://github.com/dataabc/weiboSpider) | 一个或多个指定用户、微博内容、图片、视频、定时采集 | 根目录未发现许可证；2026-02-04 更新 | 适合指定账号跟踪，不是全平台关键词搜索；无许可证时不能默认复制/分发 |
| MediaCrawler | 搜索、帖子、作者、评论 | 非商业学习许可 | 功能强但许可受限 |
| BrowserWing | 热搜和登录后搜索 | MIT | 热搜已实测；关键词搜索仍需单独验证 |
| NewsNow / DailyHotApi | 微博热搜 | MIT | 适合热点，不负责全文搜索 |

### 4.4 B站

B站应继续采用公开页面、Maxun 或 BrowserWing 的低频流程，不建议重新依赖非公开 API 逆向仓库。

两个高关注项目已经明确关停：

- [Nemo2011/bilibili-api](https://github.com/Nemo2011/bilibili-api)：README 表示因非公开接口、认证和访问控制逆向风险停止维护并永久关停；
- [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)：2026-01 收到律师函后停止维护并删除文档和源码。

它们不能进入新的实现候选清单。当前 Maxun B站 Robot 虽然速度约 10–13 秒，但走公开搜索页面、字段和错误边界更容易审计。

### 4.5 公众号

目前仍没有发现一个许可清晰、稳定维护、可以完整执行“全公众号关键词搜索 + 历史文章回溯 + 正文”的开源项目。

可以组合的只有：

- SearXNG `site:mp.weixin.qq.com`：外部发现；
- 已知公众号清单：定向跟踪；
- BrowserWing：页面和人工登录流程 POC；
- DecryptLogin：旧的公众号登录模块参考；
- Trafilatura/浏览器：对已发现 URL 尝试正文补全。

我们已实测外部搜索可以发现公众号链接，但部分 URL 只返回微信公众平台壳页。因此公众号依然是当前覆盖矩阵中最明显的缺口。

## 5. 已知 URL 的媒体和证据增强项目

这些项目支持很多网站，但不应被列入“平台搜索”能力。

| 项目 | 覆盖 | 许可证 | 最近活动 | 正确位置 |
|---|---|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | README 称支持数千网站 | Unlicense | 2026-07-14 更新 | 已知音视频 URL 的元数据和媒体归档 |
| [lux](https://github.com/iawia002/lux) | YouTube、B站等多视频站 | MIT | 2025-12-29 更新 | 简单视频详情和下载补充 |
| [gallery-dl](https://github.com/mikf/gallery-dl) | 大量图片、图库和社媒站点 | GPL-2.0 | 2026-07-11 更新 | 图片证据归档和媒体补全 |

在个人情报系统中，它们适合放在发现之后：

```text
搜索/热榜发现 URL
        ↓
先保存规范文档和 observation
        ↓
按规则选择是否归档媒体
```

不能反过来把媒体下载器当作搜索发现层。

## 6. 常见网站覆盖矩阵

符号：`已验证` 表示本工作区跑过代表性流程；`可评估` 表示有当前项目声明或代码入口但尚未通过本地连续实测；`热榜` 表示只有热门入口；`外部` 表示搜索引擎 `site:` 发现。

| 网站/领域 | 关键词发现 | 热榜 | 作者/详情/评论 | 当前建议 |
|---|---|---|---|---|
| B站 | Maxun 已验证；BrowserWing 自定义搜索已验证 | BrowserWing、NewsNow、DailyHotApi | MediaCrawler 可评估；yt-dlp/lux 只做已知 URL | 保持当前 Maxun，热榜加 MIT 聚合源 |
| 小红书 | BrowserWing 已验证；XHS-Downloader/MediaCrawler 可评估 | BrowserWing 声明 | XHS-Downloader、xhs、MediaCrawler | 继续人工登录低频 Adapter；详情单独 POC |
| 抖音 | MediaCrawler/TikTokDownloader 可评估 | BrowserWing、NewsNow、DailyHotApi | TikTokDownloader、Douyin API | 先接热榜；关键词搜索必须隔离实测 |
| 快手 | MediaCrawler 可评估 | NewsNow、DailyHotApi | MediaCrawler、Douyin API 声明 | 先热榜，深搜后置 |
| 微博 | BrowserWing 登录搜索待测；MediaCrawler 可评估 | BrowserWing 已验证；两类 MIT 聚合源 | weiboSpider 指定用户；MediaCrawler 评论 | 热搜先接，账号清单其次，关键词搜索单测 |
| 知乎 | SearXNG 外部已验证；BrowserWing/MediaCrawler 可评估 | DailyHotApi/NewsNow；BrowserWing 匿名受登录影响 | MediaCrawler | 先外部发现，后做登录站内搜索对比 |
| 贴吧 | MediaCrawler 可评估 | BrowserWing 已验证；两个聚合源 | MediaCrawler | 热榜先接，搜索按需求补 |
| 公众号 | SearXNG 外部部分通过 | 无可信全局热榜 | 已知 URL 正文不稳定 | 单独小样本，不宣称全局搜索 |
| 今日头条 | 外部；专用搜索未验证 | BrowserWing 已验证；两个聚合源 | 通用正文抽取 | 热榜可直接扩展 |
| 36氪/澎湃/IT之家/虎嗅/少数派 | SearXNG 外部 | NewsNow/DailyHotApi；36氪 BrowserWing 已验证 | Trafilatura | 高优先、低登录风险 |
| GitHub/Gitee | GitHub BrowserWing 搜索；官方 API 更优 | BrowserWing/NewsNow/DailyHotApi | 官方 API | 优先官方 API，而不是浏览器 DOM |
| V2EX/掘金/Linux.do/HN/Product Hunt | 外部；部分 BrowserWing 脚本 | 三类热榜项目 | Trafilatura | 适合第二批公开站点 |
| CNKI/万方/百度学术/Google Scholar | BrowserWing 声明搜索 | 不适用 | 详情受权限/验证码影响 | 单列学术 POC，不与普通新闻混测 |
| 淘宝/京东/闲鱼 | BrowserWing 声明登录搜索/热门 | 部分热门 | 商品详情需登录和风控 | 低频人工 POC，不进入默认监控 |
| 雪球/东方财富/同花顺 | 外部；BrowserWing 声明 | BrowserWing/NewsNow | 金融数据边界需另评估 | 只做信息观察，不承诺行情正确性 |
| Twitter/Reddit/TikTok/YouTube | BrowserWing 部分声明；外部搜索 | BrowserWing 声明 | yt-dlp/gallery-dl 详情媒体 | 取决于当前网络和登录条件 |

## 7. 哪些项目值得进入下一轮

### A 级：优先做本地实测

1. **DailyHotApi**

   原因：MIT、56 个清晰热榜路由、JSON API 形式、与当前 Gateway 最容易集成。先挑 10 个中文公共入口，不需要整包接入。

2. **NewsNow**

   原因：MIT、46 个服务端来源模块、缓存和数据源架构清晰。与 DailyHotApi 做同关键词/同时间对比后，只选一个作为主热榜源。

3. **BrowserWing 尚未验证的公开脚本**

   优先：国务院政策、法律法规、豆瓣搜索、虎扑、V2EX、GitHub 搜索、CNKI、万方、雪球/东方财富只读榜单。每个先跑 1 次检查字段，再连续 3 次。

4. **yt-dlp**

   只作为 B站、YouTube 等已知 URL 的媒体和元数据增强，不承担关键词搜索。

### B 级：隔离环境评估，不默认集成

1. MediaCrawler：能力基准和 Adapter 设计参考；许可受限；
2. XHS-Downloader：小红书搜索结果和详情补全；注意 token 生命周期；
3. TikTokDownloader：抖音搜索能力对照；核心加密算法已失效；
4. Douyin_TikTok_Download_API：已知链接详情和 API 形式；逐端点验证；
5. weiboSpider：指定账号清单监控；无明确根许可证；
6. DecryptLogin：登录抽象参考；维护时间较旧。

### C 级：不进入候选实现

1. 已永久关停的 B站非公开 API 逆向项目；
2. 要求绕过验证码、签名、访问控制或付费内容保护的方案；
3. 没有许可证却需要复制代码进入产品的仓库；
4. 只提供云端收费 API、不开源核心实现的服务；
5. 把热榜或下载器包装成“全平台关键词搜索”的项目。

## 8. 建议的连接器目录模型

后续不要只保存：

```text
platform = xiaohongshu
supported = true
```

而应保存能力级状态：

```json
{
  "platform": "xiaohongshu",
  "capabilities": {
    "keyword_search": "verified",
    "hotlist": "declared_unverified",
    "user_feed": "candidate",
    "detail": "blocked",
    "comments": "not_tested",
    "media_archive": "candidate"
  },
  "authentication": "manual_persistent_profile",
  "query_scope": "first_rendered_page",
  "license_status": "connector_code_mit",
  "last_verified_at": "2026-07-15",
  "adapter_version": "browserwing-xhs-search-v1"
}
```

每个能力还应有以下状态之一：

- `declared_unverified`：仓库或内置脚本声称支持；
- `verified`：本地真实跑通；
- `degraded`：部分字段或成功率不稳定；
- `authentication_required`：需要人工登录；
- `blocked`：当前流程明确失败；
- `retired`：项目关停或风险不可接受。

这能避免出现“平台显示支持，实际上只有一个过期热榜脚本”的问题。

## 9. 推荐的下一批实测清单

如果后续决定继续，建议只做一个小而可验证的批次。

### 批次一：公共热榜与新闻，低风险

从 DailyHotApi 和 NewsNow 各选同样的 10 个来源：

```text
微博
知乎
B站
抖音
快手
今日头条
36氪
澎湃
IT之家
少数派
```

验收：连续 3 次、结果数、规范 URL、发布时间、热度字段、重复率、耗时、限流和失败语义。最后只保留一个主源，另一个降级备用。

### 批次二：BrowserWing 公共长尾站点

```text
国务院政策
国家法律法规
豆瓣电影搜索
虎扑热帖
V2EX
GitHub 搜索
CNKI
万方
东方财富
雪球
```

每个先跑一次，不登录的失败直接记录为 `authentication_required` 或 `blocked`，不现场尝试绕过。

### 批次三：强登录平台，只做比较实验

```text
微博关键词搜索
知乎站内搜索
抖音关键词搜索
小红书详情
淘宝/京东搜索
```

每个平台只使用人工登录的隔离 Profile，控制频率，不测试发布、评论、关注等写操作。

## 10. 最终判断

“把各种常见网站都支持”是可行的，但应把目标理解为：

```text
建立一个可以持续扩展和验证的站点能力目录
```

而不是：

```text
找到一个仓库，安装后所有网站、所有动作永远可用
```

当前最合理的扩展组合是：

- DailyHotApi 或 NewsNow：扩大热榜覆盖；
- SearXNG：扩大任意域名外部发现；
- BrowserWing：补公共长尾和人工登录流程；
- 当前 Maxun：保留已经验证的 B站公开搜索；
- Trafilatura：统一公开文章正文；
- yt-dlp：按需归档已知媒体 URL；
- Intelligence Gateway：统一能力状态、文档、observation 和运行历史。

MediaCrawler 可以作为中文社媒能力上限的对照组，但除非取得适当授权，不应进入默认实现。

## 11. 后续方向调整：按需能力优先

本报告原本把下一批实测重点放在公共热榜来源，但当前产品目标已经进一步收敛：不优先持续收集数据，而是优先建立“需要时可以自动调用”的能力运行时。

因此 DailyHotApi、NewsNow 和大量 BrowserWing 脚本暂时保持候选状态，不整包接入。新增站点时先注册能力级 Manifest，至少说明：

- `platform + action`；
- 输入和输出 Schema；
- 登录/Profile 模式；
- check、execute、verify；
- 首选执行器和 fallback；
- `verified / degraded / blocked / retired` 状态；
- 最近一次真实验证证据；
- 是否允许结果持久化。

现有 `0.3.0` Capability Runtime 已经证明这种方向可行：同一个通用任务接口既能直接调用 B站 Maxun，也能在知乎没有站内 Adapter 时明确降级为外部 `site:` 发现，并支持临时执行不落库。

## 12. 2026-07-16 实施结果：从目录走向能力工厂

后续实现已经把 Runtime 升级到 `0.4.0`，并完成“公开未知网站 -> Draft -> inspect -> 样本 validate -> recipe -> promote -> execute”的真实闭环。百度样本自动生成 `baidu.keyword_search.browserwing_recipe.v1`；验证词“个人知识库”得到 9 条有效结果，晋升后用另一查询“开源情报工具”返回 5 条，未降级、未落库。

这次结果改变了常见网站扩展方式：不再先把几十个站点都写成“已支持”，而是维护两类资产。

- 稳定的正式 Capability：经过真实样本验证，带版本、范围、警告和回归输入；
- 尚未通过的 Draft：可以 inspect 和失败，但不能被 Task Planner 当作正式能力。

下一轮应选取结构差异明显的公开站点做横向回归，例如一个普通新闻站搜索、一个文档/社区站搜索、一个采用客户端渲染的站点搜索。只有 recipe 在新查询下仍能提取相关标题与 URL，才晋升；出现登录或验证码门禁时停止自动化并转人工/专用 Adapter。RSSHub 不进入这条实施路线。

## 13. 2026-07-16 多站点 Draft 回归结果

第一批横向回归已完成：Bing 中文搜索、搜狗和 CSDN 均通过样本验证，并在晋升后用不同关键词再次执行成功。结果分别为 Bing 7/5 条、搜狗 10/5 条、CSDN 10/5 条；三者使用 `persistence=none`，未改变情报库。

这轮比“又支持三个网站”更重要的结果是形成了两个通用规则：

1. 官方入口发生跨子域重定向时，以导航后重新通过公共 DNS/IP 检查的主机作为 recipe 边界；
2. 搜索提交优先选择包含搜索输入的同一 form，并对语音、图片、反馈、设置和下载类按钮降权，防止误点辅助控件。

Bing 第一轮误点语音搜索后停留在首页，相关性门禁正确将其判为 failed；修复通用规则后才重新验证和晋升。这证明 Draft 的失败状态本身也是有价值的能力证据。

## 14. 2026-07-16 搜索与详情组合结果

Gateway `0.5.0` 已把 Trafilatura 公开正文读取注册为 `web.detail_fetch.trafilatura.v1`，并用组合任务串联生成搜索能力。Bing 的三个搜索结果全部得到正文；CSDN 的两个结果一成一败，源站 HTTP 521 被保留为逐条错误，成功正文不受影响。

因此常见网站能力矩阵应继续区分“能发现链接”和“能读取详情”。公开 HTML 可以共享安全正文能力；脚本渲染、登录墙和平台详情接口不能因为搜索成功就自动标记为详情成功。

## 15. 2026-07-16 浏览器渲染详情真实结果

Gateway `0.6.0` 已把“脚本渲染详情”实现为受控的第二层能力，而不是通用浏览器兜底：

```text
Trafilatura public HTML first
  -> 失败后，仅查找 requested platform 下已验证且 host 匹配的 BrowserWing detail recipe
  -> 没有 recipe、主机不匹配、认证门禁或安全错误时停止
```

知乎专栏提供了真实 Tier 2 证据：Trafilatura 对公开专栏返回 HTTP 403，`zhihu.detail_fetch.browserwing_recipe.v1` 随后读取 3,358 字精确正文；同一 recipe 又读取另一篇非样本文章 1,916 字。候选评分会惩罚包含多个主标题或多篇嵌套文章的聚合区，避免把推荐文章当正文。知乎首页虽然出现在搜索结果中，但因为不属于 recipe 的 `zhuanlan.zhihu.com` 主机边界，没有启动 BrowserWing。中国政府网页面则同时验证了两层能力，但默认任务仍只使用成功的 Trafilatura，没有因为 BrowserWing recipe 存在而增加成本。

这进一步修正常见网站“支持矩阵”的写法：至少要分别记录 `keyword_search`、`detail_fetch/public_html`、`detail_fetch/public_browser` 和 `authenticated_profile`，不能用一个“支持”勾选框覆盖四种完全不同的真实性与风险。CSDN 搜索 recipe 已通过，但详情 BrowserWing 导航出现 `ERR_SSL_PROTOCOL_ERROR`，所以 CSDN 详情仍不能据搜索能力推断为可用。

## 主要项目资料

- [BrowserWing](https://github.com/browserwing/browserwing)
- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)
- [DailyHotApi](https://github.com/imsyy/DailyHotApi)
- [NewsNow](https://github.com/ourongxing/newsnow)
- [TrendRadar](https://github.com/sansan0/TrendRadar)
- [EasySpider](https://github.com/NaiboWang/EasySpider)
- [Crawlab](https://github.com/crawlab-team/crawlab)
- [DecryptLogin](https://github.com/CharlesPikachu/DecryptLogin)
- [XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader)
- [xhs](https://github.com/ReaJason/xhs)
- [TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader)
- [Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)
- [weiboSpider](https://github.com/dataabc/weiboSpider)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [lux](https://github.com/iawia002/lux)
- [gallery-dl](https://github.com/mikf/gallery-dl)
- [bilibili-api 关停声明](https://github.com/Nemo2011/bilibili-api)
- [bilibili-API-collect 关停声明](https://github.com/SocialSisterYi/bilibili-API-collect)
