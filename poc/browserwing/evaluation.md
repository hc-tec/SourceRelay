# BrowserWing 中文信息源 POC：第一轮实测报告

> 实测日期：2026-07-15  
> BrowserWing：`1.1.1-beta.1`  
> 环境：Windows、Node.js 24.13.0、Google Chrome、本地隔离 Profile  
> 本轮范围：无需人工登录的公开页面和一个自定义 B站关键词搜索 Adapter。

## 结论

BrowserWing 适合作为中文个人情报系统的**原型采集层和浏览器 Adapter 开发工具**，但当前不能直接作为无人值守的生产采集层。

实测确认的优势：

- B站热门、微博热搜、今日头条、36氪、贴吧、掘金、知乎日报可以匿名取得结构化结果。
- B站关键词搜索无需 LLM 即可通过浏览器控制和 DOM 抽取实现；三个测试关键词都取得首屏 30 条。
- BrowserWing 服务同时注册了 86 个 MCP 命令，现有脚本可直接暴露给 Agent。
- CLI 输出适合快速原型，浏览器 Profile 可隔离在 POC 目录。

实测确认的风险：

- 知乎热榜和知乎搜索被重定向到登录页，但命令仍以退出码 0 返回空数组。
- 小红书搜索未登录时同样以退出码 0 返回空数组。
- `weixin-hot` 实际返回微信读书飙升榜中的书籍，不是微信公众号文章，更不是公众号关键词搜索。
- B站首屏搜索包含课程、推广或重复卡片，不能把所有卡片都视为视频。
- 页面语义失败不会稳定映射为进程失败，上层必须增加登录墙、空结果和目标 URL 健康检查。
- 目前的自定义搜索只覆盖首屏；翻页、时间排序、详情补全和增量去重仍需继续实现。

## 1. 隔离与安全处理

- BrowserWing 通过本地 npm 依赖安装，没有全局安装。
- 数据库、Chrome Profile、Cookie 和运行期数据均位于被忽略的 `runtime/`。
- 服务只监听 `127.0.0.1:8080`。
- 没有配置 LLM API Key。
- 没有输入或导出任何账号密码、Cookie、Token 或验证码。
- 知乎登录墙截图包含临时二维码，仅保存在被忽略的 `screenshots/private/`，不进入版本化报告。

BrowserWing 第一次初始化时会先根据操作系统 Home 生成默认 Profile 路径，然后在后续启动时同步 `config.toml`。POC 的启动脚本已将子进程 Home 指向被忽略的 `runtime/home/`，避免首次运行路径落到普通用户目录。

## 2. 公开热榜连续运行测试

五个脚本分别连续运行 3 次：

| 脚本 | 成功 | 平均耗时 | 每次条数 | 字段 | 结论 |
|---|---:|---:|---:|---|---|
| `bilibili-hot` | 3/3 | 7.434 秒 | 100 | author、play、rank、title、url | 稳定，可直接用于热榜采集 |
| `zhihu-hot` | 0/3 | 8.699 秒 | 0 | 无 | 匿名访问被重定向到登录页 |
| `weibo-hot` | 3/3 | 8.453 秒 | 30 | category、heat、rank、title、url | 稳定，但只是热搜榜 |
| `toutiao-hot` | 3/3 | 11.450 秒 | 50 | heat、rank、title、url | 稳定，但耗时相对更长 |
| `36kr-hot` | 3/3 | 7.897 秒 | 21 | rank、title、url | 稳定，适合作为新闻热榜入口 |

原始汇总：[public-run-summary.json](samples/public-run-summary.json)

公开样本：

- [B站热门](samples/bilibili-hot.sample.json)
- [微博热搜](samples/weibo-hot.sample.json)
- [今日头条](samples/toutiao-hot.sample.json)
- [36氪](samples/36kr-hot.sample.json)

### 关键失败：知乎登录墙没有被识别为错误

