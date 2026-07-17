# 中文平台原生站内搜索审计（2026-07-17）

> 目标：把“目标平台自己的搜索系统”与“搜索引擎对该平台的外部索引”彻底分开。本报告只把经实际平台入口验证的路径称为站内搜索；`SearXNG`、Bing、搜狗和 `site:` 查询始终只是外部发现或降级，不会被提升为原生搜索成功。

## 结论摘要

目前已经有真实、可调用的原生关键词搜索能力的只有两类：

| 平台 | 结论 | 认证边界 | 当前处理 |
|---|---|---|---|
| B 站 | 可用的匿名首屏站内搜索 | 不需要 B 站账户；Gateway 对 Maxun 的本地 API Key 不等于平台登录 | 保持 `bilibili.keyword_search.maxun.v1`，补强回归与字段质量 |
| 小红书 | 可用的登录后首屏站内搜索 | 需要人工维护的隔离持久 Chrome Profile | 保持现有 Capability，但先完成 Profile 安全隔离 |
| 知乎 | 有真实站内入口，但匿名环境受 WAF/登录门禁 | 后续必须由用户在隔离浏览器中手工登录后再验证 | 不能注册为正式 `keyword_search` |
| 微博 | 有真实站内入口，但匿名环境进入 Visitor / 登录系统 | 后续必须由用户在隔离浏览器中手工登录后再验证 | 不能注册为正式 `keyword_search` |
| 36 氪、今日头条 | 已找到可达的原生搜索候选路由 | 暂未观察到明确登录门禁，但尚未通过 DOM/schema 验收 | 作为匿名 POC 候选，不先接入 |
| 公众号 | 没有可安全复用的“全公众号公开 Web 搜索”能力 | 取决于用户选择微信 App 搜一搜还是自有公众号后台 | 维持明确缺口；已知文章详情不等于全局搜索 |
| 澎湃新闻 | 旧搜索路由本次失效 | 不是登录问题，而是路由/状态机未验证 | 不接入，先从真实页面搜索框重新录制 |

因此，下一阶段不该继续扩大外部 `site:` 兜底，而应逐个平台完成：

```text
真实站内入口
  -> 首屏结果 DOM / 数据结构
  -> 登录、验证码、空结果、页面漂移的明确语义
  -> 固定样本回归
  -> 独立 keyword_search Capability
```

## 验证方法与边界

本次动态检查使用了全新的临时 Chrome `user-data-dir`，并开启无痕模式；没有使用 BrowserWing 现有共享 Profile、没有读取 Cookie、没有使用外部搜索引擎，也没有保存登录态。结果只说明本机、当前网络与当前时间下的访问行为，不能推断为平台永久规则。

系统中的既有外部发现能力仍有价值，但必须保留以下语义：

```text
external_discovery_only
!=
native_success
```

## 平台逐项结果

### B 站：可用的匿名站内关键词搜索

实际入口：

```text
https://search.bilibili.com/all?keyword=<URL-encoded query>
```

无 Cookie 访问 `DeepSeek` 查询页时，页面返回 `200` 且标题为“`DeepSeek-哔哩哔哩_bilibili`”。这是一条明确的平台内搜索路由，不是搜索引擎跳转。

Gateway 现有 [Capability manifest](../../poc/intelligence-gateway/capabilities/bilibili.keyword_search.maxun.v1.json) 已将它登记为 `verified`。该能力目前只取首个渲染结果页；需要显式标记推广/课程卡片，并只将规范 BV 视频 URL 作为可引用的视频结果。另有 [BrowserWing 确定性脚本](../../poc/browserwing/scripts/run-bilibili-search.ps1) 和三词历史样本可作回归对照。

下一步：为三个固定中文查询增加首屏卡片数、规范 URL 比例、查询词相关性、推广项和页面结构健康检查；之后再独立讨论筛选和分页，不把它们混入首版能力。

### 小红书：登录后站内搜索已验证，但必须隔离 Profile

真实流程不是直接访问已过期的 `/search_result` 路由，而是：

```text
https://www.xiaohongshu.com/explore
  -> 可见搜索输入框
  -> /search_result_ai?keyword=<query>&source=web_explore_feed
```

