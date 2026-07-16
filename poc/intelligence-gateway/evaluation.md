# 统一个人情报网关 POC 评估

> 实测日期：2026-07-15 至 2026-07-16
> 目录：`poc/intelligence-gateway`
> 网关版本：`0.6.0`
> 结论：第一版统一读取链路已经形成可运行闭环；适合作为个人低频 POC 和后续 Adapter 演进骨架，尚不能按无人值守生产系统承诺 SLA。

## 1. 本轮实际交付

网关把四种不同能力收敛到同一份状态语义和字段契约：

| 能力 | 当前实现 | 对外入口 | 已验证边界 |
|---|---|---|---|
| B站关键词搜索 | Maxun `0.0.43` Robot/run API | `POST /search`，`source=bilibili` | 首屏结果；非标准视频链接标记为推广项；新关键词需复制模板 Robot |
| 小红书关键词搜索 | BrowserWing `1.1.1-beta.1` + 人工登录的持久 Chrome Profile | `POST /search`，`source=xiaohongshu` | 首屏发现与元数据；详情正文、分页和无人值守登录恢复未通过 |
| 通用网页搜索 | 自托管 SearXNG `2026.7.14-58e02a01a` | `POST /search`，`source=web` | 支持 `site` 域名限定；覆盖受上游引擎限流、验证码和网络影响 |
| 网页正文抽取 | Trafilatura `2.1.0` | `POST /fetch` | 公开 HTML/XHTML/text；不执行页面脚本 |
| 浏览器渲染详情 | 经过 Draft 验证的 BrowserWing host-scoped recipe | `POST /tasks/execute`、`POST /tasks/search-and-fetch` | 仅公开渲染正文；不登录、不点击、不越过 recipe 主机 |
| 异步执行 | FastAPI BackgroundTasks + SQLite | `POST /jobs/search`、`GET /jobs/{id}` | 单机持久作业状态；不是分布式队列 |

同时提供：

- `GET /health`：整体与逐来源健康状态；
- `GET /sources`、`GET /sources/health`：能力发现与连接器状态；
- SQLite `connector_bindings`：查询词到 Maxun Robot 的持久绑定；
- URL 去跟踪、规范化、去重和统一 rank；
- `success`、`no_results`、`authentication_required`、`source_unavailable`、`misconfigured`、`error` 六种显式结果状态。

## 2. 部署与固定版本

本轮实际环境：

- Python `3.13.11`；
- FastAPI `0.139.0`；
- HTTPX `0.28.1`；
- Pydantic `2.13.4`；
- Trafilatura `2.1.0`；
- Uvicorn `0.51.0`；
- SearXNG `2026.7.14-58e02a01a`；
- SearXNG 镜像摘要：`sha256:af9aec5c8fe88767106e8043004a1232d43cabde22869e6355f3a63d26e41351`。

本地监听：

- 网关：`http://127.0.0.1:8765`；
- SearXNG：`http://127.0.0.1:8888`；
- Maxun backend：`http://127.0.0.1:18081`；
- BrowserWing：`http://127.0.0.1:8080`。

SearXNG 的 `settings.yml` 由初始化脚本在被忽略的 `runtime/` 中生成随机 secret；代码库只保留不含 secret 的模板。Maxun API Key 仍只从原 POC 的被忽略文件读取。网关不读取或返回浏览器 Cookie。

## 3. 统一接口实测

### 3.1 健康检查

修复 Python HTTP 客户端误用系统代理后，三个来源均为：

| 来源 | status | ready | collector |
|---|---|---:|---|
| bilibili | success | true | maxun |
| xiaohongshu | success | true | browserwing |
| web | success | true | searxng |

小红书健康检查只确认 Adapter、BrowserWing binary 和 Profile 目录存在；登录是否仍有效必须通过真实搜索确认，不能仅凭目录存在判定。

### 3.2 B站搜索

| 查询 | 状态 | 耗时 | 返回数 | 被标记推广项 |
|---|---|---:|---:|---:|
| DeepSeek | success | 12.653 秒 | 10 | 2 |
| 具身智能 | success | 10.314 秒 | 10 | 3 |

`具身智能` 不使用固定 DeepSeek 入口，网关通过 Maxun 模板 duplicate 生成对应 Robot，并把绑定写入 SQLite。后续同一查询可复用绑定。

