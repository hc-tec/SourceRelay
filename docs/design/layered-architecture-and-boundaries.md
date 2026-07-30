# 分层架构与纯接口边界

状态：架构审查结论，后续重构依据

日期：2026-07-30

## 1. 结论

项目负责人提出的原则是正确的：

> 每一层只暴露自己的纯接口，不把浏览器控制、平台策略、Gateway 协议、artifact 文件、
> 多模态处理和具体业务场景耦合到一起。

当前系统已经有一些正确的边界，但仍处于“能力闭环先跑起来、长期分层随后补齐”的阶段。
最明显的越界是当前的 `knowledge_pack.py`：它同时导入 B站 request builder、调用
Collector client、解析平台 artifact、投影资源、写本地目录和维护 provenance。它适合
MVP 验证，但不能成为最终的包结构。

目标不是为了形式上的类和目录而抽象，而是确保未来替换以下任一部分时，其余层不需要
跟着修改：

- 浏览器插件的 DOM/XHR/可信输入实现；
- Gateway 的本地 HTTP 协议；
- B站、小红书或其他平台适配器；
- 本地目录、对象存储或数据库；
- OCR、ASR、关键帧、摘要和向量处理器；
- DeepResearch、CLI、FastAPI 或其他上层调用者。

## 2. 当前架构中已经正确的部分

以下边界应保留：

1. 浏览器插件不向上层开放任意 selector、脚本、tab 控制或任意 Network 正文接口；
2. Gateway 是最终的 capability、预算、绑定和安全校验边界；
3. JS SDK 和 Python SDK 只面向 `/v2` Gateway，不读取 Profile、Cookie 或 Storage；
4. operation 和 artifact 是采集运行与原始产物之间的稳定边界；
5. 多模态处理不应阻塞浏览器采集；
6. raw artifact、资源公共投影和 provenance 应当分开保存；
7. 真实平台证据不能由 fake 页面、fake XHR 或 synthetic Gateway 代替。

这些都是产品边界，不应因为后续增加平台而放宽。

## 3. 当前需要修正的耦合

| 位置 | 当前问题 | 长期风险 | 处理方向 |
|---|---|---|---|
| `knowledge_pack.py` | 请求构造、B站语义、任务编排、本地写盘混在一个模块 | 换存储或换平台会改动用例 | 拆成 use case、source port、storage adapter |
| Python/JS SDK | 两种语言分别镜像 capability 输入契约 | 契约更新时可能漂移 | 保持 SDK 独立，但增加协议一致性门禁；后续再考虑机器契约生成 |
| Gateway `/v2/collect` route | route 内有很长的 capability 条件分支 | 每增加平台都修改核心路由 | 改为 capability registry + handler |
| artifact retrieval route | 通过 capability 条件选择具体 artifact store | 存储实现泄漏到 HTTP 路由 | 改为 artifact reader registry |
| 任务级 API | 目前直接依赖 `CollectorClient.collect_and_wait_model` | 用例层知道 SDK 方法和 wire 层细节 | 通过 `CollectionPort` 注入 |
| 资源投影 | 直接从平台 artifact 的字段路径读取 | 平台字段泄漏到通用资源层 | 每个平台 adapter 先转换成公共 `Resource` |
| 媒体处理 | 目前只有目录占位，没有独立媒体端口 | 下载、过期 URL、OCR/ASR 容易串进采集流程 | 增加 `MediaAssetPort` 和异步 `ProcessingPort` |

## 4. 目标依赖关系

采用依赖倒置，而不是让所有代码都依赖 SDK 或 Gateway：

```text
                 ┌────────────────────────┐
                 │ Delivery / API / CLI   │
                 └───────────┬────────────┘
                             │ calls
                 ┌───────────▼────────────┐
                 │ Application Use Cases  │
                 │ knowledge pack / search│
                 └───────────┬────────────┘
                             │ depends on ports + domain DTOs
                 ┌───────────▼────────────┐
                 │ Ports                  │
                 │ collection / artifact  │
                 │ resource / media       │
                 └───────────┬────────────┘
                             │ implemented by
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
┌──────▼───────┐     ┌───────▼────────┐    ┌───────▼────────┐
│ Gateway SDK  │     │ Platform        │    │ Storage /      │
│ adapter      │     │ adapters        │    │ processing     │
│ HTTP/JSON    │     │ B站 / 小红书    │    │ FS / SQLite    │
└──────────────┘     └────────────────┘    └────────────────┘
```

