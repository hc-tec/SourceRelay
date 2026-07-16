# ADR-002：先稳定数据源层，再接入 DeepResearch 分析层

- 状态：Accepted
- 日期：2026-07-16
- 适用范围：Personal Intelligence Gateway 0.6.x 后续数据源建设
- 非目标：本阶段不实现长报告生成、多智能体研究编排、观点综合或自动结论

## 1. 决策

当前阶段只建设可独立验收的数据访问层：

```text
用户或上层 Agent
      |
      v
Intelligence Gateway
  - Capability 发现与计划
  - 搜索、详情和 Profile Adapter
  - 统一状态与来源证据
  - 质量门槛、fallback、可靠性
  - persistence=none / result_only
      |
      v
结构化公开信息结果

---------------- 稳定接口边界 ----------------

未来 DeepResearch 层
  - DeerFlow、天工系 DeepResearch 等候选
  - 查询拆解、迭代检索、证据聚合
  - 引用、冲突分析和报告生成
```

DeepResearch 框架以后只能作为 Gateway 的消费者，不直接持有平台 Cookie，不绕过 Capability Planner，也不把搜索引擎、浏览器或平台私有接口直接耦合进研究工作流。

### 1.1 原始文件优先，而不是全字段入库

数据源层不追求把每个平台的所有字段预先归一化、拆列并写入关系数据库。当前采用：

```text
按需执行 Capability
  -> 将原始 JSON / HTML / Markdown / 媒体元数据保存为本地文件
  -> 写一份最小 manifest
  -> 可选生成便于当次展示的轻量结果
  -> 未来由 AI 在读取时理解平台特有字段
```

只固定文件级溯源信息，不固定内容级全字段：

```text
run_id
platform / action / feed_id
capability_id
source_url
fetched_at
status / degraded / cache evidence
media_type
raw_file
sha256
```

标题、作者、简介、热度、评论结构和其他平台特有字段可以保持原样，不必现在全部建模。这是 `raw-first + schema-on-read`，而不是不要结构：结构只用在“能找回原文件、能证明来源、能判断新旧和执行状态”上。

数据库降为可选索引，不是原始数据的唯一真相源。`persistence=none` 仍表示不写入情报库；执行过程中的本地原始 artifact 应与情报库分开管理，后续可增加显式 `artifact_only` 模式和保留期。

安全边界不变：artifact 不保存请求头、Cookie、Token、密码或验证码；人工 Profile 与原始内容目录仍保持隔离。

### 1.2 登录持久化只使用隔离浏览器 Profile

当公开无登录能力不足时，用户可以在 BrowserWing 的可见 Chrome 窗口中人工登录。Chrome `user_data_dir` 固定位于被 Git 忽略的隔离 `runtime/chrome-user-data`，因此同一机器、同一 OS 用户和同一 Profile 目录下可以跨 BrowserWing 重启复用会话。

但 Profile 目录存在不等于当前仍已登录。平台可以使会话过期或要求再验证，所以认证状态必须通过真实固定样本判断，不能通过文件存在性推断。Gateway 不导出 Profile Cookie，也不把它转交给 yt-dlp 等命令行工具；需登录的平台必须拥有独立的 `manual_persistent_profile` 只读 Capability。

## 2. “数据源可用”的定义

健康检查通过不等于数据源可用。一个来源至少要分开报告以下维度：

| 维度 | 验收问题 |
|---|---|
| dependency ready | 本地服务、binary、配置引用是否存在 |
| authentication | 是否无需登录、人工登录有效、过期或未知 |
| live execution | 固定样本是否在当前时间真实执行成功 |
| relevance | 标题或摘要是否有查询证据，是否只是平台壳页 |
| canonical URL | URL 是否可长期引用，是否仍是搜索引擎跳转或短期 token |
| detail readiness | 已知 URL 能否得到匹配资源类型的详情 |
| scope | 平台站内搜索、外部 `site:` 发现、热榜或指定账号，不能混写 |
| persistence | 临时探测能否保持数据库不变 |
| compliance | 许可证、登录、频率、个人信息与平台条款边界是否明确 |

### 就绪等级

