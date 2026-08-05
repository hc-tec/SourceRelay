# Collector 上层 SDK 与宿主 Gateway 验证记录（2026-08-05）

## 结论

Collector `0.7.17` 的宿主 Gateway 更新和上层 SDK 接入边界均已通过验证：

- 用户宿主 Gateway `http://127.0.0.1:43127` 已从旧目录（18/15）更新到当前构建（21/18）；
- JavaScript SDK 与 Python SDK 都能读取正式 v3 状态、能力目录、OpenAPI、release 和在线浏览器绑定；
- 两套 SDK 都能构造 B 站 typed request，并在本地拒绝不可调度迁移能力；
- JavaScript、Python 两条真实上层链路分别在全新的项目隔离 Chromium/Profile 中完成了一次 B 站公开搜索闭环；
- 没有接管、关闭或重启用户日常浏览器；宿主 Gateway 的 SDK 契约 smoke 没有提交平台任务。

## 宿主 Gateway 契约 smoke

验证目标：当前已运行的 `43127` Gateway，而不是临时 fake 服务。

| 项目 | 结果 |
| --- | --- |
| deployment mode | `user_owned_browser_extension` |
| browser process control | `not_available` |
| 浏览器绑定 | 3，总在线 1 |
| 注册能力 | 21 |
| `direct_ready` | 18 |
| Collector release | `0.7.17` |
| Service schema | `v3` |
| OpenAPI 路由数 | 8 |

JavaScript 和 Python smoke 均只读取 `/v1/status`、`/v2/capabilities`、`/v2/openapi.json`、
`/v2/release`、`/v2/collector-service/browser-bindings`，并在 SDK 本地构造一次
`bilibili.native_search` request。对 `xiaohongshu.current_page.network_metadata` 的
`collect` 调用在 SDK 输入校验层被拒绝，未发送 POST。

## 隔离真实平台 canary

使用项目现有的 live-canary harness，每个 scope 都创建全新的临时 Gateway、MV3 扩展
和 headed Chromium/Profile；测试结束后确认没有残留 canary 进程。平台动作仅为一次低频、
只读的公开 B 站搜索，不执行点赞、关注、评论、收藏、发布或删除。

| scope | 结果 | 证据 |
| --- | --- | --- |
| `javascript_sdk` | 1 passed（约 39 秒） | typed JS builder → Gateway → MV3 → B 站搜索 → artifact |
| `python_sdk` | 1 passed（约 38 秒） | typed Python builder → Gateway → MV3 → B 站搜索 → artifact |

本段使用隔离 Profile，不使用宿主 Gateway 的用户 binding，不保存 Cookie、Token、Profile、
截图、Network 正文或原始平台响应。

## 回归测试

```text
collector-client JavaScript SDK: 14 passed
collector-python-client SDK:     24 passed
collector-python-sdk-smoke app:   7 passed
collector-gateway-testbench:     20 passed
```

当前工作区只保留用户原有的 `AGENTS.md` 未提交修改；本验证没有修改它，也没有生成需要
纳入 Git 的临时测试产物。

## 下一步边界

上层 SDK 到 Collector 的正式入口已经具备可用证据。后续新增平台能力时，应继续保持：

1. 宿主 Gateway 只做无平台动作的契约 smoke；
2. 真实平台动作只在项目管理的隔离 Profile live canary 中验证；
3. 上层应用只使用 SDK typed builder，不复制 `/v2` wire-level 协议；
4. 只有新的真实证据通过后，才登记新的 `direct_ready` 能力。
