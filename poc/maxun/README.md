# Maxun 中文信息源 POC

本目录用于将 Maxun 与 BrowserWing 放在同一组中文信息源任务下比较。

## 安全边界

- 所有端口仅绑定 `127.0.0.1`。
- 随机密钥和本地 POC 账号只保存在被忽略的 `.env`。
- `MAXUN_TELEMETRY=false`。
- 不把密码、Cookie、Token、二维码或登录截图写入报告。
- Docker 项目名称固定为 `maxun-poc`，不会复用其他项目容器和数据卷。

## 启动与停止

```powershell
./scripts/start-image-pull.ps1
./scripts/start.ps1
./scripts/status.ps1
./scripts/stop.ps1
```

前端：`http://127.0.0.1:5173`  
后端：`http://127.0.0.1:18081`  
浏览器健康检查：`http://127.0.0.1:3002/health`

`upstream/` 固定保存本轮核验的 Maxun 官方源码浅克隆；POC 自己的 Compose 同时定义 PostgreSQL、Redis、MinIO、独立浏览器、后端和前端，用来补齐官方两个部署示例彼此缺失的服务。MinIO 被放在可选的 `storage` profile 中，默认不启动；首轮录制和结构化输出不依赖它，截图、二进制产物或文档上传需要时再启用。

当前环境已经缓存 PostgreSQL 17.7 和 Redis 7 Alpine。POC 只复用镜像层，不复用任何既有容器、网络或数据卷；PostgreSQL 镜像被重新标记为 `maxun-poc/postgres:17.7`，并使用全新的 `maxun-poc` 命名卷。
