# B站视频评论与楼中楼 Source Reconnaissance v1.0

- 状态：DOM MVP complete for first-page sort and one thread；response schema mapping paused
- 日期：2026-07-19
- 页面角色：公开视频详情评论组件
- Evidence objective：`discussion_sample`
- 账号类别：anonymous 与 user-managed authenticated 分别验证
- 样本：`https://www.bilibili.com/video/BV1qZSLBYEpa/`
- Production response routes：空
- Admission eligible：否

## A. 需求与边界

本能力是有界评论样本，不是“抓全站评论”。任务必须声明：

- 排序：最热或最新；
- 主评论目标数；
- 主评论页数；
- 是否进入楼中楼；
- 每个根评论的回复页数/回复数；
- 总语义动作、时间和响应大小预算；
- 停止条件与 partial 表述。

禁止无限滚动、自动遍历 162 页楼中楼、点赞/回复/关注、自动登录、验证码处理和把匿名可见上限当成真实终点。

## B. 人类浏览路径

```text
打开公开视频
  -> 观察导航阶段评论请求
  -> 滚动评论组件进入 viewport
  -> 核对默认“最热”
  -> 点击“最新”一次
  -> 选择第一条公开楼中楼入口
  -> 点击“点击查看”一次
  -> 观察分页控件与短时网络差分
  -> 停止，不点下一页
```

## C. 页面状态与登录差异

### C.1 匿名页面

导航阶段即自动出现：

- `GET https://api.bilibili.com/x/v2/reply/subject/description`
- `GET https://api.bilibili.com/x/v2/reply/wbi/main`

评论组件进入 viewport 后，这两条 route 再次出现，说明组件可能重新初始化或重新请求。匿名 DOM 公开显示：

- 评论计数 `12634`；
- 默认排序“最热”和可见“最新”按钮；
- 少量公开主评论及回复；
- `共1619条回复，点击查看`；
- `共109条回复，点击查看`；
- `登录后查看 1.2万+ 条评论`；
- `没有更多评论`。

“登录后查看 1.2万+ 条评论”与“没有更多评论”同时出现，证明匿名页的“没有更多”是 authentication visibility cap，不是平台全量终点。任何 anonymous coverage 都必须报告登录门禁。

匿名页第一次点击“最新”没有新增 Fetch/XHR，也没有可靠 DOM 选中态；不能把它解释为切换成功。认证样本随后提供了明确因果证据。

### C.2 认证页面

登录状态通过同一 Profile 关闭/重启核验，未读取凭据。认证 run 中：

- 点击“最新”一次后，明确新增主评论 route；
- 点击第一条“点击查看”一次后，明确新增楼中楼 route；
- DOM 展开后出现 `共162页 1 2 3 4 5 ... 162 下一页 收起`；
- 本轮没有点击“下一页”。

## D. 动作—route 映射

### D.1 主评论排序

| 语义动作 | 精确候选 | method/MIME/status | query key names | DOM cross-check |
|---|---|---|---|---|
| `select_latest_comments` | `https://api.bilibili.com/x/v2/reply/wbi/main` | GET / `application/json` / 200 | `mode`, `oid`, `pagination_str`, `plat`, `seek_rpid`, `type`, `w_rid`, `web_location`, `wts` | “最新”控件可见；认证点击后 route 新增 |

该 route 同时承载排序、对象、分页/定位和签名时序语义。未来 projector 只能使用页面当前请求的响应；不得复制 `w_rid`/`wts`、重放请求或把签名值保存为 Evidence。

### D.2 楼中楼展开

| 语义动作 | 精确候选 | method/MIME/status | query key names | DOM cross-check |
|---|---|---|---|---|
| `expand_first_thread` | `https://api.bilibili.com/x/v2/reply/reply` | GET / `application/json` / 200 | `oid`, `pn`, `ps`, `root`, `type`, `web_location` | 展开后显示 162 页、下一页和收起 |

主评论与楼中楼是两个独立分页表面：

```text
/x/v2/reply/wbi/main
  -> 主评论排序 + 主列表游标

/x/v2/reply/reply
  -> 选定 root 下的回复页 pn/ps
```

因此讨论预算必须分别限制主评论页和每个 root 的回复页；不能只设一个总“评论页数”。

## E. 背景噪声排除

动作短窗还会出现：

- `data.bilibili.com` 日志；
- `/x/click-interface/web/heartbeat` 播放心跳；
- 视频 `.m4s` 分片；
- `hdslb.com` SVG/图标；
- 账号卡片、动态导航和关系信息。

这些请求虽然时间接近，但没有对应评论 DOM 变化，不能归因于排序或楼中楼。播放器分片也说明只按“动作后新增”不足以建立因果，必须同时比较 route 语义和可见页面结果。

## F. DOM 与 response 字段映射计划

当前只完成 route metadata，没有读取 response body。下一步 schema-only 映射原计划仅允许：

- `/x/v2/reply/wbi/main`
- `/x/v2/reply/reply`

映射应回答：

- 主评论数组、排序状态和下一页游标字段；
- root comment、child replies、页码和总页数；
- 哪些字段对应公开用户名、公开正文、公开时间、公开可见计数；
- 哪些字段只作控制、签名或内部状态，不能进入 Evidence；
- response 与当前 DOM 的 item identity/文本哈希是否能一致匹配。

用户提出账号封禁风险后，schema-only 映射暂停，未读取正文。因此当前不能声称已验证具体 JSON 字段或 response projector。

## G. 字段—证据表面（当前候选）

