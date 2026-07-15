# BrowserWing 中文信息源 POC

本目录用于验证 BrowserWing 对中文公开信息源的真实能力，不保存密码、Cookie、Token、二维码或其他账号凭据。

## 当前验证范围

- 无登录公开来源：B站热门、知乎热榜、微博热搜、今日头条、36氪等。
- 关键词搜索：知乎、微博、小红书；需要登录的平台只由用户在本地浏览器中人工登录。
- 评价维度：结果数量、字段完整度、连续成功率、耗时、登录依赖、分页能力和选择器脆弱性。

## 本地运行

```powershell
npm install
./scripts/start.ps1
```

服务默认监听 `http://127.0.0.1:8080`。另开终端可运行：

```powershell
npm run list
npm run browserwing -- run bilibili-hot
```

停止后台服务：

```powershell
./scripts/stop.ps1
```

## 已完成的自动化测试

运行五个公开来源各 3 次：

```powershell
./scripts/run-public-benchmark.ps1 -Iterations 3
```

运行不依赖 LLM 的 B站关键词搜索：

```powershell
./scripts/run-bilibili-search.ps1 -Keyword "DeepSeek" -Limit 30
```

在用户已通过隔离 Profile 人工登录后运行小红书搜索：

```powershell
./scripts/run-xiaohongshu-search.ps1 -Keyword "DeepSeek" -Limit 30
```

第一轮实测结果见 [evaluation.md](evaluation.md)。

## 人工登录准备

需要验证登录平台时，由用户在隔离的可见 Chrome 窗口中亲自登录：

```powershell
./scripts/start-login-session.ps1 -Platform xiaohongshu
./scripts/start-login-session.ps1 -Platform zhihu
./scripts/start-login-session.ps1 -Platform weibo
```

不要把密码、Cookie、Token、验证码或二维码复制到终端和聊天中。

## 数据安全

- `runtime/`、`cookies/`、`profiles/` 和 `.env` 已被忽略。
- 原始结果若可能包含账号或会话信息，应放入 `samples/raw/`，不要提交。
- 报告只保留公开内容样本、脱敏错误和能力结论。