BrowserWing 访问 `https://www.zhihu.com/hot` 后，最终页面是：

```text
https://www.zhihu.com/signin?next=%2Fhot
```

页面只有短信、密码、扫码和第三方登录入口，没有热榜内容。内置脚本因选择器匹配不到任何热榜条目而返回 `[]`，但退出码仍是 0。

这说明生产 Adapter 不能只判断：

```text
exit_code == 0
```

还必须判断：

```text
最终 URL 是否仍在目标页面
结果条数是否异常为零
页面是否出现登录/验证码/访问异常标志
首条数据是否满足预期 Schema
```

## 3. 其他公开脚本单次验证

| 脚本 | 结果 | 耗时 | 字段 |
|---|---:|---:|---|
| `zhihu-daily` | 20 条 | 9.329 秒 | rank、title、url |
| `tieba-hot` | 30 条 | 9.171 秒 | description、discussions、rank、title、url |
| `juejin-hot` | 30 条 | 7.855 秒 | hot、rank、title、url |
| `weixin-hot` | 20 条 | 12.774 秒 | author、rank、title、url |
| `xiaohongshu-search --keyword=DeepSeek` | 0 条 | 14.241 秒 | 无 |

### `weixin-hot` 的命名具有误导性

内置列表把它描述为“获取微信公众号热门文章”，但实际 URL 全部属于：

```text
https://weread.qq.com/web/reader/...
```

结果内容是微信读书飙升榜中的书籍，例如书名、作者和阅读器 URL。它与公众号文章搜索没有直接关系。样本见：[weixin-hot.sample.json](samples/weixin-hot.sample.json)。

因此在我们的系统中不应命名为 `wechat_official_account_hot`，只能命名为：

```text
weread_rising_books
```

## 4. 自定义 B站关键词搜索 Adapter

BrowserWing 当前没有预置 `bilibili-search`，本轮使用浏览器控制接口实现了一个不依赖 LLM 的确定性脚本：

[run-bilibili-search.ps1](scripts/run-bilibili-search.ps1)

调用示例：

```powershell
./scripts/run-bilibili-search.ps1 -Keyword "DeepSeek" -Limit 30
```

输出已经包含最小 Adapter 元数据：

- `source_platform`
- `operation`
- `query`
- `query_scope`
- `fetched_at`
- `partial`
- `item_count`
- `items_with_url`
- `warnings`
- `items`

### 三个关键词结果

| 关键词 | 条数 | 有直接视频 URL | 耗时 | 第一条标题 |
|---|---:|---:|---:|---|
| DeepSeek | 30 | 27 | 6.646 秒 | DeepSeek V4.1即将发布…… |
| 低空经济 | 30 | 25 | 6.640 秒 | 6700亿的低空经济，是真风口？还是“空中泡沫”？ |
| 个人知识库 | 30 | 23 | 6.689 秒 | 个人知识库怎么搭？最简单Obsidian入门教程…… |

DeepSeek 另外重复运行两次，分别耗时 6.555 秒和 6.162 秒，均返回 30 条，其中 27 条带视频 URL。因此本轮 DeepSeek 搜索为 3/3 成功。

样本：

- [DeepSeek](samples/bilibili-search-deepseek.sample.json)
- [低空经济](samples/bilibili-search-low-altitude-economy.sample.json)
- [个人知识库](samples/bilibili-search-personal-knowledge-base.sample.json)

### 仍需修正的数据质量问题

部分结果没有 `/video/` URL，主要是课程、推广或非标准卡片。当前 Adapter 保留这些卡片，同时通过 `items_with_url` 暴露数量差异，便于诊断。

进入正式 Adapter 前应增加：

1. 只保留存在 BV 视频 URL 的卡片，或明确标记 `content_type`。
2. 以规范化 BV URL 去重。
3. 区分播放量和弹幕量，解析中文数量单位。
4. 抓取发布时间、视频时长和描述。
5. 支持“最新发布”等排序选项。
6. 实现第二页和后续页，并记录页码/游标。
7. 对页面卡片数量骤降设置健康告警。

