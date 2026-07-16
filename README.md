# 中文个人情报能力实验室

这个仓库研究并实现一种“按需调用能力”的个人情报底座：用户临时提出查询需求时，系统选择合适的平台能力、执行搜索或公开正文抽取、验证结果，并由调用者决定是否保存；它不以持续抓取和提前囤积数据为默认目标。

## 当前组成

```text
poc/browserwing/           BrowserWing 中文公开站点与登录 Profile 实验
poc/maxun/                 Maxun B站搜索录制、运行和映射实验
poc/intelligence-gateway/  统一 Capability Runtime 与 Draft Capability Factory
research_*.md              开源项目、中文站点覆盖和架构调研
```

核心 Gateway 当前为 `0.6.0`，已经真实验证：

- B站关键词搜索：Maxun；
- 小红书人工登录后的低频搜索：BrowserWing；
- 全网和 `site:` 外部发现：SearXNG；
- 公开 HTML/text 正文抽取：Trafilatura；
- 未知公开搜索网站：Draft -> inspect -> validate -> recipe -> promote -> execute；
- 百度、Bing、搜狗和 CSDN 公开搜索已通过能力生成闭环与不同查询回归。
- `keyword_search -> detail_fetch` 组合任务可按需读取公开正文，默认不落库。
- 详情能力采用 direct-first：Trafilatura 先读取公开 HTML，只有同平台、同主机的已验证 BrowserWing detail recipe 才能处理脚本渲染或 HTTP 受限页面；
- 知乎专栏真实闭环中，Trafilatura 收到 HTTP 403 后，BrowserWing recipe 成功读取两篇不同文章的 3,358 / 1,916 字精确正文。

详细运行方式、API 和安全边界见 [Intelligence Gateway README](poc/intelligence-gateway/README.md)。真实运行证据见 [Gateway evaluation](poc/intelligence-gateway/evaluation.md)。

## 设计原则

1. 能力级注册，不使用笼统的 `platform_supported=true`；
2. 真实样本验证通过后，Draft 才能晋升为正式 Capability；
3. 登录只能由用户在隔离浏览器中人工完成；
4. 不绕过登录、验证码、安全机制或付费保护；
5. 强登录平台低频、串行，并共享受控 Profile 锁；
6. `persistence=none` 是正式执行模式，临时查询不必写入情报库；
7. fallback 必须显式标记能力降级，外部 `site:` 发现不能冒充平台完整索引。
8. 浏览器不是任意 URL 的通用兜底；只有经过 Draft 验证并限定主机的只读 recipe 才能被 Planner 选择。

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

当前基线：`69 passed`。

## 下一阶段

`0.6.0` 已经完成公开 HTML 与浏览器渲染详情的分层闭环。下一条主线仍是扩展“需要时可调用”的能力面，而不是增加持续采集量：

1. 将 `detail_fetch` 从长文容器扩展到视频描述、问答回答和帖子正文，但每类输出保持独立质量门槛；
2. 给可靠性状态增加人工审计记录、recipe 版本回滚和定期精确验证；
3. 继续按公众号、知乎、B站、小红书、新闻站的真实需求逐个平台补搜索或 Profile Adapter，不用“浏览器能打开”冒充正式支持；
4. LLM 只负责提出探索候选，不能跳过确定性样本验证、主机边界和认证门禁。
