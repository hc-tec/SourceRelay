export const consoleStyles = `
:root { color-scheme: light; font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif; color: #17202a; background: #eef2f6; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: linear-gradient(145deg, #f8fafc, #e8edf3); }
main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
.eyebrow { color: #637083; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
h1 { margin: 5px 0 10px; font-size: clamp(28px, 5vw, 44px); letter-spacing: -.04em; }
p { margin: 0; color: #5c6876; line-height: 1.65; }
.card { margin-top: 22px; padding: 22px; border: 1px solid #d8e0e8; border-radius: 18px; background: rgba(255,255,255,.94); box-shadow: 0 18px 50px rgba(20,34,48,.08); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2 { margin: 0 0 6px; font-size: 17px; }
.status { padding: 5px 10px; border-radius: 999px; background: #dff5e8; color: #19653b; font-size: 12px; font-weight: 800; }
.fingerprint, .value { overflow-wrap: anywhere; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; }
.grid { display: grid; gap: 12px; margin-top: 16px; }
.field { padding: 12px; border-radius: 11px; background: #f4f7fa; }
.field span { display: block; margin-bottom: 4px; color: #74808d; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.code { font-size: 30px; font-weight: 800; letter-spacing: .16em; }
button { min-height: 38px; padding: 8px 14px; border: 0; border-radius: 10px; background: #1f6feb; color: white; font: inherit; font-weight: 800; cursor: pointer; }
button:disabled { cursor: wait; opacity: .6; }
.notice { margin-top: 12px; font-size: 12px; }
[hidden] { display: none !important; }
`;

export const consoleScript = `
const identity = document.querySelector('#identity');
const pairedCount = document.querySelector('#paired-count');
const createButton = document.querySelector('#create-pairing');
const pairing = document.querySelector('#pairing');
const sessionId = document.querySelector('#session-id');
const pairingCode = document.querySelector('#pairing-code');
const expiresAt = document.querySelector('#expires-at');
const error = document.querySelector('#error');

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Gateway request failed.');
  return body;
}

async function refresh() {
  const status = await json('/v1/status');
  identity.textContent = status.identity.identityFingerprint;
  pairedCount.textContent = String(status.pairedExtensionCount);
  document.documentElement.dataset.collectorGatewayConsoleReady = 'true';
}

createButton.addEventListener('click', async () => {
  createButton.disabled = true;
  error.hidden = true;
  try {
    const created = await json('/v1/pairing/sessions', { method: 'POST' });
    sessionId.textContent = created.pairingSessionId;
    pairingCode.textContent = created.pairingCode;
    expiresAt.textContent = new Date(created.expiresAt).toLocaleString();
    pairing.hidden = false;
  } catch (reason) {
    error.textContent = reason instanceof Error ? reason.message : String(reason);
    error.hidden = false;
  } finally {
    createButton.disabled = false;
  }
});

refresh().catch((reason) => {
  error.textContent = reason instanceof Error ? reason.message : String(reason);
  error.hidden = false;
});
`;

export const consoleHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Collector Gateway</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <main>
      <p class="eyebrow">LOCAL RESEARCH CONTROL PLANE</p>
      <h1>Collector Gateway</h1>
      <p>这个服务只监听 127.0.0.1。网页不能直接控制扩展；每个 Collection Profile 必须使用一次性配对 Session 显式绑定固定 Gateway 身份。</p>

      <section class="card">
        <div class="row">
          <div><h2>Gateway 身份</h2><p>ECDSA P-256 固定身份指纹</p></div>
          <span class="status">Loopback only</span>
        </div>
        <div class="grid">
          <div class="field"><span>Identity fingerprint</span><div id="identity" class="fingerprint">读取中…</div></div>
          <div class="field"><span>Paired extension profiles</span><div id="paired-count" class="value">0</div></div>
        </div>
      </section>

      <section class="card">
        <div class="row">
          <div><h2>创建一次性配对</h2><p>Session 五分钟后过期，配对码最多尝试五次。</p></div>
          <button id="create-pairing" type="button">创建配对 Session</button>
        </div>
        <div id="pairing" class="grid" hidden>
          <div class="field"><span>Session ID</span><div id="session-id" class="value"></div></div>
          <div class="field"><span>8 位配对码</span><div id="pairing-code" class="code"></div></div>
          <div class="field"><span>Expires at</span><div id="expires-at" class="value"></div></div>
          <p class="notice">打开 Collector 扩展控制页，核对 Gateway origin 后输入 Session ID 与配对码。扩展会验证身份指纹和签名；配对码不会保存到长期配置。</p>
        </div>
        <p id="error" class="notice" hidden></p>
      </section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>`;