推广或追踪行不会被冒充为规范 B站视频：它们返回 `promoted=true`，并把不可长期存储的追踪 URL 置空。调用者也可以传 `include_promoted=false` 排除它们。

### 3.3 小红书搜索

最终统一 API 实测：

| 查询 | 状态 | 耗时 | 返回数 | 规范 `/explore/{id}` URL |
|---|---|---:|---:|---:|
| DeepSeek | success | 26.816 秒 | 10 | 9 |

持久登录态仍可用。网关不接触 Cookie，只调用用户已人工登录的隔离 BrowserWing Profile。

本轮发现并修复了一个仅在后台进程出现的问题：Windows PowerShell 在没有控制台时按本地代码页解码 BrowserWing 的 UTF-8 输出，中文元数据会乱码，严重时会破坏 JSON 字符串的闭合引号。Adapter 现已显式设置无 BOM UTF-8，并对 BrowserWing JSON 输出做候选边界解析。网关还使用 Profile 级异步锁，避免两个请求同时控制同一个浏览器。

当前仍不应宣称具备：

- 小红书笔记详情正文；
- 翻页与完整索引；
- 自动登录、验证码处理或安全机制绕过；
- 高频并发采集。

### 3.4 通用网页与知乎域名限定搜索

| 查询 | site | 状态 | 耗时 | 返回数 | 域名命中 |
|---|---|---|---:|---:|---:|
| 个人知识库 | 无 | success | 2.138 秒 | 10 | 不适用 |
| 个人知识库 | zhihu.com | no_results | 0.938 秒 | 0 | 0 |
| 同一查询重试 | zhihu.com | success | 0.992 秒 | 10 | 10/10 |

第一次知乎限定查询恰好遇到上游搜索引擎暂停、验证码或限流；同一查询重试后由 DuckDuckGo 返回 10 条知乎结果。这个现象说明：

1. SearXNG 能提供全网发现和 `site:` 限定入口；
2. 它不是自有完整索引，上游短时状态会改变覆盖；
3. `no_results` 与 `source_unavailable` 必须保留，调用者应按策略重试；
4. 网关现会把 `unresponsive_engines` 摘要放入 warnings，便于判断空结果是否可信。

### 3.5 公开网页正文抽取

先用网关搜索 `gov.cn` 的“政府工作报告”，再把发现结果传给 `/fetch`：

| 状态 | 最终域名 | 耗时 | 标题长度 | 正文长度 |
|---|---|---:|---:|---:|
| success | www.gov.cn | 482 ms | 18 | 54,522 字符 |

正文抽取不是任意 URL 代理。网关在每次请求和每次重定向前解析 DNS，并拒绝 loopback、private、link-local、multicast、reserved 和 unspecified 地址；同时拒绝 URL 中的账号密码、非 HTTP(S) scheme、非 HTML/text 类型、超过 5 次重定向和超过 5 MB 的响应。

### 3.6 公众号外部发现与正文边界

不依赖订阅路由，直接使用 SearXNG 做 `DeepSeek + site:mp.weixin.qq.com`：

| 搜索状态 | 耗时 | 结果数 | 公众号域名命中 |
|---|---:|---:|---:|
| success | 1.356 秒 | 7 | 7/7 |

这证明“从外部搜索引擎发现公众号文章链接”可用，但不等于公众号全局索引。对前三个发现 URL 做正文抽取时：一个没有正文，两个只返回 117 字的“微信公众平台/公众号助手”通用壳页，不是目标文章。因此网关增加了 200 字符最小正文质量门槛，壳页现在返回 `no_results`，不会再伪装成文章抽取成功。

当前公众号能力应准确表述为：

- 外部关键词发现：通过；
- 指定域名搜索：通过；
- 公开文章正文：部分页面可能通过，但本轮样本未形成稳定成功率；
- 全平台完整关键词搜索：不具备；
- 历史文章完整回溯：不具备。

### 3.7 SQLite 异步作业

`web / 低空经济 / limit=5` 实测：

- `POST /jobs/search` 在 238 ms 返回 `queued`；
- SQLite 随后记录 `running`；
- 最终为 `success`，保存 5 条规范化结果；
- `started_at` 与 `finished_at` 均已落盘，`error` 为空。

