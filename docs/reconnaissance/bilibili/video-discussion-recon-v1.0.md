# B站视频评论与楼中楼 Source Reconnaissance v1.0

- 状态：Action-to-route mapping complete for first-page sort and first thread；response schema mapping paused
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
