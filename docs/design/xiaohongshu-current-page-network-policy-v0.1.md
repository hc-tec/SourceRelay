# 小红书当前页网络优先策略 v0.1

- 状态：**已登记能力接口，未开放任务调度**。
- 适用能力：`xiaohongshu.current_page.network_metadata`。
- 目的：把小红书的高风险页面生命周期限制写进共享契约、Gateway 能力目录与未来扩展 work，而不是依赖调用方“记得小心”。

## 产品边界

小红书不走普通“搜索 -> 点击卡片 -> 打开详情 -> 翻页”的采集模型。对于此平台，Collector 只能观察已经存在的同一 document：

```text
用户自行打开原始页面
  → （未来）扩展在该 document 之前被明确预置为只读观察
  → 用户明确选择当前页面
  → Gateway 只接收 capability + browserBindingId，不接收 URL 或浏览器标识
  → 同一 document 中生成一次有界网络元数据结果
```

这里的“原始页面”可以是用户正常通过地址栏、书签或外部入口打开的页面；它不允许扩展、Gateway 或页面内脚本通过点击卡片、搜索、分页、弹层、history、刷新或新开 tab 抵达目标。

## 已登录验证浏览器的账号边界

后续可以在**独立、持久的小红书验证浏览器**中由用户人工登录一个仅能浏览公开内容的账号，以研究公开 Explore、公开搜索和用户自行打开的公开内容页。这个登录状态只改善公开页面的可见性；它不是账号数据的授权，也不会让验证浏览器接管用户日常浏览器。

无论页面是否公开可见、账号是否已登录，当前 capability 的 `accountScopedSurfaces` 固定为 `forbidden`。下列当前账号相关 surface 永远不在能力范围内：

- 收藏、喜欢或其他个人内容库；
- 消息、私信、通知及其未读状态；
- 个人中心、账号资料管理、登录与安全设置；
- 创作中心、草稿、数据面板、订单或任何创作者后台；
- 任何需要“当前登录账号”身份才能识别、管理或返回的数据。

因此，未来即使验证账号只能访问公开浏览与搜索，也不会触发上述页面、读取其 DOM 或 Network 面、保存其数据，或尝试绕过该账号的封禁限制。

### 专用验证浏览器

使用下面的本地入口准备验证环境：

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run start:xiaohongshu-validation-browser
```

它只会启动一个可见、持久的 Chromium 和本地扩展控制面，初始不导航任何平台页面。运行材料固定在 Git 忽略的 `poc/runtime/xiaohongshu-validation/`，Profile ID 为 `xiaohongshu_validation`；它不读取、复制或管理用户日常浏览器的 Profile。该环境还显式关闭 B 站验证所用的 test-only extension-control 命令。

启动后由用户本人在这个窗口中通过地址栏进入小红书并完成必要登录。用户确认“已登录小红书验证浏览器”前，不执行任何小红书平台导航、刷新、搜索、点击或滚动；登录后也只研究用户自然停留的公开页面。

### 已登录会话的安全所有权边界

在 2026-07-28 的首次已登录验证会话中，Browser Host 正确把用户手动使用的窗口 tab 视为 **unmanaged**。这是刻意的保护：当前 Host 不能也不应该附着、读取、截图、关闭或接管一个没有经过扩展显式选择的 tab。运行 Chromium 只提供 Playwright 私有调试 pipe，没有可安全附加的第二个控制器。

因此，本轮不会为了立刻观察登录后的页面而重启浏览器、刷新页面、创建自动化 tab、通过任意 CDP/脚本读取现有 tab，或把已有页面误标为受管页。登录状态会保留在专用验证 Profile 中，待受限的显式选择路径完成一次明确更新后再使用。

### r16 源码中的下一 document 预置 MVP

工作区源码新增了一个尚未升级进当前浏览器的最小观察路径。它不改变这个能力的 catalog-only 状态，也不进入 `/v2/collect`：

1. 用户在扩展 popup 中、已停留于公开 `/explore` 或 `/search_result` 页时，点击“预置下一次手动打开的公开小红书页”。
2. Chrome 只在这次用户手势中请求可选的 `https://www.xiaohongshu.com/*` 与 `webRequest` 权限；拒绝后没有降级、没有重试、没有其他读取路径。
3. 扩展只记住私有的一次 tab/document lease，等待用户自己在**同一 tab**发起下一次顶层导航；扩展绝不导航、刷新、搜索、点击、滚动或开新 tab。
4. 新 document 形成后，至多 60 秒、24 条的 `webRequest` 完成元数据会被归入固定的风险/身份/配置/其他计数；不保存 route、URL、query、header、Cookie、Token、response body 或页面正文。
5. Browser Host 只能通过一个零输入 Native Bridge 命令读取去敏结果；它仍不能提供 tab、URL、selector、script、route 或任意浏览器控制。