```text
L0 declared     只有项目或脚本声明，未真实执行
L1 dependency   本地依赖存在，但认证和结果未知
L2 live         当前固定样本执行成功
L3 quality      相关性、规范 URL、去重和错误语义通过
L4 resilient    有安全 fallback、漂移隔离和恢复入口
```

只有 L2 以上才能写“当前可用”。只有 L3 以上才适合作为 DeepResearch 的默认数据源。L1 不能因为 `/health` 为绿色就写成平台已支持。

## 3. 2026-07-16 真实探测结果

所有探测均使用 `persistence=none`。调用前后数据库保持：

```text
documents = 8
observations = 13
search_runs = 3
```

| 来源 | 当前路径 | 真实结果 | 等级 | 准确结论 |
|---|---|---|---|---|
| B站关键词 | Maxun | `DeepSeek` 返回 5 条；3 条含字面查询词，3 条有规范 URL；约 10.5 秒 | L2 | 原生搜索能运行，但推广/弱相关行使它尚未达到稳定 L3 |
| 多平台热榜 | 自托管 NewsNow | B站三个 feed、微博、知乎、快手、贴吧、36氪、澎湃共 9 个 feed 真实成功；完整 JSON 与最小 manifest 落本地 artifact，数据库不变 | L3 | `hotlist_fetch` 已具备明确 feed、URL、缓存证据与失败语义；不是关键词搜索 |
| 抖音热榜 | NewsNow `douyin` | 当前上游 `www.douyin.com` fetch failed，NewsNow 返回 HTTP 500；失败 JSON 已保留 | L1 | Capability 保持 `declared_unverified`，Planner 不会选择 |
| 小红书关键词 | BrowserWing 人工 Profile | 第一次原生失败后降级；再次真实搜索原生返回 5 条小红书结果 | L2 | 当前登录态可用，但 Profile 文件存在不能代表实时可用，需固定探测与故障原因记录 |
| 全网搜索 | SearXNG | 一次因 Brave/Google 限流、DuckDuckGo/Startpage CAPTCHA 返回 0；稍后 `低空经济` 返回 5/5 相关结果 | L2 | 低成本首选，但上游可用性明显波动，必须有冗余 |
| 知乎搜索 | SearXNG `site:` | 无站内 Adapter；一次链路为 SearXNG 0 条 -> Bing 认证门禁 -> 搜狗 5 条；后续 SearXNG 可直接返回规范知乎 URL | L2 | 只能称外部发现；搜狗结果还需持续检查是否为搜索跳转 URL |
| 知乎专栏详情 | Trafilatura -> Browser detail recipe | HTTP 403 后 BrowserWing 成功读取两篇不同文章 3,358 / 1,916 字 | L3 | 已验证公开长文详情 fallback；不等于知乎站内完整搜索 |
| 政务/新闻搜索 | SearXNG `site:gov.cn` | `人工智能` 返回 5 条，5 条均有查询词证据，覆盖 gov.cn、网信办、教育部、发改委 | L3 | 公开政务发现和长文读取当前质量较好 |
| 中国政府网详情 | Trafilatura | 22,364 字；即使 Browser recipe 已注册也不抢占 Tier 1 | L3 | 公开 HTML 长文能力稳定 |
| 公众号外部发现 | SearXNG `site:mp.weixin.qq.com` | 曾返回 5 条标题均为“微信公众平台”、0 条有查询证据 | L1 | 原结果是平台壳页，不是有效文章发现；现已加入壳页质量过滤，仍不能称公众号全局搜索 |
| B站视频详情 | yt-dlp metadata-only | 两个不同公开 BV URL 真实成功，原始 JSON 约 30 KB；统一 API 返回规范 URL 与 artifact，数据库不变 | L3 | 独立 `video_detail` 已实现；不下载媒体、不读 Cookie，lux `-j` 对同 URL 2/2 成功 |
| 微博、抖音、快手、贴吧 | 无正式 Capability | 未进入本轮运行目录 | L0 | 不能写成当前支持；候选项目声明不等于数据源已接入 |

## 4. 本轮公共搜索冗余决策

SearXNG 仍是首选，因为它成本低、不执行页面脚本，并能聚合多个引擎。但健康检查只证明 JSON endpoint 存在，不能证明上游引擎当前能返回结果。