## 5. MCP 能力

运行中的 BrowserWing 报告：

```text
running: true
command_count: 86
```

内置脚本均已注册为 MCP 命令，包括：

- `bilibili_hot`
- `weibo_hot`
- `weibo_search`
- `zhihu_hot`
- `zhihu_search`
- `xiaohongshu_search`
- `toutiao_hot`
- `kr36_hot`
- `cnki-search`
- `wanfang-search`
- `gov-policy`
- `gov-law`

但“注册成 MCP Tool”只说明 Agent 能调用，不说明工具本身会成功。知乎和小红书的空数组案例证明，MCP 层仍需统一的语义错误和健康检查包装。

## 6. 当前评分

| 维度 | 评分 | 依据 |
|---|---:|---|
| 中文来源预置程度 | 4/5 | 已有大量中文热榜、搜索和学术/政策脚本 |
| POC 开发效率 | 4.5/5 | 一条 URL + DOM 抽取即可快速构造搜索 Adapter |
| 无登录公开来源 | 4/5 | 多个热榜 3/3 成功 |
| 登录平台可用性 | 3.5/5 | 小红书登录和重启复用通过，但必须替换过期的内置搜索流程 |
| 错误语义 | 1.5/5 | 登录墙和空结果仍返回退出码 0 |
| 数据完整性 | 2.5/5 | 多数预置搜索只取首屏，字段不统一 |
| 可观测性 | 2.5/5 | 有日志和状态，但缺少平台级语义健康检查 |
| 生产可用性 | 2/5 | 需要正式 Adapter、分页、重试、Schema 和监控包装 |
| Agent 集成 | 4/5 | CLI、HTTP、MCP 和 Skill 路线齐全 |

## 7. 人工登录后的受控验证

用户已经在本地专用 Chrome Profile 中完成人工登录，没有向 Agent 提供任何账号、Cookie、Token、验证码或二维码。

本轮先完成小红书，知乎和微博仍建议按顺序继续：

1. 小红书：搜索与 Profile 重启复用已经完成；详情和用户主页待测。
2. 知乎：登录后重新运行 `zhihu-hot` 和 `zhihu-search`。
3. 微博：登录后运行 `weibo-search`。

每个平台先运行 1 次确认字段，再连续运行 3 次；暂时不测试发布、评论、关注等写操作。

登录测试的验收重点：

- BrowserWing 重启后登录状态是否保留；
- Headless 模式能否复用人工登录状态；
- 搜索结果是否仍限制为当前页 20 条；
- URL 是否携带短期 Token；
- 详情页是否能在同一 Profile 中打开；
- 空结果、登录失效和验证码是否能被明确区分。

## 8. 阶段性选型意见

现在可以确认：BrowserWing 值得继续保留，但合理位置是：

```text
页面探索 + 登录 Profile + 录制/快速 Adapter + Agent 长尾处理
```

不建议直接让它承担：

```text
全平台批量搜索 + 长期调度 + 强 SLA + 无人维护
```

一旦某个平台流程验证稳定，应将其固化为带分页、Schema、重试、语义错误和回归样本的专用 Adapter，再通过 FastMCP、CLI-Anything 或 HTTP 暴露给上层。

## 9. 小红书登录后实测补充

### 内置脚本未通过

登录后，BrowserWing 内置 `xiaohongshu-search` 仍不能作为当前站点的稳定搜索接口：

- 无头运行超过 60 秒没有返回；
- 可见模式运行超过 90 秒没有返回；
- BrowserWing 把浏览器实例标记为 active，但没有登记 active page；
- 直接导航旧的 `/search_result?keyword=...` 路由会发生超时或异常进入某条笔记详情。

