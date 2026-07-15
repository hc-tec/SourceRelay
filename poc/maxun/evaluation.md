# Maxun 中文信息源 POC 评估

> 状态：实测进行中  
> 评估日期：2026-07-15  
> 对照基线：`poc/browserwing/evaluation.md`

## 1. 评估目标

本轮不把 Maxun 当作“现成的中文社媒搜索器”，而是验证它能否把人工网页操作录制成可重复执行的 Robot，并通过 REST API 暴露结构化结果。与 BrowserWing 使用同一组任务：

- B站关键词搜索：`DeepSeek`、`低空经济`、`个人知识库`；
- 小红书登录后关键词搜索：仅由用户在隔离浏览器内人工登录；
- 记录字段选择、翻页、运行耗时、重复成功率与 API 输出；
- 特别检查登录态是否能从录制阶段带到 Robot 运行阶段，以及能否跨服务重启保存。

## 2. 固定版本与许可证

- 官方仓库分支：`develop`；
- 固定 commit：`a078b9fea787ad0be4e834c95f612c7a2d16c480`；
- commit 时间：`2026-07-15T13:58:36+05:30`；
- 前端包版本：`0.0.43`；
- 许可证：GNU AGPL-3.0。

AGPL-3.0 是标准开源许可证，但如果修改后的 Maxun 通过网络向用户提供服务，通常需要向这些用户提供对应源代码。它不是可直接忽略义务的宽松商业许可证；正式采用前应由法务结合部署和修改方式确认义务。

## 3. 自托管部署核验

官方两套部署材料目前并不完全一致：

- 根目录 `docker-compose.yml` 定义 PostgreSQL、MinIO、backend、frontend 和独立 browser，但没有 Redis；
- `docs/self-hosting-docker.md` 定义 PostgreSQL、Redis、MinIO、backend 和 frontend，但没有独立 browser；
- 当前 backend 源码同时使用 PostgreSQL、Redis/Graphile Worker、MinIO 客户端和 browser health/WebSocket，因此不能机械照抄其中任意一份就认定依赖完整。

本 POC 使用独立的 `maxun-poc` Compose 项目、全新命名卷和仅绑定 `127.0.0.1` 的端口。MinIO 被放入可选 `storage` profile：首次只验证网页录制、JSON 结果和 API；截图、二进制结果或文档上传再补 MinIO。

## 4. 从源码确认的能力边界

### 4.1 确实存在正式 REST API

Maxun 不只是一个 GUI。backend 的 `/api` 路由使用 `x-api-key` 鉴权，并提供：

- `GET /api/robots`：列出 Robot；
- `GET /api/robots/:id`：读取单个 Robot；
- `GET /api/robots/:id/runs`：列出运行；
- `GET /api/robots/:id/runs/:runId`：读取单次运行；
- `POST /api/robots/:id/runs`：触发运行；
- `POST /api/robots/:id/duplicate`：复制 Robot。

这部分与“网页行为变接口”的目标直接匹配，后续实测将验证返回数据是否足够稳定、是否真正包含采集结果，而不只验证 HTTP 200。

### 4.2 登录态持久化存在明显结构性风险

当前独立 browser 服务使用 `chromium.launchServer({ headless: true })`，backend 每次为 RemoteBrowser 调用 `browser.newContext(contextOptions)`。在已检索的 browser-management 代码中没有发现 `launchPersistentContext`、`userDataDir` 或 `storageState` 的读取/保存。

这意味着：

- 录制会话内的登录态可以暂时存在；
- 新建 Robot run 时通常会得到新的 BrowserContext；
- 登录 Cookie 很可能不会自动从录制阶段带入正式运行，更不会天然跨 backend/browser 重启；
- 若把账号密码或验证码步骤直接录进工作流，会引入凭据泄露和不可重复问题，本 POC 不采用这种做法。

因此，对 B站公开搜索而言 Maxun 仍可能成立；对小红书、公众号后台式页面等强登录来源，即使“录制时能打开”，也不能据此判定可生产运行。必须分别验证录制内登录、录制后首次运行、第二次运行和重启后运行。

## 5. 实测记录

### 5.1 环境与服务健康

- PostgreSQL 17.7：healthy；使用全新 `maxun-poc_postgres_data` 卷；
- Redis 7 Alpine：healthy；Graphile Worker 正常启动并领取任务；
- Maxun browser：`/health` 返回 healthy，独立 Playwright WebSocket 可连接；
- backend：数据库连接、自动 sync、Graphile Worker 和 schedule worker 均启动；
- frontend：Vite 6.4.3 正常提供中文 UI；
- MinIO：未启动时 backend 记录 `getaddrinfo ENOTFOUND minio`，但服务继续监听，账号、Robot、run 与 JSON 列表输出均可用。