`0.6.1` 增加动态低频 fallback：

```text
web.keyword_search.searxng.v1
  -> no_results / source_unavailable
bing.keyword_search.browserwing_recipe.v1
  -> 失败或认证门禁
sogou.keyword_search.browserwing_recipe.v1
```

约束：

- 只有运行目录中 verified/degraded、无需登录的 Bing/搜狗 recipe 才能加入；
- 不把百度、CSDN 等站点 recipe 自动当成全网引擎；
- 对知乎、公众号、政务站等外部发现，浏览器实际查询加入 `site:hostname`；
- API 对外仍返回用户原始 query，不把 `site:` 内部执行词污染结果契约；
- BrowserWing fallback 是低频、串行、成本更高的降级路径；
- 没有这些已验证 recipe 时，系统保持原来的显式 `no_results`，不临时探索未知搜索页。

## 5. 公众号质量门槛

`mp.weixin.qq.com` 外部发现采用高精度门槛。以下任一情况不再算成功：

```text
site = mp.weixin.qq.com
1. title 是“微信公众平台”等通用壳标题
2. title + snippet 中没有查询词证据
```

这类条目会被标记为通用平台壳页并过滤。过滤后为空时返回：

```text
status = no_results
error = SearXNG returned only generic WeChat platform shell results.
```

这只能防止假成功，不能创造公众号全局索引。公众号后续仍分为两项独立能力：

1. 外部搜索发现公开文章链接；
2. 已知公开文章 URL 的正文读取。

已知账号更新、历史文章和全公众号关键词检索需要单独评估，不能由这条 `site:` 路径推断。

## 6. 下一批数据源优先级

### P0：修现有能力的质量，不扩平台数量

1. B站搜索：对查询相关性、推广项、规范 BV URL 比例增加验收门槛；
2. 小红书搜索：把“Profile 存在”和“当前登录搜索成功”拆成不同状态，并保留原生失败原因；
3. 搜狗 fallback：识别并尽可能解析搜索跳转 URL，不能把 `www.sogou.com` 跳转链接写成目标内容 URL；
4. 公众号：用小规模公开文章样本验证外部发现和正文，持续拒绝平台壳页。

### P1：补资源类型

1. `video_detail`：B站 yt-dlp raw-first 已完成；抖音/快手仍要分别通过已知公开 URL 小样本才能注册；
2. `qa_detail`：知乎问题与回答分开，不抓整个聚合页面；
3. `post_detail`：小红书/微博/贴吧帖子使用平台专用契约；
4. `article_detail`：公众号已知公开文章、新闻和专栏继续复用 direct-first 长文链。

### P2：再增加新平台

微博、抖音、快手、贴吧按“固定公开样本 -> 认证边界 -> 输出质量 -> 许可证”逐个进入 Draft。没有真实样本和验收证据前，不因 GitHub 项目 README 宣称覆盖就注册为正式 Capability。

## 7. 给未来 DeepResearch 的稳定接口

未来 DeerFlow、天工系 DeepResearch 或其他研究框架只依赖以下 Gateway 契约：

```text
plan(query, platform, action)
execute(..., persistence=none)
search-and-fetch(...)
result.status
result.items[].source / title / canonical URL / snippet
attempted_capabilities
executed_capability_id
degraded / partial / warnings
```

上层分析必须保留来源 URL、执行能力和降级证据；不得把 `site:` 外部发现写成平台完整索引，也不得因为浏览器 Profile 已存在就假设登录内容可以无人值守获取。

## 8. DeepResearch 调研触发条件

满足以下条件后再正式比较 DeerFlow、天工系项目和其他 DeepResearch 仓库：

1. 至少 3 类搜索来源达到 L3；
2. article/video/qa 中至少两类详情契约真实通过；
3. 每条结果都有规范 URL 和能力链证据；
4. 数据源失败不会被上层误解为“没有相关信息”；
5. Gateway 不向研究框架暴露 Cookie、Token 或人工 Profile 目录。

届时调研重点应是查询规划、迭代检索、引用、上下文压缩、模型可替换性和数据源工具协议，而不是让 DeepResearch 框架替代数据源治理。

当前相关自动化回归纳入完整 Gateway 测试集，共 `89 passed`。
