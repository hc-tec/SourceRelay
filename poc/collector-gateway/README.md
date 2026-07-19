# Collector Gateway

这是浏览器 Collector Core 的本地控制面，不是旧 `intelligence-gateway` 爬虫连接器的延续。它只监听 `127.0.0.1`，负责固定 Gateway 身份、显式扩展配对和后续 Research Task / EvidencePlan 调度；平台登录状态始终留在 Collection Browser Profile。

当前检查点实现：

- 首次启动生成 ECDSA P-256 Gateway 身份，并在本地 `runtime/` 持久保存；
- Gateway identity fingerprint 固定，端口或 Gateway 实例变化后必须重新配对；
- 本地 Console 创建五分钟有效的一次性配对 Session；
- 配对码为八位数字，最多尝试五次，成功后立即失效；
- 扩展 claim 必须来自 `chrome-extension://<extension-id>`，Origin 必须与请求中的扩展 ID 一致；
- Gateway 返回绑定 extension challenge、配对码摘要和 pairing authorization 摘要的 ECDSA P-256 / SHA-256 签名；
- 扩展验证 loopback origin、身份指纹、签名、过期时间和所有 challenge 后才保存配对授权；
- Console、日志和控制页都不显示 pairing authorization；
- 配对扩展使用 extension ID / instance、30 秒 timestamp、nonce、body SHA-256 和 HMAC 对每个 Gateway 请求认证；
- Gateway 给 preflight / dispatch work item 加入两分钟过期时间、nonce 和 P-256 签名；
- Console 可以创建 `scout` Research Task，并逐平台显示扩展回传的 capability preflight；
- Gateway 从内部逻辑 ID 创建并持久化独立的 Collection / Validation Browser Profile，不接受调用方提供磁盘路径；
- Gateway 始终启动可见 Playwright Chromium，自动加载 `collector-extension/dist` 生产 MV3 扩展并打开扩展控制页；
- 每个平台同一时间默认只运行一个 Profile；关闭浏览器只结束进程，不删除 Profile 中由浏览器正常管理的状态；
- B站 `collection + user_managed` Profile 可通过固定产品动作打开官方登录页；调用方不能传入 URL，扫码与验证码始终由用户完成，API 不返回登录页内容；
- B站登录状态核对只在短时官方首页中比较公开可见的账号入口与“登录”入口，返回三态结果和布尔信号，不读取或返回昵称、UID、头像地址、Cookie 或 Token；
- `user_managed` Profile 使用持久账号安全状态：同一 Profile 单 run、动作 at-most-once、60 秒总 deadline、Fetch/XHR 连续失败中止；正常结束、普通失败、断网和超时立即回到 `ready`，验证码/风控/限流/登录失效/中断和用户暂停跨 Gateway 重启锁定并要求固定 acknowledgement 解锁；
- 受管 Profile 启动会关闭浏览器尝试恢复的 HTTP(S) 旧 tab，只保留浏览器原生登录存储与扩展 Control 页；登录页、状态探针、任务页和勘察页都必须来自新的显式动作；
- Console 只显示平台、Profile 类型、逻辑账号标签、扩展加载和配对状态，不显示 Profile 路径、Cookie、Token 或登录内容；
- Research Task 必须为每个平台选择同平台、`user_managed` 的 Collection Profile；Validation Profile 不能绑定正式任务；
- B站匿名 Validation Run 使用短时专用窗口、生产 content script、首屏 20 条上限和 0 次只读交互，保存白名单字段后进入人工 review；
- B站详情 Source Reconnaissance 使用同一个真实、可见 Validation Profile 并行记录 DOM checkpoint、页面生命周期、扩展 validation 状态和去 query/hash 的 XHR/fetch metadata；不读取请求头/体、响应正文、Cookie 或 Token，且记录不能自动准入策略；
- B站认证交互勘察使用用户管理的 Collection Profile，可按 `subtitle / discussion / all` 限定本轮范围，最多执行字幕菜单、中文轨道、评论滚动、最新排序和首个楼中楼五个只读语义动作；每个动作只有三秒 Fetch/XHR/texttrack metadata 差分窗，同时覆盖平台 API、`hdslb.com` CDN 和第三方/未知来源分类；
- 字幕菜单点击必须在 2.5 秒有界窗口内满足菜单后置条件；后置条件不成立时记录 `postcondition_unmet`，依赖它的语言选择记录 `prerequisite_unmet / attempted=false`，不会重试或继续点击；只有当前 scope 的全部必需动作完成，run 才能标为 `completed`；
- 只有显式选择 `schema_only` 时，认证勘察才会对四条精确 B站 API route 和路径含 subtitle 的平台 CDN 响应做内存映射；单响应上限 512 KiB、总上限 1 MiB，JSON 只返回去敏字段路径/类型/数组规模，非 JSON 只返回类型、大小和摘要，原始正文不落盘；
- 认证交互结果原子保存为 ignored runtime artifact；artifact 不保存 Profile ID、原始 URL、原始 response body 或未知 DOM 字段。`GET /v1/reconnaissance/interactions` 只列 compact summary 与 `schemaPathCount`，`GET /v1/reconnaissance/interactions/<record-id>` 才返回完整安全结构投影；
- 运行结果不能自动改策略；只有仓库内显式 live-validation reference 才会让 Gateway 将 accepted 记录标记为 admitted；
- 持久 Profile 启动时核对 Collector Core 运行时版本，必要时通过 `chrome.runtime.reload()` 和 `chrome://extensions` 的 unpacked Reload 恢复最新 MV3 service worker；
- 控制页创建和扩展版本恢复均为 single-flight；失败页立即关闭，启动时合并重复的同扩展 control tabs，不再因扩展暂时不可用反复累积 `chrome-extension://` 页面；
- 只有所有 stage 同时为 `ready + formal` 时才允许用户批准；未 admission 的 `build_ready` 策略会被明确阻断；
- 非最终 stage 完成后任务进入 `waiting_for_user_resume`，扩展轮询不能后台取得下一 stage；Console 的 `/v1/tasks/<task-id>/resume` 只核对既有 approved plan / pending stage / Profile binding，不启动浏览器、不导航，也不能代替 locked Profile 的 manual unlock；没有任何计时冷却；
- dispatch 未收到 receipt 时会重投；扩展按 task / stage 查找现有 lease，避免重复窗口，并回传 `accepted` 或固定 `blocked` error code；
- Collection Profile 可直接发起自动配对、当前平台精确权限申请和显式任务轮询；Chrome 原生权限对话框仍必须由用户确认，配对码不从 Profile API 返回；
- 正式页面结果通过 HMAC `POST /v1/extension/evidence` 回传；Gateway 只重建白名单字段，并核对 extension instance、task / stage / lease、approved strategy、来源 URL 和记录预算；
- 原始 JSON 保存到内部推导的 `runtime/evidence/<task-id>/`，每个 batch 带 canonical result SHA-256、安全元数据和 task manifest；相同 task / stage / result digest 幂等；
- 已完成 stage 的同 digest Evidence 直接返回当前状态，不得覆盖较新的 `stage_active`；Evidence 确认或明确 blocked 后自动关闭 stage 窗口，长期只保留单一 Control 页；
- Gateway 重启时扫描并重新核验 batch JSON 和 digest，只恢复不含实际磁盘路径的 evidence summary；Research Task 队列本身仍不持久化；
- 不读取仓库 `.env`，不接触搜索 API Key、Cookie、Token、密码、二维码或浏览器 Profile。

