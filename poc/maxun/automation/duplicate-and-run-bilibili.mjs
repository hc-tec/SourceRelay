import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const samplesDir = path.join(root, 'samples');
const keyword = process.argv[2];
const sampleLabel = process.argv[3];
if (!keyword || !sampleLabel) {
  throw new Error('Usage: node duplicate-and-run-bilibili.mjs <keyword> <sample-label>');
}

const backendUrl = 'http://127.0.0.1:18081';
const apiKey = (await fs.readFile(path.join(root, 'cookies', 'maxun-api-key.txt'), 'utf8')).trim();
const api = await request.newContext({ baseURL: backendUrl, extraHTTPHeaders: { 'x-api-key': apiKey } });

try {
  const robotsPayload = await (await api.get('/api/robots')).json();
  const template = robotsPayload.robots?.items?.find((item) => item.name === 'bilibili-deepseek-titles-poc');
  if (!template) throw new Error('The Bilibili title template robot was not found.');

  const targetUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
  const duplicateResponse = await api.post(`/api/robots/${template.id}/duplicate`, {
    data: { targetUrl },
  });
  const duplicatePayload = await duplicateResponse.json();
  if (duplicateResponse.status() !== 201 || !duplicatePayload.robot?.id) {
    throw new Error(`Duplicate failed: ${JSON.stringify(duplicatePayload)}`);
  }

  const startedAt = Date.now();
  const runResponse = await api.post(`/api/robots/${duplicatePayload.robot.id}/runs`, {
    data: {},
    timeout: 300_000,
  });
  const runPayload = await runResponse.json();
  const durationMs = Date.now() - startedAt;
  const rows = runPayload.run?.data?.listData?.['List Data 1'] || [];
  const validVideoUrls = rows.filter((row) => /^https:\/\/www\.bilibili\.com\/video\//.test(row['Label 1'] || '')).length;

  const artifact = {
    keyword,
    targetUrl,
    duplicateStatus: duplicateResponse.status(),
    robot: duplicatePayload.robot,
    runDurationMs: durationMs,
    run: runPayload,
  };
  await fs.writeFile(
    path.join(samplesDir, `${sampleLabel}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  );

  console.log(`Keyword: ${keyword}`);
  console.log(`Duplicate/run status: ${duplicateResponse.status()} / ${runResponse.status()} / ${runPayload.run?.status || 'unknown'}`);
  console.log(`Rows/title/video URLs: ${rows.length} / ${rows.filter((row) => String(row['Label 2'] || '').trim()).length} / ${validVideoUrls}`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(3)} seconds`);
} finally {
  await api.dispose();
}
