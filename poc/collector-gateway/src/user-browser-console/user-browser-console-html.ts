export const userBrowserConsoleHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Collector Gateway</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">PERSONAL INTELLIGENCE</p>
      <h1>Local Collector Gateway</h1>
      <p class="subtitle">日常 Chrome / Edge 的已配对扩展与受限本地 API</p>
    </div>
    <div class="topbar-actions">
      <span id="gateway-mode" class="badge neutral">检查中</span>
      <button id="refresh" class="secondary" type="button">刷新状态</button>
    </div>
  </header>

  <main>
    <section class="panel boundary">
      <p class="eyebrow">PRODUCTION RUNTIME</p>
      <h2>浏览器由你拥有，Gateway 不管理浏览器</h2>
      <p>这里不会启动、附着、关闭或枚举 Chrome / Edge；不会创建、复制或读取登录目录，也不会读取 Cookie、密码、Token 或网页 Storage。扩展安装在你平时使用的浏览器中，并使用浏览器自己维护的登录状态。</p>
      <dl class="facts">
        <div><dt>Gateway</dt><dd id="gateway-origin">—</dd></div>
        <div><dt>已配对扩展</dt><dd id="binding-count">0</dd></div>
        <div><dt>在线扩展</dt><dd id="online-binding-count">0</dd></div>
      </dl>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">ONE-TIME PAIRING</p>
          <h2>连接当前浏览器里的 Collector 扩展</h2>
        </div>
        <button id="create-browser-binding-pairing" type="button">创建一次性配对码</button>
      </div>
      <p class="panel-copy">先在你的日常 Chrome 或 Edge 安装扩展。随后打开扩展控制页，把下面四项填入并批准唯一的 loopback 权限。配对码五分钟后失效，成功后立即作废。</p>
      <div id="browser-binding-pairing" class="pairing-ticket" hidden>
        <dl>
          <div><dt>Gateway</dt><dd id="browser-binding-pairing-origin"></dd></div>
          <div><dt>身份指纹</dt><dd><code id="browser-binding-pairing-fingerprint"></code></dd></div>
          <div><dt>会话 ID</dt><dd><code id="browser-binding-pairing-session"></code></dd></div>
          <div><dt>配对码</dt><dd><code id="browser-binding-pairing-code"></code></dd></div>
        </dl>
      </div>
      <div id="browser-bindings" class="card-grid" aria-live="polite"></div>
      <p id="browser-bindings-empty" class="empty" hidden>尚未配对任何浏览器扩展。</p>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">LOCAL APPLICATION ACCESS</p>
          <h2>给上层应用创建最小权限 token</h2>
        </div>
      </div>
      <p class="panel-copy">token 只显示一次；Gateway 只保存摘要。上层应用只能调用已登记的能力，不能控制浏览器、读取凭据或传入任意脚本。</p>
      <form id="create-service-client" class="client-form">
        <label>客户端标签
          <input name="label" maxlength="80" required placeholder="例如：本地研究应用">
        </label>
        <fieldset class="scope-selector">
          <legend>允许调用</legend>
          <label><input name="scopes" type="checkbox" value="browser-bindings:read" checked> browser-bindings:read</label>
          <label><input name="scopes" type="checkbox" value="collect:execute" checked> collect:execute</label>
          <label><input name="scopes" type="checkbox" value="operations:read" checked> operations:read</label>
          <label><input name="scopes" type="checkbox" value="artifacts:read" checked> artifacts:read</label>
        </fieldset>
        <button type="submit">创建 token</button>
      </form>
      <div id="issued-service-token" class="issued-token" hidden>
        <p>立即复制并交给对应的本地应用；关闭或刷新页面后不会再次显示。</p>
        <code id="issued-service-token-value"></code>
        <button id="copy-issued-service-token" class="secondary" type="button">复制 token</button>
      </div>
      <div id="service-clients" class="card-grid" aria-live="polite"></div>
      <p id="service-clients-empty" class="empty" hidden>还没有本地 API 客户端。</p>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">DE-IDENTIFIED AUDIT</p>
          <h2>本地服务调用记录</h2>
        </div>
      </div>
      <div id="service-audit" class="card-grid" aria-live="polite"></div>
      <p id="service-audit-empty" class="empty" hidden>还没有调用记录。</p>
    </section>
  </main>
  <div id="toast" role="status" aria-live="polite"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>`;
