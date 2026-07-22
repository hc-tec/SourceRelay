# B 站视频详情首屏：DOM-only MVP 契约 v0.1

- 日期：2026-07-21
- 状态：已完成独立匿名实网可行性侦察；历史受管闭环见第 7–10 节，通用 document-binding 诊断与正常公开视频重新验证进行中（第 12–13 节）
- 示例页面：`https://www.bilibili.com/video/BV1qZSLBYEpa`

## 1. 要解决的问题

当用户提供一个规范 BVID URL 时，系统能否在其受管浏览器的**同一精确页面**中，以一次导航、零页面交互的方式，保存可供后续 AI 使用的视频首屏详情。

这不是字幕、评论或多 P 内容采集的替代品。它只回答“这一条视频是什么”的问题。

## 2. 已证明的页面事实

2026-07-21 在独立、匿名、无扩展的可见 Chromium 临时会话中，页面一次导航后可同时看到：

- 标题 `H1`；
- 可见的 B 站播放器；
- 发布时间与公开指标所在的标题信息块；
- 公开视频简介；
- 标签；
- UP 主公开入口；
- “视频选集”及多 P 摘要。

该样本同时出现登录二维码浮层，但上述详情仍可见。没有点击登录、扫码、关闭浮层、播放、字幕、选集、评论或推荐卡片。

导航基线存在播放器、弹幕和字幕相关 route，但本 MVP 不读取 response body，不把任何 route 当作字段来源，也不保存请求头、Cookie、Token 或 query 值。

## 3. MVP 边界

```text
最大详情数                     1
目标页面导航                    1 次
页面交互                        0 次
response / XHR 采集             0 条
自动平台重试                    0 次
截图                            1 份 runtime 视觉证据
终态页面                        retained_for_review
```

本轮允许持久化的公开 DOM 投影只有：

```text
规范 BVID
标题
标题信息块的可见文本
简介
UP 主显示名及公开数字账号标识（若页面可靠提供）
标签文本（有界）
多 P 是否可见与其摘要文本（不是全量分 P）
登录浮层 / 验证 / 限流 / 不可用的布尔状态
```

明确排除：字幕正文、选集全量列表或切换、评论、楼中楼、推荐、自动播放、点赞/投币/收藏/关注、任何 response body，以及任意 DOM/JS/selector 输入接口。

## 4. 证据与完成语义

一个结果至少需要：

1. Browser Host 的精确 lease、run 与 document generation；
2. 受限 Extension binding 得到的确切 document ID；
3. 当前 URL 规范化后仍等于目标 BVID URL；
4. 可见 `H1` 和可见播放器同时成立；
5. 一份导航后的视觉证据。

标题、简介、创作者、标签和多 P 摘要分别独立标识为 present / absent，不用缺少可选字段伪造失败。若验证码、限流、异常访问、页面身份变化或导航结果未知，立即结束当前 run，不重放导航。

## 5. 产品设计约束

浏览器控制、Extension DOM 投影和 Gateway artifact 必须保持分层：

```text
Browser Host
  -> page lease、一次导航、视觉证据、终态保留

MV3 Extension
  -> 精确 tab/document/run 绑定、固定 DOM 投影

Gateway
  -> BVID 输入校验、动作账本、风险状态、去敏 artifact
```

为了不把“当前 tab”或“最近页面”误认为目标，Extension 会使用一个源专属 document-ready bridge 获取 Chrome document ID；不会用通配 selector、任意 `executeScript` 输入或通用 response observer 取代该绑定。

## 6. 后续能力的分界

```text
视频详情首屏    -> 本文 MVP
多 P 全量目录   -> 单独的选集目录策略
字幕正文        -> 既有 transcript 策略，独立验证
评论与楼中楼    -> discussion_sample 策略，单独预算与动作账本
```

只有本 MVP 的真实闭环被证明后，才开始下一个表面；不能因为首屏 DOM 成功而默认字幕、评论或多 P 切换已经可用。

