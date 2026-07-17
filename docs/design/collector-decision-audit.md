# 浏览器采集产品：决策一致性与实现差距审计

- 状态：Complete
- 日期：2026-07-17
- 决策源：[Grill 决策账本](collector-grilling-decision-log.md)
- 产品规格：[平台采集策略产品规格](platform-strategy-product-spec.md)
- 审计范围：第 1–100 题、当前 `feat/browser-extension-system` 分支和现有 Collector Extension POC

## 1. 审计结论

第 1–100 题已经覆盖一期产品实现所需的核心选择，当前没有仍需用户决定的阻塞性产品问题。开始实现仍需要用户明确授权。

决策优先级固定为：

```text
用户显式自定义选择
  > 较晚批次决定
  > 较早批次决定
  > 产品规格中的旧默认
  > 当前 POC 的既有实现
```

因此，当前代码“已经能运行”不等于它符合最终产品决定。实现阶段必须以决策账本和本审计为准。

## 2. 已解决的覆盖与冲突

### 2.1 全实站验证覆盖早期 fixture 路线

第 55、56 题明确取消全部离线测试，第 61 题只保留生成可运行扩展所必需的构建门禁。因此早期 `fixture-tested`、`fixture_verified`、fixture 回归和独立 response fixture 要求均被覆盖。

当前成熟度统一为：

```text
draft
  -> build_ready
  -> live_anonymous_verified | live_authenticated_verified
  -> suspended
```

`build_ready` 不代表平台能力。平台能力只由用户控制环境中的低频真实验证升级。

### 2.2 “去敏”与全部公开可见信息长期保存

第 45 题明确选择保存任务页面上全部公开可见信息，包括公开联系方式；第 46–50 题限定采集表面、媒体、加密、历史和导出。因此“去敏”的当前含义是删除认证材料、隐藏状态、未呈现 response 字段和未授权数据，而不是删除页面公开显示字段。

公开字段进入本地加密长期档案；诊断日志仍不得包含页面正文、查询词、账号信息或公开联系方式。这两类产物的字段政策不同，不构成冲突。

### 2.3 response observation 不能扩大可见数据表面

第 35 题允许精确 route 的受控 response observation，第 46 题又明确长期保存仅限页面正常呈现的信息。最终规则是：response 可辅助结构、游标、稳定 ID 和状态判定，但未呈现字段不得进入长期证据。可见 DOM 与 response 投影不一致时必须报告差异或部分覆盖。

### 2.4 单平台队列与详情 Worker 并发

第 26 题的“单平台队列”保留为调度所有权和限流边界；第 72 题作为更具体的后项决定，允许稳定 item ledger 之后的有界 Detail Worker 并发。账号枚举仍是单一所有者，Agent 不直接争抢游标；平台调度器统一控制详情并发上限。

### 2.5 第三方平台爬虫与 DeepResearch 框架

第 96 题禁止复制、集成或运行第三方平台采集 / 爬虫仓库。第 74 题允许 DeerFlow、天工式方案等 DeepResearch 编排框架通过 EvidencePackage 边界适配。两者作用不同：前者不得成为数据源，后者可以成为证据消费者和研究编排器。通用构建依赖仍需许可证与 SBOM 记录。

### 2.6 浏览器上下文不是“绕过访问控制”

扩展运行在用户正常 Collection Browser Profile 中，避免传统爬虫模拟浏览器和维护私有 API 的路线；它不授权绕过登录、验证码、付费限制、限流或平台安全措施。遇到这些状态仍按第 27、60、65 题暂停和报告。

### 2.7 代理的最终边界

用户配置的固定浏览器网络代理可以作为 Collection Browser Profile 的正常网络环境，扩展不读取或管理代理凭据。禁止自动代理轮换、账号池或通过代理绕过平台限流和验证状态。

### 2.8 可读 Markdown 与加密 Vault

