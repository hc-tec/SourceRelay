# B站视频字幕 Source Reconnaissance v1.0

- 状态：人工可行性与生产扩展/Gateway 闭环均已真实证明；v0.4.23 两次独立 run 均完成中文选择、两类响应捕获和 509 段 raw-first artifact，目标窗口终态保留并复用；v0.4.24 又完成 poisoned worker 与同版本冷启动验证；当前仍为 research-only validation、不可 admission
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

上述历史实现修正没有通过正确的人工流程验证，因此当时不能声称 B站字幕能力已完成。后续人工与 DevTools 证据见下一节；在该历史时间点，v0.4.18 的扩展闭环尚待新的单次授权实站验证，这一门槛后来已由 v0.4.19/v0.4.23 的独立真实 runs 取代并完成。

### F.5 人工流程与 DevTools 联合侦察

2026-07-19 用户再次授权目标 `BV1qZSLBYEpa` 的单次字幕侦察。此次不先运行既有 selector，而是按“导航、等待、快照、hover、DOM/XHR 增量、单次选择、后置条件”的真实人类流程执行。结论如下：

1. 规范 URL 会由真实页面变为同一 BV 路径加 `?vd_source=<32位十六进制>`；旧实现把这一平台追加参数误判为上下文改变，直接导致上一轮 `transcript_validation_context_changed`。
2. 字幕入口的真实 DOM 是 `.bpx-player-ctrl-subtitle[aria-label="字幕"]`。人类只需 hover 该控件，菜单即展开，无须先盲点按钮。
3. 中文轨道的真实可交互容器是 `.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]`；内层文本只是“中文”。旧实现点击最小文本子节点，并在错误节点上检查 active class。
4. 点击前 `.bpx-player-ctrl-subtitle-close-switch` 带 `bpx-state-active`；只点击中文容器一次后，`ai-zh` 容器获得 `bpx-state-active`、关闭项失去 active，页面出现“字幕已切换至 中文”，`.bili-subtitle-x-subtitle-panel` 变为可见并显示逐句字幕。
5. DevTools Network 确认三条相关 200 route：`/x/player/wbi/v2`、`/x/v2/subtitle/web/view`、`aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>`。query 和鉴权值不写入文档或产品 artifact。
6. CDN 正文是 87175 字节 UTF-8 JSON，根级 `lang=zh`，包含 509 个 `body` 片段；片段字段为 `from / to / sid / location / content / music`。首段从 0.22 秒开始，末段到 1061.66 秒结束；播放器当前可见字幕与正文内容类型一致。

扩展 v0.4.18 据此完成三项修正：只在 observed-document 边界接受唯一且格式严格的 `vd_source`，输入 API 仍拒绝任何 query；语言选择锁定 `data-lan="ai-zh"` 容器；选中后置条件检查容器 active 状态与可见字幕面板。构建、自动扩展加载、Gateway 控制循环和真实响应 projector 门禁均已通过，但没有把这次人工 DevTools 结果冒充扩展闭环验证。

### F.6 v0.4.18 第一次真实闭环提交的前置失败

用户随后明确授权对同一目标执行一次 v0.4.18 生产扩展闭环。系统只提交一次 `POST /validations/bilibili-transcript`，没有重试。该请求返回 HTTP 400；持久账号记录的 `lastRunAt`、reason 和 active run 均未变化，transcript artifact 数量也没有增加，证明请求在账号 run 创建和目标视频导航之前停止。

纯本地诊断确认：v0.4.18 扩展已加载并配对，但当时 `strategyPermission=missing`。这是前一轮 DevTools CLI 直接独占同一个 Collection Profile 后出现的扩展授权状态变化；以后不得再让独立 DevTools 浏览器直接拥有生产 Collection Profile。真实测试必须由 Gateway 启动 Profile，并在消费实网授权前同时检查：

```text
extensionLoaded = true
extensionPaired = true
strategyPermission = granted
accountSafety.state = ready
manifest.version = expected version
```

Gateway 的本地 Control 页权限恢复路径随后只触发一次 `chrome.permissions.request`，成功恢复精确 B站 origins。关闭 Profile 和 Gateway 后重新启动复核，v0.4.18、加载、配对和 `strategyPermission=granted` 均持久存在。该恢复过程没有打开 B站页面；原闭环授权已经按一次提交消费，不能自动补发，下一次真实闭环仍需新的明确授权。

### F.7 v0.4.19—v0.4.24 生产闭环与窗口生命周期

可信交互迁移到 Gateway Playwright 层后，两个独立的真实页面事实解释了 v0.4.19 早期 `control_reveal_postcondition_unmet`：

1. `.bpx-player-video-area` 约在导航后 5.2 秒已经可见，但 `.bpx-player-ctrl-subtitle` 约到 7.8 秒才挂载；看到 video area 不能立即推断字幕控件存在。
2. `.bpx-player-ctrl-subtitle` 自身可有非零 rect、`display:block / visibility:visible / opacity:1`，但祖先 `.bpx-player-control-bottom` 仍为 `opacity:0`。Playwright `locator.isVisible()` 因此会返回视觉假阳性；控制栏真正显现必须检查祖先 rect、display、visibility 与 `opacity > 0.5`。
3. reveal 坐标必须来自 `.bpx-player-video-area` 的实时 rect。使用整个 `.bpx-player-container` 底部会落入视频下方的弹幕输入区域。

生产顺序据此固定为：

