# B站账号与合集 direct live canary（2026-08-05）

## 结论

当前 `0.7.17`、MV3 build fingerprint `f8aa62d588b15a9cd3e5175a470f9c448e47e1c495ef5176c4734dbf76c5ab78` 在一个全新、项目管理的隔离可见 Chromium 会话中，完成了以下四项 user-owned-browser `/v2/collect` 能力：

```text
bilibili.account_profile
bilibili.account_inventory
bilibili.collection_series.overview
bilibili.collection_series.detail
```

四个 operation 均为 `completed`，没有平台动作重试。投稿首屏返回 40 条投影，合集概览返回 9 个公开列表；详情 ID 由概览结果选择为合法 `season` `333822`，没有由调用方拼接任意 URL。四个规范导航目标各出现一次：

```text
https://space.bilibili.com/7481602
https://space.bilibili.com/7481602/upload/video
https://space.bilibili.com/7481602/lists
https://space.bilibili.com/7481602/lists/333822
```

## 执行边界

- 使用 `testing/canary/verify-bilibili-account-series-live.mjs`；该脚本不属于默认本地测试套件。
- 使用独立临时 Gateway、独立隔离 Chromium 和生产 MV3 扩展，不接管用户日常浏览器。
- 只读取公开页面；不导出 Cookie、Storage、密码、登录 Token、请求头或原始响应正文。
- Gateway 只保留有界 artifact；测试结束删除临时状态目录和浏览器会话。
- 这只是当前构建的真实可行性证据，不把任一样本自动升级为策略 admission；能力仍受现有 catalog 的 `browserHostFallback: forbidden` 和有界投影约束。

## 手动执行

```powershell
Set-Location D:\AIProject\inteligence\poc
node testing/canary/verify-bilibili-account-series-live.mjs
```

该命令不会被 CI 或 `npm run verify:collector` 自动调用，避免任何平台动作在无人值守环境中发生。
