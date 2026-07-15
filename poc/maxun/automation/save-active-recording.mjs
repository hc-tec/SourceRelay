import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const storageState = path.join(root, 'cookies', 'playwright-storage-state.json');
const apiKey = (await fs.readFile(path.join(root, 'cookies', 'maxun-api-key.txt'), 'utf8')).trim();
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const frontendUrl = 'http://127.0.0.1:5173';
const backendUrl = 'http://127.0.0.1:18081';
const robotName = 'bilibili-deepseek-poc';

const browser = await chromium.launch({ executablePath: chromePath, headless: true });

try {
  const context = await browser.newContext({ storageState, viewport: { width: 1600, height: 1000 } });
  const active = await context.request.get(`${backendUrl}/record/active`);
  const activeBrowserId = (await active.text()).trim();
  const activeUrlResponse = await context.request.get(`${backendUrl}/record/active/url`);
  const activeUrl = (await activeUrlResponse.text()).trim();
  if (!activeBrowserId || activeBrowserId === 'null') throw new Error('No active recording to save.');

  const page = await context.newPage();
  await page.goto(`${frontendUrl}/robots`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(({ browserId, recordingUrl }) => {
    sessionStorage.setItem('browserId', browserId);
    sessionStorage.setItem('recordingUrl', recordingUrl);
    sessionStorage.setItem('initialUrl', recordingUrl);
  }, { browserId: activeBrowserId, recordingUrl: activeUrl });
  await page.goto(`${frontendUrl}/recording`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: '捕获列表' }).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(3_000);

  const finishButton = page.locator('button:visible').filter({ hasText: /^完成$/ }).last();
  const visibleFinishCount = await page.locator('button:visible').filter({ hasText: /^完成$/ }).count();
  if (visibleFinishCount < 1) throw new Error('No visible Finish button was found.');
  await finishButton.click();

  const nameInput = page.locator('#title');
  await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
  await nameInput.fill(robotName);
  await page.getByRole('button', { name: '保存', exact: true }).click();

  let savedRobot = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(1_000);
    const robotsResponse = await context.request.get(`${backendUrl}/api/robots`, {
      headers: { 'x-api-key': apiKey },
    });
    const payload = await robotsResponse.json();
    savedRobot = payload.robots?.items?.find((item) => item.name === robotName) || null;
    if (savedRobot) break;
  }
  if (!savedRobot) throw new Error('The saved robot did not appear in GET /api/robots.');

  console.log(`Saved active recording as ${robotName}.`);
  console.log(`Visible Finish buttons before save: ${visibleFinishCount}`);
} catch (error) {
  throw error;
} finally {
  await browser.close();
}
