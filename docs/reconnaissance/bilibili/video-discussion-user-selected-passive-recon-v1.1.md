# B 站视频评论：用户选定页面的被动观察侦察 v1.1

结论：**partial**。已在真实、可见、持久的隔离验证浏览器中证明“人类先滚到评论区 → 当前 document 可被动读取”的视觉与 DOM 路径；本次 run 没有启用受限 XHR 元数据 observer，因此不能把 DOM 成功误报为网络实证。

## 窄问题

对公开视频 `BV1qZSLBYEpa`，用户像正常人一样把页面滚到评论区后，评论组件是否会在同一 document 中水合为可见、可读取的 DOM？这是否足以支撑一个**零导航、零滚动、零点击、零 response body** 的 `user_selected_tab` MVP？

## 环境与边界

- 浏览器：项目隔离验证 Chromium 的单一持久 context；未接触用户日常浏览器、日常 Profile 或凭据。
- 页面：一张由测试宿主明确拥有并在结束时 `retained_for_review` 的 B 站视频 tab。
- 扩展：真实生产 MV3、真实 Native Messaging/Browser Host 桥接；不是 fixture、fake XHR 或页面克隆。
- 身份状态：页面处于正常已登录可见状态；没有读取 Cookie、Token、Storage 或 response body。
- 平台输入预算：导航 1 次；可信鼠标滚轮 1 次；hover/click/sort/展开回复/刷新/重试均为 0 次。

## 观察时间线

| Phase | 事实 | 结论 |
| --- | --- | --- |
| `navigation_submitted` | 对规范视频 URL 仅导航一次；同一 tab 中观察到 document generation 从 0 到 2。 | B 站会在同一导航生命周期内替换主 document，不能把第一次 `DOMContentLoaded` 当作稳定页面。 |
| `baseline_visible` | 视频页正常可见；首屏未出现评论区、验证码、异常访问或登录弹窗。 | 评论锚点不在首屏，不应把“页面打开”误判为“评论组件已水合”。 |
| `current_document_bound` | 在 document generation 2 上建立当前 document 的固定评论 DOM observer。 | 对已稳定页面的被动观察可行，不需要第二次导航。 |
| `action_attempted` | 可信 browser wheel 向下滚动一次，CSS scrollY 从 0 变为 760。 | 唯一语义动作是人类式查看评论区；没有自动重试。 |
| `visual_postcondition` | 评论标题显示 `评论 10357`，`最热` 为当前默认态，`最新` 控件可见，根评论已显示。 | 视觉上证明评论区进入页面可见区域。 |
| `dom_postcondition` | 固定 Shadow DOM 投影得到：`commentHostPresent=true`、`commentHostVisible=true`、`commentHostInViewport=true`、`commentContentState=ready`、根评论数 20。 | 证明组件在同一 document 内于滚动后水合；根评论可做有界被动投影。 |
| `network_postcondition` | 本轮没有启用 route 元数据 observer；response body 始终未读取。 | XHR 触发与 route 仍是未证明项，不能由 DOM 结果推断。 |

## 人类流程

```text
打开公开视频
  → 先看视频首屏，确认没有验证码/异常访问
  → 像正常用户一样向下滚一次，直到评论区域出现
  → 评论组件加载并显示根评论
  → 用户在扩展 UI 明确选择“当前已加载评论的视频页”
  → 后续 Collector 只读取同一 tab/document 的固定评论 DOM
```

## 产品含义

可以上线的第一条 direct 路径应当是：

```text
用户手动打开视频并把评论区滚进视口
  → 在扩展 popup 显式选择当前页（120 秒、单次 tab/document lease）
  → 上层 API 只提交规范 BV URL + 已配对 browserBindingId
  → Gateway 签发 bilibili.discussion / user_selected_tab typed work
  → 扩展被动投影当前已加载的最多 20 条根评论
  → Gateway 保存 capability-bound 本地产物
```

这条能力必须保持以下硬边界：

- work 预算为平台导航 0、页面语义动作 0、response body 0；
- 不自动滚动到评论区、不切换“最新”、不展开回复、不翻页、不刷新；
- 如果评论尚未水合、页面/文档改变、tab 已关闭、出现验证码/限流/异常状态，则明确停止；
- 精确 tab ID、window ID、document ID 只保存在扩展 `chrome.storage.session`，不会进入 Gateway、API、产物或上层应用；
- 本次结论不证明评论 XHR route，也不证明“最新排序”、回复树、分页或评论全量采集；这些必须分别做三面侦察。

## 清理与保留

- 平台页面在本次 run 后以 `retained_for_review` 留在隔离测试浏览器中；没有“测完立即关页”。
- 截图仅留在 Git ignored 的本地 runtime evidence，本文只记录去敏结构事实。
- 没有额外浏览器、临时 Profile、调试端口或自动重试残留。