| 输出 | 页面可见 | 候选表面 | 状态 |
|---|---|---|---|
| declared sort | 是 | DOM + main response 控制字段 | 动作因果已确认，字段未映射 |
| root comment public content | 是 | main response + DOM | 未映射 |
| root public author/time/metrics | 是 | main response + DOM | 未映射 |
| child reply public content | 是 | reply response + expanded DOM | 未映射 |
| child reply pagination | 是/间接 | reply `pn/ps` + DOM 162 页 | route 已确认 |
| cursor/signature | 否/控制用途 | response/request context | 仅运行控制，不保存 |

## H. 预算与停止条件

建议保守默认：

- 默认排序必须显式记录，不默认为“全量”；
- 主评论页最多 1–2 页；
- 只展开用户计划选中的 root；
- 每个 root 默认最多 1 页 child replies；
- 本样本虽显示 162 页，也不得自动遍历；
- 同一语义动作 at-most-once；
- 断网、3 个 Fetch/XHR failure、导航失败或 60 秒 deadline 立即停止；
- 验证码、风控和限流进入人工解锁；
- 结果表述为“在声明排序、登录状态、页面/回复预算和捕获时间下的讨论样本”。

## I. 策略候选

未来应使用独立策略族：

```text
bilibili.video.discussion.response.v1
```

建议机制：

```text
comment_navigation
  + bounded_interaction
  + approved_response（仅 main/reply 精确 projector）
  + visible_dom cross-check
```

不得塞入 `bilibili.video.detail.dom.v1 @ 1.4.0`，后者继续保持 `suspended`。

## J. 当前停止状态

- B站受管浏览器：已关闭；
- Profile risk state：`locked / user_safety_pause`；
- Gateway 重启后锁仍保留；
- 登录状态探针与认证交互 endpoint 在开浏览器前被拒绝；
- response body 未读取；
- production response routes 仍为空；
- 未经用户新的明确批准，不继续下一页、更多 root 或正文映射。

## K. 2026-07-23 匿名页面 DOM 复核与误点复盘

本轮在两个独立的、可见、临时持久 Chromium Profile 中做了三次窄验证；每次均只导航到 `BV1qZSLBYEpa` 一次，未加载 Collector 扩展，不读取 Cookie、Token、storage、请求头、请求体或 response body。

### K.1 已重新证明的事实

- 评论区视觉上可见，评论标题、数量、`最热/最新` 和首屏评论卡在滚动后出现；一次 `scrollIntoViewIfNeeded` 后新增的精确公开 route 为 `/x/v2/reply/subject/description` 与 `/x/v2/reply/wbi/main`，均为 200；
- 评论宿主是 `#commentapp > bili-comments`，`bili-comments` 使用**开放 Shadow DOM**；评论标题位于 `bili-comments-header-renderer` 的 shadow tree，排序控件是语义为 `最新` 的 `bili-text-button`；首个楼中楼入口位于 `bili-comment-thread-renderer > bili-comment-replies-renderer` 的 shadow tree，同样是语义为 `点击查看` 的 `bili-text-button`；当前没有 iframe；
- 因此，普通 `document.querySelector`、全页面 `getByText('最新')` 或全页面 `getByText('点击查看')` 都不足以建立目标身份。生产 DOM projector 必须显式穿透当前开放 Shadow DOM，并把控件绑定到当前 `#commentapp` 组件层级，再由 Host 重新读取实时边界框。

### K.2 误点的安全结论

第一次匿名探索中，全页面文本匹配把一个非评论语义入口当成了 `点击查看`，浏览器级点击打开了登录对话框；没有触发 `/x/v2/reply/reply`，该 run 不能算“楼中楼完成”，也不能把 action 结果记为 proved。随后没有重放该动作。该事实还说明：

- 匿名页面遇到登录门控时必须立刻停止后续评论动作；
- 生产后置条件必须检查评论组件 shadow tree 的排序/回复状态和登录对话框风险，而不能只看“点击调用成功”；
- `select_latest_comments` 与 `expand_first_thread` 的动作预算仍各自最多一次；目标未通过组件层级和可见边界框校验时，`attempted=false / prerequisite_unmet`，不得尝试全页面兜底。

本轮没有把匿名登录门控误报成平台 route 不可用，也没有把错误点击产生的对话框当成评论能力证据。认证样本中既有的 `/x/v2/reply/wbi/main` 与 `/x/v2/reply/reply` 因果记录仍是候选研究证据，但 response schema projector 和 production response routes 继续为空；下一步应在现有登录 Collection Profile 清理出可用页面后，执行一次严格 scoped 的认证 `select_latest_comments`，再执行一次 scoped 的单 root `expand_first_thread`。

## L. 2026-07-23 discussion DOM runner canary

在独立临时 Gateway、独立可见 Chromium Collection Profile 和当前 production extension build 上完成了一次新的产品闭环验证。该 run 没有复用登录 Profile，也没有读取认证材料。

```yaml
runId: d580e1a2-d43c-45ac-ac84-30e24c1ccb01
artifactId: 85cc5a05-56e9-4a8c-a360-facd8948d49c
target: BV1qZSLBYEpa
strategy: bilibili.video.discussion.dom.v1 @ 0.1.0
state: partial
terminalReason: login_required
navigationCount: 1
trustedScrollCount: 1
clickCount: 0
rootComments: 2
commentContentState: ready
responseBodies: not_read
productionResponseRoutes: []
targetPage: retained_for_review
admissionEligible: false
```

视觉证据显示评论标题、数量、`最热/最新`、登录评论提示和首屏评论卡均已出现；artifact 中两条根评论文本不再包含 Shadow DOM `<style>` 内容。匿名页面的登录门禁被如实保留为 `partial/login_required`，没有点击登录、排序或楼中楼，也没有自动重试。

