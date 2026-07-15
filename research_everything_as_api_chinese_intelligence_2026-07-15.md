# “万物皆接口”开源项目调研：面向中文互联网信息收集

> 调研日期：2026-07-15  
> 关注范围：微信公众号、小红书、知乎、B站、微博、抖音、快手、贴吧、今日头条、中文搜索引擎和新闻网站。  
> 结论中的“开源许可证”只描述软件代码的授权方式，不代表平台数据可被任意采集、存储或商业使用；平台条款、个人信息保护、著作权和数据安全仍需单独评估。

## 一句话结论

`CLI-Anything` 对“如何取得中文社媒数据”帮助有限，对“如何把已经取得的数据能力统一成 Agent 可调用、可测试、可组合的工具”帮助很大。

如果把“万物皆接口”理解为一个完整系统，那么它不是一个项目，而是五层能力：

1. **网页操作变接口**：BrowserWing、Maxun、EasySpider。
2. **网页网络流量变接口**：Reverse API Engineer。
3. **网页内容变结构化数据**：Firecrawl、Crawl4AI、Scrapling、Crawlee、ScrapeGraphAI。
4. **现有函数、脚本和工具变统一协议**：CLI-Anything、FastMCP、mcpo、Windmill。
5. **采集后的数据库变 REST、GraphQL 或 MCP**：PostgREST、Data API Builder。

对中文社媒而言，最现实的路线不是用某个通用 Agent 永久点击所有网页，而是：**先用浏览器 Agent/录制器探索和验证，再把成功流程固化成确定性平台 Adapter，最后用 CLI、MCP 或 HTTP 统一暴露。**

## 1. CLI-Anything 到底能解决什么

项目：[HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything)（Apache-2.0；截至调研日约 45.3k Star）

它的核心工作是分析一个已有软件、代码库、REST API、CLI 或本地文件格式，再生成：

- Python Click CLI；
- 一致的命令分组和结构化 JSON 输出；
- REPL、状态管理、undo/redo；
- 单元测试与端到端测试；
- 文档与供 Agent 发现的 `SKILL.md`；
- 可安装到 PATH 的工具包。

它适合 Blender、GIMP、LibreOffice、FreeCAD、QGIS、Zotero 这类已经有源码、后端能力或稳定数据格式的软件。

它不会自动解决：

- 小红书、抖音等平台的登录态和账号风险；
- 公众号全局关键词发现；
- 平台签名、验证码、频率限制和页面差异；
- 搜索结果是否完整、是否受个性化影响；
- 非公开接口的长期稳定性和合规性。

所以，对当前需求的准确定位是：

```text
CLI-Anything = 采集器之上的统一控制面
CLI-Anything ≠ 中文社媒数据采集器
```

如果已经有一批 Python 爬虫，它可以帮助把它们整理成一致的 `search`、`fetch`、`list-user-posts`、`health` 等命令，并强制 JSON Schema、错误码、测试和 Skill 文档；但如果底层适配器无法取到数据，CLI 化不会创造新的数据通路。

## 2. 最值得关注的新发现：BrowserWing

