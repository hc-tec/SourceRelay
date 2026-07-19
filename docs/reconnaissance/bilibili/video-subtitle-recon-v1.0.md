# B站视频字幕 Source Reconnaissance v1.0

- 状态：三次相互独立、均已消费的 subtitle-only 实网勘察已完成；最新一次以人工与 DevTools 双视角确认真实操作、选中后置条件和 509 段字幕正文，扩展 v0.4.18 已据此修正但尚未实站闭环，仍不可 admission
- 日期：2026-07-19
- 页面角色：公开视频详情播放器
- Evidence objective：未来独立的 transcript / subtitle evidence，不并入视频详情 DOM 策略
- 账号类别：anonymous 与 user-managed authenticated 分别验证
- 样本：`https://www.bilibili.com/video/BV1qZSLBYEpa/`
- Production response routes：空
- Admission eligible：否

## A. 研究问题与边界

目标不是下载视频，而是回答：用户需要时，Collector 能否像人一样打开视频、显示字幕菜单、选择中文轨道，并把页面自己的字幕数据映射为可供 AI 分析的文本证据。

允许：

- 正常打开公开视频；
- 悬停播放器显示控制条；
- 点击一次“字幕”；
- 选择一次公开可见的中文轨道；
- 观察动作前后 Fetch/XHR/texttrack 的去敏 metadata；
- 经单独批准后，对精确候选 response 做受限 schema-only 映射。

禁止：

- 下载原始音视频；
- 请求重放、签名复刻或脱离页面调用私有 API；
- 读取请求头、请求体、Cookie、Token、Profile 路径或二维码；
- 自动处理登录、验证码或风控；
- 无限重试字幕按钮或语言选择；
- 将勘察结果直接加入 production response route。

## B. 人类浏览路径

```text
打开已知公开视频
  -> 等待播放器和控制条就绪
  -> 悬停播放器
  -> 点击“字幕”一次
  -> 读取公开可见语言选项
  -> 选择“中文”一次
  -> 核对菜单/字幕状态与短时网络差分
  -> 关闭研究页
```

每个语义动作只有一次用户事件；没有结果、超时或控件缺失均不得再次点击。

## C. 登录状态差异

| Profile | DOM/动作事实 | 网络事实 | 结论 |
|---|---|---|---|
| anonymous isolated DevTools Profile | 页面公开显示“字幕”，点击后没有打开语言菜单，而是进入登录弹窗 | 动作后只新增 B站二维码轮询 route；未记录参数值 | “存在字幕控件”不等于匿名字幕可采；该样本要求登录 |
| user-managed Collection Profile | 登录持久性经关闭 Chromium、重启 Gateway、同 Profile 重启后验证；第一次一次性映射 run 打开字幕控件成功，但语言项未就绪；第二次一次性映射 run 打开菜单并向精确“中文”投递一次点击，但页面没有给出可验证的选中确认 | 第二次 run 在中文点击动作窗首次观察到 `aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>` JSON；导航阶段同时再次出现播放器状态与二进制字幕候选 | 认证交互受页面时序影响；DOM 后置条件与网络副作用必须独立记账，不能用一次网络成功代替页面选中确认 |

登录凭据由 Chromium 自己管理。核验只比较 B站首页公开页头账号入口与“登录”入口布尔信号，不读取昵称、UID、头像地址、Cookie 或 Token。

## D. DOM 勘察

| 状态/字段 | 公开可见锚点 | 本样本结果 | 风险 |
|---|---|---|---|
| 字幕控制 | 控制条可访问名称“字幕”及播放器字幕控件 | 登录前后均存在 | 控制条需悬停；不能仅按固定坐标 |
| 语言菜单 | “关闭”“中文”“字幕设置” | 认证后公开可见 | 父容器也包含“中文”，必须完整标签匹配，不能 substring 点击 |
| 中文选择 | 精确公开标签“中文” | 第一次一次性映射 run 为 `attempted=false / option_unavailable`；第二次 run 为 `attempted=true / postcondition_unmet`，仅投递一次点击 | 动作结果未知或选中确认缺失时不得复点；网络副作用不自动等于 DOM 成功 |
| 字幕样式 | 字幕大小、颜色等设置 | 可见但不属于正文证据 | 不采集、不操作 |
| 字幕正文 | 播放器渲染表面 | 本轮未做字段映射 | 需要 response schema/body 与页面显示的后续映射 |

