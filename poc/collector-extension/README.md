# Personal Intelligence Collector Extension

这是正式产品运行在**用户自己长期使用的 Chrome / Edge** 里的 MV3 扩展。浏览器本身继续管理登录状态；Collector 不创建、复制、定位或读取浏览器登录目录，也不导出 Cookie、密码、Token、网页 Storage 或浏览历史。

正式运行链路是：

```text
用户日常 Chrome / Edge（已有登录状态）
  -> 已安装的 Collector MV3 extension
  -> 已配对的 127.0.0.1 Local Collector Gateway
  -> 上层本地应用的 scoped API token
```

扩展不是传统爬虫代理。Gateway 不能传入任意 URL、selector、JavaScript、坐标、CDP 指令或 Network response body；扩展只执行已登记、短时、签名、一次性的只读 work item。

## 当前正式 direct-mode 能力

- `bilibili.video_detail`：一次规范 BV 详情页导航，固定的公开首屏 DOM 投影；
- `bilibili.native_search`：只接收关键词，固定为综合 / 相关性 / 第 1 页，只投影人眼可见的规范 BV 视频卡。

两条能力都只使用扩展自己创建且可证明归属的工作标签页。成功后的标签页保持 `idle_reusable`；用户关闭、移动、导航或接管它时，当前任务停止，绝不自动重开、刷新或重放平台操作。普通用户标签页不会被枚举、复用或接管。

扩展不绕过验证码、风控、限流、登录或付费限制，也不执行点赞、关注、收藏、评论、私信、发布或删除。

## 正式安装与配对

请按项目运行手册操作：

- [日常浏览器扩展模式：安装、配对与本地 API](../../docs/runbooks/user-owned-browser-extension.md)
- [用户自有浏览器扩展模式设计](../../docs/design/user-owned-browser-extension-mode.md)

简要地说：

1. 在 `poc` 运行 `npm run prepare:user-browser-deployment`；
2. 在用户日常 Chrome/Edge 的扩展管理页中手动“加载已解压的扩展”，选择命令打印的稳定目录；
3. 运行 `npm run start:user-browser`；
4. 打开 `http://127.0.0.1:43127`，创建一次性配对码并填入扩展控制页；
5. 由 Console 创建最小权限本地 API token，供上层应用调用 `/v2` service。

浏览器可见的安装、扩展权限确认和扩展更新 reload 必须由用户完成；Collector 不会静默安装或控制日常浏览器。

## 权限与数据边界

Manifest 当前版本为 `0.7.17`。它不申请 `cookies`、`debugger`、`downloads`、`webRequest`、`webRequestBlocking` 或 `<all_urls>`。

loopback host permission 是首次配对时由浏览器显示、用户批准的 optional permission。扩展还会验证精确 loopback origin、Gateway P-256 身份指纹、签名、短时 nonce 与 HMAC 请求认证；网页没有 `externally_connectable` 通道可以绕过控制面。

配对记录只保存在扩展自身受限 storage。Gateway 侧只保留去敏的 `browserBindingId + extensionId + extensionInstanceId` 与安全状态；没有浏览器路径、账号凭据、Cookie 或 tab ID。

## 构建与验证

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run build:extension
npm run verify:artifacts --workspace @intelligence/collector-extension
npm run verify:extension-load --workspace @intelligence/collector-extension
```

本地构建验证只检查 production bundle、MV3 worker、控制页与制品边界，不访问平台页面。真实平台能力的开发或变更必须先遵循 [真实网页交互侦察](../../skills/recon-live-web-interactions/SKILL.md)：以可见浏览器、视觉、DOM、可信浏览器输入和 Network 证据证明人类流程，再修改能力实现。

旧 Browser Host、隔离 Chromium 和受管账号策略只属于 `test/isolated-account` 测试通道。它们不是扩展在用户日常浏览器中的正式运行依赖，也不能作为 direct-mode API 的 fallback。
