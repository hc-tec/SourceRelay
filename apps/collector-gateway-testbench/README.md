# Collector Gateway Testbench

一个独立的、loopback-only 的本地测试应用。它把自己当作未来 Deep Research、分析服务、桌面应用或 CLI 的代表消费者：只调用正式的 user-owned-browser `/v2` API，绝不导入 Gateway 内部模块。

```text
浏览器中的已配对 MV3 扩展
  ↕ 受认证的 loopback work protocol
Collector Gateway :43127
  ↕ scoped Local API token（只在 Testbench Node 进程）
Collector Gateway Testbench :43128
  ↕ 同源浏览器 UI（永远拿不到 token）
本地测试人员
```

## 当前用途

- 读取 Gateway 与在线 `browserBindingId`；
- 从 Gateway 读取全部 12 项 B站既有能力的 direct-mode 登记状态；
- 投递一个 `bilibili.video_detail` 测试（输入仅为 BVID）；
- 投递一个 `bilibili.native_search` 测试（输入仅为关键词）；
- 投递一个 `bilibili.native_search_batch` 测试（输入仅为关键词；Gateway 固定派生综合相关性第 1、2 页，调用方不能传 URL、页码、排序或点击指令）；
- 投递一个 `bilibili.account_profile` 测试（输入仅为 UP 主 MID）；
- 投递一个 `bilibili.account_inventory` 测试（输入仅为 UP 主 MID，固定投稿视频首屏）；
- 读取同一测试台提交过的 operation，并从该 operation 推导固定 artifact retrieval path；
- 显示真实 Gateway 返回的 operation 与 artifact。

它不是通用爬虫控制台，也不是 Browser Profile 管理器：没有任意 URL、selector、脚本、CDP、鼠标坐标、网络响应体、Cookie、浏览器 Storage 或 Profile 接口。

能力登记册会显示 `direct_ready`、`direct_canary_pending`、`direct_migration_required` 与 `trusted_interaction_migration_required`。`direct_canary_pending` 表示签名 work item、扩展执行器与 artifact 已完成，正等待该 Testbench 的第一次真实只读闭环；它不会被误报为已验证。后两种状态说明仓库存在对应旧实现或研究成果，但它们**没有**被偷渡成日常浏览器的 Browser Host fallback。

## 启动

先保证 direct Gateway 与已配对扩展在线：

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run check:user-browser -- --require-online
```

然后在 Gateway Console 的“其他本地应用的服务访问”中创建一个新的 Local API Client。只授予下面四个 scope：

- `browser-bindings:read`
- `collect:execute`
- `operations:read`
- `artifacts:read`

不要勾选旧隔离 Browser Host 才需要的 `profiles:read`。token 只显示一次；不要把它写入 Git、日志、请求 URL、截图或聊天记录。

在同一个 PowerShell 会话中启动测试台：

```powershell
Set-Location D:\AIProject\inteligence\apps\collector-gateway-testbench
$env:COLLECTOR_SERVICE_TOKEN = 'cst_...'
npm start
```

它默认监听 `http://127.0.0.1:43128`，不会自动打开标签页。手动打开该地址后，先点“刷新本地状态”，确认 online binding，再显式提交一次测试。

可选环境变量：

```powershell
$env:COLLECTOR_SERVICE_ORIGIN = 'http://127.0.0.1:43127'
$env:COLLECTOR_TESTBENCH_PORT = '43128'
```

二者都只接受精确的 `127.0.0.1` HTTP origin / 端口。测试台不读取仓库根目录 `.env`，也不把 token 持久化到磁盘。

## 真实测试语义

一次提交只会向 Gateway 发起一个 `POST /v2/collect`。大多数 direct capability 最多执行一次已签名的平台导航；`bilibili.native_search_batch` 是唯一例外，但也只能按签名顺序执行固定第 1、2 页，最多两次导航、零 DOM 语义动作、零 response body，并在第 1 页为空、风险、用户接管、页面身份漂移、网络结果未知或任务过期时停止，不会进入第 2 页。Gateway 与扩展仍负责 at-most-once claim、工作项过期、账号安全锁与任务终态。Testbench 的自动轮询仅是读取本机 operation，最多 25 次；它不会在失败、超时、验证码、风控或登录失效后重新投递任务。

每次 operation / artifact 读取都必须来自本 Testbench 当前进程已经提交并记住的 `operationId`。浏览器页面不能传任意 Gateway path，也不能把 token 带到前端。

## 验证命令

```powershell
Set-Location D:\AIProject\inteligence\apps\collector-gateway-testbench
npm run check
npm run smoke:gateway
```

`npm run check` 只测试纯输入映射、loopback 配置与 artifact 路径边界；不使用 fake Gateway 或 fake 平台页面。`npm run smoke:gateway` 读取当前真实 Gateway 的 `/v1/status` 与 `/v2/openapi.json`，不需要 token、不会触发扩展任务或平台导航。

真正的端到端验证必须从这个 UI 显式提交一个低频、只读任务，并以 Gateway 返回的真实 terminal operation 和 artifact 为证据。