独立 DevTools 交叉验证可以使用 Google `chrome-devtools-mcp` CLI 的 extension 与 network 工具，自动安装/重载 `collector-extension/dist`、触发 extension action、检查 service worker/Control 页并列出 Fetch/XHR。该工具只用于研究与测试，不是 Collector runtime backend；运行时应使用隔离 Profile、关闭 usage statistics / CrUX，并在输出前去除 query/hash，避免调用会导出 request/response body 的命令。

安装和构建：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-gateway
npm install
npm run setup:browser
npm run verify:build
```

平台集成和端到端测试不得通过 Playwright route 伪造 B站页面、DOM、XHR 或 Gateway 响应。纯状态机、投影器和本地产物逻辑可以使用单元测试；浏览器侧平台能力只接受用户明确授权下的真实网站运行记录。

启动：

```powershell
npm start
```

默认 Console 地址：

```text
http://127.0.0.1:43127
```

可选环境变量：

- `COLLECTOR_GATEWAY_PORT`：1024–65535，默认 `43127`；
- `COLLECTOR_GATEWAY_NAME`：控制页显示名称；
- `COLLECTOR_GATEWAY_STATE_DIR`：身份与配对授权目录，默认当前目录下 `runtime/`。
- `COLLECTOR_EXTENSION_DIRECTORY`：生产扩展制品目录，默认 `../collector-extension/dist`；
- `COLLECTOR_BROWSER_PROXY_SERVER`：整个受管浏览器使用的固定 `http`、`https` 或 `socks5` 代理地址，必须明确包含 host 和 port。

代理配置只接受 server URL，不接受用户名、密码、path、query 或 fragment；系统不读取、管理或轮换代理凭据。Profile 实际目录始终由 Gateway 在 `COLLECTOR_GATEWAY_STATE_DIR/profiles/<logical-profile-id>` 内部推导，API 和 Console 都不接收或返回该路径。它不会启动 Chrome / Edge 日常 Profile，也不会复用 BrowserWing 或旧 POC Profile。

浏览器扩展的 loopback host permission 是 optional，首次配对时由用户显式授予。Chrome match pattern 无法把 host permission 限定到单一端口，因此扩展另外固定并验证 `GatewayPairingRecord.loopbackOrigin`、Gateway 公钥指纹和签名；网页没有 `externally_connectable` 通道，不能绕过扩展控制面下发任务。

任务控制面已经具备认证 preflight、formal-only 批准、单/多 stage Evidence 推进，以及 stage 间无时间等待的显式用户 resume；但当前任务队列只保存在内存中。在加密 Vault 与恢复 schema 建立前，不把研究问题和计划写入普通明文长期文件。Gateway 重启会清空待处理任务，配对身份、pairing authorization、浏览器 Profile 注册表和已完成的原始 Evidence batch 仍保留。当前原子 JSON batch 是本地 raw-first 证据层，不等于未来具备密钥管理、不可变审计、coverage 和删除边界的 Evidence Vault。

即使未来某项策略进入正式能力，dispatch 仍必须携带短时 nonce、过期时间、已批准 EvidencePlan digest 和 Gateway 签名，扩展会在创建 Collection Window 前重新运行 capability preflight。配对成功本身不授予任何平台权限或采集能力。
