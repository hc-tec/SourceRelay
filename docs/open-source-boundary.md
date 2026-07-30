# Collector Core 开源边界

本仓库的可发布产品是 Collector Core，而不是研究平台或知识分析产品。

## 发布范围

纳入 Core 发布范围的只有：

- `poc/collector-contracts`：版本化 wire contracts 和 release manifest；
- `poc/collector-extension`：用户常用浏览器中的 MV3 扩展；
- `poc/collector-gateway`：loopback Local Collector Gateway、配对、鉴权、operation、artifact 和审计；
- `poc/collector-browser-host`：只用于本地真实 Chromium/MV3/Native Messaging 生命周期验证；
- `poc/collector-client` 和 `poc/collector-python-client`：上层应用使用的 SDK；
- `poc/scripts` 中与边界、构建、发布候选和本地验证直接相关的门禁。

## 明确排除

`poc/browserwing`、`poc/maxun`、`poc/intelligence-gateway` 和
`poc/deepresearch-gateway` 是历史研究或适配材料。它们保留在当前仓库只是为了保留
调研证据，不能被 Core runtime、Gateway Registry、SDK 或 CI 作为导入、依赖或 fallback。
`apps/` 只保留本地 smoke/开发验证；知识包、跨平台汇总、媒体处理、OCR/ASR、
DeepResearch、CLI 和研究控制台应在仓库外单独维护，通过版本化 API/SDK 消费 Core。

`npm run verify:core-boundaries` 检查反向导入，`npm run verify:core-capability-matrix`
检查能力登记一致性，`npm run verify:release-candidate` 在干净 checkout 中确认这些边界
能够从锁文件重建、构建并启动。

## 浏览器所有权

生产模式只连接用户已经在使用的浏览器扩展，不创建或管理生产 Profile，不读取或导出
Cookie/密码/Token，不暴露任意 URL、selector、脚本、tab、CDP 或 Network body 接口。
测试可以使用临时 Profile 和真实 Chromium，但测试 Profile 不属于产品部署，也不能成为
上层应用可调用的运行时能力。

## 贡献与发布原则

新能力必须先有真实网页侦察证据、明确输入/执行目标/预算/产物契约，再同时登记
Gateway Registry、Artifact Reader、OpenAPI、JS SDK 和 Python SDK；一致性门禁失败时
不能合并。任何上层业务编排应放在外部项目，不通过“顺手加入 Core”解决。