当前 BackgroundTasks 适合个人单机 POC。进程崩溃后的 queued/running 恢复、租约、重试次数和多 worker 竞争尚未实现；要做长期无人值守时应升级为显式 worker/queue。

### 3.8 情报库、增量与变化检测

第二阶段在原 SQLite 中以兼容迁移方式增加：

- `search_runs`：一次来源查询的状态、耗时、结果数和 new/changed/seen 汇总；
- `documents`：来源内稳定文档身份、最新字段、首次/最后发现时间和 observation 次数；
- `observations`：每次运行看到的原始规范化快照和变化类型。

身份与变化规则：

1. 有规范 URL 时，`source + canonical_url` 形成稳定 `document_id`；
2. 没有 URL 时退化为 `source + 规范化标题 + 规范化作者`；
3. 标题另生成不含 source 的 cross-source fingerprint，用于跨来源候选聚类；
4. 标题、作者、摘要、发布时间和稳定业务指标形成 content hash；
5. SearXNG 的 score/engines 等检索排序噪声不进入 content hash。

真实连续搜索 `web / 个人知识库 / limit=5`：

| 运行 | 结果 | new | changed | seen | 耗时 |
|---|---:|---:|---:|---:|---:|
| 第一次 | 5 | 5 | 0 | 0 | 1.057 秒 |
| 第二次 | 5 | 0 | 0 | 5 | 1.193 秒 |

最终数据库为 5 个 document、10 条 observation 和 2 个 search run，证明相同结果不会重复生成文档，也不会被误报为内容变化。

异步 `web / 低空经济 / limit=3` 也通过：job 与 search_run 的 ID 关联正确，最终写入 3 个 new document。当前 API 新增：

- `GET /library/stats`；
- `GET /documents`、`GET /documents/{id}`；
- `GET /documents/{id}/observations`；
- `GET /changes`；
- `GET /runs`、`GET /runs/{id}`；
- `GET /clusters`、`GET /clusters/{fingerprint}`。

跨来源 cluster 目前是候选集合，不应被称为完整事件识别：完全相同标题可以聚合，标题不同但描述同一事件仍需后续实体消歧或语义匹配。

### 3.9 Capability Runtime：从数据收集转向按需能力

第三阶段不再继续批量接热榜或建立持续调度，而是把现有获取方式包装为版本化底层能力：

| capability_id | 动作 | 执行器 | 认证 | fallback |
|---|---|---|---|---|
| `bilibili.keyword_search.maxun.v1` | B站关键词搜索 | Maxun | 本地 API Key 引用 | SearXNG `site:bilibili.com` |
| `xiaohongshu.keyword_search.browserwing.v1` | 小红书关键词搜索 | BrowserWing | 人工登录持久 Profile | SearXNG `site:xiaohongshu.com` |
| `web.keyword_search.searxng.v1` | 全网/域名限定搜索 | SearXNG | 无 | 无 |
| `web.article_extract.trafilatura.v1` | 公开文章抽取 | Trafilatura | 无 | 无 |
| `web.detail_fetch.trafilatura.v1` | 搜索结果公开详情读取 | Trafilatura | 无 | 无 |

每个 Manifest 独立记录：

- 平台、动作、版本和执行器；
- 输入 Schema 和输出 Schema；
- 登录模式和 Profile 引用；
- 能力状态、范围和已知警告；
- fallback 链；
- 最近真实验证时间和安全验证输入；
- 执行器代码许可证。

新增：

- `GET /capabilities`、`GET /capabilities/{id}`；
- `POST /capabilities/{id}/check`；
- `POST /capabilities/{id}/verify`；
- `POST /tasks/plan`；
- `POST /tasks/execute`；
- `GET /profiles`、`GET /profiles/{platform}/status`。

真实验证：

1. 五个静态能力的依赖检查均为 `ready=true / success`；
2. `zhihu.keyword_search` 在没有站内 Adapter 时自动规划为 `web.keyword_search.searxng.v1 + site:zhihu.com`；
3. 该降级任务返回 5 条并明确 `degraded=true`；
4. 使用 `persistence=none` 后，执行前后仍为 8 个 documents、13 条 observations、3 个 search_runs，没有因临时任务落库；
5. B站通过通用 `/tasks/execute` 调用 Maxun，返回 3 条、未降级、只尝试一个能力且未持久化。

