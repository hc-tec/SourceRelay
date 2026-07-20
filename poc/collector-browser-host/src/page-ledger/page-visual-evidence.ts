import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Page } from 'playwright';
import {
  PAGE_VISUAL_EVIDENCE_SCHEMA_VERSION,
  type PageVisualEvidence
} from '@intelligence/collector-contracts';

const MAXIMUM_SCREENSHOT_BYTES = 8 * 1024 * 1024;

function safeScreenshotFile(directory: string, evidenceId: string): { path: string; fileName: string } {
  const root = resolve(directory);
  const fileName = `${evidenceId}.png`;
  const path = resolve(root, fileName);
  if (!path.startsWith(`${root}${sep}`)) throw new Error('visual_evidence_path_rejected');
  return { path, fileName };
}

async function viewport(page: Page): Promise<PageVisualEvidence['viewport']> {
  const value = await page.evaluate(() => ({
    cssWidth: Math.round(window.innerWidth),
    cssHeight: Math.round(window.innerHeight),
    devicePixelRatio: window.devicePixelRatio,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY)
  }));
  if (
    !Number.isSafeInteger(value.cssWidth) || value.cssWidth < 1 || value.cssWidth > 20_000 ||
    !Number.isSafeInteger(value.cssHeight) || value.cssHeight < 1 || value.cssHeight > 20_000 ||
    !Number.isFinite(value.devicePixelRatio) || value.devicePixelRatio <= 0 || value.devicePixelRatio > 10 ||
    !Number.isSafeInteger(value.scrollX) || !Number.isSafeInteger(value.scrollY)
  ) throw new Error('visual_evidence_viewport_invalid');
  return value;
}

export async function captureManagedPageVisualEvidence(input: {
  page: Page;
  pageAlias: string;
  documentGeneration: number;
  routeGeneration: number;
  directory: string;
}): Promise<PageVisualEvidence> {
  const evidenceId = randomUUID();
  const destination = safeScreenshotFile(input.directory, evidenceId);
  await mkdir(resolve(input.directory), { recursive: true, mode: 0o700 });
  const [image, dimensions] = await Promise.all([
    input.page.screenshot({ type: 'png', fullPage: false }),
    viewport(input.page)
  ]);
  if (image.byteLength > MAXIMUM_SCREENSHOT_BYTES) throw new Error('visual_evidence_screenshot_too_large');
  const temporary = `${destination.path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, image, { mode: 0o600 });
  await rename(temporary, destination.path);
  return {
    schemaVersion: PAGE_VISUAL_EVIDENCE_SCHEMA_VERSION,
    evidenceId,
    pageAlias: input.pageAlias,
    documentGeneration: input.documentGeneration,
    routeGeneration: input.routeGeneration,
    capturedAt: new Date().toISOString(),
    viewport: dimensions,
    screenshot: {
      fileName: destination.fileName,
      byteLength: image.byteLength,
      sha256: createHash('sha256').update(image).digest('hex')
    }
  };
}