证据逻辑格式可为 Markdown、JSON 和 JSONL；磁盘长期保存由 Vault 加密。Evidence Explorer 或配对 Reader 在授权后解密并呈现可读内容，因此“人和 AI 可读”与“静态加密”不冲突。

## 3. 当前代码与最终决定的主要差距

| 领域 | 当前 POC | 最终决定要求 | 实现处置 |
|---|---|---|---|
| 验证路线 | 大量 loopback fixture、单元测试和 `fixture_verified` | 无离线测试；仅构建门禁 + 本地真实平台验证 | 移除 test build / fixture 验证语义，建立 Validation Browser 和 capability record |
| 权限 | Manifest 预先声明多个静态 host permissions | Core 最小权限；策略启用时请求精确 optional host permission | 重构 manifest 与权限 preflight |
| 任务控制 | test driver / 扩展消息启动首屏搜索 | Console / Gateway 配对、批准计划、自动 Collection Window | 建立本地控制协议与任务状态机 |
| Profile | 测试临时 Profile；无正式 Profile 管理 | 持久 Collection Profile；账号隔离；独立 Validation Profile | 建立 Profile 生命周期与身份绑定 |
| 策略 | 四个平台的首屏 DOM discovery 元数据 | 平台 × 目标的静态策略矩阵、真实成熟度与 kill switch | 重构 registry、maturity 和 capability lock |
| 深度能力 | 无账号归档、详情阶段或评论阶段 | B站纵向样板；小红书可恢复账号归档样板 | 建立受限动作状态机、ledger 和阶段 lease |
| Artifact | `storage.session` 暂存 | 本地加密 Vault、封存批次、schema、哈希、coverage 和 Explorer | 建立 Gateway Artifact Vault |
| DeepResearch | 尚无正式 handoff | 只读 EvidencePackage、Citation / Coverage、CollectionGapRequest | 实现稳定适配协议，禁用框架自带搜索 |
| 第三方采集器 | 调研文档中存在候选仓库 | 仅参考，不复制、不集成、不运行 | 保持代码与运行时依赖隔离 |

## 4. 响应观察底座的已知安全待办

当前 production response route 为空，这是安全的保守状态。在启用任何真实 route 前，至少要处理：

1. MAIN-world 观察期限不能依赖页面可改写的配置；到期后要停止读取并撤销 wrapper。
2. Release 权限门禁要覆盖等价宽泛 host pattern 和 optional permission 字段。
3. 真实 Validation Browser 要验证 bridge-ready 到 document-bound 注入之间发生导航时，观察器不会进入新 document。
4. route-specific projector 必须只输出页面可见字段；游标和状态字段仅作短时控制。
5. 页面世界 observation 始终是不可信输入，不能被描述为密码学认证的网络证据。

在这些问题解决并完成真实验证前，production response route 必须继续保持为空。

## 5. 建议实现顺序

```text
P0  决策契约落码
    -> maturity、任务目标、状态、预算、策略契约、构建门禁

P1  扩展控制面
    -> Gateway 配对、Collection Window、optional host permission、stage lease

P2  Profile 与真实验证
    -> Collection / Validation Profile、用户登录、live capability record

P3  Artifact Vault
    -> 加密、封存批次、schema、coverage、hash、恢复

P4  B站纵向样板
    -> discovery -> detail -> bounded discussion

P5  小红书账号归档样板
    -> identity -> inventory -> resume -> selected detail

P6  Research 接入
    -> Search Adapter、EvidencePackage Reader、Citation / Coverage、GapRequest

P7  Evidence Explorer 与一期验收
```

实现阶段应按每个可验证检查点提交，不把平台数量当作进度替代品。

## 6. Grill 完成状态

核心 grill 已完成。没有需要继续以 A/B/C/D 追问的阻塞性产品选择；若后续真实平台验证暴露新的平台特有决策，再按每批 5 题的规则追加，并先写入决策账本。
