import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtimeDir = path.join(root, 'runtime');
const storageState = path.join(root, 'cookies', 'playwright-storage-state.json');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await chromium.launch({ executablePath: chromePath, headless: true });

try {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  const activeResponse = await context.request.get('http://127.0.0.1:18081/record/active');
  const urlResponse = await context.request.get('http://127.0.0.1:18081/record/active/url');
  const activeBrowserId = (await activeResponse.text()).trim();
  const activeUrl = (await urlResponse.text()).trim();
  if (!activeBrowserId || activeBrowserId === 'null' || !activeUrl.startsWith('http')) {
    throw new Error('No resumable Maxun recording session was found.');
  }
  await page.goto('http://127.0.0.1:5173/robots', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(({ browserId, recordingUrl }) => {
    sessionStorage.setItem('browserId', browserId);
    sessionStorage.setItem('recordingUrl', recordingUrl);
    sessionStorage.setItem('initialUrl', recordingUrl);
  }, { browserId: activeBrowserId, recordingUrl: activeUrl });
  await page.goto('http://127.0.0.1:5173/recording', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(8_000);

  const frame = page.frameLocator('#dom-browser-iframe');
  const cards = frame.locator('.bili-video-card');
  await cards.first().waitFor({ state: 'visible', timeout: 30_000 });
  const cardCount = await cards.count();

  await page.getByRole('button', { name: '捕获列表' }).click();
  await cards.first().hover();
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: path.join(runtimeDir, 'capture-list-hover.png'), fullPage: true });
  await cards.first().click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(8_000);
  await page.screenshot({ path: path.join(runtimeDir, 'capture-list-selected.png'), fullPage: true });

  const inspection = await page.evaluate(() => ({
    url: location.href,
    bodyText: document.body.innerText.slice(0, 20_000),
    buttons: Array.from(document.querySelectorAll('button')).map((node) => node.textContent?.trim()).filter(Boolean),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((node) => node.textContent?.trim()).filter(Boolean),
  }));
  inspection.cardCount = cardCount;

  await fs.writeFile(
    path.join(runtimeDir, 'capture-list-selected.json'),
    `${JSON.stringify(inspection, null, 2)}\n`,
    'utf8',
  );
  console.log(`Visible Bilibili cards: ${cardCount}`);
  console.log(`Buttons after selection: ${inspection.buttons.join(' | ')}`);
  console.log(`Dialogs: ${inspection.dialogs.join(' | ')}`);
  console.log(inspection.bodyText.slice(0, 4_000));
} finally {
  await browser.close();
}
