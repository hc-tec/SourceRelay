# DeepAgents + Intelligence Gateway 真实验证记录

日期：2026-07-16
分支：`research/deepresearch-swarm`

## 验证目标

使用根目录 `.env` 中的 DeepSeek 配置，通过 DeepAgents/LangGraph PoC，只调用
Intelligence Gateway，查询固定主题“低空经济”在知乎、B站、微博的公开信息。

约束：

- 每个平台最多 3 条搜索结果；
- 不调用公众号、任意网页浏览器或框架自带搜索服务；
- 记录 `status`、`executed_capability_id`、`attempted_capabilities`、
  `degraded`、`partial`、结果数量和 URL；
- `source_unavailable`、`authentication_required`、`no_results` 不得改写成成功；
- 不把模型最终中文报告当作唯一证据，以 Gateway tool trace 为准。

机器 trace 原始文件位于被 Git 忽略的本地路径：

```text
runtime/validation/deepagents_gateway_trace_2026-07-16.json
```

## 环境修正

第一次运行全部收到 502，但 Gateway 健康检查是 200。排查发现：

1. Windows 系统代理通过 Internet Options 被 `httpx` 自动继承，即使进程环境中没有
   `HTTP_PROXY`；
2. 本地 Gateway 请求被发送到了系统代理 `127.0.0.1:7897`，Gateway access log 没有
   收到对应请求；
3. Gateway 进程当时是早期旧实例，内存 Capability Catalog 只有 11 项，磁盘目录实际
   已有 22 个静态 manifest 加 6 个 runtime recipe。

已处理：

- `GatewayClient` 对 `127.0.0.1`、`localhost`、`::1` 默认 `trust_env=False`，本地
  Gateway 直连；远程 Gateway 默认仍可继承系统代理；
- 重启 Gateway，当前实例加载完整 28 项能力；
- 适配器在客户端本地校验 `search`、`search_and_fetch`、`hotlist` 的数量边界，
  无效参数不会再发到 Gateway。

## 真实运行结果

Gateway 重启后：

```text
GET /health       200
GET /capabilities 200，count=28
DeepAgents trace  7 个 Gateway tool 事件
```

### 机器 trace 逐项结果