第一次自动语言选择误把包含“中文”的父容器当作选项，因目标不可见而返回 `option_unavailable`；没有重复点击。实现随后改为完整标签匹配，较早的独立、显式 run 曾成功点中精确“中文”。第一次一次性 schema-only run 中，`open_caption_menu` 已完成，但可见标签仍只有“字幕”，所以 runner 没有把语言选择记为已尝试。第二次一次性 schema-only run 中，菜单在 2.5 秒内就绪，精确“中文”可见并只点击一次；点击后选项仍可见且没有 `aria-selected`、`aria-checked` 或选中 class，故严格返回 `postcondition_unmet`。这些结果共同说明：语义标签必须约束到最小可点击元素，菜单出现与语言选中都需要独立后置条件；runner 有界结束或观察到网络副作用，都不能替代 scope objective。

## E. XHR/fetch 勘察

### E.1 导航基线候选

| 触发 | origin + pathname | method/MIME | query key names | 当前判断 |
|---|---|---|---|---|
| 视频导航 | `https://api.bilibili.com/x/player/wbi/v2` | GET / `application/json` | `aid`, `cid`, `dm_cover_img_str`, `dm_img_inter`, `dm_img_list`, `dm_img_str`, `isGaiaAvoided`, `w_rid`, `web_location`, `wts` | schema-only 映射成功；确认是通用播放器状态对象，但尚未确认轨道目录或字幕正文字段 |
| 视频导航 | `https://api.bilibili.com/x/v2/subtitle/web/view` | GET / `application/octet-stream` | `context_ext`, `cur_production_type`, `oid`, `pid`, `playlist_switch`, `type` | 映射结果为 408 字节二进制，没有 JSON schema；不能凭 route 名解释正文 |

`/x/player/online/total`、配置 JSON、SVG 图标、日志和视频分片属于同时发生的背景流量，不能因为时间接近就解释为字幕证据。

### E.2 动作差分

| 动作 | 字幕专用新增 route | DOM 结果 | 解释 |
|---|---|---|---|
| `open_caption_menu` | 未观察到新增字幕 route | 2026-07-19 run：`attempted=true / completed`，字幕控件可见；动作尾窗内标签只有“字幕” | 点击已投递一次，但本轮没有证明语言菜单完成渲染 |
| `select_caption_language` | 未执行，因此没有动作差分 | 2026-07-19 run：`attempted=false / option_unavailable` | 未盲点、未坐标点击、未重试；较早成功样本不能覆盖本轮真实结果 |

第二次独立的一次性 run 中，`open_caption_menu` 仍没有字幕专用新增 route；`select_caption_language` 动作窗则首次观察到一次 `GET https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>`，返回 200 / `application/json`。该请求的 query 值被丢弃，原始正文没有落盘；动作本身仍因 DOM 未确认选中而是 `postcondition_unmet`。这证明“点击与字幕响应相关”，但尚未证明页面当前轨道、响应语言、可见字幕三者一致。

动作窗中出现的 `data.bilibili.com` 日志、passport cookie info、笔记列表、视频分片和图标请求均未被认定为字幕 action route。

## F. 候选 response 映射

2026-07-19，用户第一次只批准一次以下范围：`subtitle only`、打开字幕菜单一次、选择公开可见的“中文”一次、`responseBodyMapping=schema_only`。执行前 Profile 为 `ready`、`manualUnlockRequired=false`、无 active run；请求只提交一次并返回 HTTP 201。稍后用户又对相同目标和相同边界给出第二张独立的一次性授权票；第二张票同样只提交一次，并在运行结束后立即消费。两张授权互不延续，系统状态为 `ready` 也不产生新授权。

研究专用 `schema_only` 的执行边界为：

