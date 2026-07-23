# B 站视频弹幕真实侦察 v1.0

> 记录日期：2026-07-23（Asia/Shanghai）
> 侦察对象：`BV1qZSLBYEpa`
> 运行标识：`bili-danmaku-recon-20260723`
> 结论：**人工流程 proved；生产闭环尚未 admission**

## 本轮只回答的问题

在不依赖已写好的 Collector 扩展、脚本、Gateway 或平台 fixture 的前提下，确认 B 站视频弹幕是否能够通过真实浏览器的三面证据稳定获得：

1. 播放器覆盖层是否有公开可读的弹幕文本；
2. “弹幕列表”是否需要人类操作才能打开；
3. 列表中是否存在可区分的时间、文本和发送时间字段，以及能够覆盖列表的内嵌滚动语义；
4. 弹幕数据由什么类型的 Network/XHR 响应驱动，能否把二进制分段响应直接当作生产 JSON 接口。

## 环境和边界

- 真实 `https://www.bilibili.com/video/BV1qZSLBYEpa/`，可见 headed Chromium，独立临时 Playwright Profile。
- 未加载 Collector 扩展，`existingPlatformRunnerUsed=false`；没有复用产品登录 Profile。
- 页面在弹幕输入区显示登录提示，但本轮没有输入账号、密码、验证码，也没有读取 Cookie、Token、请求头、请求体、query 值或 response body。
- 只做公开只读动作：导航、一次播放/暂停切换、一次打开弹幕列表、一次内嵌列表滚动；没有发送弹幕、点赞、关注、收藏或举报。
- 截图仅保留在临时运行目录，不进入 Git；长期证据使用本文件中的结构化事实。

## 人类流程与视觉证据

页面导航完成后，播放器中已经出现公开弹幕，例如“这看视频多是一件美事啊!”、“这就是大佬的世界吗^_^”和“针不戳!”。播放器下方可见“弹幕显示隐藏”开关；弹幕输入区显示“请先登录或注册”，这只限制发送，不阻止公开弹幕的只读显示。

人类视角的列表流程是：

1. 先看到播放器右侧的“弹幕列表”下拉入口；
2. 真实点击入口后，右侧面板切换为三列列表：`时间`、`弹幕内容`、`发送时间`；
3. 面板使用虚拟长列表。真实鼠标滚轮一次后，列表的 `ul` 保持总高度，但通过 `transform: translate(0px, -720px)` 和 `padding-top: 720px` 替换当前 DOM 行。

这说明生产流程不能只读取播放器覆盖层，也不能把一次 DOM 快照解释为全量弹幕；需要先打开列表，再以预算约束的真实内嵌滚动收集行并去重。

## DOM 事实

### 播放器覆盖层

页面存在一个可见的 `.bpx-player-row-dm-wrap`，其下的单条弹幕元素当前使用：

```text
tag: DIV
class: bili-danmaku-x-dm [bili-danmaku-x-roll] [bili-danmaku-x-show]
role: comment
aria-live: polite
```

已观察到的单条元素没有 `data-*` 稳定 ID，公开文本在叶子节点中；内联 CSS 变量包含字号、颜色、轨道位置和动画时长。`--top` 等样式值是渲染状态，不是可靠的原始视频时间，因此覆盖层只能作为“当前可见采样”证据，不能作为全量存储主来源。

### 弹幕列表

打开列表后，稳定的语义结构为：

```text
.bpx-player-filter-wrap.bpx-player-dm
  .bpx-player-dm-function
    [data-action="stime"]  时间
    [data-action="text"]   弹幕内容
    [data-action="date"]   发送时间
  .bui-long-list-wrap
    ul.bui-long-list-list
      li.bui-long-list-item[data-index="N"]
        .dm-info-time
        .dm-info-dm[data-index="N"]
        .dm-info-date
```

在本次页面状态中，`ul` 的总高度为 `4776px`，单行高度为 `24px`，因此页面公开显示了约 `199` 个列表位置；首次快照只挂载了当前窗口附近的行。首次打开后可读取 28 行，真实滚轮 `720px` 后当前 DOM 行变为 `data-index=30..58`，证明该列表是虚拟化的，必须以 `data-index` 作为稳定去重键，并按内嵌列表位置推进预算。

列表单行可以直接投影为：

```yaml
index: non-negative integer
time: mm:ss or hh:mm:ss text
content: public text
sentAt: public month-day time text
```

本轮没有把“屏蔽用户”“举报”等操作文本当作字段，也没有执行这些操作。

