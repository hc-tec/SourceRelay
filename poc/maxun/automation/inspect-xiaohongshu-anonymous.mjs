import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtimeDir = path.join(root, 'runtime');
const storageState = path.join(root, 'cookies', 'playwright-storage-state.json');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const frontendUrl = 'http://127.0.0.1:5173';
const backendUrl = 'http://127.0.0.1:18081';
const targetUrl = 'https://www.xiaohongshu.com/search_result?keyword=DeepSeek&source=web_search_result_notes';

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
let recorder;

try {
  const context = await browser.newContext({ storageState, viewport: { width: 1600, height: 1000 } });
  const active = (await (await context.request.get(`${backendUrl}/record/active`)).text()).trim();
  if (active && active !== 'null') {
    await context.request.get(`${backendUrl}/record/stop/${active}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const page = await context.newPage();
  await page.goto(`${frontendUrl}/robots/create`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByLabel('Website URL').fill(targetUrl);
  const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Start Recording' }).click();
  recorder = await popupPromise;
  await recorder.waitForLoadState('domcontentloaded', { timeout: 30_000 });

  const frame = recorder.frameLocator('#dom-browser-iframe');
  await frame.locator('body').waitFor({ state: 'visible', timeout: 60_000 });
  let domStreamReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bodyText = await frame.locator('body').innerText().catch(() => '');
    if (bodyText.trim().length > 100) {
      domStreamReady = true;
      break;
    }
    await recorder.waitForTimeout(1_000);
  }

  const candidates = frame.locator('#search-input-in-feeds, #search-input, textarea, input[type="search"]');
  let visibleSearch = null;
  const candidateCount = await candidates.count();
  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      visibleSearch = candidate;
      break;
    }
  }

  let searchAttempted = false;
  let searchBlockedReason = null;
  if (visibleSearch) {
    try {
      await visibleSearch.click({ timeout: 5_000 });
      await visibleSearch.pressSequentially('DeepSeek', { delay: 120 });
      await visibleSearch.press('Enter');
      searchAttempted = true;
      await recorder.waitForTimeout(20_000);
    } catch (error) {
      searchBlockedReason = error.message.includes('intercepts pointer events')
        ? 'login overlay intercepted the search input'
        : error.message.split('\n')[0];
    }
  }

  const activeUrl = (await (await context.request.get(`${backendUrl}/record/active/url`)).text()).trim();
  const inspection = await recorder.evaluate(() => {
    const iframe = document.querySelector('#dom-browser-iframe');
    const doc = iframe?.contentDocument;
    return {
      outerBodyText: document.body.innerText.slice(0, 5_000),
      frameBodyText: doc?.body?.innerText?.slice(0, 15_000) || '',
      noteItemCount: doc?.querySelectorAll('section.note-item').length || 0,
      loginTextPresent: /登录|扫码|二维码/.test(doc?.body?.innerText || ''),
      visibleInputs: Array.from(doc?.querySelectorAll('input,textarea') || []).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).map((node) => ({ id: node.id, tag: node.tagName, value: node.value || '' })),
    };
  });
  inspection.checkedAt = new Date().toISOString();
  inspection.targetUrl = targetUrl;
  inspection.domStreamReady = domStreamReady;
  inspection.searchAttempted = searchAttempted;
  inspection.searchBlockedReason = searchBlockedReason;
  inspection.activeUrl = activeUrl;

  await fs.writeFile(
    path.join(runtimeDir, 'xiaohongshu-anonymous.json'),
    `${JSON.stringify(inspection, null, 2)}\n`,
    'utf8',
  );
  console.log(`Search attempted: ${searchAttempted}`);
  console.log(`DOM stream ready: ${domStreamReady}`);
  console.log(`Search blocked reason: ${searchBlockedReason || '(none)'}`);
  console.log(`Final URL: ${activeUrl}`);
  console.log(`Note items: ${inspection.noteItemCount}`);
  console.log(`Login text present: ${inspection.loginTextPresent}`);
  console.log(inspection.frameBodyText.slice(0, 2_500));

  const finalActive = (await (await context.request.get(`${backendUrl}/record/active`)).text()).trim();
  if (finalActive && finalActive !== 'null') {
    await context.request.get(`${backendUrl}/record/stop/${finalActive}`);
  }
} finally {
  await browser.close();
}