```text
等待字幕控件 attached
  -> 等待 video area 可见
  -> 对 video area 底部执行一次可信 mouse move
  -> 检查 control-bottom 祖先 opacity
  -> 对字幕控件执行一次可信 hover
  -> 检查中文父项可见
  -> 对 data-lan=ai-zh 父项点击一次
  -> 检查 active/字幕面板，并读取动作后真实响应
```

v0.4.19 真实 run `f659f549-aa76-47ad-b97c-195706a4d430`、artifact `eb365fbc-2144-4623-af1b-d0dae7eac0f0` 首次完成产品闭环：`state=completed`、`objective=satisfied`、三个必需动作均为 `completed`、`captureCount=2`、`language=zh`、509/509 段、`partial=false`。轨道目录与字幕正文分别来自真实 200 JSON response；artifact 保存四个本地 UTF-8 JSON 文件，不含 Cookie、Token、请求头、Profile 路径或 query 值。

该 run 还暴露出目标窗口在 `completeTranscriptValidation()` 后被自动关闭的产品缺陷。v0.4.20 起，终态清理只撤销 alarm、动态脚本和 Network arm，不再关闭目标窗口；下一独立 run 仅在旧 tab 仍停留于已记录规范目标时复用它，避免窗口堆积。Profile 浏览器生命周期与单个 run 生命周期从此分离。

扩展升级又证明 manifest 文件版本不能代表正在执行的 worker bundle。v0.4.23 让 service worker 发布编译期 runtime marker，并把升级采纳移到不可见 context；但它仍用持久 `lastExtensionVersion` 决定是否 probe，一旦记录显示新版本而实际 worker 仍旧，就会跳过无界面修复、打开可见窗口后 mismatch，并在下一次继续永久复发。

v0.4.24 删除了这个错误信任边界：每次冷启动必先由 headless A 读取实际 manifest/runtime/revision；已匹配则不 reload，不匹配才 reload 一次并由 headless B 复核。真实 poisoned-state 测试把记录设为 `0.4.24`、实际 runtime 保持 `0.4.23`，最终 4.276 秒完成无界面修复并启动唯一 Control；随后的 `0.4.24 -> 0.4.24` 冷启动为 1.857 秒、零 reload。两次都没有 `chrome://extensions`、可见 context restart 或额外 tab。

最终两个独立产品 runs：

| run | artifact | 结果 |
|---|---|---|
| `e50cf518-539d-40e3-ad30-41b44983180c` | `7d026a9d-318a-4ea3-ab05-a0e448e99a69` | `completed / satisfied / captureCount=2 / zh / 509`；终态后 B站窗口仍存在 |
| `b5e46b00-eec6-4f1d-9cb0-c41fbf615e4a` | `503eba28-48a2-4945-8258-0a0394cb0a24` | 同样完整；复用原 B站窗口，OS 窗口数保持 Control + target 两个，没有第三个窗口 |

两次 run 内每个真实语义动作最多一次，无动作重试；结束后账号均为 `ready / activeRun=null`，未出现验证码、风控或限流。人工可行性与产品闭环现在都为 `proved`，但样本覆盖不足，`admissionEligible` 继续为 `false`。

## G. 字段—证据映射（当前）

| 输出字段 | 页面可见 | 当前证据表面 | 状态 |
|---|---|---|---|
| 字幕能力存在 | 是 | visible DOM 字幕控件 | 已观察 |
| 可用语言“中文” | 是 | visible DOM 菜单与选中后置条件 | 人工 DevTools 与 v0.4.23 产品 runs 均确认 `data-lan=ai-zh`、active/字幕面板后置条件；每 run 只点击一次 |
| 轨道类型（人工/自动） | 可能 | player response + visible AI badge | 已确认 `ai-zh` 与 AI 标识；更多字幕类型仍需样本 |
| 字幕时间片与正文 | 播放时可见 | `aisubtitle.hdslb.com` response + DOM cross-check | 产品闭环已两次保存 509/509 段 `content / from / to` raw-first artifact；只抽查当前可见字幕，尚未逐段比对、未 admission |
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

不能因为单一样本的产品闭环成功就升级为正式 `live_authenticated_verified` 策略或 admission。还需验证：

- 人工字幕与 AI 自动字幕样本；
- 多语言、无字幕、字幕锁定与字幕删除；
- 中文轨道默认/非默认；
- 正文与播放器当前显示逐段映射；
- 长视频响应尺寸与时间预算；
- 验证码、限流、断网和布局变化；
- 账号安全熔断、异常锁定、独立 run 与动作预算。

## I. 当前运行状态

- B站受管浏览器：按产品生命周期有意保持运行，不属于残留泄漏；
- 可见窗口：字幕 runs 完成后曾按产品规则保留 `Collector Control + 目标 B站` 两个窗口；本次显式 v0.4.24 Profile 升级结束了旧浏览器会话，当前新会话只有 1 个 `Collector Control` 窗口与 1 个标签，不应把该显式升级与 run 终态自动关窗混为一谈；
- Profile risk state：`ready`；`manualUnlockRequired=false`；无 active run；
- Gateway：43127 有意保持运行，以便继续管理当前 Profile；没有 43128/43129 临时监听器或独立 DevTools 浏览器；
- 生产 response routes：仍为空；
- `admissionEligible`：仍为 `false`；
- 项目开发/验证使用所有者已授予的常设权限；未来新 run 仍须独立 run ID、既定动作预算、at-most-once ledger 和风险停止，不得恢复或重放旧 run。