依赖规则只有一个方向：

```text
Delivery → Application → Domain / Ports
Adapters → Domain / Ports
Infrastructure → Domain / Ports
Domain → nothing
```

`Domain` 不得导入 `httpx`、Node HTTP、Playwright、Chrome API、Path、SQLite 或任何
平台模块。`Application` 不得知道请求 URL、tab、selector、浏览器 Profile 或具体文件
目录。`Gateway` 和插件不得知道 DeepResearch 的 prompt、知识包目录或 OCR/ASR 实现。

## 5. 每层的职责

### 5.1 Domain / Contract 层

只定义跨实现稳定的值和结果，不执行 IO：

```text
CollectionRequest
CollectionOutcome
RawArtifactRef
Resource
ResourceVariant
Evidence
MediaAssetRef
ProcessingArtifactRef
KnowledgePackManifest
```

这里的 `Resource` 是公共投影，不是 B站字段的复制品；平台特有字段放入不透明的
`rawProjection`，由 adapter 负责填充。

### 5.2 Application / Use Case 层

负责业务流程和预算，不负责平台细节：

```text
BuildKnowledgePack
  1. 读取公开账号入口
  2. 获取账号资源
  3. 获取有界内容清单
  4. 按预算获取详情
  5. 写入资源与 provenance
  6. 生成完成度和失败语义
```

它只依赖端口：

```python
class BilibiliSourcePort(Protocol):
    async def read_account_profile(...) -> CollectionOutcome: ...
    async def read_account_inventory(...) -> CollectionOutcome: ...
    async def read_video_detail(...) -> CollectionOutcome: ...

class KnowledgePackStorePort(Protocol):
    def write_raw_artifact(...) -> RawArtifactRef: ...
    def write_resource(...) -> None: ...
    def append_evidence(...) -> None: ...
    def update_manifest(...) -> None: ...
```

`BuildKnowledgePack` 不知道这些方法背后是 Python SDK、HTTP、内存、文件系统还是
测试适配器。

### 5.3 Platform Adapter 层

平台 adapter 才负责把通用任务转成平台注册能力：

```text
BilibiliSourceAdapter
  → bilibili_account_profile builder
  → bilibili_account_inventory builder
  → bilibili_video_detail builder
  → CollectorPort
```

它负责：

- 规范化平台输入；
- 选择已登记 capability；
- 将 artifact 转换成公共 `Resource`；
- 将平台风险、页数和缺失字段转换成统一 coverage。

它不能负责：

- 写任意本地目录；
- 运行 OCR/ASR；
- 决定 DeepResearch prompt；
- 直接操作浏览器；
- 绕过 Gateway。

### 5.4 Collector Gateway Adapter 层

Python/JS SDK 是 Gateway adapter，不是业务编排器：

```text
transport
  → loopback HTTP、token、超时、JSON
validation
  → wire contract、allowlist、operation、artifact path
client
  → submit / poll / read artifact
```

SDK 可以提供 capability builder 和 raw-first model，因为它们属于协议适配；但不应拥有
`build_knowledge_pack`、OCR、媒体下载或本地知识库业务。

当前已经加入 SDK 的 knowledge-pack 入口属于 MVP 过渡实现，后续应迁移到独立的
`collector-knowledge-pack` 包或上层应用包，并保留兼容 facade 一段时间。

### 5.5 Storage / Processing 层

存储端口只负责持久化，不理解平台页面：

```text
RawArtifactStore
KnowledgePackStore
MediaAssetStore
EvidenceStore
```

处理端口只负责派生结果：

```text
ProcessingPort.enqueue_ocr(asset_ref)
ProcessingPort.enqueue_asr(asset_ref)
ProcessingPort.enqueue_keyframes(asset_ref)
ProcessingPort.enqueue_summary(resource_ref)
```

媒体下载必须由受控的 `MediaAssetPort` 实现，不能给上层开放任意 URL 下载器；小红书
短时链接需要在浏览器采集会话内由平台 adapter/extension 产生受控媒体引用，再交给
媒体端口落盘。