## 7. 受管 Profile 产品闭环（2026-07-21）

该 run 与第 2 节的匿名可行性侦察严格分开。它使用项目管理的、已登录 B 站 Collection Profile，并由 Browser Host 独占该 Profile。

在 run 前，扩展做了一次明确记录的版本升级：旧 `0.7.3 / revision 7` 会话在无 active lease 时关闭，Browser Host 与 Profile 随后以 `0.7.4 / revision 8` 重新启动。这个生命周期升级不是页面失败后的重试，也没有触发 B 站导航。

```text
runId       f2468a92-778c-4eea-9b0e-6559070cfaa1
artifactId  94bc3d7e-33c3-4f67-a5b1-44be5a8af4a9
strategy    bilibili.video.detail.dom.v2
state       completed
reason      detail_ready
```

### 动作与证据

```text
导航                         1 次（完成）
hover / click / scroll        0 次
response / XHR 观察           0 条
自动平台重试                  0 次
视觉证据                      1 份 runtime 截图（1280 × 720 CSS viewport）
终态页面                      retained_for_review
```

截图仅保留在 ignored runtime；本文和 Git 不含图片、用户身份信息、请求头、Cookie、Token、query 值或 response body。

### 有界 DOM 投影结果

| 字段 | 结果 |
| --- | --- |
| BVID、可见标题、可见播放器 | 已验证并捕获 |
| 标题信息、公开视频简介 | 已捕获 |
| 标签 | 已捕获 10 个 |
| 视频选集摘要 | 已捕获 |
| 登录浮层、验证码、限流、不可用 | 均未出现 |
| UP 主显示名 / 公开数字账号 ID | 本次投影未命中；作为可选字段如实记录，不影响 `detail_ready` |

### 终态安全检查

- Account Safety：`ready`，没有 active run、cooldown 或人工解锁要求；
- 受管 `video_detail` 页：`retained_for_review`，没有 active lease；
- artifact 的 manifest 与详情文件摘要均已核验；
- safeguards 明确记录 request header/body、Cookie/Token、网络 query/fragment 与 response body 均为 `not_read`。

结论：**proved（首屏详情 MVP）**。这证明了 Browser Host → MV3 精确 document binding → Gateway artifact 的真实闭环可用，但不扩大到字幕、全量多 P、评论、楼中楼、推荐或创作者字段的完整性承诺。下一轮应先单独对创作者 DOM 结构做真实页面侦察，再决定是否修订该可选投影。

## 8. 创作者字段跟进侦察（2026-07-21）

针对第 7 节的 `creatorCaptured=false`，在独立、匿名、无扩展的可见临时 Chromium 会话中做了一个新的窄侦察 run。它只有一次导航、零 hover/click/scroll，结束后临时浏览器、截图和 CLI 运行材料均已清理。

- 视觉：首屏标题右侧存在可见的 UP 主卡片；
- DOM：旧 `#v_upinfo` 不存在；可见 `.up-info-container` 与 `.up-panel-container` 存在；
- DOM：`.up-info-container a.up-name[href]` 是可见的公开创作者名称入口，并链接到公开数字账号 profile；头像入口也指向同一公开 profile，但没有显示名；
- Network：本次只验证公开 DOM 形状，未读取或保存网络请求、query、response 或认证材料。

因此后续投影应优先选取可见的 `.up-info-container a.up-name[href]`，再以同一容器内公开 profile 链接作兼容性回退；不能继续把已不存在的 `#v_upinfo` 当作当前桌面页面的唯一假设。

## 9. 创作者投影产品闭环（2026-07-21）

第 8 节的实证结论被实现为一次独立的扩展升级：`0.7.4 / revision 8` 会话在无 active lease 时按计划关闭，Browser Host 与 Profile 随后以 `0.7.5 / revision 9` 启动。新 session 的 initial marker 仍为旧版本，最终 marker 为新版本，且 Native Messaging 已连接；这证明本轮没有把旧 worker 误当作新代码。