部署时还修正了两个容易混淆的问题：

- 当前机器的 `127.0.0.1:8081` 被 Codex 自身占用，因此 POC 改用 `127.0.0.1:18081`，没有终止占用进程；
- 前端从 `127.0.0.1:5173` 打开时，backend 的 `PUBLIC_URL` 也必须使用同一 Origin，否则 CORS 会阻断 Recorder 创建请求；backend worker 自连则必须使用容器内 `http://localhost:8080`，不能误用宿主机映射端口。

本地 POC 用户注册、JWT Cookie、API Key 生成、`GET /auth/current-user` 和 `GET /api/robots` 均通过。账号密码、Cookie 和 API Key 只保存于被忽略目录，没有写入报告或终端输出。

### 5.2 B站关键词 Robot

#### 5.2.1 Recorder 能识别中文动态列表，但点击位置影响很大

Maxun 的远程 DOM Recorder 成功加载 B站 `DeepSeek` 搜索页，录制时识别出 42 个 `.bili-video-card`。第一次从卡片图片区域开始“捕获列表”，Maxun 自动生成 6 个字段并能运行 30 行，但字段只是封面、稍后再看、播放量、弹幕数和时长；视频 URL 在正式 run 中为空，标题和作者也缺失。

这不是“运行失败”，而是更值得警惕的“结构化成功但语义选错”。同一个页面上，操作员点在图片区还是标题区，会决定 Maxun 认为的重复列表边界。

第二次从视频标题元素开始捕获，自动得到以下 6 个字段：

- 视频 URL；
- 标题；
- 标题中的命中词；
- 作者主页 URL；
- 作者；
- 发布日期文本。

字段名默认仍是 `Label 1` 到 `Label 6`，必须在工作流编辑或下游 Adapter 中重命名。

#### 5.2.2 REST API 连续运行结果

标题列表 Robot：`bilibili-deepseek-titles-poc`。API 每次同步等待 run 完成后返回结构化结果。

| 运行 | HTTP / run 状态 | 行数 | 非空标题 | 非空作者 | 规范视频 URL | 耗时 |
|---|---|---:|---:|---:|---:|---:|
| 1 | 200 / success | 30 | 30 | 30 | 28 | 10.075 秒 |
| 2 | 200 / success | 30 | 30 | 30 | 30 | 10.080 秒 |
| 3 | 200 / success | 30 | 30 | 30 | 28 | 10.084 秒 |

三次均成功，平均约 10.080 秒。规范 URL 不是固定 30/30，因为 B站会混入推广卡片；推广项可能返回 `cm.bilibili.com` 的超长追踪 URL，必须过滤。归一化样本只保留 `https://www.bilibili.com/video/`，并去掉查询参数。

在同时并行触发两次 run 时，两次都约 10.08 秒成功，说明本 POC 的“每用户两个 run browser”并发路径可用。

#### 5.2.3 同模板换关键词

`POST /api/robots/:id/runs` 目前只接收输出格式等选项，并不接受 `originUrl` 参数；`GET /api/robots` 却为 Robot 声明了一个 `originUrl` input parameter，而且录制 Robot 的默认值还可能错误显示为 `about:blank`。这是 API 描述与实际 run 能力不一致。

可用替代方案是 `POST /api/robots/:id/duplicate` 传 `targetUrl`，复制同结构 Robot：

| 关键词 | duplicate / run | 行数 | 非空标题 | 规范视频 URL | 耗时 |
|---|---|---:|---:|---:|---:|
| 低空经济 | 201 / 200 success | 30 | 30 | 27 | 10.160 秒 |
| 个人知识库 | 201 / 200 success | 30 | 30 | 23 | 10.161 秒 |

这证明同结构模板可复用，但调用模型更接近“每个目标 URL 复制一个 Robot”，不是真正的单 Robot 参数化搜索。

#### 5.2.4 重启恢复

重启 backend 和独立 browser 后，数据库中的 Robot 无需重新录制；`DeepSeek` Robot 再次通过 API 返回 30 行，状态 success，耗时 10.055 秒。公开网页 Robot 的工作流持久化通过。

相关样本：