当前 [Capability manifest](../../poc/intelligence-gateway/capabilities/xiaohongshu.keyword_search.browserwing.v1.json) 已验证 `manual_persistent_profile` 模式；现有状态化脚本会关闭恢复的笔记浮层、通过真实可见输入框提交、确认查询词回显、再读取首屏笔记卡片。匿名直连即使能拿到 `200` 和页面标题，仍含登录/验证壳，因此不能升级为匿名搜索。

这条能力的限制必须保留：只读首屏、结果可能个性化、搜索发现成功不等于详情页面可直接打开。短期 `xsec_token` 不能进入 raw artifact、数据库、日志或 DeepResearch trace。

下一步：先完成每个平台独立 Profile、可见登录模式和 NTFS 权限加固；再以固定三词验证筛选、排序、验证码、登录失效和分页语义。

### 知乎：有原生入口，当前匿名环境没有可用结果

实际内容搜索入口：

```text
https://www.zhihu.com/search?type=content&q=<URL-encoded query>
```

本次全新无登录 Chrome 访问“低空经济”时，返回平台 `40362` 访问限制 JSON，而非结果页。另有历史 BrowserWing 记录：匿名内置 `zhihu-search` 两次使用该准确路由，但仅得到空数组；已有实测将它判定为登录墙，而不是可接受的“无结果”。

现有 [知乎能力](../../poc/intelligence-gateway/capabilities/zhihu.qa_detail.browserwing.v1.json) 是匿名读取**已知问题 ID**的首屏回答，不能由此推导为全站内容检索。知乎目前没有 `zhihu.keyword_search.*` manifest。

技术参考而不是直接依赖：

- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 目前使用 `/api/v4/search_v3`，但需要 `d_c0`、会话 Cookie 与请求签名，许可证为非商业学习许可证；不能复制其 Cookie/签名路线。
- MediaCrawler 的 [#517](https://github.com/NanmiCoder/MediaCrawler/issues/517)、[#682](https://github.com/NanmiCoder/MediaCrawler/issues/682)、[#796](https://github.com/NanmiCoder/MediaCrawler/issues/796) 表明登录后分页、问题答案完整性仍是独立可靠性问题。

决定：现在不注册该能力。只有在安全隔离且可见的知乎 Profile 登录后，才创建专用的 `zhihu.keyword_search.browserwing_profile.v1` Draft；它从一开始必须声明 `authentication.required=true` 和 `manual_persistent_profile`，不能使用当前只适用于匿名公开页的通用 Draft Factory。

### 微博：有原生入口，当前匿名环境明确被登录系统接管

PC 搜索入口：

```text
https://s.weibo.com/weibo?q=<URL-encoded query>
```

全新无登录 Chrome 访问“低空经济”时，渲染出的标题为“登录 - 微博”，页面含短信、账号密码、扫码和验证码登录入口。无 Cookie 的受限 HTTP 检查还显示 PC、mobile 搜索入口都会落入 Sina Visitor System，而不是结果卡片。

BrowserWing 的内置 `weibo-search` 本身也标为 `requires_login=true`，但它只抽取作者和正文前 200 字，缺少稳定帖子 ID、作者 UID、时间、规范 URL 和登录墙语义，不能直接提升为 Gateway 能力。

当前 Gateway 的 [微博账号首屏能力](../../poc/intelligence-gateway/capabilities/weibo.account_posts.browserwing.v1.json) 与微博热搜都是独立能力，均不等于全站关键词搜索。

技术参考而不是直接依赖：

- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 的移动 API 路径为 `m.weibo.cn/api/container/getIndex`；其 [#907](https://github.com/NanmiCoder/MediaCrawler/issues/907)、[#604](https://github.com/NanmiCoder/MediaCrawler/issues/604)、[#583](https://github.com/NanmiCoder/MediaCrawler/issues/583) 显示去重、Geetest 与登录失效仍未稳定解决，且项目许可证限制直接使用。
- [crawl4weibo](https://github.com/Praeviso/crawl4weibo) 是 MIT 对照实现，但其“无需 Cookie”仍会使用浏览器 visitor/session Cookie；其检查并未覆盖关键词搜索，相关 [#5](https://github.com/Praeviso/crawl4weibo/issues/5)、[#72](https://github.com/Praeviso/crawl4weibo/issues/72) 也显示网络与会话敏感。

决定：现在不注册该能力。安全登录后，只做首屏、低频、只读、无 Cookie 导出的 `weibo.keyword_search.browserwing_profile.v1`；先完成三次同查询、一次不同查询和一次重启复用验证，才允许 promotion。

### 微信公众号：必须承认“全局关键词搜索”仍是缺口

已验证能力是：

```text
https://mp.weixin.qq.com/s/<article-id>
```

也就是 [已知公开文章详情](../../poc/intelligence-gateway/capabilities/wechat_official.article_detail.public-html.v1.json)。它不代表账号历史、订阅、账号检索或“搜一搜”的全量索引。BrowserWing 的 `weixin-hot` 实际对应微信读书书籍，不是公众号热榜或公众号搜索。

微信没有已验证的面向公众、可安全复用的全公众号 Web 搜索入口。后续必须先由用户明确选择权限面：

1. 个人微信 App 内的“搜一搜”；或
2. 用户自己拥有的公众号后台。

二者的登录、数据范围、合规和会话隔离模型不同。即使外部引擎发现 `mp.weixin.qq.com` 链接，也只能记为“外部发现 + 已知链接详情”。

### 36 氪、今日头条、澎湃：候选与失败要分开记

| 平台 | 观察到的原生路由 | 本轮状态 | 结论 |
|---|---|---|---|
| 36 氪 | `https://36kr.com/search/articles/<query>` | 无 Cookie `200`，标题为“`<query>相关文章_36氪`” | 可做匿名首屏 POC；尚未有 DOM/schema 验收或 Gateway Capability |
| 今日头条 | `https://so.toutiao.com/search?keyword=<query>` | 无 Cookie `200`，标题为“`<query>-头条搜索`” | 可做匿名首屏 POC；登录入口文字不等于登录必需 |
| 澎湃新闻 | 旧 `/searchResult.jsp?keyword=<query>` | `307` 到无查询词的 `/searchResult`，查询状态丢失 | 不是可用路线；从首页真实搜索框重新录制前不能接入 |

## 统一 Capability 验收契约

任何平台只有同时满足下列条件，才能被标为 `verified` 的站内关键词搜索：

1. 实际执行能力 ID 必须以目标平台开头，例如 `zhihu.keyword_search.*`；
2. 固定查询和第二个不同查询都返回真实首屏结果；
3. `authentication_required`、验证码/安全验证、`no_results`、页面结构漂移、来源不可用不能互相伪装；
4. 结果必须有可验证的平台规范 URL，或明确标记不可引用；
5. 只输出公共字段白名单，不输出 Cookie、Token、storage、浏览器 Profile 路径或时效签名媒体 URL；
6. `partial=true`、首屏范围、分页/筛选未实现、个性化和广告都要写入响应；
7. 外部搜索 fallback 若保留，必须在追踪和引用审计中标为 `external_discovery_only`。

## 人工登录的安全前置条件

当前共享 BrowserWing Profile 不应承载知乎或微博的真实个人登录态。需要人工登录的原生搜索在请求用户扫码前，必须完成：

1. 知乎、微博、小红书各自独立的 Profile 目录与 `profile_id`；
2. 专门的 headed 登录配置，不能让 `headless=true` 与“可见扫码窗口”相冲突；
3. Profile 目录仅限当前 Windows 用户、`SYSTEM` 和必要管理员访问，移除宽泛的写权限继承；
4. BrowserWing 继续只绑定 loopback，并审查/收紧本机控制面；
5. 不导出 Cookie 到环境变量、CLI 参数、raw artifact、trace 或聊天；
6. 用户只在可见隔离浏览器内完成平台自己的登录，之后只回复“已登录”或“登录异常”。

完成前置条件之后，用户登录不是把凭据交给系统，而是让浏览器自身持久化平台会话；Gateway 只能通过页面内执行使用该会话，并返回可审计、去敏后的只读结果。