```text
runId       0e7e9d1a-6b9e-4e92-bda9-755a56ff4e06
artifactId  2b6937d6-b470-4953-b526-841a7f71b35d
strategy    bilibili.video.detail.dom.v2
state       completed
reason      detail_ready
```

本 run 与第 7 节一样只有一次导航、零 hover/click/scroll、零 response 观察和零自动重试。视觉证据存在于 ignored runtime，终态页面保留为 `retained_for_review`，Account Safety 回到 `ready`。

新的 artifact 再次捕获标题、简介、10 个标签和选集摘要；并且创作者显示名与公开数字账号 ID 都已存在。manifest/detail 摘要、截图引用和所有 `not_read` safeguards 均已核验：没有读取 request header/body、Cookie/Token、网络 query/fragment 或 response body。

结论：**proved（当前桌面首屏完整投影）**。在这个已验证样本上，MVP 定义的全部首屏公开字段均可用。该结论仍不延伸到字幕正文、全量选集、评论/楼中楼、推荐内容或任何未独立实证的交互能力。

## 10. 目录派生详情与团队布局校准（2026-07-22）

随后 `0.7.8` 在受管、可见、登录 Collection Profile 中把已完成的账号目录 artifact 作为唯一来源，先后对两条显式选中 BVID 执行单条详情物化。每条均只有一次导航、零 hover/click/scroll、零 response body、零自动重试；父 artifact digest、源页码和子详情 artifact 均可复核。

- `BV136K36TEa8` 的视觉页面显示“创作团队”卡。旧 `#v_upinfo` 与单一 `.up-info-container` 假设不足，因此投影加入受限的 `.up-panel-container` 候选；真实结果取得团队公开数字账号 ID。其目录卡未见“充电专属”标记，视频没有可投影简介文本。
- `BV1BoKD6ZEir` 的标准作者卡真实取得显示名与公开数字账号 ID；目录卡明确标为“充电专属”，同样没有可投影简介文本。当前策略没有访问状态字段，因此不能把这条 run 的可见播放器容器误报为已经证明可以播放或读取受限内容。
- 为确认这不是描述 selector 回归，已知 URL `BV1qZSLBYEpa` 在同一 `0.7.8` 运行时以一次导航真实取得简介、创作者显示名/账号、10 个标签和选集摘要。

描述读取现在只在固定候选 `#v_desc`、`.video-desc-container .basic-desc-info`、`.video-desc-container .desc-info-text` 与 `.video-desc-container` 间选择，仍受可见性、长度和控制字符校验。已知有简介的对照页面已在同版本命中这些候选；又因未标“充电专属”的目录样本也没有简介，付费限制不是空简介的充分或必要解释。首屏策略仍把简介/创作者/选集视为独立 present/absent 字段；访问状态另行侦察，不能为所有视频承诺完整性。

## 11. 充电专属访问状态：匿名页面对照侦察（2026-07-22）

### 可行性问题

目录卡中的“充电专属”是否只是创作者开通充电的泛入口，还是当前视频的实际访问限制；若是限制，首屏策略应如何诚实表达，而不把播放器容器误写为“可播放”。

### 独立人工式基线

本轮暂时忘掉现有 Extension、Gateway runner 和旧 selector，在两个**新建、可见、匿名、持久但临时**的 Chromium Profile 中各做一次规范视频详情导航。两轮均未加载待验证的 Collector 交互逻辑，未读取 Cookie、Token、storage、请求头/体、query/fragment 或 response body；不点击“去开通”、不支付、不解锁、不点赞/关注/评论，也不滚动。

