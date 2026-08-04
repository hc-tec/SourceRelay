# Collector Core Release Candidate 验证

Collector Core 的发布候选验证必须在干净 checkout 中执行，不能依赖当前工作区的
`node_modules`、兄弟仓库源码、用户常用浏览器 Profile 或真实平台请求。

从 `poc` 目录运行：

```powershell
npm run verify:release-candidate
```

验证脚本会：

- 从当前 Git 分支创建临时干净 checkout；
- 执行 `npm ci`，确认 workspace 可以从锁文件重建；
- 执行 Core import boundary 与跨语言 capability matrix 门禁；
- 构建 Contracts、MV3 Extension 和 user-browser Gateway；
- 将扩展准备到临时 `COLLECTOR_USER_BROWSER_HOME`；
- 启动临时 Gateway，读取 `/v2/release`、`/v2/capabilities` 和 `/v2/openapi.json`；
- 确认 release manifest、OpenAPI release anchor 与 18 项 direct-ready capability 一致；
- 确认没有创建 `profiles`、`browser-profiles.json` 或 `browser-host` 等历史 Profile 状态；
- 只访问 loopback，`livePlatformRequests` 始终为 0；
- 退出 Gateway 并删除临时 checkout。

该门禁验证 Core 的可发布边界，不替代 `npm run test:real-local` 的真实 Chromium/MV3/
Native Messaging 集成测试，也不替代需要单独人工身份输入的真实平台 canary。