这次 canary 还暴露并修复了两个生产后置条件缺陷：评论宿主出现但仍显示“正在玩命加载…”时不能判定 `discussion_ready`；评论文本、登录和风控信号必须限定在 `#commentapp` 组件树，不能用全页面文本兜底。当前 DOM runner 只在 `ready` 或明确 `empty` 状态投影，加载超时进入失败语义。最新排序与楼中楼动作仍未在该 run 中尝试，response projector 和 admission 继续保持暂停。

## 2026-07-23 延迟评论与页面身份修复

真实认证 Profile 的后续验证证明，评论并不是导航后立即可用：B站在首次 `DOMContentLoaded` 后约 1.5 秒又提交了一次同一 BVID 的主文档，随后评论树才在一次可信滚动后逐步出现。浏览器历史还显示同一视频会在生命周期内出现以下公开 URL 变体：

- `https://www.bilibili.com/video/<BVID>`；
- 同一路径尾斜杠；
- 同一路径尾斜杠并附唯一 `vd_source=<32位十六进制>`。

因此实现增加了三个窄门禁：

1. 导航完成后先等待 2.5 秒的 document-generation 静默窗口；若窗口内再次导航则只重新读取本地页面上下文，不重导航、不重放滚动。
2. 首轮评论观察最多等待 8 秒后再执行唯一一次可信滚动；滚动后持续观察到 `ready` 或明确 `empty`，`loading/unknown` 不会降级为空评论。
3. 只有同一 BVID 的上述 URL 变体被讨论区 Host 接受；其他 query、hash、host 或 BVID 均仍会隔离并停止。

在该修复后的真实 run 中，导航 1 次、可信滚动 1 次，评论 DOM 投影捕获 20 条根评论，页面以 `retained_for_review` 保留。排序点击尚未证明：点击前探针在发送浏览器输入前超时，已记录为前置条件失败，不得自动重试；下一步需在产品层明确解锁后单独验证排序，不与滚动或楼中楼串联。

## M. 2026-07-23 排序控件真实组件复核与安全停止

本轮没有把失败的认证动作重放。所有认证动作仍使用 `ee439ada-a7d7-436f-a898-e959004316ee` 的持久 Profile；请求头、请求体、Cookie、Token、storage state 和 response body 均未读取。

### M.1 代码缺陷与修复

真实 Shadow DOM 复核发现两个此前未覆盖的组件事实：

1. `<bili-text-button>最热</bili-text-button>` 与 `<bili-text-button>最新</bili-text-button>` 的可见文字在宿主 light DOM，通过组件 Shadow DOM 的 `<slot>` 投影；只遍历 `shadowRoot.childNodes` 会把两个语义标签都抹掉；
2. B站评论组件的 `#sort-actions` 状态类是 `hot` 与 `time`，不是 `hot` 与 `latest`。公开组件源码显示“最新”按钮调用 `handleChangeMode(2)`，其 `sortClass` 为 `time`。

Host 可信交互探针和 MV3 DOM projector 已同步修复：读取 `slot.assignedNodes({ flatten: true })`，并按组件容器把 `hot/time` 解析为“最热/最新”。修复提交为 `dbfb15c`，版本仍为 `0.7.17`；单元/类型门禁为 30 个测试文件、96 个测试全部通过，最新扩展构建 fingerprint 仅作为运行时门禁值，不改变版本号。

### M.2 三次认证动作账本

| run / artifact | 结果 | 平台输入 | 页面处置 |
|---|---|---:|---|
| `c223a86b…` / `122ad6e0…` | slot 修复前，排序目标探针超时 | `0` | `partial / interaction_prerequisite_unmet`，保留页 |
| `54cedac3…` / `cc2d1c8d…` | slot 修复后识别到控件，但共同 `hot` 容器被错误继承为“最新 active” | `0` | `partial / interaction_prerequisite_unmet`，保留页 |
| `e5bf61f4…` / `f2560db4…` | `hot/time` 修复前的真实认证点击已发出；动作尾窗未形成可交叉证明的后置条件 | `1` | `failed / document_context_changed`，页面 quarantine，账号 safety `locked` |

第三次 run 的 `platformActionIds` 已登记该唯一可信点击，因此无论平台最终是否切换，都不能重放或用刷新确认。该 run 没有保存视觉后证据，不能宣称排序成功；当前只能结论为 `inconclusive / outcome_unknown`。下一次认证验证必须是新的 run，并先经过产品固定的人工安全解锁；在此之前不再发送任何 B站动作。

### M.3 组件级公开源码与匿名对照

独立匿名浏览器只做了公开页面的低频 DOM/网络观察和一次可信排序尝试。它确认 `#commentapp > bili-comments > bili-comments-header-renderer` 的开放 Shadow DOM 层级、`#sort-actions.hot/time` 组件语义以及 `/x/v2/reply/wbi/main` 的公开路由候选，但匿名页面有评论可见性上限，排序点击未形成可用的认证后置证据；这不能替代登录 Profile 的真实验证。认证 Profile 的安全锁定保持不变。

## N. 2026-07-23 认证排序真实闭环完成

在固定安全解锁后，以新的 run（不是重放已隔离 action ID）完成一次严格 scoped 的认证排序验证：

```yaml
runId: c854c1d5-5a9c-4363-ac29-ba808f40e31a
artifactId: a977831d-7a5a-427b-aa2b-fd6e53d6bac8
target: BV1qZSLBYEpa
strategy: bilibili.video.discussion.dom.v1 @ 0.1.0
state: completed
terminalReason: discussion_ready
navigationCount: 1
trustedScrollCount: 1
selectLatestClickCount: 1
automaticRetry: 0
capturedRootComments: 20
sort: latest
loginGateVisible: false
targetPage: retained_after_run
accountSafety: ready
```