## Network 事实

只记录去 query/hash 后的 route、method、status、MIME 和已公开的大小信息：

| 阶段 | method | route | status | MIME | 大小 | 结论 |
|---|---|---|---:|---|---:|---|
| 导航基线 | GET | `/x/v2/dm/web/view` | 200 | `application/octet-stream` | 1049 bytes | 弹幕元信息/视图响应候选 |
| 导航/播放基线 | GET | `/x/v2/dm/wbi/web/seg.so` | 200 | `application/octet-stream` | 1398 bytes（gzip） | 二进制分段弹幕响应 |
| 播放推进 | GET | `/x/v2/dm/wbi/web/seg.so` | 200 | `application/octet-stream` | gzip，未提供稳定 `content-length` | 新分段候选 |
| 播放推进 | GET | `/x/v2/dm/wbi/web/seg.so` | 200 | `application/octet-stream` | gzip，未提供稳定 `content-length` | 新分段候选 |
| 播放推进 | GET | `/x/v2/dm/wbi/web/seg.so` | 200 | `application/octet-stream` | gzip，未提供稳定 `content-length` | 新分段候选 |

点击打开“弹幕列表”后没有观察到新的专属列表 JSON route；列表内容来自播放器已取得并解码的公开分段数据。由于 `seg.so` 是二进制响应，本轮没有读取 body，也没有把它误报为已拥有可审查的 JSON projector。

## 动作账本

| actionId | 语义动作 | attempted | 次数 | 后置条件 |
|---|---|---:|---:|---|
| `navigate_video` | 打开规范视频 URL | 是 | 1 | 页面标题、播放器和公开弹幕出现 |
| `play_video_once` | 真实点击播放/暂停 | 是 | 1 | 播放器从 `bpx-state-paused` 进入播放态，新的弹幕覆盖层出现，新增 `seg.so` 候选 |
| `open_danmaku_list` | 真实点击 `.bui-dropdown-display` | 是 | 1 | 视觉列表面板出现；DOM 三列标题和 `li[data-index]` 出现 |
| `scroll_danmaku_list_once` | 在列表内部真实滚轮 720px | 是 | 1 | DOM 行变为 `data-index=30..58`，`ul` 的 transform/padding 发生变化 |
| `pause_video_once` | 真实点击播放/暂停停止背景播放 | 是 | 1 | `video.paused=true`，避免侦察会话继续产生无界请求 |

页面曾短暂显示 B 站登录弹窗；使用一次真实关闭动作结束遮罩，没有尝试登录。没有自动重试平台动作。

## 结论与生产含义

### 已证明

- 匿名公开页面可以直接读取当前可见弹幕 DOM；发送门禁不等于读取门禁。
- 真实打开“弹幕列表”后，可以读取带 `data-index` 的时间、文本、发送时间三列。
- 列表是虚拟化内嵌滚动，不是普通页面滚动；行位置必须作为独立的动作和预算记录。
- 弹幕底层 Network 当前为 `application/octet-stream` 分段响应，不能沿用字幕/动态的 JSON response projector 假设。

### 尚未证明

- 没有验证二进制 `seg.so` 的公开解码契约，也没有把其协议写入生产代码。
- 没有验证“查看历史弹幕”在登录/权限/时间范围上的可用性；当前按钮呈 disabled 状态。
- 没有完成从第一行到列表末尾的低频闭环，因此不能宣称全量弹幕覆盖。
- 没有完成 Collector Extension/Gateway 的真实 managed-profile canary；本文件只证明人工可行性。

### MVP 方向

第一版采用 **DOM-first 列表采集**：

1. 导航后等待播放器稳定；
2. 通过可信浏览器输入打开“弹幕列表”；
3. 读取可见 `li.bui-long-list-item`，按 `data-index` 去重；
4. 仅在还有列表空间且预算允许时，对列表容器执行有界真实滚动；
5. 每次滚动后重新读取实时 DOM，记录 `transform/padding` 和新索引；
6. 以 `partial` 终态明确表示预算耗尽、列表未打开、登录/风控或无法确认末尾。

二进制响应只保留去 query 的审计元数据，暂不作为字段来源。待后续独立研究并通过公开字段交叉验证后，再考虑增加受限 binary projector；该升级不能由本次人工成功自动继承。

## 清理

临时 Playwright 会话在本轮证据记录后关闭；`.playwright-cli/` 只作为本地临时运行材料，不提交 Git。产品管理的登录 Collection Profile 和 retained 视频页未被本轮临时会话关闭或劫持。
