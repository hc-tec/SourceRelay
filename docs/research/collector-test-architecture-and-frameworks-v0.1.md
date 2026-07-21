# Collector 测试框架与分层调研 v0.1

- 日期：2026-07-21
- 状态：调研完成，**尚未安装或迁移任何测试框架**
- 目标：在继续扩大 Browser Host、MV3、Gateway 与平台策略之前，确定一个能长期扩展、又不会把假平台能力当成真能力的测试体系。
- 范围：当前 Collector 正式路线；历史 `intelligence-gateway`、`deepresearch-gateway` 等 POC 只能作为隔离 sidecar 处理，不能借由测试绿灯获得 Collector 能力发布资格。

## 1. 先给结论

当前仓库已经有不少验证代码，但没有一个合理的大型项目测试体系。

现状更准确地说是：20 个分散的 Node `verify-*.mjs` 脚本、25 个 Python `test_*.py` 文件和一条 CI 工作流。它们各自能发现问题，但没有统一的测试 runner、测试层级、目录、报告协议、覆盖规则、并行/超时规则，或“策略版本 -> 本地系统验证 -> 真实平台 Canary”的可追溯映射。

推荐的核心组合是：

```text
纯领域与协议逻辑        Vitest + fast-check
真实本地浏览器系统      官方 @playwright/test
历史 Python sidecar     已有 pytest / pytest-asyncio，独立执行
真实平台能力            不使用测试 fixture；走生产 Canary / Evidence 流程
```

这里的关键不是多装几个框架，而是建立一条不可越过的可信度边界：

```text
本地绿色
  = 代码、协议、真实 Chromium、MV3、Native Messaging、Host、Gateway 可协同
  ≠ 某个平台的 DOM、XHR、登录态、交互或字段仍然有效

真实平台 Canary 通过
  = 仅证明该策略版本、该登录类别、该预算和该页面样本下的窄能力
  ≠ 自动升级为平台全面支持
```

## 2. 仓库基线：问题具体在哪里

2026-07-21 的只读审计结果如下。

| 项目事实 | 当前状态 | 对大型项目的影响 |
| --- | --- | --- |
| Node 验证脚本 | 20 个独立 `verify-*.mjs` | 每个脚本自行管理临时目录、进程、输出和断言；无法统一筛选、超时、报告或质量门槛。 |
| Python 测试文件 | 25 个 | `pytest` 已存在，但历史 sidecar 和 Collector 正式路线没有清晰的 CI/发布边界。 |
| TypeScript 测试 runner | 无 | 未安装 `@playwright/test`、Vitest、Jest、覆盖率或 mutation runner；当前只有 Playwright library。 |
| 根测试配置 | 无 | 没有 `vitest.config.*`、`playwright.config.*`、coverage 或 mutation 配置。 |
| CI | 1 条 Windows workflow | 只运行硬编码的 `npm run verify:local`，没有 test project、报告聚合、分层选择或 sidecar 隔离。 |
| 测试目录与命名 | 无统一约定 | 功能代码、build gate、纯逻辑验证和真实 Chromium 验证混在 `scripts/` 中。 |
| 平台能力映射 | 文档分散 | 真实 Canary 记录、策略 maturity、本地回归与 CI 没有一个机器可读的共同目录。 |

另一个必须正视的问题是：现有名为“真实 Chromium”的 Browser Host 生命周期脚本仍使用了 `data:text/html` 滚动和自导航页面。它确实驱动了真实浏览器，但该页面是合成夹具，不能证明任何真实网页或平台能力。根据本项目的产品约束，它不能再被称为 E2E 或平台验证。

后续处理规则应是：

1. 可完全脱离浏览器验证的规则，抽成纯领域测试；
2. 只想验证 Chromium/MV3/Native Messaging/Host 生命周期的，保留真实本地系统测试，但不要以假网页宣称页面能力；
3. 真实页面、滚动、菜单、点击、筛选、字幕、评论、XHR 语义，只能由专门的真实平台 Canary 证明。

### 2.1 现有验证脚本的迁移归属

下面不是对能力的重新认证，而是对当前脚本的测试性质重新归类。这样迁移时不会把原有结论混乱地搬入新框架。