动作前 DOM 将“最新”判为 `inactive`，实时边界框为 `x=240,y=120,w=38,h=28`；Host 先移动真实鼠标并确认 hover、可见、viewport 与 composed hit-test，再发送一次 mouse down/up。动作后 DOM 变为 `latestState=active`，视觉截图 [557985d9-3c20-4d2c-9724-f6eff53ff177.png](../../../poc/collector-gateway/runtime/p2a-validation-20260717/browser-host/visual-evidence/557985d9-3c20-4d2c-9724-f6eff53ff177.png) 显示“最新”为蓝色选中态，Network 观察到 `/x/v2/reply/wbi/main` 的 GET 200。未读取 query 值、请求/响应正文或认证材料；楼中楼入口仅观察为可见，没有点击。

这次 run 证明了“导航 → 延迟评论加载 → 一次可信滚动 → 一次最新评论排序 → DOM/视觉/Network 三面交叉后置条件”的真实闭环。`discussion` 仍保持 `admissionEligible=false`，因为 response projector、分页覆盖和楼中楼正文尚未完成；下一步只能在独立预算下验证一个根评论的楼中楼入口，不能把排序成功扩展成评论全量能力。

## O. 2026-07-23 首个楼中楼入口真实闭环完成

在排序验证之后，使用独立预算执行了一个只含 `expand_first_thread` 的新 run，没有把排序点击串入同一动作链：

```yaml
runId: 6165e4d7-2301-42cd-8e67-830f877b6163
artifactId: d61f90f8-b179-4dce-9d74-641e603dc2b6
target: BV1qZSLBYEpa
state: completed
terminalReason: discussion_ready
navigationCount: 1
trustedScrollCount: 1
expandFirstThreadClickCount: 1
automaticRetry: 0
capturedRootComments: 20
firstThreadExpanded: true
replyPaginationVisible: true
targetPage: retained_after_run
accountSafety: ready
```

动作前“点击查看”入口通过评论组件 Shadow DOM、实时边界框（`x=251,y=467,w=52,h=22`）、hover 和 composed hit-test 校验；动作后入口消失，回复分页控件出现，视觉截图 [8a900fdb-8227-44df-ac76-fd3802beb0ca.png](../../../poc/collector-gateway/runtime/p2a-validation-20260717/browser-host/visual-evidence/8a900fdb-8227-44df-ac76-fd3802beb0ca.png) 显示首个根评论下的回复树，Network 捕获 `/x/v2/reply/reply` 的 GET 200。没有点击“下一页”，没有展开第二个根评论，没有读取 response body。

因此，当前已真实证明：默认热门根评论样本、最新评论排序、首个公开楼中楼展开三类人类流程均可在持久 Collection Profile 中按独立预算运行。尚未证明的是回复正文 response projector、回复分页覆盖、跨根评论采样、去重与完整性；这些必须作为后续独立 capability 和预算继续实现，不能把本次单线程展开宣称为“全量评论”。

## P. 2026-07-23 回复组件字段复核与有界 MVP

本轮先在独立可见 DevTools 侦察页按人类流程导航到同一公开视频、滚动到评论区并观察开放 Shadow DOM；没有加载待测扩展，不读取 Cookie、Token、storage、请求头、请求体或 response body。真实 DOM 确认了以下结构事实：

```text
bili-comments
  └─ bili-comment-thread-renderer
      └─ bili-comment-replies-renderer
          └─ bili-comment-reply-renderer
              ├─ bili-comment-user-info > #user-name
              ├─ bili-rich-text > #contents
              └─ bili-comment-action-buttons-renderer
                  ├─ #pubdate
                  └─ #like > #count
```

在公开可见的预览回复中，`#user-name`、`#contents`、`#pubdate` 和 `#like #count` 分别呈现作者、正文、发布时间和点赞数；回复 renderer 自身的 Shadow DOM 还会保留 `共 N 条回复` 与“点击查看”入口。匿名页点击该入口后受到登录门禁，未形成回复 route 后置条件，因此不计入认证楼中楼能力。

基于上述真实字段，代码已加入一个不读取 response body 的有界 DOM 投影：

- 单次只保存第一个根评论当前可见页，最多 20 条回复；
- 每条只保留公开可见 `author/content/publishedAt/likeCount`，缺失或无法解析时为 `null`；
- 记录 `replyPage/replyPageCount/replyHasMore/replyCoverage`，无法从可见分页控件确认时保持 `null/unknown`；
- 不点击“下一页”，不展开第二个根评论，不遍历全部 162 页，不把预览回复误报为已展开回复；
- 认证 Host 的真实浏览器输入仍要求三面后置条件；artifact 由动作后的 DOM 投影保存，response route 只保留 `/x/v2/reply/reply` 的 method/origin/path/status 时间元数据。

本轮还发现并修复了页面池的一个实际设计缺陷：B站导航会把视频 URL 改写成尾斜杠或合法 `vd_source` 变体，原 exact-target 选择只比较 URL digest，导致三个 retained tab 被错误判定为不可复用并返回 `page_pool_capacity_exhausted`。源码现在在 `bilibili + video_discussion` 角色下按已验证的同一 BVID URL 变体复用 retained tab；并增加了对应纯状态机测试。当前受管 Browser Host 进程尚未热加载该修复，因此本轮容量失败 run 只作为缺陷证据，不计入真实回复能力证明；下一次 Host 生命周期切换后再做一次新的认证单 root run。

当前 MVP 结论仍为 `partial / research-only / admissionEligible=false`：真实回复字段已被页面结构证明，生产投影与 artifact 路径已实现并通过本地单元/类型门禁，但尚缺一次加载新 Host/扩展构建后的认证三面闭环、分页控件真实页码样本和去重/完整性验证。

