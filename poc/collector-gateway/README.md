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
- Console 只显示平台、Profile 类型、逻辑账号标签、扩展加载和配对状态，不显示 Profile 路径、Cookie、Token 或登录内容；
- Research Task 必须为每个平台选择同平台、`user_managed` 的 Collection Profile；Validation Profile 不能绑定正式任务；
- 只有所有 stage 同时为 `ready + formal` 时才允许用户批准；当前 `build_ready` 策略会被明确阻断；
- dispatch 未收到 receipt 时会重投；扩展按 task / stage 查找现有 lease，避免重复窗口，并回传 `accepted` 或固定 `blocked` error code；
- 不读取仓库 `.env`，不接触搜索 API Key、Cookie、Token、密码、二维码或浏览器 Profile。

安装和构建：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-gateway
npm install
npm run setup:browser
npm run verify:build
```

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

任务控制面已经具备认证 preflight 队列和 formal-only 批准门槛，但当前任务队列只保存在内存中；在加密 Vault 与恢复 schema 建立前，不把研究问题和计划写入普通明文长期文件。Gateway 重启会清空待处理任务，配对身份、pairing authorization 和浏览器 Profile 注册表仍保留。浏览器 Profile 只承担浏览器原生状态，不代替未来的 Evidence Vault。

即使未来某项策略进入正式能力，dispatch 仍必须携带短时 nonce、过期时间、已批准 EvidencePlan digest 和 Gateway 签名，扩展会在创建 Collection Window 前重新运行 capability preflight。配对成功本身不授予任何平台权限或采集能力。