| 当前验证单元 | 正确层级 | 迁移方向 |
| --- | --- | --- |
| `collector-extension/scripts/verify-build-artifacts.mjs` | L0 | 保留为 build/manifest 制品门禁，由统一 runner 调用。 |
| `collector-gateway/scripts/verify-build-artifacts.mjs` | L0 | 保留为 production bundle 边界门禁。 |
| `verify-account-safety.mjs`、`verify-task-account-safety-resume.mjs` | L1 | 拆为 Vitest 状态机/属性测试；保留真实时间、重启与重复 action 的语义。 |
| `verify-*-contract.mjs`、`verify-transcript-artifacts.mjs`、`verify-transcript-control-loop.mjs` | L1/L2 | 改为 Vitest contract/artifact tests；它们只证明本地 schema 和去敏持久化，不再以平台名字暗示实网能力。 |
| `collector-extension/scripts/verify-transcript-capture.mjs` | L1/L2 | 保留 route whitelist、payload ceiling、字段白名单和敏感字段丢弃；不把生成的输入称为字幕实网验证。 |
| `collector-extension/scripts/verify-extension-load.mjs` | L3 | 迁入 `@playwright/test`，加载 production `dist/` 并验证 MV3 worker/control surface；零平台请求。 |
| `collector-browser-host/scripts/verify-real-strategy-binding.mjs` | L3 | 迁入 `@playwright/test`，继续验证真实 Chromium、MV3、Native Messaging 与 binding correlation。 |
| `collector-gateway/scripts/verify-real-browser-host-integration.mjs` | L3 | 迁入 `@playwright/test`，继续验证真实 Gateway -> Host restart / explicit close。 |
| `collector-browser-host/scripts/verify-real-browser-lifecycle.mjs` | L3，但须拆分 | Host/extension/process lifecycle 留在 L3；`data:` 滚动和自导航页面不再计为页面能力，能纯化的逻辑转 L1/L2，需要页面语义的部分改为 L4 Canary。 |
| `poc/intelligence-gateway/tests/*.py` | sidecar L1/L2 | 继续 pytest，但单独报告、单独 CI job，不进入 Collector maturity。 |
| `poc/deepresearch-gateway/tests/*.py` | sidecar L1/L2 | 同上；只证明 DeepResearch adapter 的安全/审计行为。 |

这张表也解释了为什么不能简单把现有 `verify:local` 当作“测试框架”：它本身同时混入了 L0、L1、L2、L3，却没有告诉执行者每个绿色结果究竟能说明什么。

## 3. 外部框架与仓库调研

### 3.1 官方 Playwright：应作为真实本地系统测试的底座

官方 Playwright 的 Chrome extension 文档明确说明：扩展只能在 **Chromium 的 persistent context** 中工作；Chrome 和 Edge 已移除侧载扩展所需的命令行 flag，测试应使用 Playwright 自带的 Chromium。文档还给出了取得 MV3 service worker 的示例，并说明可以使用 Chromium channel 在 headless 下运行扩展，或使用 headed 模式。

这与当前 Collector 的真实运行面完全一致：持久 Profile、MV3 worker、可见/无头 Chromium、Browser Host 管理的页面，以及需要精确生命周期证明的 Native Messaging。

调研时仓库已使用 `playwright@1.61.1`；同日 npm registry 的 `@playwright/test` 最新版也为 `1.61.1`，要求 Node `>=18`，满足本项目 Node `>=22` 的约束。

因此建议从 Playwright library 的自写脚本升级为官方 `@playwright/test` runner，而不是替换浏览器自动化内核。

应使用它的：

- test fixture、projects、timeout、trace、screenshot/video-on-failure、JUnit/JSON report；
- 真正的 persistent context 与生产 `dist/` 扩展；
- 真实 MV3 service worker、真实 Native Messaging host、真实 loopback Gateway 和真实 Browser Host 进程；
- test-scoped 临时 Profile/状态根目录，绝不触及用户的 Collection Profile。

不应使用它的：

- `storageState()` 导出/复用登录态；本项目禁止导出认证材料；
- route mock、假 XHR、页面 clone 来声称平台能力；
- Playwright 的扩展模式替代项目的 MV3/Host 架构；它是不同产品能力面，且其 extension-mode 相关 open issues 仍在快速变化。