## 6. Gateway 与插件内部也要分层

### 6.1 Gateway capability registry

当前 `/v2/collect` route 中的长条件分支应逐步替换为：

```ts
interface CapabilityHandler<Request, Operation> {
  capability: string;
  validate(value: unknown): Request;
  enqueue(context: GatewayContext, request: Request): Promise<Operation>;
}
```

Gateway route 只做：

1. 鉴权；
2. 解析 JSON；
3. 根据 capability 查 registry；
4. 调用 handler；
5. 返回统一 operation envelope。

增加平台能力时注册新的 handler，而不是修改 HTTP route 的主流程。

### 6.2 Artifact reader registry

artifact 读取同样采用：

```ts
interface ArtifactReader {
  capability: string;
  read(artifactId: string): Promise<RawArtifactView | null>;
}
```

HTTP 层不应知道 `BilibiliAccountProfileArtifactStore`、小红书 store 或 passive store
的具体类型。

### 6.3 Extension strategy registry

插件已经有 strategy registry 的雏形。平台策略应只处理：

```text
registered work item
  → exact page/document lease
  → DOM/XHR/trusted input
  → bounded public projection
  → signed result
```

插件策略不能向上层暴露底层观察器对象，也不能把任意页面控制能力塞回 Gateway。

## 7. 当前知识包 MVP 的迁移方案

不做一次性重写，按以下顺序拆：

### 第一步：先保留行为，拆文件

将当前 `knowledge_pack.py` 拆为：

```text
collector-knowledge-pack/
  domain.py             公共 Resource / Evidence / Coverage
  ports.py              CollectionPort / StorePort
  application.py        BuildBilibiliKnowledgePack use case
  adapters/bilibili.py  B站 builder + artifact projector
  storage/filesystem.py UTF-8 manifest / JSONL / raw artifact
```

`CollectorClient` 保持只负责 Gateway 协议；旧入口可暂时从 SDK re-export，标记为迁移
兼容层，不再在 SDK 内增加新的场景业务。

### 第二步：加依赖规则门禁

- Python 使用 import-linter 或自定义 AST 检查；
- TypeScript 使用 eslint/import graph 或构建脚本检查；
- domain 层禁止 `httpx`、`pathlib`、Playwright、Chrome API；
- application 层禁止平台 URL、selector、tab ID 和浏览器模块；
- storage 层禁止导入 B站、小红书或扩展代码；
- extension/Gateway 禁止导入知识包和 DeepResearch 代码。

### 第三步：再拆 Gateway registry

先迁移已有 15 项 direct-ready capability，保持 wire contract 和 artifact path 不变；
确认 unit、integration、real canary 都通过后，再允许新平台以 registry 方式加入。

### 第四步：媒体与多模态只接 ports

先定义媒体和处理端口，再接具体下载器、OCR、ASR 或模型。任何具体处理器都不能反向
依赖浏览器插件或 Gateway route。

## 8. 验收标准

架构改造完成后，以下事实必须能被自动检查：

1. 删除或替换 Gateway HTTP client，不会修改知识包 application；
2. 将文件系统 store 换成 SQLite 或对象存储，不会修改 B站 adapter；
3. 将 B站 adapter 换成小红书 adapter，不会修改通用知识包 use case；
4. 将 OCR/ASR worker 换成另一实现，不会修改浏览器采集策略；
5. 任意平台新增 capability，不需要修改 `/v2/collect` route 主流程；
6. 纯 domain/application 测试不启动浏览器、不访问真实平台；
7. 真实平台能力仍必须用真实 Gateway→扩展→浏览器 canary 验证；
8. capability、预算、风险停止和 at-most-once 语义不会因为分层重构而丢失。

## 9. 最终判断

“保持每层接口纯净、不要互相耦合”不是过度设计，而是这个项目从单平台 POC 走向多
平台资源基础设施的必要条件。

但不需要现在重写全部代码。当前最优策略是：

```text
先冻结边界
  → 把 knowledge pack 从 SDK 迁出
  → 把 Gateway 长分支改成 registry
  → 再接媒体与多模态
  → 最后扩展小红书、知乎、公众号和 DeepResearch
```

