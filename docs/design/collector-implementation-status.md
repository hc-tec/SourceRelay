# Collector 实现状态

- 分支：`feat/browser-extension-system`
- 状态日期：2026-07-17
- 权威决策：[collector-grilling-decision-log.md](collector-grilling-decision-log.md)
- 产品规格：[platform-strategy-product-spec.md](platform-strategy-product-spec.md)
- 冲突审计：[collector-decision-audit.md](collector-decision-audit.md)

## 1. 当前结论

Collector 已经从 fixture POC 迁移到最小权限 MV3 扩展加 loopback Gateway 的产品控制面，但尚未获得任何真实平台能力发布资格。

```text
已完成：P0 决策契约与构建门禁
已完成：P1a 扩展权限、控制页、EvidencePlan 与 stage lease
已完成：P1b Gateway 固定身份、显式配对与认证任务 preflight
已完成：P1c stage receipt、dispatch 重投去重与阻塞回报
未开始：P2 Collection / Validation Profile 与真实平台验证
未开始：P3 加密 Evidence Vault
未开始：P4 EvidencePackage / DeepResearch 正式接入
```

## 2. 已落地检查点

| Git 检查点 | 内容 | 能力含义 |
|---|---|---|
| `b3e7fdd` | P0 共享契约、移除 fixture / test build、生产构建门禁 | 只证明制品可构建和自动加载 |
| `1ec99cb` | optional host permission、控制页、EvidencePlan/preflight、专用窗口与 session lease | 只证明扩展控制面契约存在 |
| `95edf75` | loopback Gateway、P-256 固定身份、一次性签名配对 | 只证明配对双方可构建 |
| P1c（本提交） | HMAC 轮询、签名 work item、Console task、preflight、formal-only 批准、stage receipt 与重投去重 | 当前策略会被阻断为 `live_validation_required` |

## 3. 控制面边界

### 3.1 Manifest

- 安装时 API permissions：`alarms`、`storage`、`scripting`；
- 安装时 `host_permissions`：空；
- optional loopback：`http://127.0.0.1/*`，只用于固定身份 Gateway；
- optional 平台 origins：B站、知乎、微博、小红书的精确域名；
- 静态平台 `content_scripts`：空；
- `externally_connectable`：不存在；
- `<all_urls>`、通配 scheme / host、`localhost`、`cookies`、`debugger`、`webRequest`、`downloads`：禁止。

Chrome match pattern 不能限定 loopback 端口，因此扩展另外固定 `GatewayPairingRecord.loopbackOrigin`，验证 Gateway public-key fingerprint 和 P-256 签名，并对每个请求使用 extension instance、短时 timestamp、nonce、body digest 和 HMAC pairing authorization。任意网页和未配对 localhost 服务不能充当控制端。

### 3.2 任务执行

```text
Console 创建 ResearchTask
  -> paired extension 认证轮询
  -> 验证 Gateway 签名 / identity / nonce / expiry
  -> extension 生成平台 × 目标 capability preflight
  -> Gateway Console 展示计划
  -> 只有全部 stage = ready + formal 才允许用户批准
  -> dispatch 前扩展重新计算权限、策略 ID / version / maturity
  -> 专用可见 Collection Window
  -> session-only stage lease
  -> 精确任务 tab 动态注入固定 content.js
```

当前四个平台策略均为 `build_ready` 且 `liveValidation = null`，因此 preflight 必然返回 `live_validation_required / experimental`。Console 批准按钮必须禁用，Gateway 不生成可执行 dispatch，浏览器不访问平台。

### 3.3 重启和页面漂移

- Gateway identity 和扩展配对授权持久化在本地 `runtime/` / `chrome.storage.local`；
- 页面和 stage lease 只保存在 `chrome.storage.session`，浏览器重启后失效；
- 手工导航导致任务 URL 摘要变化时标记 `task_context_changed`；
- 撤销平台权限时活动 lease 标记 `permission_revoked`；
- 撤销 Gateway 配对时停止轮询并取消活动 lease；
- 当前 Gateway Research Task 队列只在内存中保存，重启恢复必须等加密任务/Vault 状态设计完成，不能把临时明文队列误写成正式持久化；
- dispatch 在 receipt 丢失时按同一 task / stage 重投新签名 envelope；扩展先查找现有 lease，已有 active / completed lease 时只补发 receipt，不重复创建窗口；
- dispatch 前权限或策略状态变化会回传固定 `blocked` error code，Gateway 停止重投。

## 4. 构建门禁状态

扩展门禁：

- TypeScript 编译；
- production bundle；
- MV3 Manifest；
- API / optional origin 精确清单；
- 禁止宽权限、静态 MAIN-world、持久平台注册脚本和 test / fixture 入口；
- Playwright 临时空 Profile 自动加载；
- MV3 service worker 启动；
- fresh Profile 零 optional origin grant；
- fresh Profile 零平台注册脚本；
- Collector 内部控制页加载。

Gateway 门禁：

- TypeScript 编译；
- Node 22 bundle；
- 只包含 `127.0.0.1` bind；
- 不包含 `0.0.0.0` all-interface bind；
- 不引入未审查的 Express / Fastify / Koa HTTP 表面。

这些都是构建门禁，不是平台测试，也不证明配对或任务控制已经完成真实环境验证。

## 5. 已知未完成项

| 领域 | 当前状态 | 下一门槛 |
|---|---|---|
| Gateway 配对 | build-ready，未做功能性离线测试 | 在产品允许的本地控制环境中验证，不冒充平台能力 |
| Task dispatch | preflight、formal-only 批准、stage receipt、at-least-once 重投去重和阻塞回报已落码 | 与真实 Validation Profile 一起验证控制状态，不冒充平台能力 |
| Profile | 尚无正式生命周期管理 | 持久 Collection Profile + 独立 Validation Profile |
| B站 discovery | strategy `build_ready` | 用户控制环境中的匿名真实验证记录 |
| response observation | 生产 route 为空 | 先完成 wrapper 到期撤销、route projector 和 document race 验证 |
| Evidence | `storage.session` 临时结果 | 加密 Vault、不可变批次、coverage、hash manifest |
| Gateway task persistence | 仅内存 | 与 Vault 密钥和 schema 一起设计加密恢复，不写普通明文队列 |
| DeepResearch | 未接入当前 Collector | 只读 EvidencePackage / Citation / Coverage / CollectionGapRequest |

## 6. 下一实现顺序

```text
P2a  Collection / Validation Profile launcher
  -> P2b B站匿名 discovery 真实验证
  -> capability validation record + maturity 升级
  -> B站 detail / bounded discussion
  -> P3 encrypted Evidence Vault
  -> P4 DeepResearch EvidencePackage adapter
```

任何真实平台验证前，生产 response route 继续为空；任何 capability 未获得当前策略版本的真实验证记录前，Console 不得批准执行。
