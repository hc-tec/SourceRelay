# Core 0.7.17 用户常用浏览器部署

该流程面向用户平时使用的浏览器。Core 不创建生产 Profile，也不接管、关闭或复制用户
浏览器；测试浏览器只属于本地验证流程。

## 构建并准备扩展目录

```powershell
Set-Location D:\AIProject\inteligence\poc
npm ci
npm run prepare:user-browser-deployment
```

首次运行会输出 `state: prepared` 和扩展目录，例如：

```text
C:\Users\<user>\AppData\Local\PersonalIntelligenceCollector\extension
```

在用户常用 Chrome/Edge 中打开扩展管理页面，使用“加载已解压的扩展程序”选择该目录，
然后打开扩展的 `control.html` 完成一次配对。配对码、Gateway identity fingerprint 和
扩展 instance 只在本地控制面使用，不复制 Cookie、密码、Token 或 Profile 数据。

## 启动 Gateway

```powershell
npm run start:user-browser
```

默认只监听 `127.0.0.1:43127`。也可以单独启动已经构建的 bundle：

```powershell
$env:COLLECTOR_GATEWAY_PORT = '43127'
$env:COLLECTOR_USER_BROWSER_HOME = "$env:LOCALAPPDATA\PersonalIntelligenceCollector"
$env:COLLECTOR_USER_BROWSER_STATE_DIR = "$env:COLLECTOR_USER_BROWSER_HOME\gateway"
node .\collector-gateway\dist\user-browser-server.js
```

`npm run check:user-browser -- --require-online` 会检查 Gateway 模式和在线 binding，不会
打开、关闭或导航用户浏览器。

## 升级扩展

`start:user-browser` 会在启动 Gateway 前把当前生产构建同步到受管扩展目录；如果浏览器里的
worker 仍是旧 fingerprint，Gateway 会在 claim 前拒绝任务，worker 随即自行执行
`chrome.runtime.reload()`，不要求用户打开扩展管理页或手动点击 Reload。

单独运行准备命令时，同一 fingerprint 重复准备仍会返回 `already_prepared`。如果目标目录是旧版本，会返回：

```json
{
  "state": "update_required",
  "nextAction": "rerun_with_replace_then_reload_the_extension_in_the_host_browser"
}
```

需要只更新制品而不启动 Gateway 时才显式执行：

```powershell
npm run update:user-browser-deployment
```

随后由已载入的新 worker 自行 reload；Gateway 不会接管、关闭标签页或重启用户浏览器。

## 故障状态

| 状态 | 含义 | 处理 |
| --- | --- | --- |
| `already_prepared` | 目标目录 fingerprint 与当前构建一致 | 保持扩展目录，检查浏览器扩展是否在线 |
| `update_required` | 目标目录是另一 Core 构建 | 明确执行 update 命令后刷新扩展 |
| `user_browser_gateway_mode_mismatch` | 启动到了旧的隔离 Browser Host/legacy Gateway | 停止旧进程，只启动 user-browser bundle |
| `user_browser_gateway_unreachable` | `127.0.0.1:43127` 没有可访问的 user-browser Gateway | 先在另一个终端运行 `npm run start:user-browser`，再重新执行 check |
| `user_browser_gateway_timeout` | Gateway 端口可连接但未在 5 秒内返回状态 | 检查 Gateway 控制台输出、端口占用和本机安全软件拦截 |
| `user_browser_extension_not_online` | Gateway 未看到扩展 binding | 打开宿主浏览器扩展控制页，检查配对和 loopback 权限 |
| `collector_gateway_port_in_use` | loopback 端口已被占用 | 检查占用进程，或显式选择其他 loopback 端口后重新配对 |

所有失败都应该进入明确终态，不自动刷新页面、不自动换 tab、不重放平台动作。
