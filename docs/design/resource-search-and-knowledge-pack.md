# 资源搜索与知识包平台设计（MVP）

状态：已确认方向，作为后续实现的产品边界

日期：2026-07-30

## 1. 设计来源与结论

本设计整理自项目负责人手绘的产品草图。草图表达的主线是：

```text
资源搜索能力
    ↓
基础平台：B站、知乎、小红书……
    ↓
多模态处理：文本、图片、视频、音频
    ↓
整合信息源
    ↓
场景：UP 主知识采集/汇编、DeepResearch 知识源增强
```

这不是“继续增加几个平台爬虫”的计划，而是把现有的浏览器插件、Gateway 和 SDK
提升为一个资源搜索基础设施：上层应用描述需要什么资源，平台适配层选择已登记的
能力，浏览器插件在用户真实浏览器中完成低频、只读、可审计的采集，最后生成原始
证据与多模态派生结果。

当前第一目标确定为：

> 先完成 B站 UP 主知识包 MVP，再以同一资源模型接入小红书，最后扩展到知乎、公众号、
> 新闻网站以及 DeepResearch。

“平台数量”不是当前第一优先级；“从采集到可复用知识包的完整闭环”才是第一优先级。

## 2. 产品定位

### 2.1 对上层应用提供什么

上层应用最终需要的是任务级能力，例如：

- 生成一个 UP 主的公开知识包；
- 生成一个小红书博主的公开笔记包；
- 围绕一个研究问题搜索多个中文平台；
- 获取可带来源引用的证据包；
- 给 DeepResearch 提供经过整理、可回溯的知识源。

上层不应感知以下实现细节：

- CSS selector、任意脚本或任意坐标；
- tab ID、浏览器 Profile 路径或 Cookie；
- 任意平台 URL 跳转；
- 任意 XHR 地址、请求正文或签名算法；
- 某个平台采用 DOM、XHR、页面内操作还是用户已选标签页。

这些内容属于插件和 Gateway 的受控执行边界，不能进入公共 SDK 契约。

### 2.2 与普通爬虫的区别

本项目不是以“绕过反爬、模拟接口、批量请求”为核心。采集运行时使用用户已经登录
的真实浏览器，通过已经登记的浏览器插件能力完成页面内可见信息的只读采集。

因此每个平台适配器需要同时考虑：

1. 人类页面流程是否可行；
2. DOM 与网络投影哪一种更稳定；
3. 是否需要主动操作才能触发内容；
4. 页面是否必须保持在同一文档；
5. 断网、卡顿、验证码、风控或登录失效时如何停止；
6. 产物如何带上完整 provenance，而不是只留下一个失效 URL。

## 3. 总体架构

```text
┌──────────────────────────────────────────────┐
│ 上层应用 / Agent / DeepResearch               │
│ 任务：搜索、知识包、证据包                     │
└──────────────────────┬───────────────────────┘
                       │ JS SDK / Python SDK
┌──────────────────────▼───────────────────────┐
│ 资源任务层                                     │
│ 任务拆解、预算、能力选择、状态与失败策略       │
└──────────────────────┬───────────────────────┘
                       │ 已登记 capability
┌──────────────────────▼───────────────────────┐
│ 平台能力适配层                                 │
│ B站 / 小红书 / 知乎 / 公众号 / 新闻等           │
└──────────────────────┬───────────────────────┘
                       │ /v2/collect
┌──────────────────────▼───────────────────────┐
│ Collector Gateway                              │
│ 鉴权、能力门禁、operation、artifact、审计       │
└──────────────────────┬───────────────────────┘
                       │ paired browser binding
┌──────────────────────▼───────────────────────┐
│ User-owned-browser Extension                  │
│ DOM / XHR / trusted interaction / same-document│
└──────────────────────┬───────────────────────┘
                       │ 原始投影与媒体
┌──────────────────────▼───────────────────────┐
│ 原始资源包与派生处理                           │
│ JSON、图片、视频、音频、OCR、ASR、摘要、实体    │
└──────────────────────────────────────────────┘
```

### 3.1 采集与处理必须分离

浏览器采集和多模态处理不应在一个操作中同步完成：

```text
浏览器采集
  → 原始 artifact 落盘
  → 媒体资源及时下载
  → 处理队列
  → OCR / ASR / 关键帧 / 摘要 / 实体抽取
  → 知识包索引
```

这样做有三个直接收益：