当前 fallback 不会假装等价：站内搜索失败后转到外部 `site:` 查询时，响应会保留 requested platform、真正执行的 capability、attempted capabilities、`degraded=true` 和范围警告。

## 4. 错误语义

网关不会把失败伪装成 `200 + []`：

| 场景 | HTTP | status | 语义 |
|---|---:|---|---|
| 正常结果 | 200 | success | 有规范化结果 |
| 来源可用但没有结果 | 200 | no_results | `ok=false`，允许按查询策略重试 |
| 隔离 Profile 未登录或过期 | 424 | authentication_required | 需要用户人工恢复登录 |
| 来源、服务或 Adapter 不可用 | 503 | source_unavailable | 依赖故障或超时 |
| 本地文件/模板配置缺失 | 503 | misconfigured | 部署配置问题 |
| 请求字段错误或私网正文 URL | 422 | error | 输入被拒绝 |

异步作业失败时也会在 SQLite `error_json` 中保存结构化状态，而不是只写一条不可机器处理的日志。

## 5. 测试与质量检查

最终验证命令：

```powershell
.\.venv\Scripts\python.exe -m compileall app tests
.\.venv\Scripts\python.exe -m pytest -q
docker compose config --quiet
```

结果：`69 passed`。覆盖：

- URL 去跟踪与 fragment；
- 规范 URL 去重和 rank 重排；
- Maxun `Label 1..6` 映射；
- B站推广项显式标记与过滤；
- SearXNG 分类列表兼容、域名限定和重复结果；
- `site` 只允许 hostname；
- SQLite job 生命周期与 connector binding；
- 回环、私网、链路本地、带凭据 URL 拒绝；
- 低于 200 字符的壳页不能冒充文章正文；
- new、changed、seen 三种 observation 生命周期；
- 搜索引擎排名噪声不制造内容变化；
- 跨来源 fingerprint 和 cluster 查询；
- 同步/异步搜索与 search_run 持久关联；
- Capability Manifest 加载和 fallback 引用完整性；
- 直接能力计划与未知平台安全降级计划；
- 通用任务执行和 `persistence=none`；
- 平台 Adapter 失败后的外部发现 fallback；
- 任务输入错误的结构化 422；
- HTTP 424、422 等错误不能伪装为空成功。
- `keyword_search` Draft 必须有样本查询，`detail_fetch` Draft 不需要查询词且可兼容现有 SQLite schema；
- 详情正文容器、标题、文本长度、认证门禁、最终主机和 recipe 阈值验证；
- 生成详情执行器的成功、选择器漂移、主机越界与显式失败；
- direct-first、无 recipe 不启动浏览器、host 不匹配不启动浏览器和逐条 capability evidence；
- 详情 fallback 前后 `persistence=none` 保持数据库不变。

## 6. 0.4.0 Draft Capability Factory 真实验证

这一阶段没有继续增加常驻采集或热榜入库，而是验证“临时需要某网站时，能否把它变成可规划、可执行的底层能力”。第一条样本站选择百度公开搜索。

### 6.1 Draft 生命周期

真实 Draft：

```text
platform     = baidu
start_url    = https://www.baidu.com/
sample_query = 个人知识库
draft_id     = d3ec0a12-ec46-4163-93b8-891e687045a4
```

`inspect` 识别结果：

```text
input_selector  = #chat-textarea
submit_selector = #chat-submit-button
status          = inspected
```

`validate` 随后真实提交“个人知识库”，最终页面仍为 `www.baidu.com`，页面标题与 URL 都包含正确的 UTF-8 查询，抽取到 9 条有效结果；查询相关性参与容器评分，最终选择 `h3`，而没有误选右侧热榜或翻页区。验证状态为：

```text
passed              = true
item_count          = 9
relevant_item_count = 7
result_selector     = h3
status              = validated
```

BrowserWing Windows CLI 对直接传入的非 ASCII JavaScript 参数可能发生编码损坏，因此执行器把查询编码为 ASCII `\uXXXX` 转义，再由浏览器恢复原始中文。BrowserWing `eval` 还要求多语句脚本以显式 `return` 返回；这两点都来自本轮真实失败后的接口验证，不是 README 假设。

### 6.2 晋升、规划和不同查询执行