### 3.2 Vitest：适合纯领域、协议与属性测试，不适合冒充平台 E2E

Vitest 的官方项目（projects）机制可在一个 Node 进程中按目录或命名配置多个测试项目；官方文档也明确指出 coverage 是 root-level 能力，而不是每个子项目各自配置。Vitest v4.1.10 支持 V8 与 Istanbul coverage；V8 coverage 对当前 Node/Chromium 技术栈兼容，且不需要预插桩。

这很适合把纯代码测试拆成下列 project：

```text
contracts              runtime guards、wire message、版本兼容规则
gateway-domain         account safety、task/retry/terminal reducer、artifact redaction
browser-host-domain    PageLease、page ledger、回收计划、错误分类
extension-domain       canonicalisation、投影器、策略输入/输出边界
```

它不应加载真实平台页面，也不应成为 Native Messaging 或平台 Canary runner。Vitest 的定位是快速、可重复的纯逻辑反馈；平台交互必须留给真实 Chromium 系统测试和 Canary。

### 3.3 fast-check：用于高风险状态空间，而不是制造网页假数据

`fast-check` 是 TypeScript 的 property-based testing 框架。调研时 npm 最新版为 `4.9.0`，最近发布于 2026-07-08，Node `>=12.17.0`，与本项目兼容。

它适合测试目前最容易靠少数例子遗漏的纯规则：

- Account Safety 的 `ready / running / locked` 转换与崩溃恢复；
- at-most-once action ID、deadline、重复 resume、版本 mismatch；
- PageLease/document generation/record version 的非法组合；
- Native Messaging/IPC message guard 对任意 JSON、超长数组、错误 schemaVersion 的拒绝；
- URL canonicalisation、query 丢弃、artifact 去敏和 digest 一致性。

它不用于生成“假的 B 站 HTML”、“假的 XHR 响应”或“假的 Gateway 闭环”。这些不属于纯逻辑覆盖，且会违反项目的真实平台证据边界。

### 3.4 pytest：保留给历史 Python sidecar，不能混入 Collector 发布结论

`poc/intelligence-gateway` 与 `poc/deepresearch-gateway` 已分别使用 pytest 与 pytest-asyncio。调研时 PyPI 的 pytest 为 `9.1.1`，pytest-asyncio 为 `1.4.0`；它们适合继续覆盖这两个 Python POC 的 API、存储、审计和安全规则。

但 README 已明确它们是历史数据源/DeepResearch sidecar，不是当前 Collector 的运行时。它们应有独立 test project、独立 CI job 和独立报告，不能因为 sidecar 测试通过就改变 Collector strategy maturity。

### 3.5 `vitest-environment-web-ext`：可以阅读，不能成为核心依赖

调研了 `crxjs/vitest-environment-web-ext`：

- npm 包当前为 `0.0.3`，2026-02-26 发布；
- GitHub issues 页面显示 0 个 open issue，但仓库很小、公开表面积也很薄；
- 其 `src/index.ts` 只是启动一个 browser environment；
- `WebExtBrowserManager` 本质上调用 `chromium.launchPersistentContext` 并加上 `--load-extension` / `--disable-extensions-except`。

源码没有 Native Messaging 注册/清理、Windows host 生命周期、Gateway restart、PageLease、document binding、受管页面池、账号安全或证据契约。把它放在核心会隐藏最关键的生命周期问题，反而更难测。

结论：不引入。直接使用官方 `@playwright/test`，并把项目特有的 Browser Host fixture 写成受审查的本地测试支持层。

### 3.6 Bitwarden BIT：只借鉴结构，不能照搬运行方式

Bitwarden 的 `browser-interactions-testing` 使用 Playwright 测真实构建的浏览器扩展，并把静态测试与低频 live site 测试分开。其 README 也诚实记录了 live test 因实验、广告、网络、验证码等会 flaky，且建议低频、浅路径、避免登录。

这两个原则与 Collector 相符：

- 真实扩展制品和真实浏览器必须参与本地系统测试；
- live 站点测试不能成为普通 CI 的自动重试任务。

