import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtimeDir = path.join(root, 'runtime');
const samplesDir = path.join(root, 'samples');
const storageState = path.join(root, 'cookies', 'playwright-storage-state.json');
const apiKeyPath = path.join(root, 'cookies', 'maxun-api-key.txt');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const frontendUrl = 'http://127.0.0.1:5173';
const backendUrl = 'http://127.0.0.1:18081';
const targetUrl = 'https://search.bilibili.com/all?keyword=DeepSeek';
const robotName = 'bilibili-deepseek-titles-poc';

await fs.mkdir(runtimeDir, { recursive: true });
await fs.mkdir(samplesDir, { recursive: true });

const apiKey = (await fs.readFile(apiKeyPath, 'utf8')).trim();
if (!apiKey) throw new Error('The ignored Maxun API key file is empty.');

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
let recorder;

const captureScreenshot = async (name) => {
  if (recorder && !recorder.isClosed()) {
    await recorder.screenshot({ path: path.join(runtimeDir, name), fullPage: true });
  }
};

try {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1600, height: 1000 },
  });

  const activeResponse = await context.request.get(`${backendUrl}/record/active`);
  const activeBrowserId = (await activeResponse.text()).trim();
  if (activeBrowserId && activeBrowserId !== 'null') {
    await context.request.get(`${backendUrl}/record/stop/${activeBrowserId}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const page = await context.newPage();
  await page.goto(`${frontendUrl}/robots/create`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await page.getByLabel('Website URL').fill(targetUrl);

  const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Start Recording' }).click();
  recorder = await popupPromise;
  await recorder.waitForLoadState('domcontentloaded', { timeout: 30_000 });

  const frame = recorder.frameLocator('#dom-browser-iframe');
  const cards = frame.locator('.bili-video-card');
  await cards.first().waitFor({ state: 'visible', timeout: 60_000 });
  const detectedCardCount = await cards.count();

  await recorder.getByRole('button', { name: '捕获列表' }).click();
  const firstTitle = cards.first().locator('h3.bili-video-card__info--tit').first();
  await firstTitle.hover();
  await recorder.waitForTimeout(1_200);
  await firstTitle.click();
  await recorder.waitForTimeout(6_000);

  const closeOutputDrawer = async () => {
    const drawer = recorder.locator('.MuiDrawer-modal').first();
    if (await drawer.isVisible().catch(() => false)) {
      await recorder.keyboard.press('Escape');
      await recorder.waitForTimeout(700);
    }
  };
  await closeOutputDrawer();

  await captureScreenshot('bilibili-title-list-selected.png');

  await recorder.getByRole('button', { name: '确认捕获', exact: true }).click();
  await recorder.getByRole('button', { name: '没有更多项目可加载', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await recorder.getByRole('button', { name: '没有更多项目可加载', exact: true }).click();
  await recorder.getByRole('button', { name: '确认', exact: true }).click();

  const customLimit = recorder.getByLabel('自定义', { exact: true });
  await customLimit.waitFor({ state: 'visible', timeout: 10_000 });
  await customLimit.check();
  await recorder.locator('input[type="number"]').fill('30');
  await recorder.getByRole('button', { name: '确认', exact: true }).click();
  await recorder.waitForTimeout(8_000);
  await captureScreenshot('bilibili-capture-complete.png');

  await recorder.keyboard.press('Escape');
  const finishButton = recorder.locator('button:visible').filter({ hasText: /^完成$/ }).last();
  await finishButton.click();
  const nameInput = recorder.locator('#title');
  await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
  await nameInput.fill(robotName);

  const closePromise = recorder.waitForEvent('close', { timeout: 60_000 });
  await recorder.getByRole('button', { name: '保存', exact: true }).click();
  await closePromise;
  recorder = undefined;
  await page.waitForTimeout(4_000);

  const apiHeaders = { 'x-api-key': apiKey };
  const robotsResponse = await context.request.get(`${backendUrl}/api/robots`, { headers: apiHeaders });
  const robotsPayload = await robotsResponse.json();
  const robot = robotsPayload.robots?.items?.find((item) => item.name === robotName);
  if (!robot) {
    throw new Error(`Saved robot ${robotName} was not returned by GET /api/robots.`);
  }

  const robotResponse = await context.request.get(`${backendUrl}/api/robots/${robot.id}`, { headers: apiHeaders });
  const robotPayload = await robotResponse.json();
  await fs.writeFile(
    path.join(samplesDir, 'maxun-bilibili-deepseek-titles-robot.json'),
    `${JSON.stringify(robotPayload, null, 2)}\n`,
    'utf8',
  );

  const runStartedAt = Date.now();
  const runResponse = await context.request.post(`${backendUrl}/api/robots/${robot.id}/runs`, {
    headers: apiHeaders,
    data: {},
    timeout: 240_000,
  });
  const runPayload = await runResponse.json();
  const runDurationMs = Date.now() - runStartedAt;
  await fs.writeFile(
    path.join(samplesDir, 'maxun-bilibili-deepseek-titles-api-run.json'),
    `${JSON.stringify(runPayload, null, 2)}\n`,
    'utf8',
  );

  const listGroups = Object.values(runPayload.run?.data?.listData || {});
  const listRowCount = listGroups.reduce((total, group) => {
    if (Array.isArray(group)) return total + group.length;
    if (group && typeof group === 'object') {
      const arrays = Object.values(group).filter(Array.isArray);
      return total + (arrays[0]?.length || 0);
    }
    return total;
  }, 0);

  const summary = {
    checkedAt: new Date().toISOString(),
    targetUrl,
    robotName,
    detectedCardCount,
    robotsApiStatus: robotsResponse.status(),
    robotApiStatus: robotResponse.status(),
    runApiStatus: runResponse.status(),
    runStatus: runPayload.run?.status || null,
    runDurationMs,
    listGroupCount: listGroups.length,
    estimatedListRowCount: listRowCount,
  };
  await fs.writeFile(
    path.join(runtimeDir, 'bilibili-titles-end-to-end-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  console.log(`Robot saved: ${robotName}`);
  console.log(`Detected cards during recording: ${detectedCardCount}`);
  console.log(`API run HTTP/status: ${runResponse.status()} / ${summary.runStatus}`);
  console.log(`API run duration: ${(runDurationMs / 1000).toFixed(3)} seconds`);
  console.log(`Estimated list rows: ${listRowCount}`);
} catch (error) {
  await captureScreenshot('bilibili-end-to-end-error.png').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