`webRequest` listener 不是常驻监控器：预置本身不会注册它；只有用户已在选中 tab 中真实发起允许的下一次顶层导航时才注册。预置过期、达到 24 条、document 变化、风险停止、网络失败或 tab 关闭都会立即移除它。

当前没有任何 route 会把 `publicContentRouteCount` 提升为非零。未知请求仍然是 `other`，而不是“已发现可用公开接口”。详情页、账号页、评论页与任何账号自身 surface 均不在这个 MVP 内。

2026-07-28 已将 r16 构建精确载入专用验证浏览器：worker 的扩展版本、控制面 revision 与构建指纹一致，Native Bridge 已连接。升级入口仍是 `npm run rebuild:xiaohongshu-validation-browser`；它只会以同一持久 Profile 重启**隔离验证浏览器**一次，不会接管日常浏览器，也不会自动导航到任何平台 URL。

验证浏览器只用于扩展加载/Host 协议、以及真实小红书页面的受限证据闭环；它**不自动化** `control.html`、扩展 popup、Chrome 原生权限提示或任何其他浏览器 UI。可选的 `https://www.xiaohongshu.com/*` 与 `webRequest` 权限是一次性的产品设置前置条件：若尚未由用户在可见扩展控制面中授予，自动化只报告 `permission_required` 并停止，不能以测试路径代替用户界面操作。

## 不可绕过的预算

| 项目 | 上限 | 含义 |
| --- | ---: | --- |
| 平台导航 | 0 | work 不能打开、改写或跳转页面。 |
| 刷新 | 0 | 不能用 reload 重新触发接口。 |
| 页面内新 document | 0 | 不能点击卡片、详情、话题、作者、评论或任何可能切页的控件。 |
| 语义动作 | 0 | 不能 click、hover、scroll、筛选、排序、搜索或展开。 |
| Network response body | 0 | 当前版本只做分类元数据，不能复制 JSON/HTML 正文。 |
| 原始 payload | 0 bytes | Gateway 与上层应用不接收原始网络材料。 |
| Network 元数据 | 最多 24 条 | 只允许去 query 的 route 分类计数，避免把安全接口变成可枚举数据。 |

同时固定：不读取 Cookie、Token、request/response header、query 值、browser Profile、tab/window/document ID；不调用 Browser Host fallback。

## 为什么是预置同一 document 观察

用户在页面完全加载后才选择当前 tab，扩展无法倒带读取已经结束的 XHR/FETCH response body。为了不以刷新补救，未来若要观察网络，只能在**用户打开原始页面之前**对该同一 document 建立明确、短时、只读的观察窗口。

这不是“后台监控所有小红书页面”：预置必须来自扩展 UI 的一次明确操作，窗口必须与一个 tab/document 生命周期绑定并自动过期；如果 document 已改变、用户手动跳走、出现登录/验证/限流，work 立即停止。

## 路由准入规则

当前没有任何小红书 response body route 获得准入。匿名 `/explore` 实证中，Network 面只有登录、身份、配置、安全与遥测相关请求；可见推荐卡片并不能证明其中任一路由是公开内容数据源。

在随后的初始 document-state 侦察中，唯一 `/explore` 导航被直接重定向到 `/website-login/captcha`，可见标题为“安全验证”。这使得 `website-login` 路径、标题“安全验证”以及“扫码验证身份”等公开页面信号成为硬停止条件；不得为获取 document state 而刷新、换 URL、换 Profile 或再次导航。

未来新建正文能力至少需要独立满足：

1. 在真实可见页面上，route 与目标公开内容具有明确语义；
2. 页面视觉与 DOM 同时出现能对应的公开字段；
3. route 不是登录、身份、安全、验证码、风控、配置、遥测或广告面；
4. body 是 JSON、大小受限、敏感字段递归剔除，且不会保存短期访问上下文；
5. 一次操作即可证明，失败不刷新、不重放、不改走 DOM 爬取。

通过后必须使用新的、固定的 capability ID 与单独的 canary；不能把 route body 偷渡进 `xiaohongshu.current_page.network_metadata`。

## API 可见性

`GET /v2/capabilities` 会显示该能力的状态：

```text
dispatchState: policy_ready_route_admission_required
captureMode: prearmed_same_document_network_metadata
responseBodies: not_read
routeAdmission: no_public_content_route_admitted
accountScopedSurfaces: forbidden
```

这是一条给上层应用的真实能力声明，不是可执行采集承诺。因此它目前不出现在 `/v2/collect` 的可调度请求集合中；调用方不能用它触发页面动作或网络正文读取。