- 只读取当前页面自己产生的 response，不重放；
- 精确允许 `/x/player/wbi/v2` 与 `/x/v2/subtitle/web/view`；
- 单响应最多 512 KiB，总计 1 MiB；
- JSON 只输出过滤敏感字段后的路径、类型、数组规模；
- 非 JSON 只输出内容类别、大小和原始字节 SHA-256；
- 原始正文不落盘、不进入仓库。

### F.1 有界动作结果

| 字段 | 结果 |
|---|---|
| run | `state=completed`，`errorCode=null` |
| `open_caption_menu` | `attempted=true`，`outcome=completed`；`captionControlVisible=true`；可见标签只有“字幕” |
| `select_caption_language` | `attempted=false`，`outcome=option_unavailable`；可见语言标签为空 |
| 网络计数 | 111 条观察，0 条因上限丢弃，2 条 Fetch/XHR failure；未达到 3 条中止阈值 |
| 动作交付 | `at_most_once`；动作尾窗 3 秒；run deadline 60 秒；没有重试 |

### F.2 response 结构结果

| phase / route | HTTP / MIME | 大小 / SHA-256 | contentKind | schema-only 结论 |
|---|---|---|---|---|
| `navigation_baseline` · `/x/player/wbi/v2` | 200 / `application/json` | 3263 字节 / `8e5825cb54bf44099494d5c9765d598e59474e041366615e5bfb394cbb79891c` | `json` | 确认根为 object；已确认路径包括 `$.code:number`、`$.data:object`、`$.data.aid:number`、`$.data.asr_language:string`、`$.data.bvid:string`、`$.data.cid:number`、`$.message:string`、`$.ttl:number`；已确认空数组包括 `$.data.guide_attention`、`$.data.jump_card`、`$.data.view_points`；`sensitiveFieldPathsOmitted=0` |
| `navigation_baseline` · `/x/v2/subtitle/web/view` | 200 / `application/octet-stream` | 408 字节 / `4ccb55169275f767d3721a7cdf8587ec9a3d0860449d9a57719eb6836632a888` | `binary` | `schemaPaths=[]`，`sensitiveFieldPathsOmitted=0`；没有把二进制猜成字幕正文 |

JSON 映射只输出路径、类型和数组规模，没有保存字段值。该对象同时出现 `$.data.ip_info.ip`、等级和 VIP 等非字幕路径名称，说明“过滤敏感字段名后遍历整个播放器对象”仍不适合作为生产 projector：未来只能显式白名单字幕所需字段，不能长期保存通用播放器响应，更不能因为 `sensitiveFieldPathsOmitted=0` 就推断对象没有敏感或账号相关内容。

本轮仍未获得或确认：轨道列表、轨道类型、字幕 URL、字幕时间片、字幕正文，以及这些字段与播放器可见字幕的一致性。`/x/v2/subtitle/web/view` 的二进制内容也仍为 `inconclusive`。

执行后 Profile 正常关闭；当时版本曾写入旧 `cooldown` 状态，现已从产品删除并迁移为 `ready`。`manualUnlockRequired=false`、无 active run，没有出现验证码、风控或限流 hard lock。随后 Gateway 停止，43127 监听器、可见 Chrome、`chrome-devtools-mcp` 和 `collector-gateway` 进程均为 0。该一次性授权已经消费，不授权任何自动恢复或第二次实网动作。

### F.3 第二次独立单次授权：AI 字幕正文结构候选

第二次 run 开始前，持久状态为 `manualUnlockRequired=false`、无 active run；Gateway 不曾后台恢复，只有收到本次新授权后才调用同一个认证 runner。唯一 POST 返回 HTTP 201，结果如下：

| 字段 | 结果 |
|---|---|
| run | `state=inconclusive`，`errorCode=null`，`objective.status=partial` |
| `open_caption_menu` | `attempted=true / completed`；2.5 秒内菜单就绪，可见精确标签“关闭”“中文”“字幕设置” |
| `select_caption_language` | `attempted=true / postcondition_unmet`；只点击精确“中文”一次；点击后选项仍可见，未观察到选中属性或 class，`selectionAcknowledged=false` |
| 网络计数 | 118 条观察，0 条因上限丢弃，2 条 Fetch/XHR failure；未达到 3 条中止阈值 |
| 动作交付 | `at_most_once`；没有补点、坐标点击、导航重试或平台动作重试 |