- `samples/maxun-bilibili-deepseek-titles-run-summary.json`；
- `samples/maxun-bilibili-deepseek-titles-normalized.json`；
- `samples/maxun-bilibili-low-altitude-economy.json`；
- `samples/maxun-bilibili-personal-knowledge-base.json`。

### 5.3 小红书登录搜索 Robot

匿名访问 `DeepSeek` 搜索路由时，Maxun 最终进入：

`/search_result/?keyword=DeepSeek&source=web_search_result_notes&type=51`

DOM 明确显示“登录后查看搜索结果”，提供小红书/微信扫码和手机号登录；`section.note-item` 数量为 0。脚本没有强制点击遮罩、没有保存登录二维码截图，也没有尝试绕过登录门槛。

Recorder 的 DOM 串流在一次匿名重试中停在 `Loading 100%` 空白页，随后以直接搜索路由重试才稳定取得登录页 DOM。这说明 Maxun 的远程 DOM 镜像本身也需要健康检查，不能仅凭加载进度 100% 判定页面可操作。

人工登录后的搜索录制尚待用户在可见的隔离 Recorder 中完成。不过源码已经暴露出生产运行的关键风险：独立 browser 使用 `chromium.launchServer({ headless: true })`，每个 RemoteBrowser 都通过 `browser.newContext()` 创建临时上下文；没有发现 `storageState`、`userDataDir` 或 `launchPersistentContext`。`recording_meta.isLogin` 只被保存为元数据，在已检索的解释执行路径中没有发现它会恢复 Cookie。

因此后续登录测试必须把以下结果拆开：

1. 人工登录的录制会话里能否看到搜索结果；
2. 保存后的第一次正式 Robot run 能否看到结果；
3. 第二次 run 是否仍可用；
4. backend/browser 重启后是否仍可用。

只通过第 1 项，不能判定 Maxun 适合小红书长期采集。

## 6. 与 BrowserWing 的阶段性比较

| 维度 | BrowserWing 已实测 | Maxun 当前证据 |
|---|---|---|
| 定位 | CLI/HTTP 驱动浏览器动作，自定义 Adapter 需要写脚本 | GUI 录制 Robot，并内建 API Key REST API |
| B站公开搜索 | 3 个关键词通过；`DeepSeek` 连续 3/3，约 6.2–6.7 秒 | 3 个关键词通过；`DeepSeek` API 连续 3/3，平均约 10.08 秒；原生 API 与并发 run 可用 |
| 小红书关键词发现 | 人工登录后自定义 Adapter 3/3；可跨 BrowserWing/Chrome 重启保存登录态 | 录制会话待实测；源码未发现 BrowserContext 登录态持久化 |
| API 化 | 可通过 CLI/服务命令封装，但本轮 Adapter 自己定义 JSON | 原生 `/api/robots` 与 runs API，接口产品化更完整 |
| 选择器/流程维护 | 代码显式、便于版本控制和定向修补 | 录制直观，但点击图片区会语义选错；字段默认 `Label 1..6`，仍需人工校对和下游归一化 |
| 部署复杂度 | 单个本地包加 Chrome profile | PostgreSQL、Redis、browser、backend、frontend；MinIO 按输出类型可选 |
| 许可证 | 见 BrowserWing 单独报告 | AGPL-3.0，网络服务修改分发义务需评估 |

## 7. 当前结论

Maxun 的价值点已经得到实测确认：它比 CLI-Anything 更接近“把网页操作直接做成带运行记录和 REST API 的产品”。B站公开搜索已经形成完整闭环，原生 Robot/run API、并发和重启恢复都可用。

但它并没有消除中文社媒最难的问题。Recorder 可能结构化成功却选错语义边界；API run 不直接接受网页入口参数；推广卡过滤和字段重命名仍要写 Adapter；登录态源码路径明显弱于 BrowserWing 的持久 Chrome profile。

阶段性判断：

- 对公开、结构稳定的网页列表，Maxun 比 BrowserWing 更像完整产品，尤其适合非开发人员先录制，再由工程人员固化字段和 API；
- 对 B站这类公开搜索，Maxun 有实际用处，但速度稍慢，且仍需过滤推广项；
- 对小红书这类强登录平台，当前不能因为 Recorder 能显示登录页就判定可用；正式 run 的登录态复用仍是 go/no-go 项；
- 对“万物皆接口”，Maxun 可以作为获取层的一种可视化生产工具，但不能替代平台 Adapter、登录态管理、质量校验和合规治理。