但 BIT 依赖 Docker、测试 vault、静态 pattern library、环境 secrets 和网站 clone。这与本项目“不导出凭据、不用合成平台页面、不用 fake Gateway/XHR 冒充平台能力”的规则冲突。

结论：借鉴 static/live 分层、diagnostics、CI 分离；不引入其代码、依赖或网页夹具方法。

### 3.7 Testcontainers 与 Stryker：都不是第一步

- `testcontainers` 当前 npm 版本 `12.0.4`，适合数据库、服务端依赖的短生命周期容器；但它无法证明 Windows Native Messaging 注册、持久 Chromium Profile、MV3 worker 和真实 Browser Host 的行为，因此不应成为 Collector 核心测试底座。未来 Evidence Vault 若引入可容器化数据库时再评估。
- `@stryker-mutator/core` 当前为 `9.6.1`，Node `>=20`，可用作 mutation testing。它适合在 Vitest 稳定后，每周或合并前手动运行在 Account Safety、runtime guard、canonicalizer 等少量高风险纯模块上。它不能替代系统测试，也不应一开始在整个仓库运行。

## 4. 推荐的分层：不是普通“测试金字塔”，而是可信度阶梯

本项目最危险的错误不是“某函数漏了 if”，而是把不同可信度的结果混在一起。因此推荐下面五层；层数越高，数量越少、成本越高，但结论也越贴近真实产品。

```text
L4  真实平台 Canary / Evidence  ─ 低频、可见、受预算与账号安全约束、非 CI
L3  真实本地系统测试             ─ production dist + Chromium + MV3 + Host + Native Messaging + Gateway
L2  跨边界契约与持久化测试       ─ runtime guard、IPC、artifact、版本与恢复；仍然无平台
L1  纯领域与属性测试             ─ reducer、canonicalizer、状态机、计划器；可使用生成数据
L0  静态完整性                   ─ typecheck、build、manifest/制品审计、依赖与 secret 扫描
```

### L0：静态完整性

**目的**：尽早挡住不能构建、类型漂移、MV3 权限漂移、未打包文件、错误依赖和敏感制品。

**工具**：现有 `tsc`、production build、manifest/artifact assertions；后续补充 lint/format 规则，但 lint 不是平台测试替代品。

**禁止**：把 source-string 搜索当作策略可用性的唯一证据。

**结论**：`build_ready` 的必要条件之一，不是平台通过。

### L1：纯领域与属性测试

**目的**：验证可脱离 I/O 的代码在大量边界输入和状态序列下仍遵守安全契约。

**工具**：Vitest；对高风险状态空间使用 fast-check。

**允许**：内存对象、随机/生成的合法与非法 JSON、临时文件、固定时间、纯测试替身。

**禁止**：网页 HTML、平台 XHR、平台 DOM、fake Gateway、假 MV3 页面；这些都不能产生平台能力结论。

**必须重点覆盖**：

- 每个 state machine 的所有合法转移、所有非法转移、restart/replay 和 terminal state；
- 每个 runtime guard 的 schema version、未知字段、过大 payload、错误关联 ID；
- 每个去敏/持久化边界的 query、fragment、Cookie、Token、header/body、Profile/Tab/Document ID 排除；
- action ledger 的 at-most-once 与 unknown outcome stop；
- PageLease、generation、recordVersion、reclaim 计划的代数不变量。

### L2：跨边界契约与持久化测试

**目的**：测试 JS/TS 进程间仍要一致的协议和本地证据包，不依赖真实网站。

**工具**：Vitest + actual runtime validator/actual filesystem；必要时 fast-check 生成消息序列。

**关键点**：这里测试的是代码自身的 wire contract、schema、序列化、哈希、恢复和拒绝语义，不是模拟一条平台 HTTP response。

**必须有的证据**：版本 mismatch 被拒绝、旧记录升级行为明确、原子写入可恢复、同 action 不可二次执行、敏感字段永不落盘。

### L3：真实本地系统测试

**目的**：证明正式构建的本地组件能真正协同：production extension、真实 Playwright Chromium、真实 MV3 worker、真实 Native Messaging host、真实 Browser Host、真实 loopback Gateway、真实进程重连和清理。

