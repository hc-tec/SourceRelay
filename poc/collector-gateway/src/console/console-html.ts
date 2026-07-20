export const consoleHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Collector Browser Host</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">PERSONAL INTELLIGENCE</p>
      <h1>Collector Browser Host</h1>
      <p class="subtitle">持久 Profile、多页面租约与扩展连接的本地控制面</p>
    </div>
    <div class="host-actions">
      <span id="host-state" class="badge neutral">读取中</span>
      <button id="refresh" class="secondary">刷新</button>
      <button id="exit-host" class="danger">退出 Browser Host</button>
    </div>
  </header>

  <main>
    <section class="metrics" aria-label="Browser Host summary">
      <article><span>Host PID</span><strong id="host-pid">—</strong></article>
      <article><span>Snapshot revision</span><strong id="snapshot-revision">—</strong></article>
      <article><span>运行 Profile</span><strong id="running-profiles">0</strong></article>
      <article><span>受管页面</span><strong id="managed-pages">0</strong></article>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">COLLECTION PROFILES</p>
          <h2>账号与浏览器会话</h2>
        </div>
      </div>
      <form id="create-profile" class="profile-form">
        <label>平台
          <select name="platform">
            <option value="bilibili">B站</option>
            <option value="xiaohongshu">小红书</option>
            <option value="zhihu">知乎</option>
            <option value="weibo">微博</option>
          </select>
        </label>
        <label>账号标签
          <input name="accountLabel" maxlength="80" required placeholder="例如：我的 B站账号">
        </label>
        <label>期望可见身份（可选）
          <input name="expectedVisibleIdentity" maxlength="160" placeholder="只记录公开可见身份描述">
        </label>
        <button type="submit">新建 Collection Profile</button>
      </form>
      <div id="profiles" class="profile-grid" aria-live="polite"></div>
      <p id="empty" class="empty" hidden>还没有 Collection Profile。</p>
    </section>

    <section class="panel notice">
      <h2>当前边界</h2>
      <p>Gateway 只读 Browser Host Snapshot，不直接持有 Playwright Page。任务结束不会关页；关闭 Profile 和退出 Host 都只由这里的显式动作触发。</p>
    </section>
  </main>

  <div id="toast" role="status" aria-live="polite"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>`;