## Q. 2026-07-23 新 Host 认证楼中楼字段闭环完成

为验证页面池 BVID 变体复用修复和新构建的回复 DOM 投影，本轮没有重启原有登录 Collection Profile，也没有关闭其中的 retained tab；而是在同一受管状态目录下使用另一个当前未运行的 B 站 Collection Profile 启动独立可见 Host/Gateway。新 Host 的 marker-first probe 精确通过：

```yaml
collectorVersion: 0.7.17
controlSurfaceRevision: 15
buildFingerprint: 3070e9e5d7998615ccc15bf2f6ef13273a199e29a3225d51e9c4b7ba9e4b9692
visibleContextRestarted: false
nativeBridgeConnected: true
```

该 Profile 首次启动时明确显示登录门禁，先记录为一个没有点击楼中楼入口的 `partial / login_required` run；用户完成登录后，才执行下面这次新的、独立预算的认证 run：

```yaml
runId: 3c240d00-e8fe-495d-95c5-8d9008ba5696
artifactId: ca1ee990-45d4-4fcd-9363-8fe829dd84e3
target: BV1qZSLBYEpa
strategy: bilibili.video.discussion.dom.v1 @ 0.1.0
state: completed
terminalReason: discussion_ready
navigationCount: 1
trustedScrollCount: 1
expandFirstThreadClickCount: 1
automaticRetry: 0
capturedRootComments: 20
capturedFirstThreadReplies: 10
replyCoverage: current_page
replyPage: null
replyPageCount: 165
loginGateVisible: false
targetTabSelection: reused_matching_managed_tab
targetPage: retained_after_run
accountSafety: ready
```

动作前后证据满足三面交叉契约：

- DOM：评论组件 Shadow DOM 内的“点击查看”入口在动作前可见，实时边界框为 `x=251,y=467,w=52,h=22`，`targetPointerHit=true`、`targetHovered=true`、`targetExpanded=false`；一次可信 mouse down/up 后入口消失，回复树出现，`firstThreadExpanded=true`、`replyPaginationVisible=true`；
- 视觉：动作前截图 [57bcb0f6-20d4-410b-a6e8-d9b3e4243310.png](../../../poc/collector-gateway/runtime/p2a-reply-canary-20260723/browser-host/visual-evidence/57bcb0f6-20d4-410b-a6e8-d9b3e4243310.png) 仍显示“共 1648 条回复，点击查看”，动作后截图 [81eb1176-5ad5-4107-a358-9223f15c9dcc.png](../../../poc/collector-gateway/runtime/p2a-reply-canary-20260723/browser-host/visual-evidence/81eb1176-5ad5-4107-a358-9223f15c9dcc.png) 显示当前回复树和可见回复内容；
- Network：动作后新增 `GET https://api.bilibili.com/x/v2/reply/reply`，status `200`；只保存去 query 的 origin/path/status 时间元数据，没有读取 query、请求头、请求体或 response body；
- 字段投影：当前可见页保存 10 条回复，每条均按真实 DOM 的 `#user-name`、`#contents`、`#pubdate`、`#like #count` 投影为 `author/content/publishedAt/likeCount`；示例字段为 `涛涛同学1 / 已三连 / 2025-12-01 09:31 / 2`，缺失点赞数保持 `null`；
- 分页：页面公开显示总页数 `165`，但当前分页控件没有提供可安全确认的当前页码和 `hasMore` 后置条件，因此 artifact 保留 `replyPage=null`、`replyHasMore=null`，覆盖诚实标记为 `current_page`。

运行结束后页面池为 1 个 `retained_for_review`、0 个 active lease、0 个 quarantine page；没有点击下一页、没有展开第二个根评论、没有刷新或重放动作。对应 artifact 位于 [manifest.json](../../../poc/collector-gateway/runtime/p2a-reply-canary-20260723/bilibili-video-discussion/ca1ee990-45d4-4fcd-9363-8fe829dd84e3/manifest.json) 与 [discussion.json](../../../poc/collector-gateway/runtime/p2a-reply-canary-20260723/bilibili-video-discussion/ca1ee990-45d4-4fcd-9363-8fe829dd84e3/discussion.json)。

结论是 `bilibili.video.discussion.dom.v1 @ 0.1.0` 的“一个根评论、当前可见一页回复、最多 20 条、DOM 字段投影”MVP 已完成真实认证闭环；`discussion` 仍保持 `research-only / admissionEligible=false`。回复全量分页、多个根评论、去重/连续性证明、response projector 和全量覆盖均未完成，不能由本次单根评论样本推断。

## R. 2026-07-24 根评论连续滚动 MVP 真实闭环

本轮只验证“导航后通过多次低频可信滚动，跨虚拟化 DOM 快照累积根评论”这一核心增量；没有排序点击、楼中楼点击、分页点击或 response body 读取。使用已登录的持久 B 站 Collection Profile `67f9abed-4d5a-4e2e-9043-74dfbeae83b0`，新构建运行时 marker 精确匹配，未导出认证材料。

```yaml
runId: afca400e-5806-407a-910a-e1eb662824a7
artifactId: 23aca610-2915-442b-bd40-88939766c0a2
target: BV1qZSLBYEpa
state: completed
terminalReason: discussion_ready
navigationCount: 1
trustedScrollCount: 3
scrollAttemptCounts: [1, 1, 1]
capturedRootComments: 21
sort: hot
loginGateVisible: false
duplicatePolicy: normalized_visible_text_within_60_item_bound
targetPage: retained_after_run
accountSafety: ready
responseBodies: not_read
```

