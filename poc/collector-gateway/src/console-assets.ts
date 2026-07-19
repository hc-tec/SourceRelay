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
.profile-list, .validation-list, .recon-list, .task-list { display: grid; gap: 10px; margin-top: 16px; }
.profile, .task { padding: 14px; border: 1px solid #dde4eb; border-radius: 12px; background: #f9fbfc; }
.validation, .reconnaissance { padding: 14px; border: 1px solid #dde4eb; border-radius: 12px; background: #f9fbfc; }
.validation h3, .reconnaissance h3 { margin: 0 0 5px; font-size: 14px; }
.validation-items { display: grid; gap: 5px; margin: 10px 0 0; padding-left: 20px; color: #4c5967; font-size: 12px; }
.profile h3, .task h3 { margin: 0 0 5px; font-size: 14px; }
.profile-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.profile-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
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
const validationForm = document.querySelector('#validation-form');
const validationProfile = document.querySelector('#validation-profile');
const detailValidationForm = document.querySelector('#detail-validation-form');
const detailValidationProfile = document.querySelector('#detail-validation-profile');
const validationList = document.querySelector('#validation-list');
const reconnaissanceForm = document.querySelector('#reconnaissance-form');
const reconnaissanceProfile = document.querySelector('#reconnaissance-profile');
const reconnaissanceList = document.querySelector('#reconnaissance-list');
const taskForm = document.querySelector('#task-form');
const taskList = document.querySelector('#task-list');
let profiles = [];
let profilesSignature = '';
const profileLoginStates = new Map();
const accountSafetyByProfile = new Map();
let accountSafetySignature = '';
let validationsSignature = '';
let reconnaissanceSignature = '';
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

function updateValidationProfileSelector() {
  const previous = validationProfile.value;
  const detailPrevious = detailValidationProfile.value;
  const reconnaissancePrevious = reconnaissanceProfile.value;
  const eligible = profiles.filter((summary) =>
    summary.profile.kind === 'validation' &&
    summary.profile.platform === 'bilibili' &&
    summary.profile.account.category === 'anonymous'
  );
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = eligible.length ? '选择 B站匿名 Validation Profile' : '尚无 B站匿名 Validation Profile';
  const options = eligible.map((summary) => {
    const option = document.createElement('option');
    option.value = summary.profile.profileId;
    option.textContent = summary.profile.account.label + (summary.running ? ' · 运行中' : '');
    return option;
  });
  validationProfile.replaceChildren(placeholder, ...options);
  if (eligible.some((summary) => summary.profile.profileId === previous)) validationProfile.value = previous;
  else if (eligible.length === 1) validationProfile.value = eligible[0].profile.profileId;
  const detailPlaceholder = placeholder.cloneNode(true);
  const detailOptions = options.map((option) => option.cloneNode(true));
  detailValidationProfile.replaceChildren(detailPlaceholder, ...detailOptions);
  if (eligible.some((summary) => summary.profile.profileId === detailPrevious)) {
    detailValidationProfile.value = detailPrevious;
  } else if (eligible.length === 1) {
    detailValidationProfile.value = eligible[0].profile.profileId;
  }
  const reconnaissancePlaceholder = placeholder.cloneNode(true);
  const reconnaissanceOptions = options.map((option) => option.cloneNode(true));
  reconnaissanceProfile.replaceChildren(reconnaissancePlaceholder, ...reconnaissanceOptions);
  if (eligible.some((summary) => summary.profile.profileId === reconnaissancePrevious)) {
    reconnaissanceProfile.value = reconnaissancePrevious;
  } else if (eligible.length === 1) {
    reconnaissanceProfile.value = eligible[0].profile.profileId;
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
  if (summary.profile.kind === 'collection') {
    const accountSafety = accountSafetyByProfile.get(summary.profile.profileId);
    const platformAutomationAllowed = !accountSafety || accountSafety.state === 'ready';
    const managedActions = [];
    if (accountSafety?.state !== 'locked') {
      managedActions.push({
        label: '暂停账号自动化',
        path: '/account-safety/pause',
        tone: 'secondary',
        capturesAccountSafety: true
      });
    }
    if (summary.profile.platform === 'bilibili' && platformAutomationAllowed) {
      managedActions.push({ label: '打开B站登录页', path: '/login-page', tone: 'secondary' });
      managedActions.push({
        label: '核对B站登录状态',
        path: '/login-status',
        tone: 'secondary',
        capturesLoginStatus: true
      });
    }
    if (!summary.extensionPaired) {
      managedActions.push({ label: '配对 Gateway', path: '/pair', tone: '' });
    }
    if (summary.strategyPermission !== 'granted') {
      managedActions.push({
        label: '授予' + platformLabels[summary.profile.platform] + '权限',
        path: '/strategy-permission',
        tone: ''
      });
    }
    if (
      platformAutomationAllowed && summary.running &&
      summary.extensionPaired && summary.strategyPermission === 'granted'
    ) {
      managedActions.push({ label: '立即轮询任务', path: '/poll', tone: 'secondary' });
    }
    for (const managedAction of managedActions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = managedAction.tone;
      button.textContent = managedAction.label;
      button.addEventListener('click', async () => {
        button.disabled = true;
        clearError();
        try {
          const result = await json(
            '/v1/profiles/' + encodeURIComponent(summary.profile.profileId) + managedAction.path,
            { method: 'POST' }
          );
          if (managedAction.capturesLoginStatus && result.loginStatus) {
            profileLoginStates.set(summary.profile.profileId, result.loginStatus);
            profilesSignature = '';
          }
          if (managedAction.capturesAccountSafety) {
            await refreshAccountSafety();
            profilesSignature = '';
          }
          await refreshWorkspace();
        } catch (reason) {
          showError(reason);
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
  }
  top.append(description, actions);

  const metaRow = document.createElement('div');
  metaRow.className = 'profile-meta';
  metaRow.append(
    runtimePill(summary.running ? 'Browser running' : 'Browser stopped', summary.running ? 'good' : ''),
    runtimePill(summary.extensionLoaded ? 'Extension loaded' : 'Extension not loaded', summary.extensionLoaded ? 'good' : ''),
    runtimePill(summary.extensionPaired ? 'Gateway paired' : 'Pairing required', summary.extensionPaired ? 'good' : 'warn'),
    runtimePill(
      summary.strategyPermission === 'granted'
        ? 'Platform permission granted'
        : summary.strategyPermission === 'missing'
          ? 'Platform permission required'
          : 'Platform permission unknown',
      summary.strategyPermission === 'granted' ? 'good' : 'warn'
    )
  );
  if (summary.profile.account.expectedVisibleIdentity) {
    metaRow.append(runtimePill('Expected: ' + summary.profile.account.expectedVisibleIdentity));
  }
  const loginStatus = profileLoginStates.get(summary.profile.profileId);
  if (loginStatus) {
    metaRow.append(runtimePill(
      loginStatus.state === 'authenticated'
        ? '上次核对：已登录'
        : loginStatus.state === 'anonymous'
          ? '上次核对：未登录'
          : '上次核对：无法判断',
      loginStatus.state === 'authenticated' ? 'good' : 'warn'
    ));
  }
  const accountSafety = accountSafetyByProfile.get(summary.profile.profileId);
  if (accountSafety) {
    const safetyLabel = accountSafety.state === 'ready'
      ? '账号自动化：可显式启动'
      : accountSafety.state === 'running'
        ? '账号自动化：运行中'
        : accountSafety.state === 'cooldown'
          ? '账号自动化：冷却中'
          : '账号自动化：已锁定';
    metaRow.append(runtimePill(
      safetyLabel + (accountSafety.reasonCode ? ' · ' + accountSafety.reasonCode : ''),
      accountSafety.state === 'ready' ? 'good' : 'warn'
    ));
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
  updateValidationProfileSelector();
  updateTaskProfileSelectors();
}

async function refreshAccountSafety() {
  const response = await json('/v1/account-safety');
  const signature = JSON.stringify(response.records);
  if (signature === accountSafetySignature) return;
  accountSafetySignature = signature;
  accountSafetyByProfile.clear();
  for (const record of response.records) accountSafetyByProfile.set(record.profileId, record);
  profilesSignature = '';
  tasksSignature = '';
}

function validationElement(validation) {
  const card = document.createElement('article');
  card.className = 'validation';
  const title = document.createElement('h3');
  title.textContent = 'B站 ' + validation.evidenceObjective + ' · ' + validation.state;
  const meta = document.createElement('p');
  meta.textContent = validation.terminalStatus + ' · ' + validation.strategy.strategyId + ' ' + validation.strategy.version;
  const badges = document.createElement('div');
  badges.className = 'profile-meta';
  badges.append(
    runtimePill(validation.result ? validation.result.pageState : 'no DOM result', validation.state === 'completed' ? 'good' : 'warn'),
    runtimePill((validation.result ? validation.result.itemCount : 0) + ' visible items'),
    runtimePill('Review ' + validation.review.status, validation.review.status === 'accepted' ? 'good' : 'warn'),
    runtimePill(
      validation.review.admittedToStrategyRegistry ? 'Admitted' : 'Not admitted',
      validation.review.admittedToStrategyRegistry ? 'good' : ''
    )
  );
  card.append(title, meta, badges);
  if (validation.errorCode) {
    const issue = document.createElement('p');
    issue.className = 'notice blocked';
    issue.textContent = validation.errorCode;
    card.append(issue);
  }
  if (validation.result && validation.result.operation === 'breadth_search' && validation.result.items.length) {
    const items = document.createElement('ol');
    items.className = 'validation-items';
    for (const item of validation.result.items.slice(0, 5)) {
      const row = document.createElement('li');
      row.textContent = item.title + ' · ' + item.url;
      items.append(row);
    }
    card.append(items);
  }
  if (validation.result && validation.result.operation === 'detail_read' && validation.result.detail) {
    const detail = document.createElement('div');
    detail.className = 'task-stage';
    const creator = validation.result.detail.creator
      ? ' · UP ' + validation.result.detail.creator.displayName
      : '';
    const description = validation.result.detail.description
      ? ' · 简介 ' + validation.result.detail.description.slice(0, 240)
      : ' · 无可见简介';
    detail.textContent = validation.result.detail.title + creator + description;
    card.append(detail);
  }
  if (validation.review.status === 'pending') {
    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    for (const decision of ['reject', 'accept']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = decision === 'reject' ? 'secondary' : '';
      button.textContent = decision === 'reject' ? '标记验证不通过' : '标记审查通过（仍不发布）';
      button.addEventListener('click', async () => {
        button.disabled = true;
        clearError();
        try {
          await json('/v1/validations/' + encodeURIComponent(validation.recordId) + '/review', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              decision,
              decisionCode: decision === 'reject'
                ? 'manual_validation_review_rejected'
                : 'manual_validation_review_accepted'
            })
          });
          await refreshValidations();
        } catch (reason) {
          showError(reason);
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
    card.append(actions);
  }
  return card;
}

async function refreshValidations() {
  const response = await json('/v1/validations');
  const signature = JSON.stringify(response.validations);
  if (signature === validationsSignature) return;
  validationsSignature = signature;
  if (response.validations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '尚无真实能力验证记录。成功运行也只会进入 Review pending，不会自动升级策略。';
    validationList.replaceChildren(empty);
  } else {
    validationList.replaceChildren(...response.validations.map(validationElement));
  }
}

function reconnaissanceElement(run) {
  const card = document.createElement('article');
  card.className = 'reconnaissance';
  const title = document.createElement('h3');
  title.textContent = 'B站 video_detail Source Reconnaissance · ' + run.state;
  const meta = document.createElement('p');
  meta.textContent = new Date(run.completedAt).toLocaleString() + ' · Run ' + run.runId;
  const pills = document.createElement('div');
  pills.className = 'profile-meta';
  pills.append(
    runtimePill(run.domObservations.length + ' DOM checkpoints', run.domObservations.length ? 'good' : 'warn'),
    runtimePill(run.networkObservations.length + ' XHR/fetch metadata'),
    runtimePill(run.routeSummary.length + ' sanitised routes'),
    runtimePill('Validation ' + (run.validation.state || 'not started'), run.validation.state === 'completed' ? 'good' : 'warn')
  );
  card.append(title, meta, pills);
  if (run.errorCode) {
    const issue = document.createElement('p');
    issue.className = 'notice blocked';
    issue.textContent = run.errorCode;
    card.append(issue);
  }
  const safeguards = document.createElement('p');
  safeguards.className = 'notice';
  safeguards.textContent = '并行 DOM + network metadata；query/hash、header、request body、response body、Cookie/Token 均不保存；该记录不能准入生产 route。';
  card.append(safeguards);
  if (run.routeSummary.length) {
    const routes = document.createElement('ul');
    routes.className = 'validation-items';
    for (const route of run.routeSummary.slice(0, 12)) {
      const item = document.createElement('li');
      item.textContent = route.resourceType + ' · ' + route.method + ' ' + route.origin + route.pathname +
        ' · ' + route.count + ' 次 · HTTP ' + (route.statusCodes.join('/') || 'failed');
      routes.append(item);
    }
    card.append(routes);
  }
  return card;
}

async function refreshReconnaissance() {
  const response = await json('/v1/reconnaissance');
  const signature = JSON.stringify(response.runs);
  if (signature === reconnaissanceSignature) return;
  reconnaissanceSignature = signature;
  if (response.runs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '尚无 Source Reconnaissance。运行记录只用于理解页面与数据流，不能自动加入 production response route。';
    reconnaissanceList.replaceChildren(empty);
  } else {
    reconnaissanceList.replaceChildren(...response.runs.map(reconnaissanceElement));
  }
}

function nextTaskAccountSafety(task) {
  if (!task.plan || !Array.isArray(task.plan.stages)) return null;
  const progress = (task.stageProgress || []).find((candidate) => candidate.state === 'pending');
  const stage = progress && task.plan.stages.find((candidate) => candidate.stageId === progress.stageId);
  const binding = stage && task.profileBindings && task.profileBindings[stage.platform];
  if (!progress || !stage || !binding) return null;
  return { progress, stage, binding, safety: accountSafetyByProfile.get(binding.profileId) || null };
}

function accountSafetyTaskNotice(context) {
  if (!context) return '下一阶段或其 Collection Profile 绑定缺失，任务不能继续。';
  const safety = context.safety;
  if (!safety || safety.state === 'ready') return '账号安全门禁已就绪，仍需你显式确认后才会把下一阶段放回调度队列。';
  if (safety.state === 'locked' || safety.manualUnlockRequired) {
    return '账号安全门禁已锁定；请先在账号安全区域人工解锁。任务继续按钮不会代替解锁。';
  }
  if (safety.state === 'running') return '该 Collection Profile 当前有另一个 run，当前任务不能继续。';
  const cooldownUntil = Date.parse(safety.cooldownUntil || '');
  if (Number.isFinite(cooldownUntil) && cooldownUntil > Date.now()) {
    return '账号仍在冷却，最早可在 ' + new Date(cooldownUntil).toLocaleString() +
      ' 后继续；到时仍须你显式点击，系统不会后台恢复。';
  }
  return '冷却时间已经结束，但任务仍保持暂停；只有你显式点击后才会继续下一阶段。';
}

function taskElement(task) {
  const card = document.createElement('article');
  card.className = 'task';
  const title = document.createElement('h3');
  title.textContent = task.researchQuestion;
  const meta = document.createElement('p');
  meta.textContent = task.profile + ' · ' + task.platforms.map(
    (platform) => platformLabels[platform] || platform
  ).join(' · ') + ' · ' + task.state;
  card.append(title, meta);

  if (task.lineage) {
    const lineage = document.createElement('p');
    lineage.className = 'notice';
    lineage.textContent = '详情来源 Evidence ' + task.lineage.sourceEvidenceBatchId +
      ' · 用户显式选择排名 ' + task.lineage.selectedItems.map((item) => item.sourceRank).join(', ');
    card.append(lineage);
  }

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
      const progress = (task.stageProgress || []).find((item) => item.stageId === stage.stageId);
      row.textContent = (platformLabels[stage.platform] || stage.platform) + ' / ' +
        stage.evidenceObjective + ' — ' + stage.preflight.status + ' (' +
        stage.preflight.releaseTrack + ') · ' + (progress ? progress.state : 'not approved');
      card.append(row);
    }
    const ready = task.plan.stages.length > 0 && task.plan.stages.every((stage) =>
      stage.preflight.status === 'ready' && stage.preflight.releaseTrack === 'formal'
    );
    if (task.state === 'awaiting_plan_approval') {
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
  }
  if (task.statusMessage) {
    const status = document.createElement('p');
    status.className = 'notice blocked';
    status.textContent = task.statusMessage;
    card.append(status);
  }
  if (task.state === 'waiting_for_account_safety') {
    const context = nextTaskAccountSafety(task);
    const safetyNotice = document.createElement('p');
    safetyNotice.className = 'notice blocked';
    safetyNotice.textContent = accountSafetyTaskNotice(context);
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'secondary';
    resume.textContent = '账号冷却结束后继续下一阶段';
    resume.disabled = !context || context.safety?.state === 'locked' || context.safety?.state === 'running';
    resume.addEventListener('click', async () => {
      resume.disabled = true;
      clearError();
      try {
        await json('/v1/tasks/' + encodeURIComponent(task.taskId) + '/resume-after-account-safety', {
          method: 'POST'
        });
        await refreshAccountSafety();
        await refreshTasks();
      } catch (reason) {
        showError(reason);
        resume.disabled = false;
      }
    });
    card.append(safetyNotice, resume);
  }
  for (const item of task.evidence || []) {
    const evidence = document.createElement('div');
    evidence.className = 'task-stage';
    evidence.textContent = 'Evidence ' + item.batchId + ' · ' + item.itemCount +
      ' items · SHA-256 ' + item.digest;
    card.append(evidence);
  }
  if (
    task.profile === 'scout' && task.state === 'completed' &&
    Array.isArray(task.evidence) && task.evidence.length > 0 && task.profileBindings.bilibili
  ) {
    const openSelection = document.createElement('button');
    openSelection.type = 'button';
    openSelection.className = 'secondary';
    openSelection.textContent = '从该 Evidence 选择视频详情（最多 3 条）';
    openSelection.addEventListener('click', async () => {
      openSelection.disabled = true;
      clearError();
      try {
        const response = await json('/v1/evidence/batches/' + encodeURIComponent(task.evidence[0].batchId));
        if (!response.batch.result || response.batch.result.operation !== 'breadth_search') {
          throw new Error('该 Evidence 不是可深化的 breadth_search 结果。');
        }
        const form = document.createElement('form');
        form.className = 'form';
        const choices = document.createElement('div');
        choices.className = 'platforms';
        for (const resultItem of response.batch.result.items) {
          const label = document.createElement('label');
          label.className = 'platform-row';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.name = 'detail-rank';
          checkbox.value = String(resultItem.rank);
          checkbox.style.width = 'auto';
          const text = document.createElement('span');
          text.textContent = '#' + resultItem.rank + ' ' + resultItem.title;
          label.append(checkbox, text);
          choices.append(label);
        }
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = '生成独立 detail_read 计划';
        form.append(choices, submit);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const selectedRanks = [...form.querySelectorAll('input[name="detail-rank"]:checked')]
            .map((input) => Number(input.value));
          if (selectedRanks.length === 0 || selectedRanks.length > 3) {
            showError(new Error('请选择 1–3 条视频。'));
            return;
          }
          submit.disabled = true;
          clearError();
          try {
            await json('/v1/tasks/detail', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                researchQuestion: task.researchQuestion + '：读取用户选中视频的公开详情',
                decisionContext: '从已完成的 breadth Evidence 中由用户显式选择条目，按独立详情预算读取公开可见字段。',
                sourceTaskId: task.taskId,
                sourceEvidenceBatchId: task.evidence[0].batchId,
                selectedRanks,
                profileId: task.profileBindings.bilibili.profileId
              })
            });
            await refreshTasks();
          } catch (reason) {
            showError(reason);
            submit.disabled = false;
          }
        });
        openSelection.replaceWith(form);
      } catch (reason) {
        showError(reason);
        openSelection.disabled = false;
      }
    });
    card.append(openSelection);
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
  await refreshAccountSafety();
  const [status] = await Promise.all([
    json('/v1/status'),
    refreshProfiles(),
    refreshValidations(),
    refreshReconnaissance(),
    refreshTasks()
  ]);
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

validationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const submit = validationForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    if (!validationProfile.value) throw new Error('请先创建并选择 B站匿名 Validation Profile。');
    await json('/v1/profiles/' + encodeURIComponent(validationProfile.value) + '/validations/bilibili', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: validationForm.elements.query.value })
    });
    await refreshWorkspace();
  } catch (reason) {
    showError(reason);
  } finally {
    submit.disabled = false;
  }
});

detailValidationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const submit = detailValidationForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    if (!detailValidationProfile.value) throw new Error('请先创建并选择 B站匿名 Validation Profile。');
    await json(
      '/v1/profiles/' + encodeURIComponent(detailValidationProfile.value) + '/validations/bilibili-detail',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalUrl: detailValidationForm.elements.canonicalUrl.value })
      }
    );
    await refreshWorkspace();
  } catch (reason) {
    showError(reason);
  } finally {
    submit.disabled = false;
  }
});

reconnaissanceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const submit = reconnaissanceForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    if (!reconnaissanceProfile.value) throw new Error('请先创建并选择 B站匿名 Validation Profile。');
    await json(
      '/v1/profiles/' + encodeURIComponent(reconnaissanceProfile.value) + '/reconnaissance/bilibili-detail',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalUrl: reconnaissanceForm.elements.canonicalUrl.value })
      }
    );
    await refreshReconnaissance();
    await refreshValidations();
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
        <p class="notice">启动后 Gateway 会自动加载生产 MV3 扩展并打开扩展控制页。Collection Profile 可通过严格白名单入口打开官方登录页；扫码、验证码等认证动作始终由用户完成。账号自动化出现验证码、风控或中断后会持久锁定，普通刷新和 Gateway 重启不能解锁。关闭浏览器不会删除 Profile，后续再次启动会复用该 Profile 的浏览器状态。</p>
        <div id="profile-list" class="profile-list"></div>
      </section>

      <section class="card">
        <div><h2>B站匿名能力验证</h2><p>只允许 B站匿名 Validation Profile、首个渲染页面、最多 20 条可见 DOM 结果和 0 次页面交互。不会启用 response observation，也不会自动升级策略。</p></div>
        <form id="validation-form" class="form form-columns">
          <label>Validation Profile<select id="validation-profile" name="profileId"></select></label>
          <label>验证查询词<input name="query" required maxlength="200" value="人工智能"></label>
          <div class="span-2"><button type="submit">运行一次低频真实验证</button></div>
        </form>
        <p class="notice">Gateway 会启动可见浏览器，并通过生产扩展的独立短时 Validation Run 注入同一个 content.js。遇到登录墙、验证码、限流、无结果或布局无法识别时会记录为 inconclusive 并停止。</p>
        <div id="validation-list" class="validation-list"></div>
        <form id="detail-validation-form" class="form form-columns">
          <label>Validation Profile<select id="detail-validation-profile" name="profileId"></select></label>
          <label>公开 B站视频规范 URL<input name="canonicalUrl" required maxlength="120" placeholder="https://www.bilibili.com/video/BV..."></label>
          <div class="span-2"><button type="submit">验证 B站可见视频详情投影</button></div>
        </form>
        <p class="notice">详情验证只读取标题、UP 主公开信息、简介、可见指标和标签；不采集评论、推荐卡或网络响应。</p>
        <form id="reconnaissance-form" class="form form-columns">
          <label>Validation Profile<select id="reconnaissance-profile" name="profileId"></select></label>
          <label>公开 B站视频规范 URL<input name="canonicalUrl" required maxlength="120" placeholder="https://www.bilibili.com/video/BV..."></label>
          <div class="span-2"><button type="submit">并行勘察 DOM 与 XHR/fetch</button></div>
        </form>
        <p class="notice">侦察只保存页面生命周期、DOM 字段信号和去 query/hash 的网络元数据；不读取请求头/体、响应正文、Cookie 或 Token，也不会改变正式策略。</p>
        <div id="reconnaissance-list" class="recon-list"></div>
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