| 对照 | 规范页 | 导航 | 视觉与 DOM 事实 | 结论 |
|---|---|---:|---|---|
| 受限样本 | `BV1BoKD6ZEir` | 1 | 播放器内可见“该视频为『中书门下平章事』专属视频”“试看中・开通『12元档包月充电』即可观看”与“去开通”；弹幕输入区可见“充电后即可发送弹幕”。 | 已证明为充电专属的试看状态。 |
| 未标记对照 | `BV136K36TEa8` | 1 | 同一可见播放器角色存在，但未找到 `.bpx-player-trial-watch-charging-toast`、`.bpx-player-charging-toast-left-title` 或“充电后即可发送弹幕”的可见语义。 | 未观察到这一类门禁；这**不**被解释为“永久公开”或“已证明可访问所有内容”。 |

受限样本的 DOM 证据来自可见播放器区域：

```text
[aria-label="哔哩哔哩播放器"]
  .bpx-player-trial-watch-charging-toast
    .bpx-player-charging-toast-left-title  -> 含“专属视频”
    .bpx-player-charging-toast-left-level  -> 含“试看中”与“充电”
```

每个节点均在当时具有非零边界，且 `display`、`visibility`、`opacity` 都满足可见条件。class 不是永久稳定性的单独承诺：生产判定同时要求上述受限播放器容器、两个可见子节点和中文语义文本。此轮不存在 UI 动作，因此没有需要归因的动作后网络请求；Network 未作为结论依据。临时浏览器、临时 Profile、截图和调试输出都在记录结构事实后关闭/清理，未将原始页面材料提交入库。

### 对产品的约束

- `charge_exclusive_trial` 是**正向观察**状态，表示只看到试看和开通提示；它不是支付流程的入口，也不授权任何绕过。
- 未命中门禁时只能保存 `indeterminate`，不能仅凭播放器可见、黑屏、目录没有标签或创作者侧栏含“充电”就写成 `public`、`playable` 或“可抓字幕”。
- `video_detail` 仍可投影标题、公开元数据、作者和标签；但后续媒体、字幕、弹幕或其他需完整播放权限的能力必须以访问状态为独立前置条件并另做实网证明。
- `BV136K36TEa8` 同样没有可投影简介，故“充电专属”不是此前两条 `descriptionCaptured=false` 的充分或必要解释。

基于此侦察，`0.7.11` 详情投影新增 `chargeExclusiveTrialVisible` 的受限 DOM 事实，并在 Gateway artifact 中映射为 `accessStatus = charge_exclusive_trial | login_required | indeterminate`。该实现还要求 document-start 后的固定首屏稳定窗口和可见播放器控制层，避免把骨架屏误判为完成；若同一规范 URL 在首屏加载中被站点再次替换，Observer 只会以 Chrome 返回的当前主文档 ID 重新绑定，不会再次导航或接受调用方的 document ID。仍须由受管登录 Collection Profile 的独立真实闭环验证，匿名人工侦察不能替代产品闭环。

## 12. 同 URL 主文档替换：故障复盘与 `0.7.12` 修复（2026-07-22）

### 事实，不把错误归因成平台门禁

`0.7.10` 与 `0.7.11` 分别对 `BV1BoKD6ZEir` 进行了单条、一次导航、零点击的受管 Profile canary。两次都没有验证码、异常访问、限流、付费解锁或重复导航；Account Safety 最终也回到 `ready`。但 Browser Host 的去敏 journal 均表明：

```text
首次 main-frame navigation / navigation_completed
  -> 约 2 秒后，同一规范 BVID URL 再发生一次 main-frame navigation
  -> 旧 binding 在约 55 秒到期
  -> video_detail_strategy_binding_context_rejected
```

因此该错误不能解释为“页面没有充电门禁”或“内容公开”。它首先是详情观察生命周期没有完成的本地框架故障。

另做了一次独立、匿名、无扩展、可见的临时 Chromium 侦察，只访问该受限样本一次且不点击、hover、滚动、登录或读取网络数据。页面在初始截图和静置 6 秒后的可访问性树中，都同时有可见播放器控制项（如“播放/暂停”）与可见试看 toast。故“控件因为没有 hover 而永久隐藏”不是本次 55 秒失败的主因。临时 browser、Profile、截图和 CLI 材料随后均已关闭/清理。