**工具**：官方 `@playwright/test`，使用一个清晰命名的 `real-local` project；运行 Windows CI 和本地 Windows 环境。

**硬约束**：

- 只使用 test-scoped 临时 Profile、临时 state root、临时 native host registration 和随机 loopback port；
- 必须在 finally/fixture teardown 中验证自己启动的 browser/host/gateway 已按显式规则清理；
- `livePlatformRequests = 0`，并在报告中显式记录；
- 运行 production `dist/`，而不是只 import source；
- 不加载用户 Collection Profile，不打开真实平台 URL，不导出 storage state；
- 不使用 fake Gateway 或 fake Native Messaging；必须启动真实项目进程；
- 不使用 `data:`/页面 clone 来宣称真实页面、DOM、滚动或 XHR 能力。

这一层可以验证 Host 与 Gateway restart 不关闭 browser、MV3 worker marker、Native Messaging 配对、租约隔离、extension page 不累积、端口/注册表清理等系统不变量。它不验证 B 站、小红书、知乎等站点仍可用。

### L4：真实平台 Canary / Evidence

**目的**：证明一个版本化策略在声明的页面、登录类别、预算和动作次数内可完成某个窄目标。

**工具**：生产 Collector 的受管 Browser Host + 可见持久 Collection/Validation Profile + 侦察 Skill；不是 Vitest 或 Playwright Test 中的普通 spec。

**强制流程**：先按人类视角并行取得 visual、DOM、Network 证据；每个语义动作最多一次；未知结果立即停止；登录、验证码、风控、弱网和异常访问进入明确终态；输出去敏 Evidence 与 validation record。

**CI 规则**：永不自动运行、永不 scheduled retry、永不因为本地绿色自动升 maturity。

## 5. 测试目录、runner 与命名的推荐形态

以下是建议的最终结构，不要求一次性搬迁：

```text
poc/
  vitest.config.ts                         # L1/L2 的 root projects 与 coverage
  playwright.real-local.config.ts          # L3，仅 production dist
  testing/
    catalog.ts                             # 所有验证单元的机器可读目录
    support/
      clock.ts                             # 仅纯测试可用
      property-arbitraries.ts              # 仅纯领域输入生成
      real-local-fixture.ts                # 临时目录、进程树、真实 Chromium/MV3/Host/Gateway
      report-contract.ts                   # 去敏结构化报告与 counter 定义
    contracts/                             # L1/L2
    gateway-domain/                        # L1/L2
    browser-host-domain/                   # L1/L2
    extension-domain/                      # L1/L2
    real-local/                            # L3 Playwright specs
  collector-contracts/src/**/*.unit.test.ts
  collector-gateway/src/**/*.unit.test.ts
  collector-browser-host/src/**/*.unit.test.ts
  collector-extension/src/**/*.unit.test.ts
```

规则如下：

- `*.unit.test.ts`：只能是 L1/L2；文件名明确表明它不代表平台能力；
- `poc/testing/real-local/*.spec.ts`：必须由 `@playwright/test` 运行，且只能测真实本地组件；
- `scripts/canary/*`：不归测试 runner 管理；必须由生产的 account safety、预算、PageLease、Evidence 机制运行；
- 历史 Python POC 保留各自 `tests/`，在 catalog 中标为 `sidecar_pure`，不可成为 Collector release gate。

## 6. 机器可读验证目录：大型项目真正缺的“总账”

无论最终用哪种 runner，都应有一个唯一的 `testing/catalog.ts`。每一项验证必须声明：

```ts
{
  id: 'browser-host-real-local-lifecycle',
  tier: 'real_local',                 // static | pure | contract | real_local | live_canary
  owner: 'collector-browser-host',
  runner: 'playwright',
  command: 'test:real-local',
  timeoutMs: 120_000,
  platformPolicy: 'forbidden',        // live_canary 才允许 managed-profile 实网
  reports: ['browser-host-real-chromium-managed-page-lifecycle'],
  requiredCounters: { livePlatformRequests: 0 },
  capabilities: ['page-pool', 'native-messaging', 'gateway-reconnect'],
  strategy: null,
  canaryRecord: null
}
```