| 序号 | 工具 | 关键输入 | status | executed / attempted | degraded / partial | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gateway_capabilities` | `status=verified` | success | 无执行能力 | false / false | 成功发现已验证能力 |
| 2 | `gateway_search_and_fetch` | `platform=web, detail_limit=0` | error | HTTP 422 | false / false | Gateway 正确拒绝非法参数；现已在客户端前置校验 |
| 3 | `gateway_search_and_fetch` | `platform=web, detail_limit=1` | no_results | HTTP 200；详情未成功 | false / true | 搜索候选存在，但公开正文 hydration 失败 |
| 4 | `gateway_search` | `platform=web, site=bilibili.com` | success | `web.keyword_search.searxng.v1` → Bing → Sogou | true / false | 3 条，均为外部站点发现，URL 有 Sogou 包装 |
| 5 | `gateway_search` | `platform=web, site=zhihu.com` | success | `web.keyword_search.searxng.v1` → Bing → Sogou | true / false | 3 条，均为外部站点发现，URL 有 Sogou 包装 |
| 6 | `gateway_search` | `platform=web, site=weibo.com` | success | `web.keyword_search.searxng.v1` → Bing → Sogou | true / false | 3 条，均为外部站点发现，URL 有 Sogou 包装 |
| 7 | `gateway_search` | `platform=bilibili` | success | `bilibili.keyword_search.maxun.v1` | false / false | 3 条 B站结果，包含 1 条推广行 |

### Gateway Planner 对照

重启后的真实 `/tasks/plan` 结果：

| 请求 | selected capability | fallback | degraded | 结论 |
| --- | --- | --- | --- | --- |
| `zhihu + keyword_search` | `web.keyword_search.searxng.v1` | Bing、Sogou | true | 没有已验证的知乎原生关键词搜索；只能 `site:zhihu.com` 外部发现 |
| `bilibili + keyword_search` | `bilibili.keyword_search.maxun.v1` | Web/SearXNG | false | 有原生能力，但需要 local API key/Maxun 模板 |
| `weibo + keyword_search` | `web.keyword_search.searxng.v1` | Bing、Sogou | true | 没有已验证的微博原生关键词搜索；现有能力是热榜和已知账号帖子 |

## 结论

### B站：原生关键词搜索已打通

实际成功调用：

```text
status=success
executed_capability_id=bilibili.keyword_search.maxun.v1
attempted_capabilities=[bilibili.keyword_search.maxun.v1]
degraded=false
item_count=3
```

当前依赖 Maxun local API key 和已配置模板；Gateway warning 说明新查询词可能需要
复制模板。结果中出现 1 条推广行，已由 Gateway 保留 `promoted` 语义，不能直接当作
自然结果。

### 知乎：当前只能外部发现，不能声称“知乎搜索已支持”

知乎没有已验证的 `keyword_search` capability。`site:zhihu.com` 搜索可以得到摘要，
但本次最终走到 Sogou BrowserWing recipe，结果 URL 是 `sogou.com/link?...` 包装链接，
不是规范知乎直链；后续详情 hydration 也没有成功。因此当前应标注：

```text
知乎关键词搜索：degraded / external discovery only
知乎问答详情：已有独立 qa_detail capability
知乎专栏详情：已有独立 detail_fetch recipe
```

二者不能混写成“知乎全站搜索可用”。

### 微博：当前只有热榜和已知账号帖子能力

微博没有已验证的 `keyword_search` capability。外部 `site:weibo.com` 搜索能拿到摘要，
但仍然受上游索引、Sogou 跳转 URL 和详情抓取失败影响。当前应标注：

```text
微博关键词搜索：degraded / external discovery only
微博热榜：已有 NewsNow hotlist_fetch capability
微博已知账号第一页：已有 BrowserWing account_posts capability
```

### DeepAgents PoC：Gateway-only 边界有效，但最终报告需要机器审计

本次 trace 证明：

- DeepAgents 可以只使用 `gateway_*` 工具；
- Gateway 失败状态和降级链可以穿过 Agent tool message；
- 本地系统代理问题被适配层发现并修复；
- 仅依靠模型最终表格仍会混合搜索和详情阶段，甚至主动尝试非法参数；
- 因此最终产品必须把 trace、Gateway 响应和 Citation Auditor 放在模型报告之上。

## 2026-07-16 后续修复和复核

本节是在上面的历史真实 trace 基础上补做的代码与受限网络复核；没有再次调用模型，
也没有把新结果伪装成一次完整 DeepAgents 重跑。

1. 已完成确定性 Citation Auditor。它只读取 UTF-8 Gateway tool trace，生成
   coverage_status、claim_status、机器可读 gaps、逐条 event/stage/capability/raw_ref
   provenance，并拒绝 Sogou/Bing/Baidu 跳转、平台首页、推广行、空 URL 和不匹配平台
   的 URL。expected platform 未被调用时明确显示 not_attempted。
2. 历史 trace 已离线复核。B站为 native_success + citable，存在 2 条规范视频 URL；
   知乎和微博均为 external_discovery_only + uncitable，历史 Sogou 包装 URL 仍被拒绝，
   没有被事后错误地改写为平台原生搜索成功。B站较早的站外 Sogou 事件不会把原生
   Maxun 覆盖状态改成降级：审计单独展示覆盖事件的 flags 与所有观测事件的 flags。
3. 已完成 Sogou 跳转 URL 的安全归一化。只读取精确公开包装页的静态 redirect，不带
   Cookie/Referer、不使用 BrowserWing Profile、不执行 JavaScript、不抓取目标内容；
   目标必须通过公网与 site hostname 边界校验。真实复核了历史的一条知乎包装链接，
   得到 www.zhihu.com 目标，解析方法为 sogou_html_location；该检查没有访问目标内容页。
4. 真实 Gateway 重启后，首次 limit=1 的 Sogou 请求正确暴露了一个假阴性：页面正常
   填入查询、form 提交、得到 1 条相关包装结果且没有登录/验证码标记，但 BrowserWing
   运行时把 limit=1 直接注入抽取脚本后，又用至少两条结果的 recipe 回归门槛拒绝。
   修复为内部至少抽取两条用于验证，归一化和去重后仍按 API limit 截断。重启服务后的
   同一受控请求已成功返回 1 条 https://www.zhihu.com/question/648380958；它保留
   discovery_url、sogou_html_location 和 target_fetched=false，未抓取知乎目标正文。
   该结果仍是 external discovery，而不是知乎原生关键词搜索。
5. 当前自动化回归：Intelligence Gateway 全量 124 passed；安装可选 deepagents
   运行时后，适配器测试 27 passed（包含不发起模型调用的 DeepAgents 构图检查）。
   新 trace v2 投影和离线审计 CLI 都由离线测试覆盖。

直接 Gateway 的 Sogou URL 归一化复核已经完成；仍待补的是一次完整 DeepAgents v2
trace 与 audit 重跑。那次运行应验证蜂群调用链和新 evidence projection，不应改变以下
边界：知乎、微博在没有 Draft -> inspect -> validate -> promote 的原生关键词能力前，
仍只能表述为外部发现。

## 2026-07-17 DeepAgents v2 受控重跑

已在重启后的 Gateway 上完成一次受控 DeepAgents 运行；所有内容调用仍只通过
gateway tools，运行只写本地被忽略的 trace 和 audit，不写情报数据库。v2 trace 有
schema version、event_index 和 evidence_items，并生成了独立的 UTF-8 audit。

机器审计结果：

| 平台 | 覆盖状态 | 可引用状态 | 规范引用 | 事实边界 |
|---|---|---|---:|---|
| B站 | native_success | citable | 4 条视频 URL | Maxun 原生关键词结果；另有 1 条 promoted 行被排除。 |
| 知乎 | external_discovery_only | citable | 1 条知乎 URL | 实际是 Bing 的 site 外部发现 fallback；另有百度百科、新闻和政务页被审计器排除，不能称知乎原生搜索。 |
| 微博 | external_discovery_only | citable | 4 条微博 URL | 实际是 Sogou 的 site 外部发现 fallback；4 个包装链接经受限静态解析为微博规范 URL，目标正文未抓取。 |

Gateway 现在会把实际生效的 site fallback 写入结构化 collection_scope；Citation
Auditor 也兼容旧 trace 的受控 planner warning。于是 Bing/Sogou 的站外发现被明确标为
external_discovery_only，而不是 native_success；报告不得将它改写为知乎或微博站内
关键词搜索已打通。

本次运行结束时，trace 与 audit 已先成功写入；随后模型最终中文回答包含一个 Unicode
勾选符，Windows PowerShell 的 GBK stdout 在最后 print 时抛出编码异常。该异常没有
影响数据调用或证据文件。示例现已在启动时显式将 stdout 重配为 UTF-8，并用中文加
Unicode 字符的本地输出探针验证；没有为修复输出问题重复发起模型调用。

## 后续工作

1. 已完成机器化 Citation Auditor：模型不能自行填充能力 ID、状态、结果数量或 URL；
2. 已完成 Sogou recipe 的跳转 URL 归一化：失败包装链接不会作为知乎、微博原始规范
   URL 返回；
3. 分别研究知乎关键词搜索和微博关键词搜索的原生 BrowserWing/公开页面路径，先做
   Draft → inspect → validate，再决定是否注册 capability；
4. 对 B站推广结果做显式过滤或在研究 Agent 提示中区分自然结果和 promoted 行；
5. 用同一套 trace 机制验证 NewsNow 热榜、知乎问答详情、微博账号帖子和 B站视频详情；
6. 暂不把本次 `site:` fallback 结果写成平台完整索引，也不因为一次 Sogou 成功就提高
   知乎/微博原生搜索就绪等级。