本轮得到三项 schema-only 映射：

| phase / route | HTTP / MIME | 大小 / SHA-256 | schema-only 结论 |
|---|---|---|---|
| `navigation_baseline` · `/x/player/wbi/v2` | 200 / `application/json` | 3263 字节 / `e1112de5ee243e99553543df065e76396c0b7413e597595e37e460d2bce5d5c6` | 140 个路径；首次明确确认 `$.data.subtitle.subtitles[]` 的 `lan`、`lan_doc`、`ai_status`、`ai_type`、`is_lock`、`subtitle_url`、`subtitle_url_v2` 与 `type` 结构 |
| `navigation_baseline` · `/x/v2/subtitle/web/view` | 200 / `application/octet-stream` | 397 字节 / `3f830b81ba9e8725fa44dbfa6604dbf5692d47128078178a9c1c3340341d4105` | 仍为 binary，`schemaPaths=[]`；不猜测其语义 |
| `select_caption_language` · `aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>` | 200 / `application/json` | 87175 字节 / `ad079a5ee4ea01a757e648c4b8735e21ce890afb203904e8fe6fa45d2443c749` | 17 个路径；确认 `$.body[].content`、`from`、`to`、`sid`、`location`、`music` 及根级 `lang`、`type`、`version` 的结构 |

这已经把“播放器轨道目录”和“逐句字幕正文”从只凭 route 名猜测推进到真实页面响应的 schema 证据，但仍没有读取或保存任何字段值，也没有完成以下一致性验证：

- `subtitle_url` 指向的响应是否就是本轮观察到的 CDN 响应；
- 根级 `lang` 是否与页面公开可见的“中文”一致；
- `body[].content / from / to` 是否逐段对应播放器当前显示；
- 人工字幕、AI 字幕、无字幕和多语言样本是否共享同一契约。

因此该 CDN route 只是 projector 候选，不能进入 production response routes。后续实现应采用两段显式白名单：播放器响应只投影轨道目录所需字段，字幕 CDN 响应只投影 `lang` 与 `body[].content/from/to` 等正文所需字段；不得保存通用播放器对象或样式字段。

本轮安全 artifact 已核对：没有 Profile ID、原始 URL、Cookie、Authorization 或 Token 字段，只有目标 URL digest、去 query 的 route、schema path、大小和摘要。旧实现当时记录的 `authenticated_run_inconclusive_cooldown` 现仅作为历史 reason；当前状态机正常结束直接回到 `ready`。`manualUnlockRequired=false`、无 active run；受管 Profile、Gateway、43127/43128、受管 Chrome 与 DevTools MCP 均已关闭。第二张一次性授权已经消费，不授权第二次提交或任何自动恢复。

### F.4 实网结果后的实现修正

历史 run 返回的 `state=completed` 只代表当时 runner 有界结束；按照当前契约，它会因为语言选择没有完成而得到 `objective.status=partial` 与 `state=inconclusive`。当前实现已经加入：

- 字幕点击后的 2.5 秒菜单就绪后置条件；
- `postcondition_unmet` 与 `prerequisite_unmet` 两种结果；
- scope required-actions objective；
- 去除 Profile ID、原始 URL、正文和未知 DOM 字段的原子 runtime artifact；
- compact 列表与完整安全 schema 详情两个读取层级。

上述历史实现修正没有通过正确的人工流程验证，因此当时不能声称 B站字幕能力已完成。最新人工与 DevTools 证据见下一节；v0.4.18 的扩展闭环仍须新的单次授权实站验证。

### F.5 人工流程与 DevTools 联合侦察

2026-07-19 用户再次授权目标 `BV1qZSLBYEpa` 的单次字幕侦察。此次不先运行既有 selector，而是按“导航、等待、快照、hover、DOM/XHR 增量、单次选择、后置条件”的真实人类流程执行。结论如下：

