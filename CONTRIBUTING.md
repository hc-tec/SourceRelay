# Contributing to Collector Core

所有源码、文档和测试文本使用 UTF-8。修改前先确认目标属于 Collector Core，而不是
仓库外的上层应用。保留无关的工作区变更，不提交 `.env`、运行时材料、Profile、截图、
Token 或凭据。

核心变更建议按以下顺序验证：

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run verify:core-boundaries
npm run verify:core-capability-matrix
npm run test:unit
npm run test:real-local
npm run verify:release-candidate
```

真实平台 canary 不属于 CI；它必须遵循项目内真实网页交互侦察 Skill 和已有的低频、只读、
有预算、有审计流程。新 direct capability 必须同时更新 Registry、Artifact Reader、
OpenAPI、JS SDK、Python SDK，并让跨语言 matrix 门禁通过。
