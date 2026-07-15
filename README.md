# 中文个人情报能力实验室

这个仓库研究并实现一种“按需调用能力”的个人情报底座：用户临时提出查询需求时，系统选择合适的平台能力、执行搜索或公开正文抽取、验证结果，并由调用者决定是否保存；它不以持续抓取和提前囤积数据为默认目标。

## 当前组成

```text
poc/browserwing/           BrowserWing 中文公开站点与登录 Profile 实验
poc/maxun/                 Maxun B站搜索录制、运行和映射实验
poc/intelligence-gateway/  统一 Capability Runtime 与 Draft Capability Factory
research_*.md              开源项目、中文站点覆盖和架构调研
```

核心 Gateway 当前为 `0.4.0`，已经真实验证：

- B站关键词搜索：Maxun；
- 小红书人工登录后的低频搜索：BrowserWing；
- 全网和 `site:` 外部发现：SearXNG；
- 公开 HTML/text 正文抽取：Trafilatura；
- 未知公开搜索网站：Draft -> inspect -> validate -> recipe -> promote -> execute；
- 百度公开搜索已通过能力生成闭环验证。

详细运行方式、API 和安全边界见 [Intelligence Gateway README](poc/intelligence-gateway/README.md)。真实运行证据见 [Gateway evaluation](poc/intelligence-gateway/evaluation.md)。

## 设计原则

1. 能力级注册，不使用笼统的 `platform_supported=true`；
2. 真实样本验证通过后，Draft 才能晋升为正式 Capability；
3. 登录只能由用户在隔离浏览器中人工完成；
4. 不绕过登录、验证码、安全机制或付费保护；
5. 强登录平台低频、串行，并共享受控 Profile 锁；
6. `persistence=none` 是正式执行模式，临时查询不必写入情报库；
7. fallback 必须显式标记能力降级，外部 `site:` 发现不能冒充平台完整索引。

## 本地状态不进入 Git

根级 `.gitignore` 排除了：

- `.env`、Cookie、Token、证书和密钥；
- BrowserWing Chrome Profile、截图和下载；
- SQLite 数据库、原始抓取结果、日志和 PID；
- Python 虚拟环境、缓存和 Node.js 依赖；
- `poc/maxun/upstream/` 第三方源码 checkout。

Maxun upstream 是运行 POC 时单独获取的第三方源码，不作为本仓库的嵌套 Git 仓库提交。本仓库只保存自己的配置模板、自动化、连接器、测试、公开样本和评估结论。

## Gateway 开发验证

```powershell
cd D:\AIProject\inteligence\poc\intelligence-gateway
.\.venv\Scripts\python.exe -m compileall app tests
.\.venv\Scripts\python.exe -m pytest -q
docker compose config --quiet
```

当前基线：`41 passed`。

## 下一阶段

当前主线是 `0.4.1` 的能力可靠性，而不是增加持续采集量：

1. 给运行时 recipe 增加验证状态、连续失败、漂移告警、禁用和重新验证；
2. 用结构不同的公开搜索站回归 Draft Factory；
3. 增加 `detail_fetch` Draft，把“发现链接”和“读取详情”组合起来；
4. LLM 只负责提出探索候选，不能跳过确定性样本验证门禁。