`promote` 写入并热加载：

```text
runtime/capabilities/baidu.keyword_search.browserwing_recipe.v1.json
```

随后以不同于验证样本的“开源情报工具”调用统一任务接口：

| 检查项 | 真实结果 |
|---|---|
| `/tasks/plan` | 直接选择 `baidu.keyword_search.browserwing_recipe.v1` |
| 是否 fallback | 否 |
| `/tasks/execute` | `200 / success` |
| 返回条数 | 5 |
| collector | `browserwing_recipe` |
| persistence | `none` |
| 情报库前后 | 仍为 8 documents、13 observations、3 search runs |
| capability check | `ready=true / success` |

返回标题包括“开源情报工具全解析”“14款顶级开源情报工具合集”“开源情报(OSINT)检索工具盘点”等，说明 recipe 并非只记住验证样本，而是能够再次进入平台执行新的按需查询。

### 6.3 安全与能力边界

- 只允许公开 HTTP(S) 起始 URL，`127.0.0.1` 等非公开地址返回 422；
- inspect 不提交查询，validate 通过后才能 promote；
- 登录、扫码、验证码文字可能只是普通页面入口，不能单凭 marker 判断为门禁；只有在同时拿不到可用结果时才标记 `authentication_gate_suspected`，系统也不会尝试绕过；
- 生成 recipe 目前只覆盖公开 `keyword_search` 和首个渲染页；
- 标题与 URL 来自重复结果容器启发式，必须保留样本验证和回归维护；
- BrowserWing 与小红书共用 Profile，所以所有这类任务必须低频、串行；
- 浏览器重定向不像 Trafilatura 下载器那样逐跳重新做 DNS/IP 校验，因此 Gateway 继续只绑定 `127.0.0.1`，不能被描述成完全消除了浏览器 SSRF 风险。

### 6.4 结论变化

`0.3.0` 证明了“已有 Adapter 可以统一规划与执行”；`0.4.0` 又证明了一步更接近用户目标的能力：未知公开搜索站点可以先形成 Draft，经真实样本门禁后生成确定性 recipe，并立刻进入同一 Capability Runtime。它仍不是 LLM 自主浏览器 Agent，也不是任意网站自动成功生成器，但已经把“人工写每个爬虫”推进为“机器探索候选、样本验证、受控晋升、统一执行”的可运行底座。

### 6.5 0.4.1 recipe 漂移隔离与恢复验证

`0.4.1` 增加持久化在运行时 Manifest 中的可靠性状态，并进行了两组验证。

自动化测试模拟同一 recipe 连续失败：

```text
failure 1 -> degraded / consecutive_failures=1
failure 2 -> degraded / consecutive_failures=2
failure 3 -> blocked  / consecutive_failures=3
```

进入 blocked 后，百度任务规划不再选择旧 recipe，而是直接得到：

```text
selected = web.keyword_search.searxng.v1
site     = www.baidu.com
degraded = true
```

随后恢复执行器并对 blocked capability 做精确 verify，状态恢复为 `verified`，连续失败清零，Planner 再次直接选择百度 recipe。

真实服务也完整经历了这一状态变化。前两次百度 verify 遇到 BrowserWing 已断开的控制连接，能力变为 degraded；第三次触发 blocked，Planner 自动 fallback。继续定位发现 BrowserWing 新实例允许暂时没有活动页，过早执行 `page-info` 会造成假失败。调整为“明确的连接断开导航错误 -> 替换实例 -> 由 navigate 创建活动页 -> 单次重试”后，精确 verify 返回：

```text
HTTP                  = 200
status                = success
capability_status     = verified
consecutive_failures  = 0
planner_eligible      = true
planner selected      = baidu.keyword_search.browserwing_recipe.v1
```

这说明可靠性层能够区分“当前不可用”和“永久删除”：失效能力会退出正常规划，但不会失去修复后的恢复入口。

### 6.6 多站点能力工厂横向回归

为了判断百度是否只是偶然成功，又选择三个无需账号的公开入口。每个站点先用 Draft 样本验证，晋升后再用不同查询执行：