三次滚动均由 Host 发送真实 wheel 输入并在动作账本中各记录一次；观察窗口在没有新增根评论时停止，不刷新、不回退、不重放。DOM 投影将 successive snapshot 中的可见根线程文本按规范化文本去重并限制为最多 60 条。视觉证据 [f81f637d-4c5f-4000-ae43-6fe93effcb1d.png](../../../poc/collector-gateway/runtime/p2a-reply-canary-20260723/browser-host/visual-evidence/f81f637d-4c5f-4000-ae43-6fe93effcb1d.png) 显示页面停留在评论区（`scrollY=1218`），artifact 的根评论数从单视口 20 条扩展为 21 条。

对应 artifact：[manifest.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/23aca610-2915-442b-bd40-88939766c0a2/manifest.json)；[discussion.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/23aca610-2915-442b-bd40-88939766c0a2/discussion.json)。

这证明了“根评论跨快照有界累积”已经具备真实生产闭环，但不等同于全量评论覆盖：当前仍没有稳定公开 root id、没有跨更多页的分页终止证明，也没有把多个 root 的楼中楼展开串入同一任务。下一步应在独立预算下完成根评论稳定身份/覆盖字段，再推进多个 root 的楼中楼采样；`admissionEligible` 继续保持 `false`。

## S. 2026-07-24 第二个根评论楼中楼真实闭环与动作账本修复

本轮在同一已登录的 B 站 Collection Profile 上验证了当前可见根评论窗口中的第二个楼中楼入口。请求只包含一个交互动作 `expand_second_thread`；没有把该结果扩大解释为多个根评论连续采样，也没有点击回复下一页。

```yaml
runId: 7b264b70-8b0f-47c3-a5d1-8c6c0a533854
artifactId: 752c57ac-2efb-45b3-ae09-19e1280f431b
target: BV1qZSLBYEpa
strategy: bilibili.video.discussion.dom.v1 @ 0.1.0
state: completed
terminalReason: discussion_ready
navigationCount: 1
trustedScrollCount: 3
expandSecondThreadClickCount: 1
capturedRootComments: 21
capturedReplyThreads: 1
capturedThreadOrdinal: 1
capturedReplies: 10
replyPage: null
replyPageCount: 3
replyHasMore: true
replyCoverage: current_page
networkRoute: /x/v2/reply/reply
networkStatus: 200
targetPage: retained_after_run
accountSafety: ready
```

动作前 DOM 重新读取了序号为 `1` 的可见根评论 renderer，实时边界框为 `x=236,y=341,w=52,h=22`；目标可见、位于 viewport、通过 composed hit-test，且已真实 hover。一次可信 mouse down/up 后，入口消失，回复分页出现，当前页投影为 10 条回复，页面公开显示总页数为 3。Network 同时记录到动作后新增的 `GET https://api.bilibili.com/x/v2/reply/reply`、status `200`；仅保存去 query 的 route 元数据，没有读取 query、请求体、响应正文或认证材料。对应 artifact 为 [manifest.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/752c57ac-2efb-45b3-ae09-19e1280f431b/manifest.json) 与 [discussion.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/752c57ac-2efb-45b3-ae09-19e1280f431b/discussion.json)；动作前后视觉证据保留在同一 runtime 的 `browser-host/visual-evidence` 目录。

本轮还修复了一个会影响审计和多动作扩展的本地设计缺陷：此前动作数组在初始化时就放入交互动作，而额外滚动是在执行时追加，导致真实执行顺序为“导航 → 滚动 1/2/3 → 点击”，artifact 却可能写成“导航 → 滚动 1 → 点击 → 滚动 2/3”。现在由独立的有界动作账本组件按阶段追加：导航和首轮滚动先登记，后续可信滚动按实际发生顺序登记，所有请求交互在滚动阶段结束后一次性登记；重复 finalize 不会复制动作，滚动阶段关闭后也不能再追加滚动。单元门禁验证了动作 ID、顺序和 `at-most-once` 语义。

截至本节 run 结束，事实边界仍然是：该 run 只证明了序号为 `1` 的第二个可见根评论；当时尚未证明同一 run 连续展开序号 `0` 和 `1` 两个楼中楼，也尚未点击回复分页。紧接后的 T 节记录了新的双动作 run。旧字段 `firstThread*` 只代表 ordinal `0`，多线程结果必须读取 `discussion.replyThreads`；本次 `capturedFirstThreadReplies=0` 不表示本次没有回复，而是表示 ordinal `0` 没有在该 run 中展开。`admissionEligible` 继续保持 `false`。

## T. 2026-07-24 同一 run 连续展开两个楼中楼真实闭环

在动作账本修复和新 Gateway 构建加载后，使用同一已登录 Profile 执行了唯一一次双动作 run：

```yaml
runId: 2761f616-d09b-4b80-a72f-dcea94a32714
artifactId: 9f547500-0967-4562-9e82-0d5e6a82cae1
target: BV1qZSLBYEpa
strategy: bilibili.video.discussion.dom.v1 @ 0.1.0
state: completed
terminalReason: discussion_ready
navigationCount: 1
trustedScrollCount: 3
actions: [expand_first_thread, expand_second_thread]
actionAttemptCounts: [1, 1]
capturedRootComments: 21
capturedReplyThreads: 2
threadOrdinals: [0, 1]
capturedRepliesByThread: [10, 10]
network200ByThread: [1, 1]
targetTabSelection: reused_matching_managed_tab
targetPage: retained_after_run
accountSafety: ready
```

这次 run 的动作顺序由 artifact 明确记录为：

```text
navigate
scroll 1
scroll 2
scroll 3
expand_first_thread
expand_second_thread
```

