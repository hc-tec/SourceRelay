# B站字幕可信交互实证

在处理 B站视频字幕、播放器 hover 菜单、媒体轨道，或需要理解“视觉发现 → DOM 定位 → 可信输入 → XHR 证明”的案例时读取本文件。

## 1. 实证边界

- 日期：2026-07-19
- 目标：`https://www.bilibili.com/video/BV1qZSLBYEpa`
- 浏览器：专用、可见、已登录的持久 Chromium Profile
- 未启动 Collector Gateway
- 未加载 Collector 扩展
- 未执行 `transcript-validation.js` 或其他已有平台 runner
- 使用 Playwright 连接本地 CDP，只发送浏览器级鼠标输入
- 目标导航一次、字幕语义 hover 一次、中文点击一次，均未重试

这是一条人工式浏览器可行性记录，不是 v0.4.18 产品闭环成功记录。

## 2. 从视觉开始

导航返回 HTTP 200。初始截图中播放器控制栏自动隐藏，因此 DOM 可见性查询一度返回零个字幕控件。这不能解释为“页面没有字幕”。

先把鼠标移动到播放器底部区域，真实控制栏出现：播放、时间、自动、倍速、字幕、音量、设置、宽屏和全屏。

侦察中一度把经过系统缩放的截图像素误当作 CSS 坐标。读取页面得到：

```text
innerWidth = 1283
innerHeight = 706
devicePixelRatio = 1.75
```

改用页面 DOM 的实时边界框后消除了坐标误差。可复用教训：截图负责理解页面，DOM rect 负责驱动浏览器输入；不要从截图像素硬算生产坐标。

## 3. DOM 定位

控制栏显现后，字幕按钮为：

```text
tag = DIV
class = bpx-player-ctrl-btn bpx-player-ctrl-subtitle
aria-label = 字幕
rect = x:537, y:531, width:28, height:22
```

按钮实时中心约为 `(551,542)`。使用浏览器级 `mouse.move` 到该中心后，菜单真实展开。

菜单中的中文项为真正交互父节点：

```text
selector = .bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]
text = 中文
rect = x:520, y:414, width:152, height:40
active before = false
```

不要点击最小“中文”文本子节点；父节点既接收交互，也持有选中状态。

## 4. 一次可信点击

确认中文项存在、可见且尚未 active 后，使用浏览器级 mouse click 对实时中心约 `(595.79,434.00)` 点击一次。

动作后 DOM 成为：

```text
class = bpx-player-ctrl-subtitle-language-item bpx-state-active
```

可见字幕面板：

```text
class = bili-subtitle-x-subtitle-panel
visible = true
sample text = 就是MLP的一个模型
```

页面同时显示“字幕已切换至 中文”。

## 5. XHR 证明

中文点击后真实新增：

```text
GET https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>
HTTP 200
byteLength = 87175
lang = zh
segmentCount = 509
```

首段：

```json
{
  "from": 0.22,
  "to": 2.36,
  "content": "最近这两年有一个词非常火"
}
```

末段：

```json
{
  "from": 1058.54,
  "to": 1061.66,
  "content": "三大实战以及一大理论的这个课程目标的"
}
```

视觉字幕、DOM active 状态和字幕 CDN JSON 三条证据同时成立，因此浏览器操作可行性为 `proved`。

## 6. 被否定的旧解释

v0.4.18 曾得到：轨道目录已捕获、字幕菜单未展开、中文未点击、字幕正文未触发。根因不是 B站无法模拟，也不是字幕 selector 不存在；根因是 content script 使用 `HTMLElement.click()`，没有按人类流程先执行浏览器级可信 hover。

正确产品职责是：

```text
Gateway Playwright 浏览器控制层
  -> 读取实时 rect
  -> 可信 mouse move / hover
  -> 可信 click

MV3 Extension
  -> 精确 run/tab/document 绑定
  -> DOM/XHR 捕获、投影和提交
```

