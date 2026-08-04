# Collector Core 版本化发布

当前 Core Release anchor 为 `0.7.17`。它不是“随便改几行代码就升级”的内部编号，而是
Contracts、MV3 Extension、Gateway、JS SDK、Python SDK 和控制面兼容性的一组发布身份。

## 生成发布目录

```powershell
Set-Location .\poc
npm run package:core-release
```

默认输出到：

```text
poc/runtime/core-release-0.7.17/
├─ release-manifest.json
├─ sha256sums.json                     # manifest、SBOM 和全部制品的 SHA-256
├─ sbom.cdx.json                       # 确定性的 CycloneDX 1.5 依赖清单
├─ extension/                         # 用户常用浏览器加载的 MV3 扩展目录
├─ gateway/                           # user-browser Gateway bundle 和启动脚本
│  ├─ dist/user-browser-server.js
│  └─ start-user-browser.ps1
├─ npm/
│  ├─ intelligence-collector-client-0.7.17.tgz
│  ├─ intelligence-collector-contracts-0.7.17.tgz
│  └─ intelligence-collector-gateway-0.7.17.tgz
└─ python/
   └─ intelligence_collector_client-0.7.17-py3-none-any.whl
```

发布脚本会从构建产物生成两个可复核的完整性文件，并且不访问真实平台：

- `release-manifest.json` 的 `files` 列出扩展、Gateway、NPM tarball、Python wheel 和 SBOM，
  每项包含相对路径、字节数和 SHA-256。它排除自身与 `sha256sums.json`，避免自引用循环；
- `sha256sums.json` 覆盖上述所有文件以及 `release-manifest.json` 本身，只排除它自己；
- `sbom.cdx.json` 是不带时间戳、随机 UUID 或本机绝对路径的 CycloneDX 1.5 文档，来源是
  `poc/package-lock.json`。依赖条目记录名称、版本、许可证（来自包元数据）、发布来源 URL
  和 npm integrity（转换为 CycloneDX hashes），并附带锁文件 SHA-256。

因此发布目录可以复制到另一台机器，仅凭目录内文件完成完整性复核，不需要访问 npm、PyPI、
浏览器或任何真实平台。

Python wheel 构建固定了 `SOURCE_DATE_EPOCH=0` 和 `PYTHONHASHSEED=0`；在相同提交、相同
锁文件下重复运行 `npm run package:core-release`，wheel、SBOM、manifest 和校验清单的哈希
应保持一致。

可以用下面的命令重新生成并查看结果：

```powershell
npm run package:core-release
Get-Content -Encoding utf8 .\runtime\core-release-0.7.17\release-manifest.json
Get-Content -Encoding utf8 .\runtime\core-release-0.7.17\sha256sums.json
Get-Content -Encoding utf8 .\runtime\core-release-0.7.17\sbom.cdx.json
```

## 验证 SDK 脱离源码安装

```powershell
npm run verify:sdk-release-installation
```

这个门禁会在临时目录中：

- 从 npm tarball 安装 JS SDK；
- 从 Python wheel 安装 Python SDK；
- 检查 `CORE_RELEASE_VERSION`、18 项 direct capability 和 request builder；
- 确认没有从仓库源码路径导入包；
- 使用真实 Python venv 和 npm 安装流程；
- 对发布目录的每个 manifest 条目、SBOM 和 SHA-256 清单逐文件重新计算并校验；
- 不启动浏览器、不访问平台、不伪造平台采集结果。

SDK 的 `readRelease()` 会拒绝与自身兼容锚点不一致的 Gateway release manifest，避免上层
应用静默调用不兼容的 Core。

## 上层应用安装

外部上层应用只能依赖版本化 Python wheel 或 JS tarball。开发期的相邻 checkout editable
安装不再是推荐路径；仓库外的上层应用应使用
`intelligence-collector-client==0.7.17`。

## 升级原则

1. 先生成新版本 release manifest；
2. 对比 Extension runtime build fingerprint、service schema 和协议版本；
3. 先更新 Gateway/SDK，再准备扩展；
4. 用户浏览器中如果已有不同 fingerprint，部署命令返回 `update_required`，不会静默覆盖；
5. 只有显式运行 `npm run update:user-browser-deployment` 才会原子替换扩展目录；
6. 浏览器中的扩展仍由用户在宿主浏览器内刷新，不由 Gateway 关闭或重启用户浏览器。
