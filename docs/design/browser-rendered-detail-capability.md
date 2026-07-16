# ADR-001：浏览器渲染详情能力的分层与生命周期

- 状态：Accepted
- 日期：2026-07-16
- 适用版本：Intelligence Gateway 0.6.x
- 决策范围：从搜索结果 URL 读取公开详情；不涉及绕过登录、验证码或付费保护

## 1. 背景

Gateway 0.5.0 已经形成：

```text
keyword_search Capability
  -> 搜索结果 URL
  -> web.detail_fetch.trafilatura.v1
  -> 公开 HTML/text 正文
```

Trafilatura 是默认详情能力，因为它不执行页面脚本、逐跳检查 URL、成本低且输出稳定。但以下公开页面可能只在浏览器渲染后出现正文：

- HTML 只包含客户端应用壳；
- 正文由站点公开接口在页面加载后注入；
- 页面结构稳定，但服务器直出文本少于质量门槛。

不能把所有失败 URL 直接交给通用浏览器。浏览器执行脚本、共享本地 Profile，安全面和维护成本都明显更高；登录墙、验证码和账号内容也不能因为浏览器“看得到”就自动进入通用能力。

## 2. 决策

详情读取采用分层能力梯子：

```text
Tier 1  public_html
        Trafilatura，默认首选
              |
              | no_results / 明确脚本壳
              v
Tier 2  public_browser_recipe
        只使用已验证、限定主机、只读的 BrowserWing recipe
              |
              | authentication gate
              v
Tier 3  authenticated_platform_adapter
        用户人工登录的专用 Adapter；不由通用 Draft 自动生成
```

核心原则：

1. direct first：公开 HTTP 抽取永远先于浏览器渲染；
2. registered fallback only：只有目标平台已经存在 verified/degraded 的 detail recipe，才允许进入 Tier 2；
3. no blind browser fallback：未知 URL 的 Trafilatura 失败不会自动启动 BrowserWing；
4. exact evidence：每条详情必须报告尝试过的 capability、最终执行者和失败原因；
5. no implicit persistence：搜索和详情默认都不落库；
6. auth is a boundary：发现登录或验证码门禁时停止，不生成通用可用能力。

## 3. Detail Draft 契约

第一版 `detail_fetch` Draft 使用一个公开样本详情 URL：

```json
{
  "platform": "example",
  "action": "detail_fetch",
  "start_url": "https://example.com/article/1",
  "description": "Public rendered article detail"
}
```

`sample_query` 只属于 `keyword_search`，detail Draft 不需要伪造查询词。

生命周期与搜索 Draft 相同：

```text
proposed -> inspected -> validated -> promoted
                         \-> failed
```

但各状态证据不同：

| 阶段 | 搜索 Draft | 详情 Draft |
|---|---|---|
| inspect | 输入、提交控件 | 标题候选、正文容器候选、文本长度 |
| validate | 样本查询与结果相关性 | 最终主机、标题、正文长度、认证门禁 |
| recipe | 输入/提交/结果选择器 | allowed host、标题/正文选择器、最小正文长度 |
| promote | keyword_search manifest | detail_fetch manifest |

## 4. Detail Recipe

第一版确定性 recipe：

```json
{
  "sample_url": "https://example.com/article/1",
  "allowed_host": "example.com",
  "title_selector": "h1",
  "content_selector": "article",
  "minimum_text_chars": 200,
  "maximum_text_chars": 200000
}
```

运行时输入不是固定 `sample_url`，而是同一受控主机下的新详情 URL。

晋升条件：

- 初始和导航后 URL 都通过公共地址检查；
- 最终主机等于 `allowed_host` 或其子域；
- 页面标题非空；
- 选定正文容器至少 200 字；
- 正文容器不是整个导航页、页脚或登录弹层；
- 没有“正文不可用且认证/验证码门禁存在”的情况；
- recipe 再执行一次仍得到同一主机和合格正文。

## 5. 正文容器选择

候选来源：

```text
article
main
[role=main]
[class*=article]
[class*=content]
[class*=post]
[class*=detail]
```

评分只用于提出候选，不直接代表验证通过。评分考虑：

- 可见文本长度；
- 段落数量；
- 标题数量；
- 链接文字占比；
- 候选节点占整页文字比例；
- `article/main` 语义标签加分；
- 一个候选内出现多个主标题或多篇嵌套 `article` 时按聚合内容降分；
- 导航、页脚、评论、推荐、登录类标记降分。

输出正文时只读取 `innerText`，不执行点击、表单提交、滚动翻页或站点私有接口调用。

## 6. 详情选择策略

`/tasks/search-and-fetch` 对每个 URL 独立执行：

```text
1. web.detail_fetch.trafilatura.v1
2. 如果失败，并且 requested platform 有已注册 browser detail recipe：
   platform.detail_fetch.browserwing_recipe.v1
3. 否则保留 Tier 1 失败，不临时探索或生成能力
```

每条响应新增：

```text
attempted_capabilities
executed_capability_id
degraded
```

语义：