项目：[browserwing/browserwing](https://github.com/browserwing/browserwing)（MIT；截至调研日约 1.37k Star）

它是本轮中对中文区域最直接、也最容易做 POC 的项目。它同时提供：

- 浏览器控制 HTTP API；
- 可视化录制、编辑和重放；
- CLI、MCP、Skill 导出；
- Cookie、Storage 和登录会话管理；
- JSON、CSV、表格输出；
- 内置 AI Agent；
- 78 个内置脚本。

源码中已经注册的中文相关能力包括：

| 类型 | 已有脚本或能力 | 实际边界 |
|---|---|---|
| 热榜 | B站、知乎、微博、抖音、贴吧、小红书、今日头条、36氪、掘金等 | 多数只是当前热榜，不是全站搜索 |
| 平台搜索 | 微博搜索、知乎搜索、小红书搜索 | 依赖网页 DOM；微博和小红书标记需要登录 |
| 小红书详情 | 笔记详情、用户主页笔记列表 | 依赖页面状态和选择器，仍需登录 |
| 公众号 | `weixin-hot` | 实际访问微信读书飙升榜，不是公众号全局关键词搜索 |
| 其他中文搜索 | 京东、淘宝、闲鱼、脉脉、CNKI、万方、百度学术、政府政策/法规等 | 各脚本质量和登录条件不同 |

源码也显示了它目前不宜被高估：

- 小红书搜索只处理当前页面最多 20 条结果，没有稳定分页协议；
- 微博搜索最多 20 条，正文只保留前 200 字；
- 知乎搜索最多 20 条，摘录只保留前 150 字；
- 大量适配器直接依赖 CSS 选择器或页面内 JavaScript 状态，页面调整就可能失效；
- 公众号能力只是榜单入口；
- 项目的 MIT 许可证只解决代码复用，不解决目标平台许可。

因此，BrowserWing 的合理定位是：

- **非常适合**：个人低频查询、中文平台能力验证、录制流程、生成第一版适配器、Agent 的长尾任务；
- **有条件适合**：少量账号、低频定时监控；
- **不应直接承担**：大规模关键词扫库、强 SLA、长期无人维护的生产采集。

## 3. 与“网站皆接口”最接近的项目

### 3.1 Maxun：录制网站行为，发布结构化 REST API

项目：[getmaxun/maxun](https://github.com/getmaxun/maxun)（AGPL-3.0；约 16.5k Star）

Maxun 的口号就是 “Turn Any Website Into A Structured API”。它有四类 Robot：

- **Extract**：录制人工浏览行为，或用 LLM 描述需要的字段；
- **Scrape**：页面转 Markdown、HTML、截图；
- **Crawl**：整站发现和抓取；
- **Search**：执行搜索、按时间过滤并抓取结果。

它还提供登录、分页、滚动、调度、REST API、SDK、CLI 和 MCP。它比 CLI-Anything 更接近“没有现成 API 的网页也能被接口化”。

但 README 明确称项目仍处于 early stage。对小红书、公众号等强登录/强风控场景，录制器只是减少脚本开发成本，不能保证长期稳定，更不能保证平台搜索结果完整。适合先拿普通新闻网站、公告网站和一两个登录平台做 POC。

### 3.2 Reverse API Engineer：从 HAR 生成类型化客户端

项目：[Kalil0321/reverse-api-engineer](https://github.com/Kalil0321/reverse-api-engineer)（MIT；约 869 Star）

它的流程是：人工或 Agent 浏览网站，捕获网络流量到 HAR，再由 Claude 读取请求，生成 Python、JavaScript 或 TypeScript 客户端、README 和使用示例。它可以使用 Playwright MCP、真实 Chrome 会话或 `agent-browser`。

这条路线对“发现页面背后真实 JSON 请求”很有效，通常比长期解析 DOM 更干净。但生成的客户端可能只是对非公开接口的脆弱封装：Cookie、签名参数、接口版本、设备指纹和平台规则一变就会失效。尤其在中文社媒上，它应当被当作**适配器开发辅助工具**，而不是稳定 API 的来源。

### 3.3 Firecrawl：通用网页数据 API，云版与自托管版边界明显

项目：[firecrawl/firecrawl](https://github.com/firecrawl/firecrawl)（AGPL-3.0；约 151k Star）

能力包括 Search、Scrape、Interact、Agent、Crawl、Map、Batch Scrape，输出 Markdown、HTML、结构化 JSON 和截图，并提供 SDK、CLI、HTTP API、MCP。

它非常适合新闻网站、企业网站、文档站和 RAG 入库。不过官方 `SELF_HOST.md` 明确说明：自托管实例当前没有 Fire-engine，缺少处理 IP 封禁、机器人检测等高级能力；云端宣传的代理、限流和复杂页面能力不能自动等同于完全开源自托管能力。因此它对公开中文新闻网页价值高，对登录态中文社媒价值有限且更依赖托管服务。

### 3.4 Crawl4AI：可控、可自托管的通用抓取服务

项目：[unclecode/crawl4ai](https://github.com/unclecode/crawl4ai)（Apache-2.0；约 72.7k Star）

它支持 Markdown、CSS/XPath 结构化 JSON、浏览器会话、持久 Profile、Cookie、动态 JS、深度爬取、CLI，以及带 FastAPI 和 JWT 的 Docker 服务。相较 Firecrawl，它对自建和二次开发更友好，也没有 AGPL 的网络传播要求。

它仍然是通用抓取框架，不带完整的中文平台搜索连接器。适合新闻网站、公开详情页和将已知 URL 清洗成统一内容，不负责解决“去哪里发现全平台相关内容”。

### 3.5 Scrapling / Crawlee：把成功流程做成可靠爬虫

- [D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling)（BSD-3-Clause）：HTTP 与动态浏览器、Session、多会话、并发、断点续爬、持久队列、智能元素重定位、Docker 和 MCP。页面结构变化后的元素相似匹配很有价值。
- [apify/crawlee](https://github.com/apify/crawlee)（Apache-2.0）：HTTP/Playwright/Puppeteer 统一接口、持久队列、Dataset、Session、重试、存储和伸缩，是成熟的代码化爬虫底座。

这两类项目不负责“自动生成所有适配器”，但适合把 BrowserWing、Maxun 或 Agent 探索成功的流程重写为可测试、可重试、可持续运行的确定性任务。生产环境通常最终会回到这一层。

### 3.6 ScrapeGraphAI：用自然语言定义抽取目标

项目：[ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai)（MIT；约 28.4k Star）

开源版是自托管 Python 库，提供 SmartScraper、Search、ScriptCreator 等 LLM 图式管线；托管 API 另有 Crawl、Monitor、History 等更完整能力。它适合页面字段经常变化、结构不统一的内容抽取，但 LLM 抽取成本和不确定性较高，也不负责平台级数据发现、账号或风控。

## 4. 浏览器 Agent 项目：适合探索，不等于采集平台

| 项目 | 许可证 | 主要能力 | 对中文社媒的合理用途 |
|---|---|---|---|
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Apache-2.0 | 面向 Agent 的高速浏览器 CLI、可访问性快照、点击/输入/读取、会话 | 低频探索、人工登录后的任务执行、生成脚本前验证 |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | MIT | LLM 驱动浏览器 Agent、Python 库、CLI、真实浏览器 Profile | 长尾任务和探索；生产扩展、指纹和代理更多依赖其云服务 |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | 通过可访问性树把 Playwright 暴露为 MCP | Agent 探索、自愈测试；不提供中文平台连接器 |
| [browser-act/skills](https://github.com/browser-act/skills) | MIT | 多会话、多账号、人工接管、Agent CLI | 有人工兜底的低频自动化；需单独审查服务依赖和账号风险 |

Browser Agent 的共同问题是：

- 每一步都可能消耗模型推理和浏览器资源；
- 同一任务的动作路径不完全确定；
- 页面变化、弹窗、登录、验证码依然存在；
- 并发扩大后内存、会话和账号管理成本很高；
- 结果难以保证幂等、完整和可重放。

最优实践是“Agent 探索/录制一次，确定性程序运行很多次”，而不是每次采集都让 Agent 从头理解网页。

## 5. “已有能力变接口”的项目

这些项目不会替你拿到数据，但会让已经写好的适配器更容易被系统和 Agent 使用。

| 项目 | 输入 | 输出 | 适用位置 |
|---|---|---|---|
| CLI-Anything | 已有软件、源码、API、文件格式 | CLI、JSON、测试、Skill | 统一本地工具契约和 Agent 发现 |
| [FastMCP](https://github.com/jlowin/fastmcp) | Python 函数 | MCP Tool/Resource/Prompt | 将每个平台 Adapter 暴露给 Agent |
| [mcpo](https://github.com/open-webui/mcpo) | MCP Server | 带 OpenAPI Schema 的 HTTP 服务 | 让非 MCP 应用复用同一工具 |
| [Windmill](https://github.com/windmill-labs/windmill) | Python/TS/Go/Bash/SQL 等脚本 | Job、Webhook、HTTP Route、UI、Workflow | 适合把现有爬虫服务化、调度和人工运维 |
| [Activepieces](https://github.com/activepieces/activepieces) | TypeScript Piece、连接器 | 可视化工作流、MCP | 轻量业务编排；社区版 MIT，企业功能另有商业许可 |
| [Huginn](https://github.com/huginn/huginn) | Agent/Event | 事件图、定时器、Webhook、告警 | 个人自托管监控，理念很贴近个人情报 |
| [Kestra](https://github.com/kestra-io/kestra) | 脚本/API/容器任务 | 声明式调度、事件流、重试、回填 | 更严格的数据管道和生产调度 |
| [n8n](https://github.com/n8n-io/n8n) | 连接器和代码节点 | 可视化工作流 | 连接器丰富，但属于 fair-code/Sustainable Use License，不应称为严格开源 |

Windmill 需要特别留意许可证边界：源码主要为 AGPL-3.0，部分客户端和规范为 Apache-2.0；官方 Community Edition 二进制还混合了专有功能，并限制转售、托管服务和包装。组织内部直接使用通常没问题，产品化嵌入前需重新审查。

## 6. 数据库也可以“天然成为接口”

- [PostgREST](https://github.com/PostgREST/postgrest)（MIT）：把现有 PostgreSQL Schema 直接变成 REST API，并生成 OpenAPI 描述。
- [Azure Data API Builder](https://github.com/Azure/data-api-builder)（MIT）：从数据库生成 REST、GraphQL 和 MCP 端点，可运行在本地、任意云或容器中。

它们适合放在采集之后。所有平台 Adapter 先写入统一数据模型，再通过数据库层对外服务，比让上层系统直接理解十几种爬虫输出更稳定。

建议的最小统一数据契约至少包含：

```text
source_platform, source_type, source_id, canonical_url,
author_id, author_name, title, text, published_at, fetched_at,
keyword, query_scope, engagement, raw_payload, content_hash,
adapter_version, account_profile, evidence_snapshot
```

其中 `query_scope`、`adapter_version` 和 `evidence_snapshot` 很重要：中文平台的搜索结果常受登录账号、时间和个性化影响，不能把一次页面结果误称为“全平台结果”。

## 7. 按中文来源给出的现实判断

| 来源 | 最适合的发现方式 | 最适合的持续采集方式 | 通用接口化项目的帮助程度 |
|---|---|---|---|
| 公众号 | SearXNG/搜狗等外部搜索补漏；已知账号清单 | WeRSS / WeWe RSS / RSSHub 路由 | BrowserWing/Maxun 可做页面 POC；无法凭空实现全公众号搜索 |
| 小红书 | BrowserWing 或 MediaCrawler 做低频关键词 POC | 固化专用 Adapter；严格控制登录和频率 | BrowserWing 当前最直接；Maxun/RAE 可辅助开发，生产稳定性仍需自担 |
| 知乎 | 网站搜索、SearXNG、BrowserWing | RSSHub 已知问题/话题/用户 + 专用搜索 Adapter | 中等；网页搜索相对可做，但结果完整性仍有限 |
| B站 | 网站搜索、RSSHub `vsearch`、BrowserWing 探索 | RSSHub 订阅 + 专用 Adapter | 中等；近期非公开 API 项目停止维护事件说明逆向路线风险很高 |
| 微博 | BrowserWing/网站搜索、RSSHub keyword | 热搜/关键词低频监控 + 专用 Adapter | 中等；登录、搜索限制和页面变化是主要成本 |
| 抖音/快手 | 热榜和低频网页验证 | 合规的数据合作或专用 Adapter | 较低；通用 Agent 不能消除强风控和账号成本 |
| 搜索引擎 | SearXNG 聚合百度、搜狗、360、夸克、Bing | 定时 Query + 去重 | 高，但属于外部网页发现，不等于平台内部全量搜索 |
| 新闻/公告网站 | SearXNG、RSS、网站 Sitemap | Crawl4AI/Firecrawl/Crawlee/Scrapling + 正文抽取 | 高，是通用接口化方案最成熟的场景 |

此前候选中，[MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 仍是中文社媒关键词覆盖最接近需求的现成项目，覆盖小红书、抖音、快手、B站、微博、贴吧和知乎；但它使用非商业学习许可证，禁止商业用途和大规模采集，不能作为严格开源、商业安全的默认底座。

## 8. 推荐架构

```text
                         ┌─ RSSHub / WeRSS：已知账号、栏目、话题订阅
搜索发现 ─ SearXNG ──────┼─ NewsNow：热榜
                         └─ BrowserWing / Maxun：交互式搜索与长尾验证
                                      │
                                      ▼
                          浏览器录制 / HAR 分析 / Agent 探索
                                      │
                              成功流程固化、写测试
                                      ▼
             Crawlee / Scrapling / Crawl4AI / 自有平台 Adapter
                                      │
                   FastMCP / CLI-Anything / HTTP 统一工具契约
                                      │
                    Kestra / Crawlab / Windmill 调度与重试
                                      │
                     PostgreSQL + OpenSearch（检索与去重）
                                      │
                    PostgREST / Data API Builder / mcpo
                                      │
                         个人情报 Agent、告警、简报、检索 UI
```

架构上的关键原则：

1. **搜索、订阅、抓取、抽取、调度、对外接口必须分层。**
2. **每个平台 Adapter 都要有健康检查、样例快照和版本号。**
3. **浏览器登录 Profile 单独管理，不能把 Cookie 混在任务代码或模型上下文中。**
4. **Agent 负责发现新路径和处理长尾，确定性任务负责日常批量运行。**
5. **先保存原始证据，再做 LLM 摘要；摘要不能替代原始正文和 URL。**
6. **搜索结果必须记录账号、时间、查询参数和可见范围，避免把个性化结果误当全量。**

## 9. 三套可落地路线

### 路线 A：个人 POC，最快看到中文平台效果

组合：BrowserWing + RSSHub + WeRSS + SearXNG + PostgreSQL。

1. 先直接验证 BrowserWing 的小红书、微博、知乎搜索和各平台热榜。
2. 公众号采用 WeRSS/WeWe RSS 做已知账号订阅，SearXNG 做外部关键词补漏。
3. 搜索结果统一写入 PostgreSQL，使用 `canonical_url + content_hash` 去重。
4. 只有当某个任务稳定重复出现时，才把录制流程重写为专用 Adapter。

优点是快、贴近中文需求；缺点是浏览器脚本仍然脆弱，适合个人低频使用而不是批量商业服务。

### 路线 B：严格开源、可长期维护

组合：SearXNG/RSSHub/WeRSS + Crawlee 或 Scrapling + Crawl4AI + Crawlab 或 Kestra + PostgreSQL/OpenSearch + FastMCP + PostgREST。

尽量选择 Apache-2.0、MIT、BSD-3-Clause 项目；如果使用 AGPL 项目，按网络服务场景履行许可证义务。BrowserWing 和 Reverse API Engineer 只用于探索与生成第一版，不作为唯一生产运行时。

### 路线 C：商业或有 SLA 的生产系统

优先使用平台官方 API、授权数据源或明确许可的数据服务；公开新闻网页可配合 Firecrawl 托管服务或自建抓取器。通用浏览器 Agent 只做异常和长尾任务，核心搜索和采集必须有平台级 Adapter、账号治理、速率策略、审计和人工熔断。

商业场景中，项目代码是 MIT/Apache 并不代表目标平台数据可商用；MediaCrawler 的非商业许可证、Windmill Community Edition 的产品化限制、n8n 的 Sustainable Use License 都应进入采购/法务清单。

## 10. 建议的优先验证顺序

### 第一优先：直接回答“对中文需求到底有没有用”

1. **BrowserWing**：用同一组 5 个关键词实测小红书、微博、知乎，并记录登录、结果数、字段、耗时、连续运行成功率。
2. **Maxun**：分别录制一个普通新闻网站和一个登录平台搜索，验证分页、会话续期、API 输出和页面变化后的恢复。
3. **Reverse API Engineer**：只对一个公开、低风险站点捕获 HAR，比较生成客户端与 DOM 抓取的维护成本。

### 第二优先：验证长期系统骨架

4. **Crawl4AI 或 Scrapling**：把一个新闻站和一个 BrowserWing 成功流程固化为确定性任务。
5. **FastMCP + mcpo**：把现有 Python 爬虫同时暴露为 MCP 和 OpenAPI，确认不需要所有能力都 CLI 化。
6. **PostgREST 或 Data API Builder**：让统一 PostgreSQL 数据直接成为上层检索 API。

### 第三优先：再决定调度平台

7. 个人场景优先 Huginn/Crawlab；工程化数据管道优先 Kestra；脚本即 API 和内部运维 UI 场景考虑 Windmill；大量 SaaS 连接器场景考虑 Activepieces。不要因为 n8n 连接器多就忽略其许可证边界。

## 最终判断

你的“万物皆接口”方向是成立的，但最重要的不是把一切强行变成 CLI，而是建立一个稳定的 **Adapter Contract**：固定输入、结构化输出、可重试、可重放、可观测、可版本化。

- CLI-Anything 解决“已有能力如何标准化”；
- BrowserWing/Maxun 解决“网页操作如何快速变成可复用能力”；
- Reverse API Engineer 解决“如何发现页面背后的请求”；
- Crawlee/Scrapling/Crawl4AI 解决“如何把流程做成长期运行的采集器”；
- FastMCP/mcpo/Windmill 解决“如何把采集器交给 Agent、应用和工作流调用”；
- PostgREST/Data API Builder 解决“如何让采集后的统一数据天然成为接口”。

对于中文社媒，**获取层依然是最难、最平台化、最需要持续维护的一层**。任何只改变 CLI、MCP 或 OpenAPI 形式的项目，都无法绕过这一事实；但把上述项目组合起来，确实能让你原来“每个平台各写一套孤立爬虫”的方案升级成一套可发现、可组合、可测试、可替换的个人情报基础设施。

## 2026-07-15 BrowserWing 实测补充

本调研之后已经完成 BrowserWing `1.1.1-beta.1` 的第一轮本地 POC：

- B站热门、微博热搜、今日头条和 36氪分别连续运行 3 次，均为 3/3 成功。
- B站热门每次返回 100 条，微博 30 条，头条 50 条，36氪 21 条。
- 知乎热榜连续 3 次均为空；确认原因是匿名访问被重定向到知乎登录页。
- BrowserWing 对登录墙仍返回退出码 0 和空数组，上层不能只检查进程退出码。
- 已实现一个不依赖 LLM 的 B站关键词搜索 Adapter；“DeepSeek”“低空经济”“个人知识库”均取得首屏 30 条。
- `weixin-hot` 实际返回微信读书飙升榜书籍，不是微信公众号文章。
- 当前服务注册了 86 个 MCP 命令，但 MCP 注册不代表底层脚本具有生产稳定性。
- 用户在隔离 Profile 中人工登录小红书后，登录状态可以跨 BrowserWing 和 Chrome 进程重启复用。
- BrowserWing 内置小红书搜索仍使用过期的 `/search_result` 路线，登录后会导航超时；自定义 Adapter 改用当前 `/search_result_ai` UI 流程后，DeepSeek 连续 3/3 成功，每次得到 22 个结果区块和 20 条规范化笔记 URL。
- 自定义小红书 Adapter 对“低空经济”和“个人知识库”也成功，并且不会保存短期 `xsec_token`。

完整实测报告、脚本和公开数据样本见：[BrowserWing 中文信息源 POC](poc/browserwing/evaluation.md)。

## 2026-07-15 统一个人情报网关实测补充

按照后续选择，本轮没有继续推进订阅路由方案，而是完成了第一版可运行的统一读取网关：

- B站：使用 Maxun Robot/run API；`DeepSeek` 和新关键词均通过，新关键词由模板 Robot duplicate 并持久绑定；
- 小红书：使用 BrowserWing 隔离持久 Profile；统一 API 对 `DeepSeek` 返回 10 条，其中 9 个规范笔记 URL；
- 通用网页：自托管 SearXNG，支持全网查询和 `site=zhihu.com` 等域名限定；
- 网页正文：Trafilatura 成功从 `gov.cn` 页面抽取约 5.45 万字符；
- 控制面：FastAPI 提供同步搜索、正文抽取、健康检查和 SQLite 异步 job；
- 状态：明确区分成功、无结果、需要登录、来源不可用和配置错误，失败不再伪装成空数组；
- 安全：不读取浏览器 Cookie，不输出 Maxun API Key；正文抽取拒绝私网/回环地址，并限制重定向、类型和响应大小；
- 公众号：SearXNG 的 `site:mp.weixin.qq.com` 外部发现返回 7 条且域名 7/7 命中，但前三条正文样本只得到空页或 117 字通用壳页，不能视为稳定正文能力；
- 情报库：第二阶段已增加 `search_runs`、`documents`、`observations`、new/changed/seen 判定和跨来源标题 fingerprint；同一 Web 查询连续两次实测为 `5 new` 后 `5 seen`；
- 验证：最终单元测试 28 项通过，三个来源健康检查均为 ready。

这次实测把前面的架构判断变成了运行中的代码：CLI 或 MCP 可以继续作为上层调用形式，但真正决定中文信息覆盖的是可替换的来源 Adapter、登录态边界、错误语义和质量校验。

完整实现、启动说明和逐项实测数据见：[统一个人情报网关 POC](poc/intelligence-gateway/evaluation.md) 与 [README](poc/intelligence-gateway/README.md)。

## 2026-07-15 常见网站项目扩展调研

进一步盘点发现，可利用的现成站点入口远多于当前网关已接入的三个搜索来源：

- BrowserWing 本地实际注册 86 个内置脚本，其中 23 个标记需要登录、24 个带查询参数；
- DailyHotApi 当前仓库实际发现 56 个热榜路由文件；
- NewsNow 当前仓库实际发现 46 个服务端数据源模块；
- MediaCrawler 对小红书、抖音、快手、B站、微博、贴吧和知乎提供关键词、帖子、作者及评论能力，但使用非商业学习许可证；
- XHS-Downloader、TikTokDownloader、weiboSpider、yt-dlp 等可以补平台详情、账号跟踪或媒体归档，但不能一概视为平台级关键词搜索；
- 两个高关注 B站非公开 API 逆向项目已经因法律风险停止维护或永久关停，不进入候选实现。

扩展常见网站时应维护能力级状态：热榜、关键词搜索、指定作者、详情、评论、正文和媒体下载分别标记 `declared_unverified`、`verified`、`degraded`、`blocked` 或 `retired`，不能只写一个笼统的 `platform_supported=true`。

完整项目对比、常见网站覆盖矩阵和分批实测建议见：[常见网站开源采集项目扩展调研](research_common_site_open_source_connectors_2026-07-15.md)。

## 2026-07-15 按需采集能力运行时

产品目标进一步明确：优先建设“需要时可以自动进入目标平台并获取指定数据”的底层能力，而不是提前持续采集大量数据。

Intelligence Gateway 已升级到 `0.3.0`，将现有四条获取路径注册为版本化 Capability Manifest，并增加统一任务计划、执行、健康检查、Profile 状态和 fallback：

- `bilibili.keyword_search.maxun.v1`；
- `xiaohongshu.keyword_search.browserwing.v1`；
- `web.keyword_search.searxng.v1`；
- `web.article_extract.trafilatura.v1`。

真实任务已经验证：请求知乎关键词搜索时，由于没有站内 Adapter，系统自动规划为 SearXNG `site:zhihu.com`，返回 5 条并明确标记 `degraded=true`；指定 `persistence=none` 后不会写入 documents、observations 或 search_runs。B站也已通过同一通用任务接口调用 Maxun，未发生降级。

后续重点从“增加采集量”调整为：能力注册表、统一 Task Spec、check/execute/verify 生命周期、Profile 管理、fallback 和未知网站 Draft Adapter 生成。

### 2026-07-16：未知公开网站 Draft 能力闭环已经跑通

Intelligence Gateway 已升级到 `0.4.0`。本轮没有接入 RSSHub，也没有继续做持续采集，而是实现并真实验证了：

```text
未知公开网站
  -> proposed Draft
  -> 只读 inspect
  -> 样本关键词真实 validate
  -> 生成确定性 BrowserWing recipe
  -> promote 为运行时 Capability Manifest
  -> 被统一 Task Planner 发现和执行
```

百度公开搜索样本中，系统自动识别 `#chat-textarea`、`#chat-submit-button` 和结果选择器 `h3`；“个人知识库”验证得到 9 条结果后才允许晋升为 `baidu.keyword_search.browserwing_recipe.v1`。晋升后再以“开源情报工具”调用统一 `/tasks/execute`，直接返回 5 条相关结果，没有走 SearXNG fallback，也没有写入情报库。

这使此前的调研结论更具体：`CLI-Anything` 一类项目仍主要解决“已有能力如何标准化”，而当前真正有价值的底层是“能力工厂 + 验证门禁 + 运行时目录”。它不能凭空破解强登录平台，也不应绕过验证码，但对百度、普通新闻站、企业站、文档站等公开搜索入口，已经存在一条从未知页面到可复用能力的可运行路线。

下一步优先级不再是增加采集量，而是：

1. 用 3 至 5 个结构不同的公开搜索站回归 Draft Factory，区分通用 recipe 与站点特例；
2. 为 recipe 增加漂移检测、重新验证和版本升级，而不是静默继续使用失效选择器；
3. 增加 `detail_fetch` Draft 类型，把搜索结果链接交给已有公开正文抽取能力；
4. 最后再考虑 LLM 辅助探索，但 LLM 只能提议候选，不能跳过确定性样本验证；
5. 强登录中文社媒仍走专用 Adapter 与人工 Profile，保持低频串行，不能把公开站点能力工厂误称为全平台通用破解方案。

### 2026-07-16：0.4.1 能力可靠性补充

生成 recipe 已增加运行时可靠性状态。连续验证失败会先降级，达到三次后自动 blocked；Planner 此后不再执行旧选择器，而是直接选择配置好的外部 fallback。blocked 能力仍可通过精确 verify 做修复回归，成功后连续失败清零并恢复为 verified。

百度真实运行中恰好出现 BrowserWing 控制连接失效，系统完整经历 `verified -> degraded -> blocked -> fallback -> repaired -> verified`，同时修复了 BrowserWing 的失效实例替换流程。这个结果说明能力目录不能只记录“最后一次成功时间”，还必须把故障隔离、降级规划和恢复门禁作为底层能力生命周期的一部分。

## 主要官方资料

- [CLI-Anything](https://github.com/HKUDS/CLI-Anything)
- [BrowserWing](https://github.com/browserwing/browserwing)
- [Maxun](https://github.com/getmaxun/maxun)
- [Reverse API Engineer](https://github.com/Kalil0321/reverse-api-engineer)
- [Firecrawl](https://github.com/firecrawl/firecrawl) / [Self-hosting](https://github.com/firecrawl/firecrawl/blob/main/SELF_HOST.md)
- [Crawl4AI](https://github.com/unclecode/crawl4ai)
- [Scrapling](https://github.com/D4Vinci/Scrapling)
- [Crawlee](https://github.com/apify/crawlee)
- [ScrapeGraphAI](https://github.com/ScrapeGraphAI/Scrapegraph-ai)
- [agent-browser](https://github.com/vercel-labs/agent-browser)
- [Browser Use](https://github.com/browser-use/browser-use)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [FastMCP](https://github.com/jlowin/fastmcp)
- [mcpo](https://github.com/open-webui/mcpo)
- [Windmill](https://github.com/windmill-labs/windmill)
- [Activepieces](https://github.com/activepieces/activepieces)
- [Huginn](https://github.com/huginn/huginn)
- [Kestra](https://github.com/kestra-io/kestra)
- [n8n](https://github.com/n8n-io/n8n)
- [PostgREST](https://github.com/PostgREST/postgrest)
- [Data API Builder](https://github.com/Azure/data-api-builder)
- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)
- [RSSHub](https://github.com/DIYgod/RSSHub)
- [WeRSS](https://github.com/rachelos/we-mp-rss)
- [SearXNG](https://github.com/searxng/searxng)