| 平台 | 起始入口 | 样本验证 | 有效结果 | recipe | 二次查询 | 二次结果 |
|---|---|---|---:|---|---|---:|
| Bing | `cn.bing.com` | 开源情报 | 7 | `#sb_form_q -> form -> h2` | 个人知识库 | 5 |
| 搜狗 | `www.sogou.com` | 个人知识库 | 10 | `#query -> form -> div.vrwrap` | 开源情报工具 | 5 |
| CSDN | `so.csdn.net/so/search` | Python Agent | 10 | `#keyword -> #search -> h3` | FastAPI Agent | 5 |

Bing 第一轮曾失败：全局按钮启发式误点了“Search using voice”，页面留在首页，虽然抽到 9 个链接，但没有一个包含样本查询词，因此相关性门禁将 Draft 保持为 failed，没有误晋升。修复方式不是写死 Bing：通用评分降低语音、图片、反馈、设置和下载类控件；没有可信 submit 时，使用输入所属 form。再次验证后最终 URL 正确进入 `/search?q=...`。

同一轮还把主机边界从“用户输入 URL 的原始主机”调整为“首次导航后、重新通过公共 DNS/IP 检查的最终主机”。因此 `cn.bing.com -> www.bing.com` 可以形成 recipe，但搜索提交后的页面仍必须位于这个已验证主机或其子域。

晋升后本地 Catalog 共 8 个能力，其中生成能力为百度、Bing、搜狗和 CSDN。三次二次查询均 `success`、`degraded=false`、未 fallback；使用 `persistence=none` 后情报库仍为 8 documents、13 observations、3 search runs。

### 6.7 0.5.0 搜索到详情组合任务

`0.5.0` 把公开正文读取注册为正式能力：

```text
web.detail_fetch.trafilatura.v1
```

它可通过 `/tasks/execute` 单独规划，也可由 `/tasks/search-and-fetch` 在平台搜索后组合调用。详情最多选择 5 个去重后的 HTTP(S) URL；现有下载器会在初始请求和每次重定向前重新做公共 DNS/IP 校验，并保持 5 次重定向、5 MB 和 HTML/text 类型限制。

Bing 真实组合任务：

| 搜索词 | 搜索能力 | 详情能力 | 尝试 | 成功 | 正文长度 |
|---|---|---|---:|---:|---|
| 国务院 政府工作报告 | `bing.keyword_search.browserwing_recipe.v1` | `web.detail_fetch.trafilatura.v1` | 3 | 3 | 18,400 / 19,938 / 3,841 |

前三条分别落到中国政府网 2025 政府工作报告、中国政府网 2026 政府工作报告和观察者网页面。整体为 `success`、`partial=false`。

CSDN 真实组合任务体现部分失败语义：

| 搜索词 | 尝试 | 成功 | 失败 | 整体状态 |
|---|---:|---:|---:|---|
| FastAPI Agent | 2 | 1 | 1（HTTP 521） | `success / partial=true` |

成功文章抽取到 3,493 字；失败项保留 `source_unavailable` 和源站 HTTP 521，不会导致成功正文丢失。

详情 Manifest 的真实 verify 返回 `200 / success`。在 `0.5.0` 验证时，本地 Catalog 为 9 个能力：5 个静态能力加 4 个生成搜索能力。所有真实组合调用均使用 `persistence=none`，完成后仍为 8 documents、13 observations、3 search runs。

### 6.8 0.6.0 浏览器渲染详情分层

`0.6.0` 没有把 BrowserWing 变成任意 URL 的通用兜底，而是增加了三层详情策略：

```text
Tier 1  web.detail_fetch.trafilatura.v1
        -> no_results / source_unavailable
Tier 2  platform.detail_fetch.browserwing_recipe.v1
        -> 仅 verified/degraded + requested platform 相同 + URL 命中 allowed_host
Tier 3  人工登录的平台专用 Profile Adapter（不由通用 Draft 生成）
```

每条详情现在返回完整的 `attempted_capabilities`、`executed_capability_id` 和 `degraded`。Planner 与组合接口都遵守 direct-first；精确 `/capabilities/{id}/verify` 则用于维护者单独回归某个生成 recipe。

真实样本一：`gov.cn` 结构化长文。Draft 找到 `#ti` 和 `div.content`，验证得到 22,625 字公开渲染文本，晋升为 `gov-cn.detail_fetch.browserwing_recipe.v1`，精确 verify 返回正常中文标题和 22,625 字正文。随后普通 `detail_fetch` 仍只尝试并执行 Trafilatura，得到 22,364 字，证明已注册 BrowserWing recipe 不会改变 direct-first 顺序。