两个交互均重新读取实时 DOM，不复用第一个入口的坐标或 element handle。第一个动作前 `threadOrdinal=0`、目标可见且通过 hover/composed hit-test；一次可信 mouse down/up 后入口消失、回复树出现、当前页 10 条回复、分页总页数 165，动作后新增 `GET https://api.bilibili.com/x/v2/reply/reply` status `200`。第一个楼中楼展开后，第二个动作再次从实时 DOM 找到 `threadOrdinal=1`，动作前边界框为 `x=236,y=341,w=52,h=22`，目标仍可见、位于 viewport、可命中且已 hover；一次可信点击后入口消失、当前页再次得到 10 条回复、分页总页数 3，动作后同一路由再次得到独立 `200`。两个动作都没有重试，`attemptCount=1`，没有出现未知结果。

多线程投影保存在 `discussion.replyThreads`：ordinal `0` 与 `1` 各自保留真实 DOM 可见页的 `author/content/publishedAt/likeCount` 字段和分页元数据；旧的 `firstThread*` 字段仍只代表 ordinal `0`。对应 artifact：[manifest.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/9f547500-0967-4562-9e82-0d5e6a82cae1/manifest.json)、[discussion.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/9f547500-0967-4562-9e82-0d5e6a82cae1/discussion.json)。动作前后及最终视觉证据位于 `poc/collector-gateway/runtime/p2a-reply-canary-20260723/browser-host/visual-evidence/`，其中双动作对应的 evidence id 为 `62ee2ac7-5625-4982-925c-39f40f5d6016`、`2156ea9a-f1f5-495d-b6ca-ad9c23d02fbe`、`5d5ff2d6-bbc0-40f5-8fc8-8c06f1304adc`、`24b0a75c-6f11-4b6f-b90c-ebc5c6c941b9`。

运行结束后再次核对页面池：`activeLease=0`、`retainedPages=1`、`quarantinedPages=0`，目标页面仍为 `retained_for_review`；Browser Host/Chromium 没有关闭，账号安全为 `ready`。这证明了“有界根评论滚动 → 同 run 实时定位并连续展开两个可见根评论楼中楼 → DOM/视觉/Network 三面后置条件 → 页面保留”的核心闭环。它仍不等同于回复全量：没有点击下一页、没有读取 response body、没有稳定 root id 或跨页连续性证明，`admissionEligible` 继续保持 `false`。

## U. 2026-07-24 楼中楼单次下一页真实闭环

在确认分页控件位于展开回复树下方、可能不在当前 viewport 后，新增了两个按根评论序号区分的只读动作：`next_first_thread_page` 与 `next_second_thread_page`。分页动作的前置阶段只根据实时 DOM rect 发送一次有界可信 wheel，把“下一页”控件带入 viewport；随后重新读取 DOM、hover 和 composed hit-test，再发送一次可信 mouse down/up。它不遍历分页、不重放点击；wheel 属于该语义动作的目标揭示阶段，视觉 evidence 的 `scrollY` 变化保留了这一事实。

使用新 Browser Host 构建，在同一已登录 Profile 上完成了 ordinal `1` 的单次翻页 canary：

```yaml
runId: ce0037fc-5e34-4d9e-9fb2-19ef05d6d039
artifactId: 3f35874b-dd8d-4724-96ef-88b91b345117
target: BV1qZSLBYEpa
strategy: bilibili.video.discussion.dom.v1 @ 0.1.0
state: completed
terminalReason: discussion_ready
actions: [expand_second_thread, next_second_thread_page]
actionAttemptCounts: [1, 1]
capturedRootComments: 21
threadOrdinal: 1
replyPageCount: 3
replyPage: null
replyHasMore: true
pageOneReplies: 10
pageTwoReplies: 10
networkRoute: /x/v2/reply/reply
networkStatusByAction: [200, 200]
targetPage: retained_after_run
accountSafety: ready
```

动作前后证据如下：

- ordinal `1` 展开动作后，回复树投影为 10 条，公开分页总数为 3，下一页入口存在但尚在当前 viewport 之外；
- `next_second_thread_page` 的动作前视觉 evidence 显示一次 reveal 后 `scrollY=1649`，实时目标边界框为 `x=256,y=578,w=39,h=22`，目标可见、可命中且已 hover；
- 动作后视觉截图显示分页从 `1` 的蓝色选中态切换为 `2` 的蓝色选中态，回复正文更换为另一页的 10 条公开回复；Network 在动作后新增 `GET https://api.bilibili.com/x/v2/reply/reply`、status `200`；
- 由于当前 B 站分页组件没有提供稳定可依赖的 `aria-current`/页码 active DOM 语义，Host 不猜测当前页码，artifact 保留 `replyPage=null`，但保存 `replyPageCount=3`、`replyHasMore=true` 与真实视觉/Network 证据。对应 artifact：[manifest.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/3f35874b-dd8d-4724-96ef-88b91b345117/manifest.json)、[discussion.json](../../../poc/collector-gateway/runtime/p2a-discussion-root-20260724/bilibili-video-discussion/3f35874b-dd8d-4724-96ef-88b91b345117/discussion.json)；分页动作前后视觉 evidence id 为 `192b18bc-c619-436e-bd40-513cda093c4d` 与 `4231fd7e-4b52-464e-9706-845305c9d45d`。

运行结束后页面池再次保持 `activeLease=0`、一个 `retained_for_review` 目标页、`quarantinedPages=0`，Browser Host/Chromium 未因 run 终态关闭，账号安全为 `ready`。这一节证明了“楼中楼展开 → 有界 reveal → 单次下一页 → 当前页 DOM 字段替换 → 视觉/Network 交叉证明”的核心分页能力；仍未证明第 3 页、全量回复、跨页去重/连续性或 response body projector，`admissionEligible` 继续保持 `false`。