对策略能力，目录应继续显式关联：

```ts
{
  id: 'bilibili-account-video-page-two-live-canary',
  tier: 'live_canary',
  runner: 'production-canary',
  command: null,                       // CI/local suite 禁止执行
  platformPolicy: 'managed_profile_low_frequency',
  strategy: {
    id: 'bilibili.account.video-inventory.dom.v1',
    version: '0.1.0',
    maturity: 'research_canary_proved_not_admitted'
  },
  canaryRecord: 'docs/validation/bilibili-account-video-page-two-v0.1.md'
}
```

catalog 的作用不是替代测试，而是防止以下两种最危险的误报：

1. 一个 CI build gate 被误解成平台策略已经可用；
2. 一次真实 Canary 被误解成所有账号、所有页面、所有操作都已覆盖。

## 7. CI 与本地执行的推荐拓扑

```text
Pull request / 每次提交
  ├─ L0 静态完整性                         快速、所有改动必跑
  ├─ L1/L2 Vitest pure + contract           快速、所有改动必跑
  └─ L3 Windows real-local Playwright       使用临时 Profile，production dist，零平台请求

Nightly / 手动维护任务
  ├─ L3 repeat/reliability run              可多轮，但仍然零平台请求
  ├─ coverage trend                         只考核高风险纯模块
  └─ Stryker mutation                       只考核小范围安全/协议核心

本地受管实网
  └─ L4 live Canary                         无自动 CI、无自动 retry、独立 Evidence/validation record
```

建议把历史 Python POC 作为另一个 CI job：

```text
sidecar-pure-pytest
  -> pytest / pytest-asyncio
  -> 明确标记为 historical-sidecar
  -> 不能阻止或提升 Collector 策略发布，除非未来正式产品边界发生显式变更
```

测试报告一律去敏。CI 只保留必要的文本摘要、JUnit/JSON、失败时的 trace/screenshot 的受控 artifact；不上传 Collection Profile、Cookie、Token、HAR、response body、query、真实截图或任何登录状态。

## 8. 覆盖率与 mutation：如何避免“为了数字写垃圾测试”

不应一开始设置全仓库 80%/90% 之类的全局指标。那会诱导围绕实现细节写大量价值很低的 test。

建议只为高风险、纯模块设置质量目标：

| 模块类别 | 初始目标 |
| --- | --- |
| Account Safety / action ledger | 100% 状态转换与非法转换；核心 branch coverage 高于 95% |
| runtime guard / IPC schema | 100% 已声明 message type、版本 mismatch 与拒绝分支 |
| canonicalisation / redaction / artifact manifest | 100% 安全关键分支；加入 fast-check 属性 |
| PageLease / generation / reclaim planner | 核心不变量的属性覆盖；branch coverage 高于 90% |
| MV3/Gateway/Browser Host 系统 | 不设行覆盖 KPI；以真实本地行为和 cleanup 证据作为门槛 |
| 真实平台 | 不设覆盖率；以每个 capability 的 Canary、预算、失败语义和 Evidence 作为门槛 |

Mutation testing 在 L1/L2 稳定后用于检查这些高风险模块的测试是否真的能杀死错误变异。它应是低频的质量审计，而不是每次保存文件都运行的任务。

## 9. 明确拒绝的方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 用 fake B 站页面、fake XHR、fake Gateway 做 E2E | 拒绝 | 不能证明真实平台能力，且违背项目既定边界。 |
| 把 `data:text/html` / clone 页面称为平台测试 | 拒绝 | 最多验证浏览器 API 的局部机械行为，不能证明页面语义。 |
| 用 `vitest-environment-web-ext` 作为核心 | 拒绝 | 当前包很薄，未覆盖本项目最危险的 Native Messaging、Host、Gateway、PageLease 生命周期。 |
| 只依赖 Playwright library 的手写脚本 | 拒绝 | 没有项目、fixture、trace、timeout、shard、report、筛选和质量门槛。 |
| 只加单元测试 | 拒绝 | 已经发生过跨层 document binding / same-document interaction 缺口，纯测试无法证明真实进程和浏览器协同。 |
| 自动化真实平台 CI / 自动 retry | 拒绝 | 违反账号安全、at-most-once 与低频实网验证原则。 |
| 把历史 Connector/sidecar pytest 结果当 Collector 发布证据 | 拒绝 | 产品执行面和安全模型不同。 |
| Docker/Testcontainers 作为 Native Messaging 主测试面 | 暂不采用 | 无法证明 Windows Registry/Native Host/持久 Chromium 运行语义。 |