### `0.7.12` 的生命周期修复

修复保持详情策略的零页面交互边界，不增加平台导航、刷新、点击或 response 读取：

1. document-start bridge 不再在第一个 document-ready 消息后注销；只要短时 binding 仍在，它可以收到同一规范目标的替换文档。
2. 每次 DOM capture 前，MV3 只在已绑定 tab 上调用 Chrome `webNavigation.getFrame({ frameId: 0 })` 取得当前主文档身份；它不接受 Gateway/调用方提供的 document ID，不读取页面 DOM，也不把 URL 或 document ID 输出到 artifact。
3. binding session schema 升至 `v3`，只在 Extension session storage 内维护 `documentBindCount` 等生命周期元数据；旧 binding 不迁移，因其本来就是短时任务状态。
4. B 站首屏稳定窗口由 2 秒提高到 3 秒，并在每个替换文档重新开始计时。它用于避免把首个骨架文档当成最终页面，不是随机“拟人”延迟、重试或额外平台动作。
5. Manifest 新增 `webNavigation` 权限，但实现只在已有精确 binding 的 tab、规范目标已匹配时读取主 frame 身份；不会注册全局采集、持久化浏览历史或导出 URL/认证信息。

### 验证层级与当前状态

```text
L1  单元：同目标 document-a -> document-b 的 binding 仍保持 bridge 注册，
    且以 Chrome 当前主 frame identity 重新绑定；不需要页面 fixture。

L3  real-local：生产 Chromium + MV3 + Native Messaging + Browser Host + Gateway，
    6/6 通过、live platform requests = 0。

L4  live canary：待执行；只允许一个 BVID、一次导航、零点击、零自动重试。
```

L1/L3 仅证明浏览器/扩展基础框架，不能冒充 B 站能力。`0.7.12` 随后对同一受限样本执行的单次 canary 仍在约 55 秒后以 `video_detail_strategy_binding_context_rejected` 结束，且 Browser Host 又一次记录到同 URL 的第二次 main-frame navigation。它证明第一轮修复不足，但**不**支持把故障归因成“充电视频”或平台访问限制。

## 13. 去敏 binding 诊断与验证样本纠偏（2026-07-22）

`BV1BoKD6ZEir` 最初仅用作“播放器存在不等于可访问”的受限负向样本。它不应成为详情页框架开发的中心，更不应被重复导航来掩盖基础问题。该样本的第二次失败已经完整保留为一次导航、零 click/hover/scroll、零自动重试的 runtime artifact；后续不会自动重跑它。

为让下一次验证回答**通用**问题，`0.7.13 / revision 11` 新增了失败时的本地 binding 诊断命令。它只能在当前 managed page 仍由同一 run lease 持有时调用，并且只返回以下枚举/布尔型生命周期事实：

```text
bindingState              missing | invalid | expired | active
documentBindingState      not_bound | bound
documentBindCount         0 | 1 | 2 | 3（3 表示三次或更多）
bridgeRegistration        registered | missing | unavailable
currentMainFrameState     not_checked | unavailable | target_mismatch |
                          current_document_unbound | matches_bound_document |
                          different_document | excluded_document
```

它明确不返回 tab ID、document ID、URL、DOM、截图、页面文本、请求/响应、storage、Cookie、Token 或任何认证材料。失败诊断只写入该次 ignored runtime artifact 的 manifest，不进入摘要索引，也不构成采集字段。

新的 L1 单元和 L3 生产 Chromium/MV3/Native Messaging/Browser Host/Gateway real-local 闭环均已验证该命令（6/6、零实网请求）。下一条 L4 canary 必须改为正常公开视频；验证目标是“同 URL 主文档替换后能否稳定完成详情投影”，而非测试充电门禁。访问状态仍是详情投影的一项停止/标记分支，不再是开发主线。
