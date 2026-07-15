import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtimeDir = path.join(root, 'runtime');
const storageState = path.join(root, 'cookies', 'playwright-storage-state.json');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

await fs.mkdir(runtimeDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});

try {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 1000 },
  });
  const cookieMetadata = (await context.cookies()).map(({ name, domain, path: cookiePath, httpOnly, secure, sameSite }) => ({
    name,
    domain,
    path: cookiePath,
    httpOnly,
    secure,
    sameSite,
  }));
  const currentUserProbe = await context.request.get('http://127.0.0.1:18081/auth/current-user');
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: path.join(runtimeDir, 'maxun-home.png'), fullPage: true });

  const inspection = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((node) => node.textContent?.trim()).filter(Boolean),
    buttons: Array.from(document.querySelectorAll('button')).map((node) => node.textContent?.trim()).filter(Boolean),
    links: Array.from(document.querySelectorAll('a')).map((node) => ({
      text: node.textContent?.trim() || '',
      href: node.href,
    })).filter((item) => item.text || item.href),
    bodyText: document.body.innerText.slice(0, 12_000),
  }));
  inspection.cookieMetadata = cookieMetadata;
  inspection.currentUserProbeStatus = currentUserProbe.status();

  await fs.writeFile(
    path.join(runtimeDir, 'ui-inspection.json'),
    `${JSON.stringify(inspection, null, 2)}\n`,
    'utf8',
  );
  console.log(`UI inspection saved. URL: ${inspection.url}`);
  console.log(`Headings: ${inspection.headings.join(' | ')}`);
} finally {
  await browser.close();
}