## V. 2026-07-24 独立分页揭示动作真实闭环与失败边界收敛

上一节的真实 canary 证明了分页可行，但当时 `next_*_page` 内部仍包含一次目标揭示 wheel。为避免把“寻找控件”和“点击下一页”混成一个不可解释的语义动作，本轮将两者拆开，版本保持不变：

```text
expand_first_thread
  -> reveal_first_thread_pagination
  -> next_first_thread_page

expand_second_thread
  -> reveal_second_thread_pagination
  -> next_second_thread_page
```

新增动作的边界如下：

- `reveal_*_thread_pagination` 只允许在对应楼中楼已经展开后执行；Host 以当前回复 renderer 或已挂载的“下一页”控件的实时 DOM rect 计算一次有界可信 wheel；它不是下一页点击，也不监听或保存 response body；
- reveal 的后置条件是“真实的下一页控件已经挂载并进入 viewport”，使用动作前后视觉与 DOM 两面证明；若 wheel 结果已被本地滚动位置读回但控件仍未出现，只记录 postcondition unmet 并保留页面，不猜测点击；若文档上下文丢失，仍按未知结果隔离；
- `next_*_page` 不再隐含滚动，只在实时 DOM 已发现、可命中、已 hover 且位于 viewport 的真实“下一页”控件时允许一次 mouse down/up；
- 输入校验要求 reveal 位于对应 expand 之后、next 位于 expand 之后且（如果请求 reveal）位于 reveal 之后；单次任务最多 8 个语义动作，仍是 at-most-once；
- interaction evidence 明确记录 `inputKind=click|wheel`、`wheelDeltaY` 和 `replyNextPageVisible`，不再用 `clickAttempted=true` 掩盖 wheel。

### V.1 首楼失败边界的保留记录

以下三个历史 run 不重新执行，仅作为设计约束：

| run / artifact | 事实 | 处置 |
|---|---|---|
| `b1dda042-3776-470d-9d90-15539024b287` / `14e5637f-029d-4ec0-86ec-2444290319d0` | 首个楼中楼展开后公开显示约 165 页，但下一页节点在当前 DOM 中未及时挂载；没有发送下一页点击，动作是 `attempted=false / prerequisite_unmet`、`bilibili_video_discussion_interaction_precondition_timeout` | `partial`，目标页保留，账号安全回到 `ready` |
| `3a3a5ca3-6658-4bb1-9dbf-65a04d52c511` / `bcfdeea3-de10-4c42-a6b7-3d9829d507a6` | 曾把回复宿主 rect 冒充下一页控件揭示提示；wheel 后未确认真实控件就继续等待，结果为 `document_context_changed` | 页面 quarantine、账号 safety 锁定；随后只用本地 `resume_authenticated_platform_actions` acknowledgement 解锁，未重放原 action |
| `ee7ee675-d389-41ec-8379-30219f8f55cb` / `befadf47-f4ca-4b66-ad50-bb8f9b7342b5` | 无条件遍历整个 thread Shadow DOM 的分页探针拖慢普通展开后置条件，展开结果未知 | 页面 quarantine；该全 thread 探针已回退，未把失败当作平台能力否定 |

这些记录说明：分页节点缺失只能由独立、可审计的 reveal 语义动作处理；不能通过 next 动作猜测滚轮，也不能用更宽的全树搜索拖慢所有交互。

### V.2 新版本代码的真实认证 canary

在新的 Browser Host 进程和同一已登录 Collection Profile 中执行了一个只验证第二楼的完整三动作链：

```yaml
runId: 474d8084-fc20-449d-a4c7-4fdf151c010f
artifactId: d80c2465-51c7-4b3a-9156-4688897320ae
target: BV1qZSLBYEpa
collectorVersion: 0.7.17
strategy: bilibili.video.discussion.dom.v1 @ 0.1.0
state: completed
terminalReason: discussion_ready
actions:
  - expand_second_thread
  - reveal_second_thread_pagination
  - next_second_thread_page
actionAttemptCounts: [1, 1, 1]
capturedRootComments: 22
capturedReplyThreads: 1
threadOrdinal: 1
pageOneReplies: 10
pageTwoReplies: 10
revealWheelDeltaY: 431
replyPageCount: 3
replyPage: null
replyHasMore: true
networkStatusByClickAction: [200, 200]
targetTabSelection: created_new_managed_tab
targetPage: retained_after_run
accountSafety: ready
```

动作前 reveal 探针发现真实“下一页”控件已经挂载但位于 viewport 外（`y=1009`）；一次 wheel 后滚动位置由 `1218` 变为 `1649`，控件进入 viewport（`y=578`），没有发送点击。随后下一页动作重新读取 DOM、移动鼠标并确认 composed hit-test/hover，只点击一次；动作后回复正文从首组 10 条替换为另一组 10 条，视觉截图显示分页从 1 切换到 2，Network 新增 `/x/v2/reply/reply` status 200。B站当前组件没有稳定的 active 页码语义，因此 `replyPage` 仍诚实保留为 `null`，不猜测为 2。

该 run 只证明第二个可见根评论的“展开 → 独立揭示 → 单次下一页”。它没有重放首楼历史失败、没有读取 response body、没有遍历全量分页、没有稳定 root id 或跨页去重证明；`admissionEligible` 继续为 `false`。下一项核心验证应是使用同一独立 reveal 语义动作验证首个楼中楼，但在首楼 reveal 本身未通过前不得发送 `next_first_thread_page`。