不要在 content script 中继续堆叠 synthetic `MouseEvent`，也不要把本案例坐标写进生产策略。正式实现必须重新获取当时页面的实时 DOM rect，并保持 action at-most-once。

## 7. 状态解释

- 人工式浏览器可行性：`proved`
- v0.4.18 产品闭环：历史状态为 `partial`
- v0.4.19 首个可信交互产品闭环：`proved`
- v0.4.23 当前产品闭环、窗口保留与复用：`proved`
- v0.4.24 冷启动 worker marker-first 采纳与同版本重启：`proved`
- 正式策略 admission：仍为 `false`，需要更多字幕类型、语言、空结果、长视频和风险样本

不要把单一样本的产品闭环自动升级为正式策略 admission。

## 8. 延迟挂载与视觉假阳性

真实页面时间线显示：video area 约在导航后 5.2 秒可见，字幕控件约到 7.8 秒才挂载。生产流程必须先等待字幕控件 attached，再执行 reveal；不能在 video area 刚出现时就开始 2.5 秒后置条件窗口。

reveal 的实时坐标必须来自 `.bpx-player-video-area`。使用 `.bpx-player-container` 底部会落入弹幕输入区。

字幕控件自身可能满足 Playwright `isVisible()`，但祖先 `.bpx-player-control-bottom` 仍为 `opacity:0`。正确视觉后置条件是祖先 rect 非零、display/visibility 有效且 `opacity > 0.5`。可复用顺序：

```text
attached
  -> trusted reveal on video area
  -> ancestor opacity proves controls visible
  -> trusted hover on caption control
  -> menu DOM proves Chinese option visible
  -> trusted click once
  -> active/panel + response prove completion
```

## 9. 产品闭环与窗口生命周期

真实 v0.4.19 run `f659f549-aa76-47ad-b97c-195706a4d430`、artifact `eb365fbc-2144-4623-af1b-d0dae7eac0f0` 首次得到：三个 required actions 均 completed、两类真实响应、`lang=zh`、509/509 段、`partial=false`。

字幕终态最初会调用 `cleanupRun(..., true)` 关闭目标窗口。该行为已改为只清 alarm、动态脚本和 Network arm，并保留最终目标页。下一独立 run 只在旧 tab 仍停留于原规范 URL 时复用它；用户已导航到别处时不得关闭或劫持。

v0.4.23 runs：

- `e50cf518-539d-40e3-ad30-41b44983180c` / artifact `7d026a9d-318a-4ea3-ab05-a0e448e99a69`：完整 509 段，run 后目标窗口仍在；
- `b5e46b00-eec6-4f1d-9cb0-c41fbf615e4a` / artifact `503eba28-48a2-4945-8258-0a0394cb0a24`：复用同一目标窗口，OS 窗口数仍为 Control + target 两个，无第三个窗口。

扩展升级侦察还证明 manifest 版本可能新于正在执行的 worker bundle。v0.4.23 首先把 reload 与复核移入 headless context，但仍错误地用持久 `lastExtensionVersion` 决定是否探测；一旦该记录已经是新版本而实际 worker 回退为旧代码，就会跳过修复、打开可见窗口后 mismatch，并在每次启动永久复发。

v0.4.24 改为每次冷启动 marker-first：headless A 必定读取实际 manifest/runtime/revision，匹配时零 reload；不匹配时只 reload 一次，再由 headless B 复核。真实 poisoned-state 验证故意令持久记录为 `0.4.24`、实际 runtime 为 `0.4.23`，结果 4.276 秒内完成 `0.4.23 -> 0.4.24`，`headlessPrewarmPerformed=true / prewarmRuntimeReloadAttempted=true / chromeUiReloadAttempted=false / contextRestarted=false`；随后同版本冷启动耗时 1.857 秒，`headlessProbePerformed=true` 且两个 reload 字段均为 `false`。两次可见阶段都只有一个 Control 窗口、一个标签，`chrome://extensions` 标签为 0。不得恢复旧的 UI Reload、可见 context 自动重启或基于历史版本跳过实际探测的路径。
