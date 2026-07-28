# 小红书 Explore 初始文档状态侦察 v0.1

- 日期：2026-07-28
- 结论：**blocked**。尝试验证匿名 `/explore` 首次 HTML 是否含有可与可见卡片交叉证明的初始状态时，平台在唯一导航后直接进入身份安全验证页。
- 范围：这不是登录尝试，不是页面内跳转，更不是接口重试。它只验证首页原始 document response 的结构可行性。

## 窄问题

匿名用户对 `/explore` 做一次原始导航时，首次 HTML document 是否携带可被有界、去敏投影的初始页面状态，从而避开 DOM-first 与 XHR/FETCH response replay？

## Run 摘要

```yaml
platform: xiaohongshu
targetRole: home_feed
targetIdentity: /explore
browserMode: visible persistent isolated temporary recon profile
authenticated: false
extensionInteractionLoaded: false
existingPlatformRunnerUsed: false
navigationCount: 1
outcome: blocked
```

## 动作账本

| actionId | attempted / count | 结果 |
| --- | --- | --- |
| `navigate_explore_document_once` | `true / 1` | `DOMContentLoaded` 后最终 document 为安全验证页；没有第二次导航。 |

刷新、点击、hover、滚动、页面内新 document、搜索、筛选、分页、XHR/FETCH response body 读取和自动重试均为 `0`。

## 三面证据

### 视觉

可见页面标题为“安全验证”。页面要求用户使用已经登录相同账号的小红书 App 扫码验证身份；运行材料中的二维码截图只保存在 Git ignored runtime，未进入本文或 Git。

### DOM

最终规范路径是：

```text
/website-login/captcha
```

没有 Explore 卡片区域，也没有可供初始状态交叉核验的页面 state。此路径不能被解释为普通登录弹层、空结果或加载失败。

### Network

目标 document 最终为 `200 text/html /website-login/captcha`。原计划只允许读取 `200 text/html /explore` 的有界结构摘要，因此没有读取安全验证 document 的正文，也没有读取任何 XHR/FETCH 正文。

## 产品含义

这次事实把两条规则从“建议”提升为硬停止条件：

1. `pathname=/website-login/captcha` 或页面标题/文本出现“安全验证”“验证身份”“扫码验证”时，终态必须是 `verification_required`；不得刷新、换 URL、换 Profile、重放导航或尝试 DOM/XHR 替代路线。
2. 只有实际到达 `/explore` 的正常 document，才允许尝试下一轮“初始文档状态”实证；安全验证 document 永远不读取正文、不解析 state、不进入 route 准入。

共享小红书契约已加入这个分类规则并有纯逻辑单元测试覆盖。当前 `xiaohongshu.current_page.network_metadata` 仍保持 catalog-only、零导航、零 response body，不因本次失败获得任何额外权限。

## 清理

本轮临时匿名 context 在完整 run 后关闭；没有保留浏览器、调试端口、登录材料、二维码内容、Cookie、Token、Storage、response body 或未完成平台动作。后续小红书实网动作在用户明确恢复方向前保持停止。