## 10. 推荐的最小落地顺序（尚未执行）

1. **先立规则，不迁一大堆脚本**：创建测试目录、catalog、报告契约、命名/禁止清单和 CI group；把现有验证按 L0-L4 标注，而不是立刻重写全部。
2. **先让 Vitest 承担真正的纯代码**：从 Account Safety、Native Bridge runtime guard、PageLease/state reducer、canonicalisation/redaction 四类高风险模块开始；每类至少一组 fast-check 属性测试。
3. **再建立单一 `@playwright/test` real-local fixture**：只启动 production dist、临时 Profile、真实 MV3、真实 Host/Native Messaging/Gateway；先迁移 Browser Host lifecycle 与 Gateway restart 两条最有价值的现有验证。
4. **把 CI 改成按 layer 选择，而非硬编码脚本列表**：PR 跑 L0-L3；sidecar pytest 单独跑；L4 永远不进入 CI。
5. **最后接入策略/Canary 总账**：每个策略版本必须同时拥有纯合同、本地系统验证、recon dossier 和真实验证记录，才允许任何 maturity 变化。
6. **稳定后再加 coverage trend 与 Stryker**：只针对安全/协议核心，避免把时间消耗在边角行覆盖。

## 11. 本轮推荐决策

如果没有新的产品边界变化，建议按以下决策进入实施：

1. 采用 **Vitest + fast-check + 官方 `@playwright/test` + pytest sidecar**；
2. 不接入 `vitest-environment-web-ext`、Bitwarden BIT、Testcontainers 或任何第三方爬虫/扩展运行时；
3. L3 一律基于 production dist 和真实本地进程，禁止 fake Gateway/XHR/平台 clone；
4. L4 继续使用生产 Canary/Evidence 流程，禁止 CI 与自动 retry；
5. 建立一个 catalog，将每个验证、策略、maturity、Canary record 与平台访问政策关联起来；
6. 将现有 `data:` 浏览器夹具从“E2E”口径移除：能纯化则纯化；需要网页语义的能力改由真实 Canary 验证。

## 12. 主要来源与核验日期

- Playwright 官方 Chrome extensions 指南（2026-07-21）：<https://playwright.dev/docs/chrome-extensions>
- Playwright 官方 projects 指南（2026-07-21）：<https://playwright.dev/docs/test-projects>
- Playwright npm registry（2026-07-21）：<https://registry.npmjs.org/@playwright/test>
- Vitest projects 指南（2026-07-21）：<https://vitest.dev/guide/projects.md>
- Vitest coverage 指南（2026-07-21）：<https://vitest.dev/guide/coverage.md>
- Vitest npm registry（2026-07-21）：<https://registry.npmjs.org/vitest>
- fast-check（2026-07-21）：<https://github.com/dubzzz/fast-check>、<https://fast-check.dev/docs/introduction/getting-started/>
- pytest 文档与 PyPI（2026-07-21）：<https://docs.pytest.org/en/stable/explanation/fixtures.html>、<https://pypi.org/project/pytest/>
- `crxjs/vitest-environment-web-ext` README/source/issues（2026-07-21）：<https://github.com/crxjs/vitest-environment-web-ext>、<https://raw.githubusercontent.com/crxjs/vitest-environment-web-ext/main/src/browser/WebExtBrowserManager.ts>
- Bitwarden Browser Interactions Testing README/issues（2026-07-21）：<https://github.com/bitwarden/browser-interactions-testing>、<https://raw.githubusercontent.com/bitwarden/browser-interactions-testing/main/README.md>
- StrykerJS 与 Testcontainers npm registry（2026-07-21）：<https://registry.npmjs.org/@stryker-mutator/core>、<https://registry.npmjs.org/testcontainers>
