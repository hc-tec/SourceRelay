# Collector Core 版本化发布

当前 Core Release anchor 为 `0.7.17`。它不是“随便改几行代码就升级”的内部编号，而是
Contracts、MV3 Extension、Gateway、JS SDK、Python SDK 和控制面兼容性的一组发布身份。

## 生成发布目录

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run package:core-release
```

默认输出到：

```text
poc/runtime/core-release-0.7.17/
├─ release-manifest.json
├─ extension/                         # 用户常用浏览器加载的 MV3 扩展目录
├─ gateway/                           # user-browser Gateway bundle 和启动脚本
│  ├─ dist/user-browser-server.js
│  └─ start-user-browser.ps1
├─ npm/
│  ├─ intelligence-collector-client-0.7.17.tgz
│  ├─ intelligence-collector-contracts-0.7.17.tgz
│  └─ intelligence-collector-gateway-0.7.17.tgz
└─ python/
   └─ intelligence_collector_client-0.7.17-py3-none-any.whl
```

发布脚本会从干净构建产物生成 sha256 文件清单，并且不访问真实平台。

## 验证 SDK 脱离源码安装

```powershell
npm run verify:sdk-release-installation
```

这个门禁会在临时目录中：

- 从 npm tarball 安装 JS SDK；
- 从 Python wheel 安装 Python SDK；
- 检查 `CORE_RELEASE_VERSION`、18 项 direct capability 和 request builder；
- 确认没有从 `D:\AIProject\inteligence\poc` 导入源码；
- 使用真实 Python venv 和 npm 安装流程；
- 不启动浏览器、不访问平台、不伪造平台采集结果。

SDK 的 `readRelease()` 会拒绝与自身兼容锚点不一致的 Gateway release manifest，避免上层
应用静默调用不兼容的 Core。

## 上层应用安装

外部上层应用只能依赖版本化 Python wheel 或 JS tarball。开发期的相邻 checkout editable
安装不再是推荐路径；`D:\AIProject\inteligence-apps\README.md` 已改为使用
`intelligence-collector-client==0.7.17`。

## 升级原则

1. 先生成新版本 release manifest；
2. 对比 Extension runtime build fingerprint、service schema 和协议版本；
3. 先更新 Gateway/SDK，再准备扩展；
4. 用户浏览器中如果已有不同 fingerprint，部署命令返回 `update_required`，不会静默覆盖；
5. 只有显式运行 `npm run update:user-browser-deployment` 才会原子替换扩展目录；
6. 浏览器中的扩展仍由用户在宿主浏览器内刷新，不由 Gateway 关闭或重启用户浏览器。
