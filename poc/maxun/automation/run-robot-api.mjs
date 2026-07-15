import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const samplesDir = path.join(root, 'samples');
const runtimeDir = path.join(root, 'runtime');
const robotName = process.argv[2] || 'bilibili-deepseek-poc';
const sampleLabel = process.argv[3] || 'maxun-bilibili-deepseek';
const backendUrl = 'http://127.0.0.1:18081';
const apiKey = (await fs.readFile(path.join(root, 'cookies', 'maxun-api-key.txt'), 'utf8')).trim();

await fs.mkdir(samplesDir, { recursive: true });
await fs.mkdir(runtimeDir, { recursive: true });
const api = await request.newContext({
  baseURL: backendUrl,
  extraHTTPHeaders: { 'x-api-key': apiKey },
});

try {
  const robotsResponse = await api.get('/api/robots');
  const robotsPayload = await robotsResponse.json();
  const robot = robotsPayload.robots?.items?.find((item) => item.name === robotName);
  if (!robot) throw new Error(`Robot ${robotName} was not found.`);

  const robotResponse = await api.get(`/api/robots/${robot.id}`);
  const robotPayload = await robotResponse.json();
  await fs.writeFile(
    path.join(samplesDir, `${sampleLabel}-robot.json`),
    `${JSON.stringify(robotPayload, null, 2)}\n`,
    'utf8',
  );

  const startedAt = Date.now();
  const runResponse = await api.post(`/api/robots/${robot.id}/runs`, {
    data: {},
    timeout: 300_000,
  });
  const runPayload = await runResponse.json();
  const durationMs = Date.now() - startedAt;
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const runPath = path.join(samplesDir, `${sampleLabel}-api-run-${timestamp}.json`);
  await fs.writeFile(runPath, `${JSON.stringify(runPayload, null, 2)}\n`, 'utf8');

  const listData = runPayload.run?.data?.listData || {};
  const topLevelKeys = Object.keys(listData);
  let estimatedRows = 0;
  for (const value of Object.values(listData)) {
    if (Array.isArray(value)) {
      estimatedRows += value.length;
      continue;
    }
    if (value && typeof value === 'object') {
      const arrays = Object.values(value).filter(Array.isArray);
      estimatedRows += arrays[0]?.length || 0;
    }
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    robotName,
    robotId: robot.id,
    httpStatus: runResponse.status(),
    messageCode: runPayload.messageCode || null,
    runStatus: runPayload.run?.status || null,
    durationMs,
    listDataKeys: topLevelKeys,
    estimatedRows,
    runFile: path.basename(runPath),
  };
  const summaryPath = path.join(runtimeDir, `${sampleLabel}-latest-run-summary.json`);
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`Robot: ${robotName}`);
  console.log(`HTTP/message/run status: ${runResponse.status()} / ${summary.messageCode} / ${summary.runStatus}`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(3)} seconds`);
  console.log(`List data keys: ${topLevelKeys.join(', ') || '(none)'}`);
  console.log(`Estimated rows: ${estimatedRows}`);
  console.log(`Saved run sample: ${path.basename(runPath)}`);
} finally {
  await api.dispose();
}
