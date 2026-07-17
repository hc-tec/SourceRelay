# `hc-tec/my-collection-skills` 可行性与接入边界（2026-07-17）

> 审计对象：[hc-tec/my-collection-skills](https://github.com/hc-tec/my-collection-skills)，`main` 于 2026-07-17 读取到的 HEAD 为 `cc55cb295124138b7515a669bfc9e1aed8e1f6dc`（2026-02-09）。仓库使用 MIT License；GitHub API 当时显示 0 个 open issues。本文基于只读源码审计，没有使用任何账号、Cookie、CookieCloud 服务或平台页面。

## 一句话判断

**有价值，但它不是全平台站内搜索方案。**

它很好地解决了“读取我自己已经收藏的 B 站、知乎、小红书内容，并转成可分析文本”这一类个人私有知识入口；它没有实现微博、公众号、新闻站，也没有任何全站 `keyword_search` 功能。因此：

```text
适合作为：我的收藏 / 私有资料源的策略参考或未来专用 Adapter
不适合作为：知乎、微博、小红书等平台的全站关键词搜索底座
不能原样接入：它的 CookieCloud 取 Cookie 与环境变量导出模型不符合当前 Gateway 的凭据边界
```

## 它实际上支持什么

仓库的 README、Skill 与脚本目录将能力限定为三种平台的“我自己的收藏”：

| 平台 | 实际动作 | 技术路径 | 对当前情报系统的意义 |
|---|---|---|---|
| B 站 | 当前用户、收藏夹、收藏夹条目、视频字幕 | 登录 Cookie + Web API | 适合个人收藏清单与已收藏视频的文本化 |
| 知乎 | 当前用户、收藏夹、收藏条目、收藏回答/文章全文 | 登录 Cookie + Web API | 适合个人收藏问答/专栏的可分析输入 |
| 小红书 | 已收藏笔记、收藏专辑、专辑条目、笔记详情 | Playwright 注入登录 Cookie，读取 `window.__INITIAL_STATE__` | 适合个人收藏笔记清单与详情读取 |
| 聚合层 | 依 URL 或平台路由到上述三类脚本 | `favorites-harvester` | 是聚合命令，不增加新的平台能力 |
| 音频/转写 | 下载音频、faster-whisper 转写 | Docker 辅助流水线 | 与收藏内容的二次文本化有关 |

它不包含下列能力：

- 平台全局关键词搜索；
- 微博、微信公众号、新闻网站的采集；
- 任意账号的全历史读取；
- 不登录的公开搜索替代方案；
- 防验证码、绕过风控或稳定的多页搜索保证。

仓库文件树中没有任何 `weibo`、`wechat` 或平台 `keyword_search` Skill；现有脚本命名就是 `bili_folders`、`zhihu_collections`、`xhs_saved_notes`、`xhs_boards` 等。因此不能把“收藏夹列表”误称为“站内搜索”。

## 值得借鉴的工程策略

### 1. 把“个人收藏”设计成独立数据源家族

仓库最正确的产品边界是：用户显式授权读取**自己的**收藏，而不是模糊地说“爬平台”。这正好适合新增一组与公开搜索平行的动作：

```text
private_favorites.list_containers
private_favorites.list_items
private_favorites.item_detail
private_favorites.transcript
```

它们不能复用 `keyword_search` 的语义，也不应该和公开网页结果混进同一默认检索池。后续 DeepResearch 若使用这些内容，应把它们标为“用户私有输入”，仅在用户明确选择的研究任务中启用。

### 2. B 站和知乎的 API-first 思路

对于“我自己的收藏”，B 站和知乎更适合先通过登录后的同源页面/API 获得结构化数据，再把公开字段整理为稳定输出。这个策略比盲目解析收藏页面 DOM 更容易做分页、排序和变化检测。

但它只能证明收藏 API 可行，**不能证明全站搜索 API 可行**。特别是知乎的站内内容搜索需要额外登录、Cookie/签名与风控处理，不能因为收藏接口能用就推导为 `zhihu.keyword_search` 可用。

### 3. 小红书的“浏览器真实状态”提取

小红书脚本展示了一个有用的方向：通过真实浏览器载入页面，再从 `window.__INITIAL_STATE__` 中投影需要的笔记字段，而不是猜测请求签名或脆弱地拼页面 DOM。对于后续登录后搜索或收藏详情，这比复刻私有 API 更符合我们的只读、低频策略。

不过它的当前实现把 Cookie 注入一个新的 Playwright Context，并将收藏结果中的 `xsec_token` 输出出来；这两点都需要在 Gateway 中改造。

## 为什么不能原样接入

### CookieCloud 是凭据导出模型，不是隔离浏览器模型

该仓库推荐 CookieCloud：浏览器扩展把 cookie payload 同步到本机 `127.0.0.1:8088` 服务，脚本从 `COOKIECLOUD_UUID` 和 `COOKIECLOUD_PASSWORD` 解密 payload，再为指定域名拼出 `Cookie:` 请求头，或传给 Playwright `context.add_cookies(...)`。

仓库还显式提供：

```text
--cookie '<raw Cookie header>'
BILIBILI_COOKIE / ZHIHU_COOKIES / XIAOHONGSHU_COOKIE
cookiecloud_export_env.py -> favorites.env
```

这对于个人本机脚本很方便，但不适合直接成为 Gateway 的默认认证机制：

| 风险 | 原仓库行为 | Gateway 必须采用的边界 |
|---|---|---|
| 凭据表面 | 可将 Cookie 作为 CLI 参数、环境变量或 `.env` 文件导出 | 不接收、不导出、不记录 Cookie/Token/二维码/验证码 |
| 扩散面 | Docker runner、CookieCloud 服务和环境变量都可接触解密后 Cookie | 浏览器自身持有会话；Gateway 只在浏览器页内执行受控只读动作 |
| Profile 隔离 | 以浏览器扩展导出的当前登录态为输入 | 每个平台独立、受 ACL 保护的专用 Chrome Profile |
| 临时访问参数 | 小红书收藏结果可包含 `xsec_token` | 仅作为短期内存执行上下文；不进 artifact、日志、数据库或 trace |
| 审计 | 通用脚本输出可被重定向，未提供 Gateway 级敏感字段总拦截 | 每个 Adapter 用公共字段 allowlist + forbidden-key 校验 |

CookieCloud 文档虽然让服务仅监听 `127.0.0.1`，并将数据目录 Git-ignore，但这不足以满足长期保存个人社交平台会话的最小隔离要求。尤其不应让 Agent 接收 UUID、密码、Cookie、Token 或导出的 `favorites.env` 内容。

### 该仓库没有当前运行回归证据

仓库当前主分支代码提交停在 2026-02-09，且没有 open issue 并不等于平台兼容性已持续验证。没有看到针对登录失效、验证码、页面结构漂移、不同查询、Browser/Container 重启和敏感字段泄露的自动化验收包。

所以它应被视为：

```text
优秀的个人脚本与策略参考
不是已验证的长期平台连接器
```

## 对本项目的可行性判断

| 使用目标 | 可行性 | 判断 |
|---|---:|---|
| 读取用户自己的 B 站/知乎/小红书收藏 | 高 | 与仓库原始用途直接一致；完成隔离登录后可做专用只读 Adapter |
| 将收藏内容作为用户私人研究材料 | 高 | raw-first 本地保存即可，不必把每个字段拆入数据库 |
| 从收藏内容提取 B 站字幕、知乎正文、小红书笔记文本 | 中高 | 适合做“详情/文本化”能力；需去敏、限量、失败语义和 token 管理 |
| 用它实现 B 站全站搜索 | 低 | 仓库只是收藏 API；B 站原生关键词搜索应继续走单独的匿名页面 Adapter |
| 用它实现知乎/微博全站搜索 | 低 | 没有微博实现；知乎收藏接口不能证明搜索可行 |
| 用它解决公众号全局搜索 | 无 | 项目未覆盖公众号 |
| 原样复制 CookieCloud 方案到 Gateway | 不建议 | 与“不导出 Cookie”的安全边界冲突 |
| 借其 API/页面状态策略自行重写 Adapter | 有条件可行 | 只保留方法论；登录态留在隔离浏览器内 |

## 推荐接入方式

### 先做边界，而不是直接安装 Skill

建议不把第三方仓库直接安装为 Gateway Skill，也不把它的 Docker Compose、CookieCloud 服务或环境变量协议并入当前运行环境。应先完成已识别的登录安全前置条件：

1. 每个平台独立的 Chrome Profile；
2. 专用 headed 登录路径；
3. 收紧 Profile 目录 ACL；
4. BrowserWing 继续仅 loopback 绑定并检查本机控制面；
5. 禁止 Cookie/Token/`xsec_token` 出现在 Artifact、trace、日志、API 响应和聊天中。

### 再以“浏览器内同源读取”重写三条窄能力

后续可按以下顺序逐条做，不导出浏览器 Cookie：

```text
1. bilibili.private_favorites.list_containers
2. zhihu.private_favorites.list_collections
3. xiaohongshu.private_favorites.list_saved_notes
4. 每个平台的 item_detail / transcript（与列表能力分开）
```

实现上优先让 BrowserWing 在已登录平台页面内完成：

```text
打开受限的同源页面
  -> 读取页面已渲染内容或页内同源 fetch 的公共响应
  -> 仅投影事先定义的公开/用户授权字段
  -> 立刻拒绝 Cookie、storage、Token、签名 URL 等字段
  -> 原始去敏 JSON 仅落本地 artifact
```

这既能借鉴 `my-collection-skills` 的 API-first / hydrated-state 思路，又避免把真实会话变成可复制的字符串。

### 每个个人数据 Capability 的验收门槛

只有在用户通过可见隔离浏览器自行登录后，才做固定的小样本验证。每条能力都应验证：

1. 登录会话有效时返回正确的容器/条目数；
2. 重启浏览器后会话仍可复用或明确返回 `authentication_required`；
3. 登录过期、验证码、空收藏、页面结构漂移和平台不可用被区分；
4. raw artifact 中没有 Cookie、Token、Profile 路径、`xsec_token` 或签名媒体 URL；
5. API 响应默认不写入公共情报数据库，只有用户显式选择后才作为私有研究输入。

## 与“平台站内搜索”路线的关系

两条路线应并存但永不混写：

```text
公开 / 平台搜索
  B站、小红书、知乎、微博等的 keyword_search
  -> 发现“平台上有什么”

用户私有收藏
  B站、知乎、小红书的 private_favorites
  -> 发现“我已经选择保存了什么”
```

`my-collection-skills` 对第二条路线很有价值，对第一条路线只提供部分浏览器/API 工程经验。它不改变本项目对知乎、微博原生关键词搜索仍需独立登录验证的结论。

## 最终建议

把该仓库纳入“**策略参考 / 私有收藏数据源候选**”，不要纳入“**全站搜索供应商**”。优先完成安全隔离后，从 B 站收藏夹或知乎收藏夹选择一个最小、只读、低频的适配器验证；小红书随后再做，因为 `xsec_token` 的短期访问上下文更容易引入泄露和详情不稳定问题。

在这之前，不需要用户把任何 CookieCloud UUID、密码、Cookie、Token、二维码或验证码发给系统；若进入验证阶段，用户只需要在弹出的平台独立浏览器窗口里自行登录，并确认“已登录”。

