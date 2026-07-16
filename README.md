# 中文个人情报能力实验室

这个仓库研究并实现一种“按需调用能力”的个人情报底座：用户临时提出查询需求时，系统选择合适的平台能力、执行搜索或公开正文抽取、验证结果，并由调用者决定是否保存；它不以持续抓取和提前囤积数据为默认目标。

## 当前组成

```text
poc/browserwing/           BrowserWing 中文公开站点与登录 Profile 实验
poc/maxun/                 Maxun B站搜索录制、运行和映射实验
poc/intelligence-gateway/  统一 Capability Runtime 与 Draft Capability Factory
research_*.md              开源项目、中文站点覆盖和架构调研
```

核心 Gateway 当前为 `0.9.0`，已经真实验证：

- B站关键词搜索：Maxun；
- 小红书人工登录后的低频搜索：BrowserWing；
- 全网和 `site:` 外部发现：SearXNG；
- 公开 HTML/text 正文抽取：Trafilatura；
- 未知公开搜索网站：Draft -> inspect -> validate -> recipe -> promote -> execute；
- 百度、Bing、搜狗和 CSDN 公开搜索已通过能力生成闭环与不同查询回归。
- `keyword_search -> detail_fetch` 组合任务可按需读取公开正文，默认不落库。
- 详情能力采用 direct-first：Trafilatura 先读取公开 HTML，只有同平台、同主机的已验证 BrowserWing detail recipe 才能处理脚本渲染或 HTTP 受限页面；
- 知乎专栏真实闭环中，Trafilatura 收到 HTTP 403 后，BrowserWing recipe 成功读取两篇不同文章的 3,358 / 1,916 字精确正文。
- NewsNow 按需热榜：B站三类 feed、微博、知乎、快手、贴吧、36氪和澎湃已通过自托管真实样本；原始 JSON 作为本地 artifact 保留，不写入情报数据库。
- 抖音 NewsNow feed 当前真实返回 HTTP 500，Capability 保持 `declared_unverified`，不进入 Planner。
- B站已知公开视频详情：yt-dlp metadata-only 对两个不同 BV URL 真实通过，完整 JSON 落本地 artifact，不下载视频、不使用 Cookie；lux 对同 URL 成功对照。
- 贴吧指定吧主题与已知帖子详情：aiotieba 4.7.1 匿名只读真实通过；只开放 `get_threads/get_posts`，完整返回落本地 artifact，不把内容拆入数据库。

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
9. 原始数据优先作为本地 JSON/HTML/Markdown artifact 保存，只用最小 manifest 记录来源、时间、动作、执行能力和文件校验值；不预先要求将所有平台字段归一化入库。

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

当前基线：`89 passed`。

## 下一阶段

`0.9.0` 已经完成 NewsNow `hotlist_fetch`、B站 yt-dlp `video_detail`，以及贴吧 aiotieba `forum_threads/post_detail` 的 raw-first artifact 闭环。当前阶段继续稳定数据源层，不在 Gateway 内加入长报告、多智能体研究或结论生成：

1. 修 B站相关性/规范 URL、小红书实时认证状态、搜狗跳转 URL 和公众号壳页等现有质量问题；
2. 实现 aiotieba 只读薄 Adapter，只开放公开吧主题和帖子详情；
3. 对 WeRSS 与 WeWe RSS 做已知公众号历史小样本，只选一个合适的按需数据源，不扩写成全公众号搜索；
4. DailyHotApi 保留为 NewsNow 对照候选，本地真实样本和失败契约未通过前不进入自动 fallback；
5. 数据层达到稳定验收条件后，再调研 DeerFlow、天工系 DeepResearch 等仓库作为上层分析消费者。

数据源分层、就绪等级和原始文件优先的保存边界见 [数据源层 ADR](docs/design/data-source-layer.md)。不同平台、不同动作的 GitHub 仓库选型与 NewsNow/DailyHotApi 接口级核验见 [平台专用数据源调研](research_platform_specific_data_sources_2026-07-16.md)。
