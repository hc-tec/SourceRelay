# Monorepo 项目与目录边界

状态：架构决策

日期：2026-07-30

## 1. 结论

当前仓库采用 **单 Git、多个独立项目/包的 monorepo**。主 Git 根目录是：

```text
D:\AIProject\inteligence\.git
```

`poc` 只是当前 Collector workspace 的目录名，不是 Git 仓库边界，也不应成为
所有未来项目的“万能目录”。

因此，今后的规则是：

1. **属于 Collector 核心产品的包**，在当前目录迁移完成前，继续作为 `poc` 的兄弟包维护；
2. **上层可执行应用和示例**放在顶层 `apps/`；
3. **独立产品或独立部署单元**不自动放入 `poc`，需要出现真实边界时再建立顶层项目目录；
4. **历史 POC 和第三方源码**保持隔离，不能被当成生产包或运行时依赖；
5. 是否拆成独立 Git 仓库，取决于发布、权限、团队、许可证或部署边界，而不是目录名称。

## 2. 当前仓库的事实结构

```text
inteligence/                 # 唯一主 Git 仓库
├─ apps/                     # 上层应用、SDK smoke、消费者
├─ docs/                     # 产品、架构、验证和研究文档
├─ poc/                      # 当前 Collector workspace + 历史 POC（过渡状态）
│  ├─ collector-contracts/   # Collector 核心包
│  ├─ collector-extension/
│  ├─ collector-browser-host/
│  ├─ collector-gateway/
│  ├─ collector-client/
│  ├─ collector-python-client/
│  ├─ browserwing/            # 历史 POC
│  ├─ maxun/                  # 历史 POC / 第三方源码隔离
│  └─ deepresearch-gateway/   # 历史适配 POC
├─ runtime/                  # 本地运行态和研究 checkout，原则上 Git-ignore
└─ skills/                   # 本项目专用开发/侦察规范
```

`poc/maxun/upstream/.git` 以及 `runtime/research-checkouts/*/.git` 是外部源码 checkout
的内部 Git 元数据，不改变主仓库的边界；它们也不应被 import 到 Collector 运行时。

## 3. 下一步项目应该放在哪里

### 3.1 Collector 内部新包

例如：

```text
poc/collector-knowledge-pack/
poc/collector-media-processing/
```

它们虽然是独立的 Python/Node 项目（各自拥有 manifest、依赖、测试和公开端口），
但仍属于同一个 Collector 产品，因此暂时放在 `poc` workspace 下最稳妥。这样可以：

- 复用现有构建和验证入口；
- 通过 import graph、依赖锁定和测试矩阵实现项目级隔离；
- 不引入一次大规模路径迁移；
- 让 Gateway、Extension、SDK、知识包之间的边界先在代码层稳定下来。

这里的“放在同一目录”不等于“互相可以随意 import”。每个包仍必须遵守：

```text
Delivery → Application → Domain / Ports
Adapters → Domain / Ports
Infrastructure → Domain / Ports
Domain → nothing
```

### 3.2 上层应用

例如 Python SDK smoke、研究控制台、未来的本地任务客户端：

```text
apps/collector-python-sdk-smoke/
apps/research-console/
```

应用可以调用已发布的 SDK 或本地 API，但不能直接导入 Extension、Browser Host、Profile
实现或平台策略内部模块。

### 3.3 独立产品

如果未来出现 DeepResearch 编排器、独立桌面控制台或独立部署服务，应按产品边界建立
顶层项目（例如 `apps/deepresearch-console/` 或明确的 `projects/<name>/`），而不是
继续堆进 `poc`。在真正需要之前不预先创建 `projects/`，避免形成第二套重复的目录规则。

## 4. 为什么现在不立即把 `poc` 改名

当前根级脚本、README、runbook、验证记录、Playwright 配置和多个 package path 都以
`poc` 为工作目录。立即全量搬迁会产生大量无产品价值的路径 diff，并增加漏改命令、
验证入口和文档链接的风险。

因此采用两阶段策略：

### 阶段 A：现在

- 保持一个主 Git 仓库；
- Collector 新包继续作为 `poc` 的兄弟包；
- 禁止把 DeepResearch、媒体处理实验、第三方 checkout 随意混入核心包；
- 每个新包必须有自己的 manifest、测试、README 和依赖方向门禁。

### 阶段 B：有真实收益时

当 Collector 包数量、发布流程或维护者明显增加，再一次性把活动包从
`poc/collector-*` 迁移到更准确的 `packages/collector-*` 或 `collector/packages/*`，
同步更新 workspace、脚本、文档和 CI。迁移完成前不同时维护两套路径。

## 5. 何时才拆成多个 Git 仓库

只有出现以下至少一个稳定边界时才考虑拆仓库：

- 不同团队分别维护并需要独立代码所有权；
- 独立发布、版本和回滚周期；
- 不同许可证或必须完全隔离的安全信任边界；
- 独立部署、运行时和基础设施生命周期；
- 单仓库构建、测试或权限管理成本已经成为实际瓶颈。

仅仅因为新增了一个 Python 包、一个 Gateway adapter 或一个平台策略，不足以拆 Git。

## 6. 实施约束

- Git 提交按项目/边界形成可回滚 checkpoint，不把无关项目混在同一个提交；
- 根级 CI 负责跨包契约和集成门禁，各包负责自己的单元测试与类型检查；
- `collector-python-client` 只负责 Gateway 协议；知识包编排进入独立包；
- Gateway、Extension 和 Browser Host 不得反向依赖知识包、DeepResearch 或媒体处理；
- `runtime/`、浏览器 Profile、凭据和真实运行产物不进入主 Git；
- 目录归属不能替代依赖边界；最终以 import graph 和公开端口为准。