- 页面采集不会被模型处理耗时拖慢；
- 小红书短时媒体链接可以在有效期内及时保存；
- 处理失败时可以从原始资源重试，不需要再次触发平台页面操作。

## 4. 统一资源模型

第一阶段不把所有平台字段强行压成一套数据库表，而是采用“公共投影 + 原始投影”
的双层模型。

### 4.1 核心对象

```text
CollectionTask       一次采集任务
Resource              一条内容资源（视频、笔记、回答、文章）
ResourceVariant       同一资源的不同平台/时间版本
MediaAsset            图片、视频、音频、封面等媒体
Evidence              某个事实或片段的来源证据
ProcessingArtifact    OCR、字幕、摘要、主题、实体等派生结果
KnowledgePack         面向场景的整合资源集合
```

### 4.2 Resource 公共投影

```json
{
  "resourceId": "resource-local-id",
  "platform": "bilibili",
  "resourceType": "video",
  "title": "公开标题",
  "author": {
    "displayName": "公开昵称",
    "platformId": "platform-public-id"
  },
  "publishedAt": "2026-07-30T00:00:00.000Z",
  "sourceCapability": "bilibili.video_detail",
  "artifactRef": {
    "operationId": "...",
    "artifactId": "..."
  },
  "mediaAssetIds": [],
  "processingArtifactIds": [],
  "provenanceRef": "provenance-entry-id"
}
```

公共字段用于跨平台检索和排序；平台特有字段、原始页面投影和网络投影保留在
`raw` 产物中，不因为公共模型暂时没有对应字段而丢失。

### 4.3 Evidence 与 provenance

每一个可供研究引用的结论都应能回溯到原始产物：

```json
{
  "evidenceId": "evidence-local-id",
  "resourceId": "resource-local-id",
  "sourcePlatform": "bilibili",
  "sourceCapability": "bilibili.video_detail",
  "capturedAt": "2026-07-30T00:00:00.000Z",
  "artifactId": "...",
  "contentHash": "sha256:...",
  "locator": {
    "kind": "text",
    "field": "description",
    "offset": null
  }
}
```

AI 摘要、OCR、ASR 和实体抽取都是派生结果，不能替代或覆盖这条 provenance。

## 5. 原始资源包布局

第一阶段优先使用可复制、可检查的本地目录，不强制引入大型数据库：

```text
knowledge-packs/
  task-<task-id>/
    manifest.json
    sources/
      bilibili/
        profile.json
        videos.jsonl
        details/
        dynamics.jsonl
        series/
      xiaohongshu/
        search.json
        notes/
        comments/
    media/
      images/
      videos/
      audio/
    derived/
      transcript/
      ocr/
      keyframes/
      summaries/
      entities/
    evidence/
      provenance.jsonl
      fetch-events.jsonl
```

`manifest.json` 记录任务状态、资源数量、媒体数量、处理状态和能力版本。

原始 JSON 使用 UTF-8 保存；媒体文件以内容 hash 命名；所有下载和处理事件追加写入
`fetch-events.jsonl`，方便定位网络中断、过期链接、重复下载和部分完成。

后续可以按需要增加 SQLite、全文索引或向量索引，但索引只能是加速层，不能成为唯一
数据真相。

## 6. 平台能力路线

### 6.1 B站：第一个纵向闭环

当前已经具备的 user-owned-browser direct-ready 能力可作为第一版知识包的采集基础：

- 站内搜索；
- 固定两页站内搜索；
- UP 主公开资料；
- UP 主投稿视频首屏；
- 视频公开详情；
- UP 主动态；
- 合集/系列概览与详情；
- 弹幕可见 DOM；
- 用户已选页面的评论区投影。

字幕属于需要可信交互迁移的能力，不能在未完成真实闭环前假装已经是普通 direct-ready
能力。视频/音频下载也应作为独立媒体资源能力设计，不与页面详情能力混在一起。

第一版 B站知识包采用以下最小链路：

```text
UP 主主页
  → 账号资料
  → 投稿视频列表
  → 视频详情
  → 原始 artifact
  → manifest + provenance
```

评论、弹幕、字幕、视频和音频处理均设计成可选阶段，不能因为某个阶段失败而丢弃已经
成功的原始资料。

### 6.2 小红书：同文档、短时资源、低导航

小红书必须继续遵守项目已经确认的特殊边界：

