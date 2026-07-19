# 真实网页交互侦察证据契约

在设计侦察 run、判断一次交互是否成功或把实证迁移到生产状态机前读取本文件。

## 1. Run 摘要

至少记录：

```yaml
runId: local logical id
objective: 本轮只回答的一个可行性问题
platform: 平台
targetRole: search | detail | account | discussion | media | other
targetIdentity: 去敏规范标识
browserMode: visible persistent profile
browserLifecycle: temporary_recon | managed_profile_session
authenticated: true | false | indeterminate
extensionInteractionLoaded: false
existingPlatformRunnerUsed: false
navigationCount: 1
startedAt: ISO-8601
finishedAt: ISO-8601
outcome: proved | partial | inconclusive | blocked
```

首次干净侦察应把 `extensionInteractionLoaded` 和 `existingPlatformRunnerUsed` 记为 `false`。后续产品闭环验证必须另建 run，不能覆盖人工可行性记录。

## 2. 观察时间线

按顺序记录这些 phase，而不是只保存最终 DOM：

```text
browser_started
network_observer_attached
navigation_submitted
baseline_visible
control_revealed
target_discovered
precondition_checked
action_attempted
visual_postcondition
dom_postcondition
network_postcondition
cleanup_verified
```

每条观察包含时间、phase、来源 `visual | dom | network | browser | local`、事实和推断。把事实与推断放在不同字段中。

## 3. 动作账本

每个用户可观察动作使用稳定的语义 ID：

```yaml
actionId: open_caption_menu
intent: 展开字幕语言菜单
targetDiscovery:
  visual: 播放器底部字幕按钮
  dom: '[aria-label="字幕"]'
precondition:
  checked: true
  satisfied: true
input:
  layer: browser
  kind: mouse_move
  trustedPath: playwright-cdp
attempted: true
attemptCount: 1
outcome: completed | postcondition_unmet | prerequisite_unmet | risk_stopped | context_changed
postconditions:
  visual: 菜单可见
  dom: 中文语言父项可见
  network: not_expected
```

约束：

- `attemptCount` 对导航、语义 hover、click、scroll、filter、sort、expand 等平台动作最多为 1。
- 一旦发送浏览器输入，即使超时或返回丢失，也记录 `attempted=true`。
- 前置条件不满足时记录 `attempted=false / prerequisite_unmet`。
- 本地读取和等待不进入平台动作计数，但必须有 deadline。

## 4. 视觉证据

记录截图时间、页面角色、窗口/CSS 尺寸、DPR、滚动位置、鼠标动作前后状态和可见结果。不把屏幕物理像素直接当作 CSS 坐标。

截图属于本地运行材料，默认放入 ignored runtime，不提交含账号头像、昵称或其他身份线索的原图。长期参考文档优先保存文字化的结构事实。

## 5. DOM 证据

为目标与后置条件分别记录：

- tag、role、ARIA、稳定 `data-*`；
- 真正交互父节点和最小文本子节点的关系；
- 动作前后 class/selected/expanded/checked 状态；
- 实时 `x/y/width/height`；
- display、visibility、opacity 与遮挡；
- 可见面板的公开文本样例或文本哈希。

不要把单一 CSS class 永久声明为稳定 selector。把它与页面角色、语义属性和真实验证日期绑定。

## 6. Network 证据

每条候选响应记录：

```yaml
phase: baseline | after_action_id
method: GET
origin: https://example.com
path: /route/without/query
status: 200
mime: application/json
byteLength: 12345
causalAssessment: confirmed | candidate | unrelated
domCrossCheck: 对应的页面状态
```

只有满足以下条件才使用 `confirmed`：

1. 请求在目标动作后首次出现或有可解释的增量；
2. route 语义与目标一致；
3. 页面同时出现对应 DOM/视觉状态；
4. 如读取公开 response，字段值能够与页面内容或目标对象匹配。

播放器分片、遥测、广告、推荐、账号卡片和后台刷新即使时间接近，也不能自动归因于动作。

## 7. 结论分类

- `proved`：目标动作一次完成，所需独立后置条件全部成立。
- `partial`：流程只完成一部分，例如目录已发现但正文未触发。
- `inconclusive`：动作已经尝试，但证据不足以解释结果。
- `blocked`：登录、验证码、风控、限流、访问控制或页面身份阻止继续。

人工可行性 `proved` 只证明真实浏览器能够完成操作。生产扩展/Gateway 闭环必须用独立 run 证明，不能继承该状态。

## 8. 交付摘要模板

```markdown
结论：proved / partial / inconclusive / blocked

- 环境：真实网站、可见持久 Profile、是否加载待测扩展
- 人类流程：看见什么 -> 做了什么 -> 页面怎样变化
- DOM：目标节点、动作前状态、动作后状态
- Network：动作后新增 route、status、大小、公开字段映射
- 动作预算：导航 N，hover N，click N，scroll N，均无自动重试
- 产品含义：应由哪一层实现；哪些旧假设被否定
- 清理：临时浏览器/端口/Gateway 是否归零；产品管理的 Profile 会话若有意保留，记录窗口数、所有者与显式关闭条件
```
