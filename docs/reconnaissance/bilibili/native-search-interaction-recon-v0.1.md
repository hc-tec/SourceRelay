# B站原生搜索：类型、排序与分页交互实证 v0.1

- 状态：真实网页交互 reconnaissance，尚未等同于正式策略 admission
- 日期：2026-07-22
- 平台：B站桌面搜索页
- 环境：专用、可见、匿名、临时 persistent Chromium Profile；未加载 Collector Extension，未启动或附着受管 Collection Profile
- 数据边界：只记录页面可见结构、去敏 query digest、DOM 状态、截图 hash 和 Network route metadata；未读取 Cookie、Token、request header/body 或 response body

## 1. 问题与结论

本轮只回答三个独立问题：B站原生搜索的“视频”类型、“最新发布”排序和第 2 页分页是否能按人类可见流程可靠触发，以及生产实现应采用导航、DOM 还是可信鼠标输入。

结论：三项可行性均已证明；但它们应保持为不同的策略能力/动作，而不能把当前“综合首屏、零交互”策略自动扩大为完整搜索支持。

| 能力 | 人类流程 | 已证明的后置条件 | 推荐生产职责 |
|---|---|---|---|
| 视频类型 | 综合页将鼠标移到“视频”标签父级，再点击一次 | 视觉蓝色选中态；`li.vui_tabs--nav-item` 获得 `vui_tabs--nav-item-active`；页面角色成为 `/video` | 对已知类型优先一次原生 `/video` 导航，避免每次 run 多一次点击 |
| 最新发布排序 | 在稳定的视频页将鼠标移到“最新发布”按钮，再点击一次 | 视觉选中态；目标 `button` 获得 `vui_button--active`；URL 出现 `order` 枚举 | 对已验证枚举 `newest -> order=pubdate` 优先一次原生导航；等待非空内容而非仅看 active 状态 |
| 相邻分页 | 先向下滚动一次让分页器进入视窗，再点击一次“下一页” | 第 2 页 numeric button active；规范 BV 集合 digest 改变；30 个非空标题仍可见；动作后出现 `GET /x/web-interface/wbi/search/type` 200 | Browser Host 专属、受预算的可信 scroll + click；MV3 继续只投影精确 document DOM |

## 2. 视觉与 DOM 事实

### 2.1 类型标签

当前桌面布局中，“视频”最小文本节点不是交互目标：

```text
SPAN.vui_tabs--nav-text      text = 视频
  -> SPAN.vui_tabs--nav-link
  -> LI.vui_tabs--nav-item  rect = x:124, y:162, width:116, height:40
```

综合页的父节点 class 为 `vui_tabs--nav-item vui_tabs--nav-item-active`；点击前视频节点没有 active，点击后视频节点获得同一 active 后缀。不能点击最小文本节点，也不能把侦察坐标写入生产代码；生产控制层须每次读取当前父级 rect、pointer hit 和 `:hover` 状态。

### 2.2 排序按钮与骨架屏陷阱

视频页的排序栏是独立按钮：

```text
综合排序  -> button.vui_button--tab vui_button--active
最新发布  -> button.vui_button--tab
```

可信点击“最新发布”后，目标 button 获得 `vui_button--active`，默认 button 失去该状态。一次交互截图仍可能显示骨架屏，尽管页面里仍残留 BV anchor；因此 **BV link 数量、active class 或 URL 参数本身都不是结果 ready 的充分条件**。稳定原生 `order=pubdate` 导航在 4 秒后才同时满足 30 个非空 `h3`、零 visible skeleton 和稳定卡片内容。

### 2.3 分页器

分页器在首屏下方：

```text
DIV.vui_pagenation
  -> BUTTON.vui_pagenation--btn-num     active page = 1
  -> BUTTON.vui_pagenation--btn-side    text = 下一页
```

本次目标按钮初始 y 约为 1860，viewport 高 900。一次有界向下 wheel 后页面从 `scrollY=0` 到 `scrollY=1427`，按钮进入视窗；随后浏览器级 mouse move 证明 pointer hit / hover，再完成唯一 click。动作后第 2 页 active，规范 BV 集合 SHA-256 与第 1 页不同，且页面仍有 30 个非空标题。

## 3. Network 事实与因果边界

导航前均开始监听；只保存 method、去 query/hash route、status 与 MIME。

| 阶段 | 确认 route metadata | 因果结论 |
|---|---|---|
| 视频 `/video` 原生导航 | `GET https://search.bilibili.com/video` 200；`GET https://api.bilibili.com/x/web-interface/wbi/search/default` 200 | 基线加载候选，不作为 click 因果 |
| 最新发布原生导航 | 同页 HTML 200 与 `.../wbi/search/default` 200；视觉/DOM 为最新发布选中且非空结果已渲染 | 原生排序 URL 可用；生产首版仍保持 DOM-only 数据投影 |
| 点击第 2 页 | `GET https://api.bilibili.com/x/web-interface/wbi/search/type` 200，发生在 click 后；第 2 页选中与 BV 集合变化同时出现 | pagination click 的 route 因果已确认 |

没有读取上述响应正文，也不因看到 route 就把 response-body 采集并入策略。

## 4. 动作账本与清理

| run | query identity | navigation | scroll | hover | click | 结论 |
|---|---|---:|---:|---:|---:|---|
| `select-video-0d8a8015` | SHA-256 only | 1 | 0 | 1 | 1 | 类型选择 UI proved；切换后的截图仍为骨架，未把内容 ready 误报为成功 |
| `sort-newest-b0ffc225` | SHA-256 only | 1 | 0 | 1 | 1 | 排序选择 UI proved；同样发现骨架屏不能用旧 BV anchor 充当 ready |
| `newest-baseline-3459710` | SHA-256 only | 1 | 0 | 0 | 0 | `order=pubdate` 原生导航在 4 秒后稳定渲染，proved |
| `page-two-cb74aea6` | SHA-256 only | 1 | 1 | 1 | 1 | 相邻分页三面实证 proved |

另有一次分页实验在本地 probe 空值错误后终止；它只留下 click 前截图，且无法可靠证明输入是否已投递，故按 `outcome_unknown` 处理，未重放、未复用 Profile，也不计入成功证据。

每个临时浏览器均在 run 结束后关闭，临时 Profile 目录已删除；截图仅保留在 ignored `poc/runtime/recon-artifacts/`，不进入 Git。受管 B站 Collection Profile、Gateway 和已登录浏览器未被附着、读取或关闭。

## 5. 生产迁移结论

1. 扩展 DOM projector 必须新增搜索页面角色、已验证排序枚举、页码以及 **non-empty semantic content** ready 条件；不得把 skeleton 中残留的链接计为完成。
2. 已验证的类型和排序可通过一次第一方 URL 导航表示；导航 query 中的原始 keyword 仍只短时存在，长期 artifact 只保存 digest，类型/排序使用白名单枚举。
3. 分页必须是 Browser Host 中的源站专属可信输入命令：先实时确认 active page、下一页 enabled、当前 rect、viewport 和 pointer hit；一次必要 scroll、一次 hover、一次 click；结果未知则 quarantine，禁止自动再点。
4. `更多筛选` 与其每一个 filter value、其他排序、跳页、搜索类型、空结果、登录/验证码/限流和多页恢复仍是独立 reconnaissance/策略版本，不得由本记录推断为已经支持。