- 尽量在现有公开页面完成采集；
- 不主动刷新；
- 不依赖任意非官方 URL 跳转；
- 不批量打开新页面；
- 网络投影优先，DOM 作为补充；
- 需要时在同一文档内打开和关闭详情；
- 评论和回复由调用方显式开启并提供预算；
- 图片和视频链接在同一采集会话内尽快下载；
- 遇到验证码、风控、登录失效或未知页面状态立即停止，不自动重放。

小红书第一版知识包采用：

```text
已有公开搜索页/公开主页
  → 笔记卡片
  → 同文档笔记详情
  → 可选评论/回复
  → 媒体及时落盘
  → 原始投影 + provenance
```

### 6.3 其他平台

知乎、公众号、新闻网站不应在 B站纵向闭环完成前同时开工。接入时必须先分别完成：

1. 人类视角页面流程研究；
2. DOM 与 XHR 并行侦察；
3. 登录、验证码和页面导航风险评估；
4. 最小公共投影和原始 artifact 契约；
5. 真实浏览器闭环验证；
6. 再登记为 SDK 可见能力。

## 7. 两个核心场景

### 7.1 UP 主知识采集汇编

输入一个公开账号入口，输出一个可复用的知识包：

```text
账号资料
  + 内容清单
  + 内容详情
  + 系列/动态
  + 可选评论、弹幕、字幕
  + 图片、音频、视频等媒体
  + 原始证据和来源链
```

这个场景优先验证“资源包闭环”，而不是验证接口数量。

### 7.2 DeepResearch 知识源增强

DeepResearch 接入的正确边界是“证据源适配器”，而不是让 DeepResearch 直接操纵浏览器：

```text
研究问题
  → 生成平台搜索计划
  → 多平台获取候选资源
  → 去重、排序和预算控制
  → 获取高价值详情
  → 多模态处理
  → 生成带 provenance 的证据包
  → 提供给 DeepResearch
```

DeepResearch 需要的不是一堆 URL，而是：

- 原始内容；
- 证据片段；
- 来源平台、作者和时间；
- 内容类型；
- 采集能力和 artifact；
- 完整度和处理状态；
- 能够重新定位的 provenance。

## 8. MVP 范围与验收标准

### 8.1 B站 UP 主知识包 MVP

输入：一个合法的公开 B站 UP 主主页入口。

输出：一个本地知识包，至少包含：

- `manifest.json`；
- 账号资料 artifact；
- 投稿视频清单 artifact；
- 至少一条视频详情 artifact；
- 每项资源的 `resourceId` 和 provenance；
- 原始 JSON 使用 UTF-8 保存；
- 任意单项失败不覆盖已完成资源；
- 可以从 artifact 重新构造结构化资源列表。

### 8.2 上层项目验收

Collector Core 的 SDK 只负责底层已登记能力；任务级知识包由仓库外的上层项目负责：

```python
# 底层能力：需要精确控制某一个已登记能力
request = bilibili_native_search(
    browser_binding_id=binding_id,
    query="人工智能"
)

# 上层项目：通过 Core SDK 组合多个底层能力
source = BilibiliGatewaySource(collector)
pack = await build_bilibili_account_knowledge_pack(source, ...)
```

Core 只验收底层 request builder、结构化 artifact 和真实 Gateway→扩展→浏览器闭环；
知识包编排器、资源投影、provenance 和本地存储在仓库外的上层项目中单独验收。

### 8.3 不在 MVP 内

- 一次性接入所有中文平台；
- 任意网站通用爬虫；
- 任意 URL、selector、脚本或 Network API；
- 大规模并发页面操作；
- 自动解决验证码或风控；
- 强制引入向量数据库；
- 把 DeepResearch 运行时直接嵌入 Collector Gateway。

## 9. 下一步执行顺序

1. 完成 Python SDK 的能力化 request builder 和结构化 operation/artifact/result 模型；
2. 用真实 B站 canary 验证 builder 不破坏 Gateway→扩展→浏览器闭环；
3. 在仓库外的上层项目中实现 B站 UP 主知识包的 manifest、raw artifact 和 provenance 编排；
4. 上层项目再实现小红书博主笔记包，优先处理短时媒体落盘；
5. Core 继续研究知乎、公众号、新闻网站的页面流程和能力登记；
6. DeepResearch 作为另一个上层消费者接入，只读取 Core 交付的证据包。

任何新平台或新能力都必须先进入平台能力研究和真实验证，不得因为上层“想支持”就直接
进入公共 SDK allowlist。