1. 规范 URL 会由真实页面变为同一 BV 路径加 `?vd_source=<32位十六进制>`；旧实现把这一平台追加参数误判为上下文改变，直接导致上一轮 `transcript_validation_context_changed`。
2. 字幕入口的真实 DOM 是 `.bpx-player-ctrl-subtitle[aria-label="字幕"]`。人类只需 hover 该控件，菜单即展开，无须先盲点按钮。
3. 中文轨道的真实可交互容器是 `.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]`；内层文本只是“中文”。旧实现点击最小文本子节点，并在错误节点上检查 active class。
4. 点击前 `.bpx-player-ctrl-subtitle-close-switch` 带 `bpx-state-active`；只点击中文容器一次后，`ai-zh` 容器获得 `bpx-state-active`、关闭项失去 active，页面出现“字幕已切换至 中文”，`.bili-subtitle-x-subtitle-panel` 变为可见并显示逐句字幕。
5. DevTools Network 确认三条相关 200 route：`/x/player/wbi/v2`、`/x/v2/subtitle/web/view`、`aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>`。query 和鉴权值不写入文档或产品 artifact。
6. CDN 正文是 87175 字节 UTF-8 JSON，根级 `lang=zh`，包含 509 个 `body` 片段；片段字段为 `from / to / sid / location / content / music`。首段从 0.22 秒开始，末段到 1061.66 秒结束；播放器当前可见字幕与正文内容类型一致。

扩展 v0.4.18 据此完成三项修正：只在 observed-document 边界接受唯一且格式严格的 `vd_source`，输入 API 仍拒绝任何 query；语言选择锁定 `data-lan="ai-zh"` 容器；选中后置条件检查容器 active 状态与可见字幕面板。构建、自动扩展加载、Gateway 控制循环和真实响应 projector 门禁均已通过，但没有把这次人工 DevTools 结果冒充扩展闭环验证。

## G. 字段—证据映射（当前）

| 输出字段 | 页面可见 | 当前证据表面 | 状态 |
|---|---|---|---|
| 字幕能力存在 | 是 | visible DOM 字幕控件 | 已观察 |
| 可用语言“中文” | 是 | visible DOM 菜单与选中后置条件 | 人工 DevTools 流程只点击一次，确认 `data-lan=ai-zh`、active class、切换提示和字幕面板可见 |
| 轨道类型（人工/自动） | 可能 | player response + visible AI badge | 已确认 `ai-zh` 与 AI 标识；更多字幕类型仍需样本 |
| 字幕时间片与正文 | 播放时可见 | `aisubtitle.hdslb.com` response + DOM cross-check | 已真实读取 509 段 `content / from / to`；只抽查当前可见字幕，尚未逐段比对、未 admission |
| 字幕来源/语言代码 | 间接 | player response + subtitle CDN response | 已确认轨道 `ai-zh`、CDN 根级 `lang=zh` 以及同一 approved CDN pathname；多语言一致性仍待验证 |

## H. 策略候选

未来策略必须独立于 `bilibili.video.detail.dom.v1`：

```text
bilibili.video.transcript.response.v1
```

建议组合：

```text
bounded_interaction
  + approved_response（仅精确 route projector）
  + visible_dom cross-check
```

不能因为本样本菜单成功就升级为 `live_authenticated_verified`。还需验证：

- 人工字幕与 AI 自动字幕样本；
- 多语言、无字幕、字幕锁定与字幕删除；
- 中文轨道默认/非默认；
- 正文与播放器当前显示逐段映射；
- 长视频响应尺寸与时间预算；
- 验证码、限流、断网和布局变化；
- 账号安全熔断、异常锁定与逐次授权。

## I. 当前停止状态

- B站受管浏览器：已关闭；
- 本轮历史记录中的 Profile risk state：旧 `cooldown`，当前 schema 已删除该状态并迁移为 `ready`；
- 历史 reason：`authenticated_run_inconclusive_cooldown`，新运行不再生成 `_cooldown` reason；
- `manualUnlockRequired=false`，无 active run；
- Gateway：已停止，43127 与 43128 监听器均为 0；
- 可见 Chrome、`chrome-devtools-mcp` 与 `collector-gateway` 进程：均为 0；
- 生产 response routes：仍为空；
- `admissionEligible`：仍为 `false`；
- 最新人工与 DevTools 单次授权已经消费；扩展 v0.4.18 的真实闭环仍需新的明确批准。
