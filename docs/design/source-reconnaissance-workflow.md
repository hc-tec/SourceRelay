# 数据源勘察工作流：先理解页面，再实现策略

- 状态：Accepted product gate
- 日期：2026-07-18
- 适用范围：所有平台、页面角色与证据目标，包括站内搜索、已知 URL 详情、账号内容目录、评论、有界筛选与翻页
- 上游规格：[平台采集策略产品规格](platform-strategy-product-spec.md)

## 1. 核心原则

平台策略不能从“先写一段爬取代码”开始。它必须复现一个谨慎的人类研究者面对陌生网站时的工作顺序：先确认用户究竟需要什么证据，再在真实浏览器中理解页面如何呈现、如何变化、正常交互会触发什么请求，最后才为每类字段选择获取手段。

```text
证据需求
  -> 人类式页面路径复现
  -> 页面角色与状态勘察
  -> DOM / 交互 / XHR-fetch 联合观察
  -> 字段到证据表面的映射
  -> 候选手段比较与最小方案选择
  -> 策略契约草案
  -> 实现
  -> 用户控制环境中的真实验证
  -> review + explicit admission
```

DOM、响应观察和有界交互不是三条预先选定的技术路线。它们是勘察后可按字段组合的证据表面。不得因为 DOM 容易写就忽略稳定的页面响应，也不得因为发现 JSON 就绕过页面可见性、访问控制或用户授权。

## 2. 强制阶段与交付物

### 2.1 需求定界

先写清：

- 研究问题、决策语境和目标平台；
- 证据目标是广度目录、详情、账号上下文、账号归档还是讨论样本；
- 每类期望信息的优先级：必需、重要、可选、不允许；
- 是否要求匿名、用户管理登录态或两者分别覆盖；
- 页数、详情、评论、交互、时间和媒体预算；
- 允许公开保存的字段，以及明确禁止的 Cookie、Token、请求头、请求体、浏览器存储、签名材料和隐藏字段。

没有字段需求，就无法判断 DOM 与 XHR 哪个更合适；“尽量多抓”不是合格需求。

### 2.2 浏览器路径复现

在专用、可见、用户控制的 Validation Browser Profile 中，像人一样完成目标流程并记录语义步骤：

```text
进入平台原生入口
  -> 输入关键词 / 打开已知 URL / 进入博主主页
  -> 观察首屏
  -> 使用平台已有筛选或排序（若任务需要）
  -> 打开详情或评论（若任务需要）
  -> 判断页面是否存在可靠终点、分页、懒加载或登录门禁
```

不得在这一阶段把外部搜索结果冒充站内结果，也不得通过私有请求重放、签名复刻或 Cookie 导出缩短研究路径。

### 2.3 页面与 DOM 勘察

对每个页面角色记录：

- 规范 URL、可能的重定向和 SPA 路由变化；
- 成功、空结果、未登录、验证、限流、删除/不可达和布局未知状态；
- 用户正常可见的字段、字段出现时机和缺失是否合法；
- 可作为语义锚点的 DOM 区域、可访问名称、稳定属性和结构关系；
- 虚拟列表、懒加载、折叠文本、滚动、分页、弹层和播放器自动行为；
- 不同内容、账号状态、窗口尺寸或页面变体下的差异；
- 哪些选择器只是偶然 class、构建 hash 或单一样本，不应进入策略。

勘察可以使用只读 snapshot、DevTools Elements、页面截图和临时只读表达式。勘察产物不是 production adapter，也不能自动获得 admission。

### 2.4 XHR / fetch 与页面状态勘察

XHR / fetch 勘察与 DOM 勘察在同一次人类浏览路径中并行启动，而不是等 DOM 失败后才补做。并行时间轴用于回答“页面在什么时点触发了什么数据流、DOM 又在什么时点呈现了哪些公开字段”；最终是否采用 response-assisted 方案，仍由字段映射、稳定性和最小权限评审决定。研究重点是理解前端的数据流，不是寻找可脱离浏览器调用的“私有 API”。

每个候选 route 至少记录：

- 由哪个正常页面动作触发；
- 精确 origin、pathname、method、MIME 和响应状态范围；
- 是否依赖登录、验证码、时效签名、设备指纹或页面短期上下文；
- 哪些响应字段确实对应页面正常呈现的字段；
- 哪些字段只用于游标、稳定 ID 或状态判断，不能进入长期 Evidence；
- 大小、数量、分页、重复、错误结构和页面版本差异；
- DOM 与响应不一致时如何报告 partial / mismatch；
- 是否能在不读取 header、request body、Cookie、Token 和原始响应包的前提下安全投影。

勘察阶段可以使用 Chrome DevTools、Playwright 辅助观察或扩展的临时 Validation-only 观察能力。默认先保存 route/状态/尺寸等 metadata，并与 DOM checkpoint、document lifecycle 和正常交互动作使用同一 run 时间轴；只有为判断字段映射确有必要且经过单独 review 时，才读取经过当场去敏、大小受限的响应副本。原始 HAR、认证材料和完整响应不能成为仓库交付物。

有界交互勘察的安全结构投影应原子保存到 ignored runtime，而不是只依赖一次 HTTP/终端输出。列表接口只返回动作结果、objective、route 摘要、content kind、大小、摘要和 `schemaPathCount`；单 record 详情才返回完整路径/类型/数组规模。artifact 不保存 Profile ID、原始目标 URL、查询值、header、request body、Cookie、Token、原始 response body 或未进入白名单的 DOM 字段。

