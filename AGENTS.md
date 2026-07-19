# Project agent instructions

- Read and write all text as UTF-8. In PowerShell, use `Get-Content -Encoding utf8`; with ripgrep, use `rg --encoding utf-8`.
- Before investigating, automating, debugging, or validating any real website or browser-extension platform interaction, read `skills/recon-live-web-interactions/SKILL.md` completely and follow it. Read its linked reference files when their routing conditions apply.
- The project owner grants standing authorization for autonomous, in-scope real-platform reconnaissance and low-frequency read-only browser actions in project-managed profiles. Do not ask for per-run chat authorization. Ask the user only when indispensable human authentication input is required, such as scanning a QR code, entering a password, or completing a captcha.
- Do not export browser credentials or bypass access controls, captchas, rate limits, paid restrictions, or platform safety measures. Do not like, follow, favorite, comment, message, publish, or delete unless the user separately asks for that state-changing action.
- Treat visual inspection, DOM reconnaissance, trusted browser input, and Network/XHR observation as parallel evidence surfaces. Prove the human workflow on the real page before writing platform automation.
- Do not use platform fixtures, fake XHR, fake Gateway responses, or synthetic page clones as evidence of real platform capability. Pure functions and state machines may use unit tests.
- Preserve unrelated dirty-worktree changes. Use `apply_patch` for source and documentation edits, and commit coherent verified checkpoints promptly.
