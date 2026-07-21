# B 站 UP 主投稿目录分页：真实交互侦察 v0.1

- 日期：2026-07-21
- 状态：匿名人类流程已证明；数据替换未证明；**尚未实现产品策略**
- 目标角色：`account_video_inventory.pagination`
- 示例页面：`https://space.bilibili.com/7481602/upload/video`

## 1. 本轮唯一问题

在 B 站 UP 主投稿目录中，人类能否通过真实分页控件从第 1 页切换到第 2 页；页面、DOM 与 Network 是否同时证明第 2 页数据已经出现，从而为后续受管浏览器策略建立可靠的输入和完成条件？

这不是生产采集 run，也不验证“全部投稿”。它只验证一次 `第 1 页 -> 第 2 页` 的人类交互，并且不读取任何 response body。

## 2. 环境与动作账本

```yaml
browserMode: headed isolated temporary Chromium
browserLifecycle: temporary_recon
authenticated: false
extensionInteractionLoaded: false
existingPlatformRunnerUsed: false
targetRole: account
navigationCount: 1
outcome: partial
```

动作按真实浏览器输入执行；没有 `HTMLElement.click()`、事件伪造、重试、刷新或登录操作：

| actionId | 前置条件 | 浏览器输入 | 尝试次数 | 结果 |
| --- | --- | --- | ---: | --- |
| `scroll_to_pagination` | 初始滚动位置为 0，目录内容已渲染 | 一次真实 mouse wheel | 1 | 完成，抵达分页区域 |
| `select_page_2` | 第 1 页为 active；第 2 页是未禁用的 `<button>`；鼠标中心命中其自身 | 鼠标移动到实时中心后一次 down/up | 1 | DOM active 状态变为第 2 页；数据替换未证明 |

临时浏览器、页面、CLI 调试状态和截图均已在本轮结束时关闭并删除；受管登录 Profile 未被该临时侦察接触。

## 3. 点击前的三面证据

### 视觉

在目录底部可看见页码按钮。页面公开显示第 1 页到第 7 页，并显示一个公开的总页数/总条目摘要；登录浮层遮住右侧部分区域，但不遮住第 2 页按钮。

### DOM

真实可见容器为：

```text
div.vui_pagenation.vui_pagenation--jump.video-pagination
```

其公开文本语义是“上一页、页码、下一页、共若干页、跳至页”。点击前的关键后置前提为：

```text
page 1 button                    vui_button--active
page 2 element                   button.vui_pagenation--btn-num
page 2 disabled                  false
page 2 live bounding box         351,653,34,34 CSS px
pointer at center                 elementFromPoint 命中该 button
pointer hover                     true
```

同时发现目录的第 1 页一次已渲染 40 张卡片。它们可以位于视口下方，因此此前 MVP 的精确语义应为“**第 1 页已渲染卡片**”，而非“像素首屏可见卡片”。

### Network（只记录去 query/hash 的 metadata）

导航与滚动后的基线已经出现一次：

```text
GET https://api.bilibili.com/x/space/wbi/arc/search  -> 200
```

本轮没有读取该请求的 header、body、query、Cookie、Token 或 response body。这个 route 只作为“目录数据可能由哪类请求补充”的观察事实，**不是**生产接入许可。

## 4. 一次点击后的证据与失败语义

点击后，页面滚动位置回到顶部；DOM 看到第 2 页按钮成为 active，目录仍有 40 张已渲染卡片，且页面未显示验证码、限流或不可用文案。

但唯一语义匹配的 action 后新增请求是：

```text
GET https://api.bilibili.com/x/space/wbi/arc/search  -> 412
```

因此，不能把 “第 2 页 active 样式” 当作 “第 2 页数据已经完成替换”。没有读取 response body，也没有第二次点击来尝试恢复；本轮结论必须是 `partial`。

点击使页面回到顶部后，原先位于分页按钮上的鼠标坐标落在了视频卡片区域。随后出现播放器、媒体、字幕等请求；这些请求与目录分页 route 语义不匹配，不能归因于“第 2 页数据已取得”。最合理的解释是页面重排后的 hover 预览副作用，但这仍是推断，不是成功证据。

## 5. 对产品设计的约束

1. 不重用旧 `arc/search` response runner，也不因本次看到 route 而读取或依赖 response body。
2. 后续策略必须通过 Browser Host 的可信浏览器输入点击页码，Extension 只投影固定 DOM；不得用 content-script synthetic click。
3. 每个分页动作只能尝试一次。`active` 页码、卡片身份变化和语义匹配的 Network metadata 必须同时满足，才能宣称当前页完成。
4. 分页后页面可能复位滚动位置；设计动作计划时必须显式处理指针在布局变化后的落点，避免无意 hover 到视频卡片或播放器预览。
5. 412、登录失效、验证码、异常访问、限流、导航未知或 document mismatch 都是停止条件；记录 partial artifact 后不刷新、不重试、不换代理。
6. 下一次实证应使用受管、已登录 Profile，但必须通过 Browser Host 的受控输入路径完成，不能让 Playwright CLI、独立 CDP 或 DevTools 附着该 Profile。

## 6. 当前结论

```text
human control discovery          proved
trusted page-2 click             proved
DOM active-page change           proved
page-2 data replacement          not proved
network route metadata           observed, 412 after action
production pagination strategy   not admitted
```

下一步不是写“全量分页爬虫”，而是在受管登录 Profile 中先完成一次同样严格的、单点击、三面证据闭环；只有成功后，才实现 `bilibili.account.video-inventory.pagination.dom.v1` 的最小策略。