不得把平台域名拦截到本地 HTML、伪造 DOM/XHR 或 fake Gateway 来验证平台集成。纯函数、状态机和 projector 可以单元测试；optional permission、content injection、DOM/XHR 时间线、动作后置条件、弱网/验证码终止和页面清理必须在用户明确授权的真实网站运行中验证。

### 2.5 字段—证据映射与手段选择

每个所需字段必须逐项做决定，不能只给整个平台贴上“DOM 方案”或“接口方案”标签。

| 字段 / 状态 | 页面是否可见 | DOM 稳定性 | 响应候选 | 是否需交互 | 最终手段 | 选择理由 | Fallback |
|---|---|---|---|---|---|---|---|
| 示例：视频标题 | 是 | 高 | 有但非必要 | 否 | visible_dom | DOM 足够且最小 | layout_changed |
| 示例：下一页游标 | 间接可见 | 低 | 有 | 点击下一页 | approved_response + bounded_interaction | 游标只作控制，不进入长期证据 | 停止并报告 partial |

选择顺序是“满足需求的最小、最稳定、最可解释手段”，而不是固定 DOM 优先或 XHR 优先：

1. 可见 DOM 已稳定覆盖字段时，不为结构漂亮而扩大到 response observation；
2. DOM 需要脆弱猜测、但页面自己的响应能稳定映射到可见字段时，可选择精确 response projector；
3. 内容必须经过筛选、展开、分页或进入详情才能出现时，增加有上限的语义动作；
4. 同一结果可以采用混合手段，但每个字段必须注明来源表面；
5. 任何手段都无法可靠满足契约时，能力保持 `draft` 或返回 capability gap，不能先写一个“差不多”的采集器。

### 2.6 策略候选评审

进入实现前必须完成一份 Source Reconnaissance Dossier。评审至少回答：

- 为什么选这个页面入口与页面角色；
- 为什么每个必需字段采用当前手段；
- 哪些替代方案被否决，依据是什么；
- 登录、空结果、验证、限流、布局漂移和自动导航如何终止；
- 预期覆盖、无法覆盖和“不等于全部”的语义；
- host permission、动作预算、响应 route 和保存字段是否最小；
- 实现后要用哪些真实页面状态验证。

没有通过这一步，不创建 production selector、action graph 或 response route。

### 2.7 实现、真实验证与 admission

实现只能落在 Dossier 已批准的范围内。若实现过程中发现页面行为与勘察不一致，应退回勘察阶段更新记录，而不是静默扩大选择器、route 或动作。

策略只有在以下事实同时成立后才能 admission：

- 构建产物与权限门禁通过；
- 用户控制的 Validation Profile 中真实运行；
- 需求矩阵中的必需字段和终态满足契约；
- 页面变体、登录类别与验证时间被记录；
- 失败样本和前驱版本继续保留；
- 人工 review 明确 accepted；
- registry 只引用精确 strategy version、record ID 和 verifiedAt。

一次成功页面、旧接口文章、GitHub README、第三方爬虫代码或没有 open issue 都不能替代上述证据。

平台能力没有“受控假页面通过”这一中间成熟度；真实平台证据不足时，策略继续保持 `build_ready` 或 `suspended`。

## 3. Dossier 模板

每个候选能力在 `docs/reconnaissance/<platform>/` 下建立独立文件，建议命名：

```text
<surface>-<objective>-recon-v<major>.<minor>.md
```

内容模板：

```markdown
# <平台 / 页面角色 / 证据目标> Source Reconnaissance

## A. 需求与边界
- research question:
- evidence objective:
- account category:
- must / should / optional / forbidden fields:
- budgets:

## B. 人类浏览路径
- entry:
- semantic steps:
- expected terminal:

## C. 页面角色与状态矩阵
| role | canonical URL rule | success | empty | auth | verification | rate limit | unavailable |

## D. DOM 勘察
| field/state | visible anchor | readiness | variants | selector risk |

## E. XHR/fetch 勘察
| trigger | exact route candidate | MIME/status | visible-field mapping | cursor/state only | credential dependency | decision |

## F. 交互勘察
| semantic action | precondition | success signal | maximum | stop conditions |

## G. 字段—证据映射
| output field | chosen surface | projector | fallback | excluded data |

## H. 候选方案比较
- DOM-only:
- response-assisted:
- interaction-assisted:
- selected design and rationale:

## I. 覆盖、风险与失败语义
- known gaps:
- page variants:
- automatic navigation / autoplay:
- login and verification:
- suspension signals:

## J. 实验日志
| time | profile category | page variant | observation | decision impact |

## K. 实现与 admission gate
- strategy ID / proposed version:
- exact permissions:
- approved response routes:
- live validation matrix:
- reviewer decision:
```

## 4. 产品状态与可见性

Console 的能力状态以后应区分：

```text
unresearched
  -> reconnaissance_in_progress
  -> strategy_draft
  -> build_ready
  -> live_anonymous_verified | live_authenticated_verified
  -> suspended
```

`unresearched` 和 `reconnaissance_in_progress` 不是失败，而是诚实表示“尚未理解这个平台表面”。Planner 不得为这两种状态生成可批准的采集 stage。

## 5. 与第三方仓库的关系

第三方仓库、Issue、博客和历史接口只能帮助形成勘察问题，例如：常见登录门禁、页面角色、可能存在的分页或已知失效模式。它们不能直接提供 production selector、Cookie、签名、请求重放代码或 runtime dependency。任何有价值的线索都必须回到当前真实浏览器页面重新观察和验证。