- Trafilatura 成功：`degraded=false`；
- BrowserWing recipe 成功：`degraded=true`，因为安全面和选择器维护成本更高；
- 两者都失败：保留最后错误和完整 attempted chain；
- 一条详情失败不影响其他详情成功。

通用 `/tasks/execute` 的 `detail_fetch` Planner 也使用同一顺序。维护者需要单独回归某个生成 recipe 时，使用 `/capabilities/{capability_id}/verify` 精确执行；精确验证不代表默认任务可以跳过 Tier 1。

## 7. 安全边界

### Tier 1

- 每次重定向前重新解析 DNS/IP；
- 拒绝私网、回环、链路本地、保留、多播和未指定地址；
- 最大 5 次重定向、5 MB；
- 只读取 HTML/XHTML/text。

### Tier 2

- 导航前执行公共 URL 检查；
- 导航后再次检查最终 URL；
- 请求主机和最终主机必须落在 recipe `allowed_host` 边界；
- 共享 BrowserWing Profile 锁，低频串行；
- 不截图、不导出 Cookie、不读取 localStorage；
- 不点击登录、同意、验证码、展开全文或下载按钮；
- Gateway 继续只绑定 `127.0.0.1`。

浏览器在页面脚本执行前不能像 HTTP 下载器一样逐跳阻断所有重定向，因此 Tier 2 是受控本地能力，不应描述为完全消除了浏览器 SSRF。

## 8. 可靠性

生成的 detail recipe 复用 0.4.1 可靠性状态：

```text
success -> verified / failures=0
failure 1-2 -> degraded
failure 3 -> blocked
blocked -> Planner 不再选用
exact verify success -> restored verified
```

正文长度不足、选择器失效、最终主机越界和认证门禁都属于验证失败证据。

## 9. 非目标

第一版不做：

- 登录后文章、私信、评论或账号主页详情；
- 自动点击“展开全文”；
- 验证码识别或绕过；
- 付费内容；
- 浏览器下载媒体；
- 任意 LLM 自主点击；
- 自动保存全部正文；
- 对所有 Trafilatura 失败页面临时生成 Draft。

## 10. 验收标准

1. keyword_search Draft 兼容不回归；
2. detail Draft 可以独立 create/inspect/validate/promote；
3. 生成 detail capability 可由 `/capabilities/{capability_id}/verify` 精确执行，并可被 `/tasks/execute` 作为 Tier 2 fallback；
4. search-and-fetch 先尝试 Trafilatura，只在已注册 recipe 存在时 fallback；
5. 每条详情报告 attempted/executed capability；
6. 私网 URL、主机越界、正文过短和认证门禁不能晋升；
7. 所有详情默认不落库；
8. 至少一个公开脚本渲染或结构化详情样本真实通过。

## 11. 真实验收证据

2026-07-16 已完成两类真实公开页面验证：

| 平台/页面 | Tier 1 | Browser detail recipe | 结果 |
|---|---|---|---|
| 中国政府网结构化长文 | Trafilatura 成功，22,364 字 | 精确 verify 成功，22,625 字 | 即使 recipe 已注册，普通任务仍只执行 Tier 1 |
| 知乎专栏公开文章 | HTTP 403 | `zhihu.detail_fetch.browserwing_recipe.v1` | fallback 成功，3,358 字 |
| 同主机第二篇知乎专栏 | HTTP 403 | 同一 recipe | fallback 成功，1,916 字 |
| 知乎首页 | no_results | recipe 仅允许 `zhuanlan.zhihu.com` | 未启动 BrowserWing |
| 一个公开 B站视频样本 | no_results | 能识别标题但无合格长文容器 | Draft failed，不晋升 |

真实 `/tasks/search-and-fetch` 同时处理后三条，得到 `2 success + 1 no_results`、整体 `success / partial=true`。每条响应均包含完整 attempted/executed/degraded evidence，数据库前后保持 8 documents、13 observations、3 search runs。

CSDN 公开详情样本在当前 BrowserWing 会话中导航得到 `ERR_SSL_PROTOCOL_ERROR`，因此保留为 `source_unavailable`，没有晋升。该失败被视为能力级证据：同平台搜索 recipe 通过，不等于详情 recipe 自动可用。

B站负面样本说明本 ADR 的 `detail_fetch` 第一版实际是长文详情契约。视频简介、UP 主、时长、播放指标等字段需要独立 `video_detail` 输出与质量门槛，不通过放宽 200 字文章阈值塞入本能力。

知乎首次候选选择了包含推荐内容的 `main[role="main"]`。加入多主标题和嵌套文章聚合惩罚后，候选收敛到单篇 `article.Post-Main.Post-NormalMain`；Draft 重新验证后再次 promote 会更新 recipe、清零旧失败状态并递增 manifest patch 版本，本次从 `1.0.0` 更新到 `1.0.1`。

当前完整 Gateway 自动化回归为 `89 passed`；其中详情能力继续覆盖 Draft 模型与 SQLite 兼容、正文容器验证、认证门禁、主机越界、selector 漂移、direct-first、无 recipe/host 不匹配时禁止启动浏览器，以及默认不持久化。
