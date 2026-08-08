 赶紧搞定核心功能！！！不要在边角料上花时间！！！
# Project agent instructions

- Read and write all text as UTF-8. In PowerShell, use `Get-Content -Encoding utf8`; with ripgrep, use `rg --encoding utf-8`.
- Before investigating, automating, debugging, or validating any real website or browser-extension platform interaction, read `skills/recon-live-web-interactions/SKILL.md` completely and follow it. Read its linked reference files when their routing conditions apply.
- The project owner grants standing authorization for autonomous, in-scope real-platform reconnaissance and low-frequency read-only browser actions in project-managed profiles. Do not ask for per-run chat authorization. Ask the user only when indispensable human authentication input is required, such as scanning a QR code, entering a password, or completing a captcha.
- Do not export browser credentials or bypass access controls, captchas, rate limits, paid restrictions, or platform safety measures. Do not like, follow, favorite, comment, message, publish, or delete unless the user separately asks for that state-changing action.
- Treat visual inspection, DOM reconnaissance, trusted browser input, and Network/XHR observation as parallel evidence surfaces. Prove the human workflow on the real page before writing platform automation.
- Do not use platform fixtures, fake XHR, fake Gateway responses, or synthetic page clones as evidence of real platform capability. Pure functions and state machines may use unit tests.
- Preserve unrelated dirty-worktree changes. Use `apply_patch` for source and documentation edits, and commit coherent verified checkpoints promptly.
- 扩展源码或构建制品发生变化后，排查/验证必须使用项目专用隔离 Profile 通过 `chrome-devtools-mcp` CLI 的 CDP 扩展工具自动更新：首次用 `chrome-devtools install_extension <absolute-dist-path>`，后续用 `chrome-devtools reload_extension <extension-id>`；禁止把“请用户打开 `chrome://extensions` 再手动 Reload”当作处理方案。
- 自动重载后必须重新读取真实 worker 的 runtime marker（manifest version、`collectorVersion`、control-surface revision、build fingerprint），并与 `dist/runtime-build.json` 精确比对；若仍不一致只允许再执行一次受控 reload，不能依赖历史版本记录、可见窗口重启或重复导航来掩盖 mismatch。
- DevTools/CDP 自动更新只允许作用于仓库管理的验证/研究 Profile；不得附着、接管或关闭用户日常浏览器。运行 `chrome-devtools` 时关闭 usage statistics/CrUX，Network 证据输出先去掉 query/hash，绝不输出 Cookie、Token、密码或其他认证材料。
- B站字幕菜单属于 hover-owned UI：必须按“视频区域 → 字幕按钮 → 菜单路径 → `data-lan="ai-zh"` 父节点”分段发送真实 mouse move，每段等待并重新确认可见/`:hover`；禁止把鼠标瞬移、hover 和 click 合并成零停顿序列。唯一一次点击后必须同时核对 active 状态、可见字幕面板和去敏字幕 CDN 200 响应。
