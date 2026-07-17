export const consoleStyles = `
:root { color-scheme: light; font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif; color: #17202a; background: #eef2f6; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: linear-gradient(145deg, #f8fafc, #e8edf3); }
main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
.eyebrow { color: #637083; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
h1 { margin: 5px 0 10px; font-size: clamp(28px, 5vw, 44px); letter-spacing: -.04em; }
p { margin: 0; color: #5c6876; line-height: 1.65; }
.card { margin-top: 22px; padding: 22px; border: 1px solid #d8e0e8; border-radius: 18px; background: rgba(255,255,255,.94); box-shadow: 0 18px 50px rgba(20,34,48,.08); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2 { margin: 0 0 6px; font-size: 17px; }
.status, .pill { display: inline-flex; align-items: center; width: fit-content; padding: 5px 10px; border-radius: 999px; background: #dff5e8; color: #19653b; font-size: 12px; font-weight: 800; }
.pill { padding: 3px 8px; background: #edf1f5; color: #556271; font-size: 10px; }
.pill.good { background: #dff5e8; color: #19653b; }
.pill.warn { background: #fff1cc; color: #7c5200; }
.fingerprint, .value { overflow-wrap: anywhere; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; }
.grid { display: grid; gap: 12px; margin-top: 16px; }
.summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.field { padding: 12px; border-radius: 11px; background: #f4f7fa; }
.field span { display: block; margin-bottom: 4px; color: #74808d; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.code { font-size: 30px; font-weight: 800; letter-spacing: .16em; }
button { min-height: 38px; padding: 8px 14px; border: 0; border-radius: 10px; background: #1f6feb; color: white; font: inherit; font-weight: 800; cursor: pointer; }
button.secondary { border: 1px solid #cfd7df; background: white; color: #344252; }
button:disabled { cursor: wait; opacity: .6; }
.notice { margin-top: 12px; font-size: 12px; }
.notice.error { padding: 10px 12px; border-radius: 9px; background: #fff0ee; color: #9b2c20; }
.form { display: grid; gap: 12px; margin-top: 16px; }
.form-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.form label { display: grid; gap: 6px; color: #4c5967; font-size: 12px; font-weight: 800; }
.span-2 { grid-column: 1 / -1; }
input, textarea, select { width: 100%; padding: 9px 11px; border: 1px solid #cfd7df; border-radius: 9px; background: white; color: #17202a; font: inherit; }
textarea { min-height: 76px; resize: vertical; }
.profile-list, .task-list { display: grid; gap: 10px; margin-top: 16px; }
.profile, .task { padding: 14px; border: 1px solid #dde4eb; border-radius: 12px; background: #f9fbfc; }
.profile h3, .task h3 { margin: 0 0 5px; font-size: 14px; }
.profile-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.profile-actions { display: flex; align-items: center; gap: 8px; }
.platforms { display: grid; gap: 8px; }
.platform-row { display: grid !important; grid-template-columns: 150px minmax(0, 1fr); align-items: center; gap: 12px; padding: 10px; border: 1px solid #dce3ea; border-radius: 10px; background: #f8fafc; }
.platform-toggle { display: flex; align-items: center; gap: 7px; }
.platform-toggle input { width: auto; }
.task-stage { margin-top: 7px; padding: 8px; border-radius: 8px; background: #eef3f7; font-size: 11px; }
.blocked { color: #8b5a00; }
.empty { padding: 14px; border: 1px dashed #cfd7df; border-radius: 10px; text-align: center; }
[hidden] { display: none !important; }
@media (max-width: 680px) {
  main { padding-top: 28px; }
  .row { align-items: flex-start; flex-direction: column; }
  .summary-grid, .form-columns { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .platform-row { grid-template-columns: 1fr; }
}
`;

