export const consoleHtml = `<!doctype html>
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
      <p class="subtitle">用户日常浏览器扩展、受限本地 API 与原始证据的本地控制面</p>
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
          <p class="eyebrow">USER-OWNED BROWSER</p>
          <h2>日常浏览器扩展</h2>
        </div>
        <button id="create-browser-binding-pairing" type="button">创建一次性配对码</button>
      </div>
      <p class="panel-copy">在用户平时使用、已登录的 Chrome/Edge 中安装扩展后，在扩展控制页填入这里生成的会话 ID 与八位配对码。Gateway 不创建、启动、关闭或读取浏览器 Profile、Cookie、密码或 Token。</p>
      <div id="browser-binding-pairing" class="pairing-ticket" hidden>
        <p>此配对码五分钟后失效，成功后立即作废。不要复制到聊天记录、命令行历史或其他应用。</p>
        <dl>
          <div><dt>Gateway</dt><dd id="browser-binding-pairing-origin"></dd></div>
          <div><dt>身份指纹</dt><dd><code id="browser-binding-pairing-fingerprint"></code></dd></div>
          <div><dt>会话 ID</dt><dd><code id="browser-binding-pairing-session"></code></dd></div>
          <div><dt>配对码</dt><dd><code id="browser-binding-pairing-code"></code></dd></div>
        </dl>
      </div>
      <div id="browser-bindings" class="client-grid" aria-live="polite"></div>
      <p id="browser-bindings-empty" class="empty" hidden>尚未配对任何日常浏览器扩展。</p>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">TEST / ISOLATED-ACCOUNT LANE</p>
          <h2>受管测试 Profile</h2>
        </div>
      </div>
      <p class="panel-copy">此面板仍是旧的隔离 Browser Host 测试通道，不是正式用户日常浏览器安装路径。</p>
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

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">LOCAL API CLIENTS</p>
          <h2>其他本地应用的服务访问</h2>
        </div>
      </div>
      <p class="panel-copy">创建的 token 只显示一次；Gateway 只保存其摘要。请选择这个应用真正需要的最小权限。它只能调用已登记的采集能力，不能读取浏览器凭据、Profile 路径或执行任意脚本。</p>
      <form id="create-service-client" class="client-form">
        <label>客户端标签
          <input name="label" maxlength="80" required placeholder="例如：本地分析应用">
        </label>
        <fieldset class="scope-selector">
          <legend>允许调用</legend>
          <div class="scope-options">
            <label class="scope-option"><input name="scopes" type="checkbox" value="browser-bindings:read" checked><span><code>browser-bindings:read</code><small>读取已配对的日常浏览器绑定</small></span></label>
            <label class="scope-option"><input name="scopes" type="checkbox" value="collect:execute" checked><span><code>collect:execute</code><small>执行已登记的采集能力</small></span></label>
            <label class="scope-option"><input name="scopes" type="checkbox" value="operations:read" checked><span><code>operations:read</code><small>读取异步工作项状态</small></span></label>
            <label class="scope-option"><input name="scopes" type="checkbox" value="artifacts:read" checked><span><code>artifacts:read</code><small>读取 capability 绑定的产物</small></span></label>
            <label class="scope-option"><input name="scopes" type="checkbox" value="profiles:read"><span><code>profiles:read</code><small>仅旧的隔离 Browser Host 测试通道需要</small></span></label>
          </div>
        </fieldset>
        <button type="submit">创建本地 API token</button>
      </form>
      <div id="issued-service-token" class="issued-token" hidden>
        <p>请立即复制并交给对应本地应用；关闭此页后 Gateway 不会再次显示它。</p>
        <code id="issued-service-token-value"></code>
        <button id="copy-issued-service-token" class="secondary" type="button">复制 token</button>
      </div>
      <div id="service-clients" class="client-grid" aria-live="polite"></div>
      <p id="service-clients-empty" class="empty" hidden>还没有本地 API 客户端。</p>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">SERVICE AUDIT</p>
          <h2>去敏调用记录</h2>
        </div>
      </div>
      <p class="panel-copy">只记录调用主体、能力、结果和去敏的 Profile 摘要；不保存查询词、URL、正文、token、Cookie、浏览器身份或 Profile 路径。</p>
      <div id="service-audit" class="audit-grid" aria-live="polite"></div>
      <p id="service-audit-empty" class="empty" hidden>还没有 Collector Service 调用记录。</p>
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
