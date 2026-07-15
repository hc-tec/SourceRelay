import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtimeDir = path.join(root, 'runtime');
const samplesDir = path.join(root, 'samples');
const storageState = path.join(root, 'cookies', 'playwright-storage-state.json');
const apiKey = (await fs.readFile(path.join(root, 'cookies', 'maxun-api-key.txt'), 'utf8')).trim();
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const frontendUrl = 'http://127.0.0.1:5173';
const backendUrl = 'http://127.0.0.1:18081';
const targetUrl = 'https://www.xiaohongshu.com/search_result?keyword=DeepSeek&source=web_search_result_notes';
const robotName = 'xiaohongshu-deepseek-authenticated-poc';
const statusPath = path.join(runtimeDir, 'xiaohongshu-interactive-status.json');

await fs.mkdir(runtimeDir, { recursive: true });
await fs.mkdir(samplesDir, { recursive: true });

const writeStatus = async (state, extra = {}) => {
  const payload = { checkedAt: new Date().toISOString(), state, ...extra };
  await fs.writeFile(statusPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`STATE ${state}`);
};

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: false,
  slowMo: 30,
  args: ['--start-maximized'],
});

try {
  const context = await browser.newContext({ storageState, viewport: null });
  const active = (await (await context.request.get(`${backendUrl}/record/active`)).text()).trim();
  if (active && active !== 'null') {
    await context.request.get(`${backendUrl}/record/stop/${active}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const main = await context.newPage();
  await main.goto(`${frontendUrl}/robots/create`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await main.getByLabel('Website URL').fill(targetUrl);
  const popupPromise = main.waitForEvent('popup', { timeout: 30_000 });
  await main.getByRole('button', { name: 'Start Recording' }).click();
  const recorder = await popupPromise;
  await recorder.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  await recorder.bringToFront();

  const frame = recorder.frameLocator('#dom-browser-iframe');
  await frame.locator('body').waitFor({ state: 'visible', timeout: 60_000 });
  await writeStatus('waiting_for_user_login');

  let authenticatedNoteCount = 0;
  const loginDeadline = Date.now() + 15 * 60_000;
  while (Date.now() < loginDeadline) {
    const noteCount = await frame.locator('section.note-item').count().catch(() => 0);
    const bodyText = await frame.locator('body').innerText().catch(() => '');
    const loginGatePresent = /登录后查看搜索结果|手机号登录|扫码/.test(bodyText);
    if (noteCount > 0 && !loginGatePresent) {
      authenticatedNoteCount = noteCount;
      break;
    }
    await recorder.waitForTimeout(2_000);
  }

  if (authenticatedNoteCount === 0) {
    await writeStatus('login_timeout');
    throw new Error('No authenticated Xiaohongshu result cards appeared within 15 minutes.');
  }
  await writeStatus('authenticated_results_visible', { noteItemCount: authenticatedNoteCount });

  // Clear every recorded login interaction before saving any Robot. This keeps
  // the authenticated BrowserContext alive but resets Maxun's workflow record.
  await recorder.getByLabel('options').click();
  await recorder.getByText('重置', { exact: true }).click();
  const resetConfirm = recorder.locator('button:visible').filter({ hasText: /^确认$/ }).last();
  await resetConfirm.click();
  await recorder.waitForTimeout(12_000);

  const notes = frame.locator('section.note-item');
  await notes.first().waitFor({ state: 'visible', timeout: 45_000 });
  const noteCountAfterReset = await notes.count();
  const title = notes.first().locator('.title, .note-title, [class*="title"]').first();
  await title.waitFor({ state: 'visible', timeout: 15_000 });

  await recorder.getByRole('button', { name: '捕获列表' }).click();
  await title.hover();
  await recorder.waitForTimeout(1_200);
  await title.click();
  await recorder.waitForTimeout(6_000);
  const drawer = recorder.locator('.MuiDrawer-modal').first();
  if (await drawer.isVisible().catch(() => false)) {
    await recorder.keyboard.press('Escape');
    await recorder.waitForTimeout(700);
  }

  await recorder.getByRole('button', { name: '确认捕获', exact: true }).click();
  await recorder.getByRole('button', { name: '没有更多项目可加载', exact: true }).click();
  await recorder.getByRole('button', { name: '确认', exact: true }).click();
  await recorder.getByLabel('自定义', { exact: true }).check();
  await recorder.locator('input[type="number"]').fill('20');
  await recorder.getByRole('button', { name: '确认', exact: true }).click();
  await recorder.waitForTimeout(6_000);
  await recorder.keyboard.press('Escape');

  await recorder.locator('button:visible').filter({ hasText: /^完成$/ }).last().click();
  const nameInput = recorder.locator('#title');
  await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
  await nameInput.fill(robotName);
  await recorder.getByRole('button', { name: '保存', exact: true }).click();

  let robot = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const robots = await (await context.request.get(`${backendUrl}/api/robots`, {
      headers: { 'x-api-key': apiKey },
    })).json();
    robot = robots.robots?.items?.find((item) => item.name === robotName) || null;
    if (robot) break;
  }
  if (!robot) throw new Error('Authenticated Xiaohongshu Robot was not saved.');
  await writeStatus('authenticated_robot_saved', { noteItemCount: noteCountAfterReset });

  const startedAt = Date.now();
  const runResponse = await context.request.post(`${backendUrl}/api/robots/${robot.id}/runs`, {
    headers: { 'x-api-key': apiKey },
    data: {},
    timeout: 300_000,
  });
  const runText = await runResponse.text();
  let runPayload;
  try {
    runPayload = JSON.parse(runText);
  } catch {
    runPayload = { rawResponse: runText };
  }
  const runDurationMs = Date.now() - startedAt;
  const rows = runPayload.run?.data?.listData?.['List Data 1'] || [];
  const result = {
    checkedAt: new Date().toISOString(),
    targetUrl,
    recordingNoteItemCount: noteCountAfterReset,
    apiRunHttpStatus: runResponse.status(),
    apiRunStatus: runPayload.run?.status || null,
    apiRunDurationMs: runDurationMs,
    apiRunRowCount: Array.isArray(rows) ? rows.length : 0,
    run: runPayload,
  };
  await fs.writeFile(
    path.join(samplesDir, 'maxun-xiaohongshu-authenticated-recording-vs-api-run.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  await writeStatus('complete', {
    recordingNoteItemCount: noteCountAfterReset,
    apiRunHttpStatus: runResponse.status(),
    apiRunStatus: result.apiRunStatus,
    apiRunRowCount: result.apiRunRowCount,
  });
} catch (error) {
  const previous = await fs.readFile(statusPath, 'utf8').then(JSON.parse).catch(() => ({}));
  await writeStatus('failed', { previousState: previous.state || null, error: error.message.split('\n')[0] });
  throw error;
} finally {
  await browser.close();
}
