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
- 生成 Core 发布目录，并验证 `release-manifest.json`、确定性 CycloneDX SBOM 和
  `sha256sums.json` 的文件集合、字节数与 SHA-256；
- 通过独立的 `npm run verify:core-release-bundle -- --directory <release-directory>`
  重新验证已生成目录，确保发布目录脱离源码也可消费；
- 启动临时 Gateway，读取 `/v2/release`、`/v2/capabilities` 和 `/v2/openapi.json`；
- 确认 release manifest、OpenAPI release anchor 与 18 项 direct-ready capability 一致；
- 确认没有创建 `profiles`、`browser-profiles.json` 或 `browser-host` 等历史 Profile 状态；
- 只访问 loopback，`livePlatformRequests` 始终为 0；
- 退出 Gateway 并删除临时 checkout。

该门禁验证 Core 的可发布边界，不替代 `npm run test:real-local` 的真实 Chromium/MV3/
Native Messaging 集成测试，也不替代需要单独人工身份输入的真实平台 canary。

## GitHub Actions 门禁

`.github/workflows/core-release-candidate.yml` 只在手动触发或推送 `core-v*` 标签时运行，避免
每个普通提交重复构建发布包。它会生成并上传 14 天保留期的 Core release directory，同时
运行 clean checkout、SDK 脱离源码安装、SBOM 和 SHA-256 完整性校验。

普通 push / pull request 使用的 `collector-local-validation.yml` 也把 Windows 真实 Chromium
分层测试和 Ubuntu release-candidate 测试拆成两个并行 job。浏览器集成测试变慢或进入诊断
时，不会阻塞 Core 发布合同、SDK artifact 和 loopback Gateway 的结果。

AgentKit 的 `.github/workflows/released-core-l2.yml` 会 checkout Core `main`，从 Core 的
`package-core-release` 生成发布目录，再让 packaged MCP 连接该目录中的 Gateway entrypoint。
它不会连接 Core 源码 `dist`，也不会访问真实平台；Core 与 AgentKit 的发布锚点不一致时，
AgentKit preflight 会 fail closed。
