# Security policy

Collector Core 只接受影响本地 loopback Gateway、MV3 扩展、配对/鉴权、能力边界、
artifact 去敏或测试隔离的安全报告。

请不要在 issue 或 pull request 中提交 Cookie、密码、Token、二维码、验证码、浏览器
Profile、真实账号标识或平台原始响应。使用最小化、去敏的复现步骤，并先移除凭据和运行材料。

Core 不支持绕过登录、验证码、付费限制、限流或平台安全措施；也不接受新增任意脚本、
任意 selector、任意 tab 控制、CDP 或 Network response body 接口的“修复”。
