# Monorepo 项目与目录边界

状态：架构决策

日期：2026-07-30

## 1. 结论

当前仓库是一个面向开源发布的 **Collector Core 单 Git 仓库**。主 Git 根目录是：

```text
D:\AIProject\inteligence\.git
```

`poc` 只是当前 Collector Core workspace 的目录名，不是 Git 仓库边界，也不应成为
所有未来项目的“万能目录”。更重要的是：当前仓库只负责浏览器采集基础能力，不负责
知识包编排、跨平台汇总、媒体处理、DeepResearch 或具体上层应用。

因此，今后的规则是：

1. **Collector Core**（MV3 插件、必要的 Browser Host/Gateway、Contracts、SDK 和已登记平台策略）继续留在当前仓库；
2. **知识包、汇总、媒体处理、DeepResearch 和上层应用**从一开始就作为当前仓库之外的独立项目维护；
3. 当前仓库内的 `apps/` 只允许 smoke、验证和开发工具，不放产品级上层应用；
4. **历史 POC 和第三方源码**保持隔离，不能被当成生产包或运行时依赖；
5. 当前 `poc` 不做内部拆分；隔离通过公开 API/SDK、依赖方向和独立仓库实现。

## 2. 当前仓库的事实结构

```text
inteligence/                 # 唯一主 Git 仓库
├─ apps/                     # smoke、验证和开发工具（不是产品级上层应用）
├─ docs/                     # 产品、架构、验证和研究文档
├─ poc/                      # 当前 Collector Core workspace + 历史 POC（过渡状态）
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

### 3.1 Collector Core 内部改动

现有 Collector Core 的内部包继续放在 `poc/`，例如：

```text
poc/collector-contracts/
poc/collector-extension/
poc/collector-browser-host/
poc/collector-gateway/
poc/collector-client/
poc/collector-python-client/
```

它们属于同一个 Collector Core 产品，因此继续放在当前 `poc` workspace 下。这里不做
内部拆分，也不为了目录好看进行大规模搬迁。Core 的职责只到“通过受控浏览器能力交付
原始 artifact 和稳定 API/SDK”为止。

Core 内部包仍然必须拥有自己的 manifest、依赖、测试和公开端口，并遵守依赖门禁。这样可以：

- 复用现有构建和验证入口；
- 通过 import graph、依赖锁定和测试矩阵实现项目级隔离；
- 不引入一次大规模路径迁移；
- 让 Gateway、Extension、SDK 之间的边界在代码层稳定下来。

这里的“放在同一目录”不等于“互相可以随意 import”。每个包仍必须遵守：

```text
Delivery → Application → Domain / Ports
Adapters → Domain / Ports
Infrastructure → Domain / Ports
Domain → nothing
```

### 3.2 上层应用与汇总项目

产品级知识包、跨平台汇总、媒体处理、DeepResearch 适配器和研究控制台不进入当前
仓库。它们应放到主仓库旁边的独立项目目录，并拥有自己的 Git 仓库，例如：

```text
D:\AIProject\inteligence/             # 当前 Collector Core 仓库
D:\AIProject\inteligence-apps/        # 未来独立上层应用仓库（名称可调整）
├─ knowledge-pack/
├─ media-processing/
├─ deepresearch-adapter/
└─ apps/
```

上层项目只能通过版本化的 Local Collector Service API、OpenAPI 合同或 JS/Python SDK
调用 Core。它不能直接导入 Extension、Browser Host、Profile 实现或平台策略内部模块；
Core 也不能反向依赖上层项目。

当前仓库内已有的 `apps/collector-python-sdk-smoke` 属于验证工具，可以保留；它不代表
产品级上层应用进入 Core。

### 3.3 独立产品

如果未来出现 DeepResearch 编排器、独立桌面控制台或独立部署服务，直接在当前仓库之外
建立独立 Git 项目，而不是继续堆进 `poc`。项目名称可以是
`inteligence-apps`、`inteligence-research` 或其他明确名称；名称可以后定，边界不能混淆。

## 4. 为什么现在不立即把 `poc` 改名

当前根级脚本、README、runbook、验证记录、Playwright 配置和多个 package path 都以
`poc` 为工作目录。立即全量搬迁会产生大量无产品价值的路径 diff，并增加漏改命令、
验证入口和文档链接的风险。

因此采用两阶段策略：

### 阶段 A：现在

- 保持一个主 Git 仓库；
- 当前 Collector Core 继续使用 `poc` workspace，不做内部拆分；
- 禁止把知识包编排、跨平台汇总、DeepResearch、媒体处理和产品级上层应用加入 Core；
- 新的上层项目在主仓库外建立独立 Git，并通过 API/SDK 依赖 Core；
- Core 内部每个包继续拥有自己的 manifest、测试、README 和依赖方向门禁。

### 阶段 B：有真实收益时

如果未来只是觉得 `poc` 这个名称不适合开源发布，再单独安排一次目录重命名；这属于
品牌/路径迁移，不是项目边界拆分。迁移前后都不允许同时维护两套路径。

## 5. 何时才拆成多个 Git 仓库

当前 Core 与未来上层应用之间已经形成稳定的开源边界，因此上层应用默认使用独立仓库。
对于 Core 内部的包，只有出现以下至少一个稳定边界时才考虑再拆仓库：

- 不同团队分别维护并需要独立代码所有权；
- 独立发布、版本和回滚周期；
- 不同许可证或必须完全隔离的安全信任边界；
- 独立部署、运行时和基础设施生命周期；
- 单仓库构建、测试或权限管理成本已经成为实际瓶颈。

仅仅因为新增了一个 Python 包、一个 Gateway adapter 或一个平台策略，不足以拆 Core 的
Git；但知识包、汇总和 DeepResearch 不属于 Core，应从一开始就放在外部项目。

## 6. 实施约束

- Git 提交按项目/边界形成可回滚 checkpoint，不把无关项目混在同一个提交；
- 根级 CI 负责 Core 内部跨包契约和集成门禁，各包负责自己的单元测试与类型检查；
- `collector-python-client` 只负责 Gateway 协议；知识包编排属于仓库外上层项目；
- Gateway、Extension 和 Browser Host 不得依赖知识包、DeepResearch 或媒体处理；
- 上层项目只能依赖 Core 的 API/SDK，不能以相对路径或内部 import 反向嵌入 Core；
- `runtime/`、浏览器 Profile、凭据和真实运行产物不进入主 Git；
- 目录归属不能替代依赖边界；最终以 import graph 和公开端口为准。