原因不是登录失败。当前小红书网页从首页可见搜索框进入的是：

```text
/search_result_ai?keyword=...&source=web_explore_feed
```

而内置脚本仍然直接访问旧的 `/search_result` 路由。除此之外，小红书会从会话状态恢复上一次打开的笔记浮层，需要在搜索前识别并关闭。

### 自定义状态化 Adapter 通过

已经新增：[run-xiaohongshu-search.ps1](scripts/run-xiaohongshu-search.ps1)。

它执行以下确定性步骤：

1. 启动或复用隔离 BrowserWing Profile。
2. 访问小红书 Explore。
3. 如果恢复了上次打开的笔记浮层，通过浏览器历史返回列表页。
4. 选择当前可见的真实搜索输入框。
5. 使用浏览器原生文本插入事件更新站点受控输入状态。
6. 进入当前 `/search_result_ai` 路由。
7. 验证页面标题确实对应请求关键词，避免把热门占位词误当查询结果。
8. 抽取首屏 note cards。
9. 删除 URL 中短期 `xsec_token`，只保存规范化笔记 URL。

### 连续运行结果

| 测试 | 成功 | 耗时 | 结果区块 | 有规范化 URL |
|---|---:|---:|---:|---:|
| DeepSeek 第 1 次 | 是 | 20.337 秒 | 22 | 20 |
| DeepSeek 第 2 次 | 是 | 19.683 秒 | 22 | 20 |
| DeepSeek 第 3 次 | 是 | 19.601 秒 | 22 | 20 |
| 服务和 Chrome 完全重启后的 DeepSeek | 是 | 19.833 秒 | 22 | 20 |
| 低空经济 | 是 | 19.961 秒 | 20 | 20 |
| 个人知识库 | 是 | 19.351 秒 | 22 | 20 |

这证明：

- 人工登录状态可以跨 BrowserWing 和 Chrome 进程重启保存；
- 当前小红书关键词搜索在低频个人 POC 中可用；
- BrowserWing 的浏览器控制底座有价值；
- BrowserWing 自带适配器不能被视为持续更新的生产连接器；
- 正式系统必须拥有自己的页面状态机、路由验证和数据健康检查。

结构化汇总：[xiaohongshu-run-summary.json](samples/xiaohongshu-run-summary.json)。

脱敏公开样本：

- [DeepSeek](samples/xiaohongshu-search-deepseek.sample.json)
- [低空经济](samples/xiaohongshu-search-low-altitude-economy.sample.json)
- [个人知识库](samples/xiaohongshu-search-personal-knowledge-base.sample.json)

当前 POC 有意没有保存短期 `xsec_token`。这会提高数据安全性和去重稳定性，但部分笔记详情可能需要在打开时重新通过搜索页取得有效上下文，因此下一轮详情 Adapter 应把“规范化内容 ID”和“临时访问上下文”分开管理。

### 笔记详情验证未通过

从“个人知识库”搜索页点击第一条笔记后，最终进入：

```text
/404
当前笔记暂时无法浏览，请打开小红书 App 扫码查看
```

进一步检查当前 `/search_result_ai` 页面发现，笔记卡片只提供：

```text
/explore/{note_id}
```

DOM 链接本身没有 `xsec_token`。也就是说，本轮可以稳定取得标题、作者、点赞数和内容 ID，但不能假设规范化 URL 可以直接在网页端打开详情。

这对系统设计有两个直接影响：

1. 搜索发现和详情获取必须拆成两个 Adapter 能力，分别记录健康状态。
2. 规范化内容 ID 可以长期存储；短期访问上下文若确有必要，应放在加密、短生命周期的运行时存储中，不能混入公开样本、日志或长期数据表。

因此，小红书当前阶段的能力评级是：

```text
关键词发现：通过
首屏元数据：通过
登录状态跨重启：通过
规范化内容 ID：通过
网页详情正文：未通过
分页与增量：未验证
```
