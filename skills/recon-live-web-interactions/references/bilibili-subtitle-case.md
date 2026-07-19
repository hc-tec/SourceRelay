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
- v0.4.18 产品闭环：仍为 `partial`
- 下一产品版本：应先迁移可信交互执行层，再用独立真实 run 验证

不要把第一条自动升级成第二条。
