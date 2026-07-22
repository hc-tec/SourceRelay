# B站字幕：当前匿名登录门槛侦察 v0.1

- 日期：2026-07-22
- 结论：blocked（匿名播放器访问门槛），不是验证码、限流或“字幕控件不存在”
- 目标：用户已指定的公开 BVID BV1qZSLBYEpa
- 环境：独立、可见、临时 persistent Chromium Profile；无扩展、无 Gateway、无认证材料读取；结束后 Profile 已关闭并删除

## 已观察事实

一次导航后，视觉截图显示播放器内部的“登录观看 / 试看”门槛。页面未显示验证码、异常访问或限流。

DOM 同时显示：

- .bpx-player-container 已渲染；
- .bpx-player-ctrl-subtitle（aria-label 为“字幕”）节点已存在；
- 该控件的祖先控制栏 opacity 尚未达到人眼可见阈值；
- 中文语言项尚未渲染，字幕面板也未显示。

全局页面头部的“登录”入口不能当作 login modal。将其当作门槛会产生假阳性；正式判定必须要求尺寸足够的 dialog/login 容器，或播放器内可见的访问门槛。

## 动作账本

| action | attempted | count | result |
|---|---:|---:|---|
| open_video | 是 | 1 | completed |
| reveal_player_controls | 是 | 1 | postcondition_unmet |
| open_caption_menu | 否 | 0 | prerequisite_unmet |
| select_chinese_caption | 否 | 0 | prerequisite_unmet |

reveal_player_controls 的首次尝试以 .bpx-player-container 的底边作为目标，落入播放器下方的输入区域，未能显现控制栏。它不能说明 hover 不可行。下一次独立、已登录 run 必须先读取精确 .bpx-player-video-area 的实时 rect；不得复用此 run 或在同一页面重试。

没有字幕 XHR/text-track response 被观察到，也没有读取 request header、request body、response body、Cookie、Token 或浏览器 storage。

## 产品含义

1. 匿名/未登录播放器内的访问门槛必须映射为 authentication_required，立即停止后续 hover、点击与 Network 读取。
2. 正式字幕策略的成功前置条件是：受管登录 Profile、无验证码/风控、精确 video-area、控制栏视觉可见、字幕按钮 hover 后菜单可见。
3. Browser Host 负责可信 mouse move/hover/click；MV3 只负责 exact document binding 与严格 route/projector 观察。
4. 截图仅保留在 ignored runtime，不能提交进 Git；本记录只保留去敏结构事实与动作结果。