export const consoleScript = `
const platformLabels = { bilibili: 'B站', zhihu: '知乎', weibo: '微博', xiaohongshu: '小红书' };
const identity = document.querySelector('#identity');
const pairedCount = document.querySelector('#paired-count');
const profileCount = document.querySelector('#profile-count');
const runningCount = document.querySelector('#running-count');
const createButton = document.querySelector('#create-pairing');
const pairing = document.querySelector('#pairing');
const sessionId = document.querySelector('#session-id');
const pairingCode = document.querySelector('#pairing-code');
const expiresAt = document.querySelector('#expires-at');
const error = document.querySelector('#error');
const profileForm = document.querySelector('#profile-form');
const profileKind = document.querySelector('#profile-kind');
const accountCategory = document.querySelector('#account-category');
const profileList = document.querySelector('#profile-list');
const taskForm = document.querySelector('#task-form');
const taskList = document.querySelector('#task-list');
let profiles = [];
let profilesSignature = '';
let tasksSignature = '';

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Gateway request failed.');
  return body;
}

function showError(reason) {
  error.textContent = reason instanceof Error ? reason.message : String(reason);
  error.className = 'notice error';
  error.hidden = false;
}

function clearError() {
  error.hidden = true;
  error.textContent = '';
}

function runtimePill(text, tone) {
  const pill = document.createElement('span');
  pill.className = 'pill' + (tone ? ' ' + tone : '');
  pill.textContent = text;
  return pill;
}

function updateTaskProfileSelectors() {
  for (const select of taskForm.querySelectorAll('select[data-profile-platform]')) {
    const previous = select.value;
    const platform = select.dataset.profilePlatform;
    const eligible = profiles.filter((summary) =>
      summary.profile.kind === 'collection' && summary.profile.platform === platform
    );
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = eligible.length ? '选择 Collection Profile' : '尚无可用 Collection Profile';
    const options = eligible.map((summary) => {
      const option = document.createElement('option');
      option.value = summary.profile.profileId;
      option.textContent = summary.profile.account.label + (summary.running ? ' · 运行中' : '');
      return option;
    });
    select.replaceChildren(placeholder, ...options);
    if (eligible.some((summary) => summary.profile.profileId === previous)) select.value = previous;
    else if (eligible.length === 1) select.value = eligible[0].profile.profileId;
  }
}

function profileElement(summary) {
  const card = document.createElement('article');
  card.className = 'profile';
  const top = document.createElement('div');
  top.className = 'row';
  const description = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = summary.profile.account.label;
  const meta = document.createElement('p');
  meta.textContent = platformLabels[summary.profile.platform] + ' · ' + summary.profile.kind + ' · ' + summary.profile.account.category;
  description.append(title, meta);
  const actions = document.createElement('div');
  actions.className = 'profile-actions';
  const action = document.createElement('button');
  action.type = 'button';
  action.className = summary.running ? 'secondary' : '';
  action.textContent = summary.running ? '关闭浏览器' : '启动可见浏览器';
  action.addEventListener('click', async () => {
    action.disabled = true;
    clearError();
    try {
      await json('/v1/profiles/' + encodeURIComponent(summary.profile.profileId) + (summary.running ? '/close' : '/launch'), {
        method: 'POST'
      });
      await refreshWorkspace();
    } catch (reason) {
      showError(reason);
    } finally {
      action.disabled = false;
    }
  });
  actions.append(action);
  top.append(description, actions);

  const metaRow = document.createElement('div');
  metaRow.className = 'profile-meta';
  metaRow.append(
    runtimePill(summary.running ? 'Browser running' : 'Browser stopped', summary.running ? 'good' : ''),
    runtimePill(summary.extensionLoaded ? 'Extension loaded' : 'Extension not loaded', summary.extensionLoaded ? 'good' : ''),
    runtimePill(summary.extensionPaired ? 'Gateway paired' : 'Pairing required', summary.extensionPaired ? 'good' : 'warn')
  );
  if (summary.profile.account.expectedVisibleIdentity) {
    metaRow.append(runtimePill('Expected: ' + summary.profile.account.expectedVisibleIdentity));
  }
  if (summary.profile.lastLaunchedAt) {
    metaRow.append(runtimePill('Last launch: ' + new Date(summary.profile.lastLaunchedAt).toLocaleString()));
  }
  card.append(top, metaRow);
  return card;
}

async function refreshProfiles() {
  const response = await json('/v1/profiles');
  const signature = JSON.stringify(response.profiles);
  if (signature === profilesSignature) return;
  profilesSignature = signature;
  profiles = response.profiles;
  if (profiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '尚未创建受管浏览器 Profile。先创建 Validation Profile 做实网验证，或创建 Collection Profile 绑定用户管理的登录环境。';
    profileList.replaceChildren(empty);
  } else {
    profileList.replaceChildren(...profiles.map(profileElement));
  }
  updateTaskProfileSelectors();
}

function taskElement(task) {
  const card = document.createElement('article');
  card.className = 'task';
  const title = document.createElement('h3');
  title.textContent = task.researchQuestion;
  const meta = document.createElement('p');
  meta.textContent = task.platforms.map((platform) => platformLabels[platform] || platform).join(' · ') + ' · ' + task.state;
  card.append(title, meta);

  const bindings = Object.values(task.profileBindings || {});
  if (bindings.length) {
    const bindingRow = document.createElement('div');
    bindingRow.className = 'profile-meta';
    for (const binding of bindings) {
      bindingRow.append(runtimePill((platformLabels[binding.platform] || binding.platform) + ': ' + binding.account.label));
    }
    card.append(bindingRow);
  }

  if (task.plan && Array.isArray(task.plan.stages)) {
    for (const stage of task.plan.stages) {
      const row = document.createElement('div');
      row.className = 'task-stage';
      row.textContent = (platformLabels[stage.platform] || stage.platform) + ' / ' + stage.evidenceObjective + ' — ' + stage.preflight.status + ' (' + stage.preflight.releaseTrack + ')';
      card.append(row);
    }
    const ready = task.plan.stages.length > 0 && task.plan.stages.every((stage) =>
      stage.preflight.status === 'ready' && stage.preflight.releaseTrack === 'formal'
    );
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = ready ? '批准并进入调度队列' : '当前能力不能批准';
    approve.disabled = !ready;
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      clearError();
      try {
        await json('/v1/tasks/' + encodeURIComponent(task.taskId) + '/approve', { method: 'POST' });
        await refreshTasks();
      } catch (reason) {
        showError(reason);
      }
    });
    card.append(approve);
  }
  if (task.statusMessage) {
    const status = document.createElement('p');
    status.className = 'notice blocked';
    status.textContent = task.statusMessage;
    card.append(status);
  }
  return card;
}

async function refreshTasks() {
  const response = await json('/v1/tasks');
  const signature = JSON.stringify(response.tasks);
  if (signature === tasksSignature) return;
  tasksSignature = signature;
  if (response.tasks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '尚无 Research Task。任务创建后先由扩展进行 capability preflight，未达到正式能力门槛时不会打开平台。';
    taskList.replaceChildren(empty);
  } else {
    taskList.replaceChildren(...response.tasks.map(taskElement));
  }
}

async function refreshWorkspace() {
  const [status] = await Promise.all([json('/v1/status'), refreshProfiles(), refreshTasks()]);
  identity.textContent = status.identity.identityFingerprint;
  pairedCount.textContent = String(status.pairedExtensionCount);
  profileCount.textContent = String(status.browserProfileCount);
  runningCount.textContent = String(status.runningBrowserProfileCount);
  document.documentElement.dataset.collectorGatewayConsoleReady = 'true';
}

function synchroniseProfileForm() {
  const anonymousOption = accountCategory.querySelector('option[value="anonymous"]');
  if (profileKind.value === 'collection') {
    accountCategory.value = 'user_managed';
    anonymousOption.disabled = true;
  } else {
    anonymousOption.disabled = false;
  }
}

profileKind.addEventListener('change', synchroniseProfileForm);

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const submit = profileForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const expectedVisibleIdentity = profileForm.elements.expectedVisibleIdentity.value.trim();
    await json('/v1/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: profileForm.elements.kind.value,
        platform: profileForm.elements.platform.value,
        accountCategory: profileForm.elements.accountCategory.value,
        accountLabel: profileForm.elements.accountLabel.value,
        ...(expectedVisibleIdentity ? { expectedVisibleIdentity } : {})
      })
    });
    profileForm.elements.accountLabel.value = '';
    profileForm.elements.expectedVisibleIdentity.value = '';
    await refreshWorkspace();
  } catch (reason) {
    showError(reason);
  } finally {
    submit.disabled = false;
  }
});

createButton.addEventListener('click', async () => {
  createButton.disabled = true;
  clearError();
  try {
    const created = await json('/v1/pairing/sessions', { method: 'POST' });
    sessionId.textContent = created.pairingSessionId;
    pairingCode.textContent = created.pairingCode;
    expiresAt.textContent = new Date(created.expiresAt).toLocaleString();
    pairing.hidden = false;
  } catch (reason) {
    showError(reason);
  } finally {
    createButton.disabled = false;
  }
});

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const submit = taskForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  const selected = [...taskForm.querySelectorAll('input[name="platform"]:checked')];
  const platforms = selected.map((input) => input.value);
  const profileIds = {};
  try {
    if (platforms.length === 0) throw new Error('请至少选择一个平台。');
    for (const platform of platforms) {
      const select = taskForm.querySelector('select[data-profile-platform="' + platform + '"]');
      if (!select || !select.value) throw new Error('请为' + (platformLabels[platform] || platform) + '选择 Collection Profile。');
      profileIds[platform] = select.value;
    }
    await json('/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        researchQuestion: taskForm.elements.researchQuestion.value,
        decisionContext: taskForm.elements.decisionContext.value,
        query: taskForm.elements.query.value,
        platforms,
        profileIds
      })
    });
    taskForm.elements.researchQuestion.value = '';
    taskForm.elements.decisionContext.value = '';
    taskForm.elements.query.value = '';
    await refreshTasks();
  } catch (reason) {
    showError(reason);
  } finally {
    submit.disabled = false;
  }
});

synchroniseProfileForm();
refreshWorkspace().catch(showError);
setInterval(() => refreshWorkspace().catch(() => undefined), 3000);
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
      <p>本地研究控制台只监听 127.0.0.1。Gateway 从逻辑 Profile ID 管理持久、可见、隔离的 Chromium 环境；不读取日常浏览器 Profile，也不向界面暴露路径、Cookie 或凭据。</p>

      <section class="card">
        <div class="row">
          <div><h2>Gateway 身份</h2><p>ECDSA P-256 固定身份与当前浏览器运行概览</p></div>
          <span class="status">Loopback only</span>
        </div>
        <div class="grid summary-grid">
          <div class="field"><span>Identity fingerprint</span><div id="identity" class="fingerprint">读取中…</div></div>
          <div class="field"><span>Managed profiles / running</span><div class="value"><span id="profile-count">0</span> / <span id="running-count">0</span></div></div>
          <div class="field"><span>Paired extension profiles</span><div id="paired-count" class="value">0</div></div>
        </div>
      </section>

      <section class="card">
        <div><h2>受管浏览器 Profile</h2><p>Validation Profile 用于低风险实网验证；Collection Profile 绑定用户管理的登录环境。每个平台同一时间只启动一个 Profile。</p></div>
        <form id="profile-form" class="form form-columns">
          <label>Profile 类型
            <select id="profile-kind" name="kind">
              <option value="collection">Collection</option>
              <option value="validation">Validation</option>
            </select>
          </label>
          <label>平台
            <select name="platform">
              <option value="bilibili">B站</option>
              <option value="zhihu">知乎</option>
              <option value="weibo">微博</option>
              <option value="xiaohongshu">小红书</option>
            </select>
          </label>
          <label>账号类型
            <select id="account-category" name="accountCategory">
              <option value="user_managed">用户管理</option>
              <option value="anonymous">匿名</option>
            </select>
          </label>
          <label>账号标签<input name="accountLabel" required maxlength="80" placeholder="例如：B站主账号；只作为本地逻辑标签"></label>
          <label class="span-2">预期页面身份（可选）<input name="expectedVisibleIdentity" maxlength="160" placeholder="用于未来登录身份核对，不保存密码或 Cookie"></label>
          <div class="span-2"><button type="submit">创建受管 Profile</button></div>
        </form>
        <p class="notice">启动后 Gateway 会自动加载生产 MV3 扩展并打开扩展控制页。关闭浏览器不会删除 Profile，后续再次启动会复用该 Profile 的浏览器状态。</p>
        <div id="profile-list" class="profile-list"></div>
      </section>

      <section class="card">
        <div class="row">
          <div><h2>一次性 Gateway 配对</h2><p>Session 五分钟后过期，配对码最多尝试五次。</p></div>
          <button id="create-pairing" type="button">创建配对 Session</button>
        </div>
        <div id="pairing" class="grid" hidden>
          <div class="field"><span>Session ID</span><div id="session-id" class="value"></div></div>
          <div class="field"><span>8 位配对码</span><div id="pairing-code" class="code"></div></div>
          <div class="field"><span>Expires at</span><div id="expires-at" class="value"></div></div>
          <p class="notice">在刚启动的 Collector 扩展控制页核对 Gateway origin，再输入 Session ID 与配对码。扩展会验证身份指纹和签名；配对码不会保存到长期配置。</p>
        </div>
        <p id="error" class="notice" hidden></p>
      </section>

      <section class="card">
        <div><h2>创建 Scout Research Task</h2><p>每个平台必须绑定同平台 Collection Profile。任务先进入扩展 capability preflight；计划未满足正式能力门槛时不能批准，也不会打开平台页面。</p></div>
        <form id="task-form" class="form">
          <label>研究问题<input name="researchQuestion" required maxlength="500" placeholder="例如：这些平台如何讨论某个主题？"></label>
          <label>决策语境<textarea name="decisionContext" required maxlength="1000" placeholder="说明为什么需要这些证据，以及结果将用于什么判断。"></textarea></label>
          <label>站内查询词<input name="query" required maxlength="200"></label>
          <div class="platforms" aria-label="平台与 Collection Profile">
            <label class="platform-row"><span class="platform-toggle"><input type="checkbox" name="platform" value="bilibili" checked>B站</span><select data-profile-platform="bilibili" aria-label="B站 Collection Profile"></select></label>
            <label class="platform-row"><span class="platform-toggle"><input type="checkbox" name="platform" value="zhihu">知乎</span><select data-profile-platform="zhihu" aria-label="知乎 Collection Profile"></select></label>
            <label class="platform-row"><span class="platform-toggle"><input type="checkbox" name="platform" value="weibo">微博</span><select data-profile-platform="weibo" aria-label="微博 Collection Profile"></select></label>
            <label class="platform-row"><span class="platform-toggle"><input type="checkbox" name="platform" value="xiaohongshu">小红书</span><select data-profile-platform="xiaohongshu" aria-label="小红书 Collection Profile"></select></label>
          </div>
          <button type="submit">生成 capability preflight</button>
        </form>
        <div id="task-list" class="task-list"></div>
      </section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>`;
