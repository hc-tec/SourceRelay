# 日常浏览器 B 站 direct-mode 全面验收（2026-07-27）

## 结论

本次在**用户日常使用、已登录并已配对的浏览器**中，使用 loopback-only
Collector Gateway Testbench 对全部 `direct_ready` B 站能力做了真实只读闭环验收。

- `direct_ready`：**8 / 8 通过**。
- 每项只提交一次平台任务；Gateway/扩展记录的导航预算均为一次，未自动重投。
- 全程未读取或导出 Cookie、token、Storage、原始网络正文；没有执行点赞、关注、评论、私信、发布或删除。
- Gateway 保持 `user_owned_browser_extension` 模式：不会创建、接管或关闭用户的日常浏览器 Profile。

这是一份产品闭环验收，不把本地单元测试冒充真实平台证据；本地测试结果另列于本文后半部分。

## 范围与方法

- 环境：一个 online 的已配对 MV3 扩展绑定；Gateway 与 Testbench 均为 `127.0.0.1` loopback 服务。
- 输入：预先选定的公开视频、公开 UP 主和固定站内搜索词；文档不保留标题、正文、昵称、图片 URL 或认证信息。
- 调度：严格串行。每个 `POST /api/operations` 只发起一次，之后仅对本地 operation 做有界读取轮询。
- 停止条件：验证码、登录失效、风控、限流、断网、工作页被用户接管、导航结果未知或任一 loopback 错误都会停止后续平台动作。本次没有触发这些条件。
- 证据：每项都核对 Gateway 的 terminal operation 和同一 operation 可推导的受控 artifact；只记录去敏的状态、动作账本和布尔/计数投影。

## 真实平台验收结果

| 能力 | 真实终态 | 一次性动作/导航证据 | 去敏投影证据 | 结果 |
| --- | --- | --- | --- | --- |
| `bilibili.video_detail` | `detail_ready` | 一次导航完成 | 标题、播放器、简介、作者和标签等受控公开投影可用；无登录遮罩 | 通过 |
| `bilibili.account_profile` | `profile_ready` | `open_canonical_account_profile`：`attempted=true`、`attemptCount=1`、`completed` | 页面身份匹配、账号头部定位、显示名可见，且排除了当前查看者头部 | 通过 |
| `bilibili.account_inventory` | `inventory_ready` | `open_canonical_account_inventory`：一次完成 | 首屏 40 张可见投稿卡，0 张未解析卡，无登录遮罩 | 通过 |
| `bilibili.native_search` | `search_ready` | `open_fixed_native_search`：一次完成 | 首屏 20 张可见视频卡，0 张未解析卡，无登录遮罩 | 通过 |
| `bilibili.dynamic` | `dynamic_ready` | `navigation.attempted=true`、`attemptCount=1` | 动态流可见，12 条可见动态；无验证码、限流、源不可用或登录遮罩 | 通过 |
| `bilibili.collection_series.overview` | `collection_series_overview_ready` | `navigation.attempted=true`、`attemptCount=1` | 公开列表可见；9 个概览项目；固定元数据响应 200；从真实 artifact 发现 3 个合法详情候选 | 通过 |
| `bilibili.collection_series.detail` | `collection_series_detail_ready` | `navigation.attempted=true`、`attemptCount=1` | 仅使用上一项 artifact 派生的真实候选；首屏可见、25 项可见卡、声明总数 164、活动页为第 1 页；无风险/登录信号 | 通过 |
| `bilibili.danmaku` | `danmaku_ready` | `navigation.attempted=true`、`attemptCount=1` | 播放器与弹幕叠层可见，无登录/验证码/限流/源不可用；本次首屏可见弹幕行数为 0 | 通过（零结果） |

### 弹幕的准确边界

`bilibili.danmaku` 本次闭环证明了“被动读取当前页面可见弹幕 DOM”的 direct 能力可以完成；它**不等于**已采集完整弹幕历史。本次结果为零条可见行，属于公开页面当前可见投影的真实零结果，不应被包装成弹幕内容丰富度验证。

## 当前不在日常浏览器 direct-mode 范围内的能力

以下 3 项在 `/v2/capabilities` 中已明确登记为迁移边界。本次没有把它们偷渡到旧 Browser Host 或任何回退路径，因此不记为失败、也不记为通过。

| 能力 | 登记状态 | 原因 |
| --- | --- | --- |
| `bilibili.account_inventory.pagination` | `direct_migration_required` | 有界翻页仍待迁移到日常浏览器直连执行模型 |
| `bilibili.transcript` | `trusted_interaction_migration_required` | 需要可信 hover/click 触发字幕菜单与文本轨道观察 |
| `bilibili.discussion` | `trusted_interaction_migration_required` | 需要可信滚动、排序和评论线程展开 |

## 后续独立 direct canary

本文件上方的 **8 / 8** 是当日用户日常、已登录浏览器的原始验收范围，保持不改写。随后使用独立、临时、可见 Chromium 与 production MV3 / direct Gateway / Testbench 完成了 [`bilibili.native_search_batch`](bilibili-native-search-batch-direct-canary-v0.1.md) 的真实闭环：固定第 1、2 页各一次签名导航，`search_batch_ready`，24 项受控公开投影，零页面语义动作和零 response body。因此能力登记册现将它标为 `direct_ready`；它不代表任何用户日常浏览器已经被接管或自动重载。

## 原始验收的辅助测试分层（历史记录，不替代真实平台证据）

| 层级 | 执行命令/方式 | 结果 |
| --- | --- | --- |
| Testbench 契约与输入边界 | `apps/collector-gateway-testbench` 的 `npm run check` | 7 / 7 通过；覆盖固定输入映射、任意 URL/额外字段拒绝、artifact 路径绑定与 loopback 限制 |
| Gateway 只读 smoke | `npm run smoke:gateway` | 通过；确认 user-owned extension 部署、1 个 online 绑定、12 项登记能力及受限 API 路径 |
| 核心单元/领域测试 | `poc` 的 `npm run test:unit` | 57 个测试文件、183 个测试通过 |
| 本地真实进程 integration/E2E | `poc` 的 `npm run test:real-local` | 8 / 8 通过；含实际 MV3 启动、direct Gateway 配对、隔离 Profile 边界和 Gateway/Browser Host 生命周期 |

## 原始验收结束时状态（历史记录）

- 日常浏览器绑定：仍为 `online`。
- Testbench 与 Gateway：仍可达；Testbench 记住本轮 8 个 operation，便于当前进程内审阅。
- Gateway：仍报告 `browserProcessControl=not_available`，符合“用户浏览器不由 Gateway 接管”的产品边界。
- 隔离验证浏览器：按其显式持久生命周期保留，状态为 `ready`，0 个 extension 页面、1 个非受管保留页、0 个实时平台请求；未擅自关闭。
- 工作区：本次测试与构建没有留下新的未提交实现改动；唯一现有未提交项是项目所有者的 `AGENTS.md` 修改，未触碰、未暂存。

## 后续建议

1. 将上表 8 项以及后续独立验证通过的固定两页搜索，作为上层 Deep Research / 分析应用可依赖的正式 direct 基础服务矩阵。
2. 下一项优先迁移 `account_inventory.pagination`；它仍需要新的已登录隔离 Profile 三面实证，不能借用搜索分页结论。
3. 字幕与评论继续先做“真实人类流程 + DOM/XHR 并行侦察”，验证可信浏览器输入后再进入 extension/Gateway 产品闭环；不要用 synthetic DOM click 或旧 Browser Host fallback 代替。