真实样本二：知乎专栏 Tier 2 fallback。对以下样本，Trafilatura 收到 HTTP 403：

```text
https://zhuanlan.zhihu.com/p/1910368867760476348
```

Detail Draft 最初选择 `main[role="main"]`，虽然得到 4,089 字，却把推荐文章也包含进来。容器评分随后增加“多个主标题”和“多篇嵌套 article”聚合惩罚，重新选择 `article.Post-Main.Post-NormalMain`，样本正文收敛为 3,358 字；重新验证和晋升后 manifest 从 `1.0.0` 更新为 `1.0.1`。页面上的“登录/扫码/验证码”导航文字没有被误判成正文认证门禁，因为公开正文实际可读。同一 recipe 又成功读取同主机另一篇非样本文章 1,916 字。

真实 `/tasks/search-and-fetch` 结果：

| 条目 | Tier 1 | Tier 2 | 最终状态 | 正文长度 |
|---|---|---|---|---:|
| 知乎专栏样本 | HTTP 403 | `zhihu.detail_fetch.browserwing_recipe.v1` | success / degraded | 3,358 |
| 第二篇知乎专栏 | HTTP 403 | 同一 recipe | success / degraded | 1,916 |
| `https://www.zhihu.com/` | no_results | 因不匹配 `zhuanlan.zhihu.com` 而未启动 | no_results | 0 |

整体为 `success / partial=true`。调用前后数据库均为 8 documents、13 observations、3 search runs。CSDN 详情样本在 BrowserWing 中出现 `ERR_SSL_PROTOCOL_ERROR`，系统保留为 `source_unavailable`，没有晋升或伪装成功；这条失败也说明“搜索 recipe 已通过”并不自动代表同站详情 recipe 已通过。

另一个公开 B站视频样本在 Trafilatura 中为 `no_results`；Browser Detail Draft 能识别视频标题，但没有找到满足当前长文质量门槛的正文容器，因此状态为 failed、没有晋升。这不是选择器 bug，而是输出契约边界：视频标题、简介、UP 主和指标应进入独立 `video_detail` 模型，不能为了制造“支持 B站详情”的结论而降低文章正文门槛。

## 7. 当前结论

这轮已经证明“万物皆接口”对你的中文个人情报需求有实际用处，但正确实现不是寻找一个万能 CLI，而是建立一个统一控制面，让每类来源使用最合适的获取层：

```text
Maxun Robot        -> B站公开搜索
BrowserWing Profile -> 小红书登录后搜索
BrowserWing Recipe  -> 已验证公开站点的按需搜索
BrowserWing Detail  -> 已验证主机的公开渲染正文 fallback
SearXNG             -> 全网和域名限定发现
Trafilatura         -> 公开文章正文
        ↓
统一 Gateway -> 明确状态、统一字段、去重、SQLite jobs
```

当前版本可以用于低频个人检索、Agent 工具调用和后续来源 POC。它还不是生产级舆情系统，主要缺口是视频描述/问答/帖子等非长文章详情模型、更多站型回归、recipe 版本回滚、公众号全局搜索、更多强登录平台、分页、实体消歧和合规治理。

## 8. 下一阶段建议

按价值与风险排序：

1. 为视频描述、问答回答、帖子正文定义独立输出类型和质量门槛，不把所有详情强塞进“200 字长文章”；
2. 为运行时 recipe 增加定期 `verify`、人工审计记录、选择器漂移告警、版本升级和回滚；
3. 优先补公众号已知文章、B站视频详情、知乎问答和公开新闻站四类按需详情小样本，再决定是否需要平台专用 Adapter；
4. 再评估 LLM 辅助探索，让模型提出候选选择器和动作，但确定性验证门禁仍不可跳过；
5. 强登录平台继续使用专用 Adapter 与用户人工 Profile；小红书、微博等不进入通用 Draft，也不把外部 `site:` 发现误称为站内完整索引；
6. 在任何商业化或多人服务之前，单独评估 Maxun 与 SearXNG 的 AGPL 网络服务义务，以及平台条款、个人信息、浏览器 URL 安全和内容存储周期。
