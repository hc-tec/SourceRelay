# B 站视频详情首屏：DOM-only MVP 契约 v0.1

- 日期：2026-07-21
- 状态：已完成独立匿名实网可行性侦察与受管 Profile 产品闭环
- 示例页面：`https://www.bilibili.com/video/BV1qZSLBYEpa`

## 1. 要解决的问题

当用户提供一个规范 BVID URL 时，系统能否在其受管浏览器的**同一精确页面**中，以一次导航、零页面交互的方式，保存可供后续 AI 使用的视频首屏详情。

这不是字幕、评论或多 P 内容采集的替代品。它只回答“这一条视频是什么”的问题。

## 2. 已证明的页面事实

2026-07-21 在独立、匿名、无扩展的可见 Chromium 临时会话中，页面一次导航后可同时看到：

- 标题 `H1`；
- 可见的 B 站播放器；
- 发布时间与公开指标所在的标题信息块；
- 公开视频简介；
- 标签；
- UP 主公开入口；
- “视频选集”及多 P 摘要。

该样本同时出现登录二维码浮层，但上述详情仍可见。没有点击登录、扫码、关闭浮层、播放、字幕、选集、评论或推荐卡片。

导航基线存在播放器、弹幕和字幕相关 route，但本 MVP 不读取 response body，不把任何 route 当作字段来源，也不保存请求头、Cookie、Token 或 query 值。

## 3. MVP 边界

```text
最大详情数                     1
目标页面导航                    1 次
页面交互                        0 次
response / XHR 采集             0 条
自动平台重试                    0 次
截图                            1 份 runtime 视觉证据
终态页面                        retained_for_review
```

本轮允许持久化的公开 DOM 投影只有：

```text
规范 BVID
标题
标题信息块的可见文本
简介
UP 主显示名及公开数字账号标识（若页面可靠提供）
标签文本（有界）
多 P 是否可见与其摘要文本（不是全量分 P）
登录浮层 / 验证 / 限流 / 不可用的布尔状态
```

明确排除：字幕正文、选集全量列表或切换、评论、楼中楼、推荐、自动播放、点赞/投币/收藏/关注、任何 response body，以及任意 DOM/JS/selector 输入接口。

## 4. 证据与完成语义

一个结果至少需要：

1. Browser Host 的精确 lease、run 与 document generation；
2. 受限 Extension binding 得到的确切 document ID；
3. 当前 URL 规范化后仍等于目标 BVID URL；
4. 可见 `H1` 和可见播放器同时成立；
5. 一份导航后的视觉证据。

标题、简介、创作者、标签和多 P 摘要分别独立标识为 present / absent，不用缺少可选字段伪造失败。若验证码、限流、异常访问、页面身份变化或导航结果未知，立即结束当前 run，不重放导航。

## 5. 产品设计约束

浏览器控制、Extension DOM 投影和 Gateway artifact 必须保持分层：

```text
Browser Host
  -> page lease、一次导航、视觉证据、终态保留

MV3 Extension
  -> 精确 tab/document/run 绑定、固定 DOM 投影

Gateway
  -> BVID 输入校验、动作账本、风险状态、去敏 artifact
```

为了不把“当前 tab”或“最近页面”误认为目标，Extension 会使用一个源专属 document-ready bridge 获取 Chrome document ID；不会用通配 selector、任意 `executeScript` 输入或通用 response observer 取代该绑定。

## 6. 后续能力的分界

```text
视频详情首屏    -> 本文 MVP
多 P 全量目录   -> 单独的选集目录策略
字幕正文        -> 既有 transcript 策略，独立验证
评论与楼中楼    -> discussion_sample 策略，单独预算与动作账本
```

只有本 MVP 的真实闭环被证明后，才开始下一个表面；不能因为首屏 DOM 成功而默认字幕、评论或多 P 切换已经可用。

## 7. 受管 Profile 产品闭环（2026-07-21）

该 run 与第 2 节的匿名可行性侦察严格分开。它使用项目管理的、已登录 B 站 Collection Profile，并由 Browser Host 独占该 Profile。

在 run 前，扩展做了一次明确记录的版本升级：旧 `0.7.3 / revision 7` 会话在无 active lease 时关闭，Browser Host 与 Profile 随后以 `0.7.4 / revision 8` 重新启动。这个生命周期升级不是页面失败后的重试，也没有触发 B 站导航。

```text
runId       f2468a92-778c-4eea-9b0e-6559070cfaa1
artifactId  94bc3d7e-33c3-4f67-a5b1-44be5a8af4a9
strategy    bilibili.video.detail.dom.v2
state       completed
reason      detail_ready
```

### 动作与证据

```text
导航                         1 次（完成）
hover / click / scroll        0 次
response / XHR 观察           0 条
自动平台重试                  0 次
视觉证据                      1 份 runtime 截图（1280 × 720 CSS viewport）
终态页面                      retained_for_review
```

截图仅保留在 ignored runtime；本文和 Git 不含图片、用户身份信息、请求头、Cookie、Token、query 值或 response body。

### 有界 DOM 投影结果

| 字段 | 结果 |
| --- | --- |
| BVID、可见标题、可见播放器 | 已验证并捕获 |
| 标题信息、公开视频简介 | 已捕获 |
| 标签 | 已捕获 10 个 |
| 视频选集摘要 | 已捕获 |
| 登录浮层、验证码、限流、不可用 | 均未出现 |
| UP 主显示名 / 公开数字账号 ID | 本次投影未命中；作为可选字段如实记录，不影响 `detail_ready` |

### 终态安全检查

- Account Safety：`ready`，没有 active run、cooldown 或人工解锁要求；
- 受管 `video_detail` 页：`retained_for_review`，没有 active lease；
- artifact 的 manifest 与详情文件摘要均已核验；
- safeguards 明确记录 request header/body、Cookie/Token、网络 query/fragment 与 response body 均为 `not_read`。

结论：**proved（首屏详情 MVP）**。这证明了 Browser Host → MV3 精确 document binding → Gateway artifact 的真实闭环可用，但不扩大到字幕、全量多 P、评论、楼中楼、推荐或创作者字段的完整性承诺。下一轮应先单独对创作者 DOM 结构做真实页面侦察，再决定是否修订该可选投影。

## 8. 创作者字段跟进侦察（2026-07-21）

针对第 7 节的 `creatorCaptured=false`，在独立、匿名、无扩展的可见临时 Chromium 会话中做了一个新的窄侦察 run。它只有一次导航、零 hover/click/scroll，结束后临时浏览器、截图和 CLI 运行材料均已清理。

- 视觉：首屏标题右侧存在可见的 UP 主卡片；
- DOM：旧 `#v_upinfo` 不存在；可见 `.up-info-container` 与 `.up-panel-container` 存在；
- DOM：`.up-info-container a.up-name[href]` 是可见的公开创作者名称入口，并链接到公开数字账号 profile；头像入口也指向同一公开 profile，但没有显示名；
- Network：本次只验证公开 DOM 形状，未读取或保存网络请求、query、response 或认证材料。

因此后续投影应优先选取可见的 `.up-info-container a.up-name[href]`，再以同一容器内公开 profile 链接作兼容性回退；不能继续把已不存在的 `#v_upinfo` 当作当前桌面页面的唯一假设。
