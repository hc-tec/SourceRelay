import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtimeDir = path.join(root, 'runtime');
const storageState = path.join(root, 'cookies', 'playwright-storage-state.json');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const targetUrl = 'https://search.bilibili.com/all?keyword=DeepSeek';

await fs.mkdir(runtimeDir, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath, headless: true });

try {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/robots/create', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_000);

  const urlInput = page.getByLabel('Website URL').or(page.locator('input').filter({ has: page.locator('[placeholder*="ycombinator"]') })).first();
  await urlInput.fill(targetUrl);

  const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Start Recording' }).click();
  const recorder = await popupPromise;
  await recorder.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  await recorder.waitForTimeout(25_000);

  await recorder.screenshot({ path: path.join(runtimeDir, 'recorder-inspection.png'), fullPage: true });
  const inspection = await recorder.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('iframe')).map((frame) => {
      let bodyText = '';
      let elementSummary = [];
      try {
        const doc = frame.contentDocument;
        bodyText = doc?.body?.innerText?.slice(0, 12_000) || '';
        elementSummary = Array.from(doc?.querySelectorAll('input,textarea,button,a') || []).slice(0, 200).map((node) => ({
          tag: node.tagName,
          id: node.id || '',
          className: typeof node.className === 'string' ? node.className : '',
          text: node.textContent?.trim().slice(0, 200) || '',
          value: 'value' in node ? String(node.value).slice(0, 200) : '',
          href: 'href' in node ? node.href : '',
        }));
      } catch (error) {
        bodyText = `FRAME_ACCESS_ERROR: ${error.message}`;
      }
      return {
        id: frame.id,
        name: frame.name,
        src: frame.src,
        bodyText,
        elementSummary,
      };
    });

    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 16_000),
      buttons: Array.from(document.querySelectorAll('button')).map((node) => node.textContent?.trim()).filter(Boolean),
      iframeCount: frames.length,
      frames,
    };
  });

  await fs.writeFile(
    path.join(runtimeDir, 'recorder-inspection.json'),
    `${JSON.stringify(inspection, null, 2)}\n`,
    'utf8',
  );
  console.log(`Recorder inspection saved. URL: ${inspection.url}`);
  console.log(`Iframe count: ${inspection.iframeCount}`);
  console.log(`Buttons: ${inspection.buttons.join(' | ')}`);
} finally {
  await browser.close();
}
