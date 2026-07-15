import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const samplesDir = path.join(root, 'samples');

const preferredFirst = path.join(samplesDir, 'maxun-bilibili-deepseek-titles-api-run.json');
const entries = await fs.readdir(samplesDir, { withFileTypes: true });
const otherRuns = entries
  .filter((entry) => entry.isFile() && /^maxun-bilibili-deepseek-titles-run[23]-api-run-.*\.json$/.test(entry.name))
  .map((entry) => path.join(samplesDir, entry.name))
  .sort();
const runFiles = [preferredFirst, ...otherRuns];

const runStats = [];
let firstRows = null;
for (const runFile of runFiles) {
  const payload = JSON.parse(await fs.readFile(runFile, 'utf8'));
  const rows = payload.run?.data?.listData?.['List Data 1'] || [];
  if (!firstRows) firstRows = rows;
  const validVideoUrls = rows.filter((row) => /^https:\/\/www\.bilibili\.com\/video\//.test(row['Label 1'] || ''));
  runStats.push({
    file: path.basename(runFile),
    status: payload.run?.status || null,
    rowCount: rows.length,
    nonEmptyTitles: rows.filter((row) => String(row['Label 2'] || '').trim()).length,
    nonEmptyAuthors: rows.filter((row) => String(row['Label 5'] || '').trim()).length,
    validVideoUrls: validVideoUrls.length,
    promotedOrTrackingRows: rows.length - validVideoUrls.length,
    uniqueVideoUrls: new Set(validVideoUrls.map((row) => row['Label 1'])).size,
  });
}

const normalized = (firstRows || []).map((row, index) => {
  const rawUrl = String(row['Label 1'] || '').trim();
  const validVideoUrl = /^https:\/\/www\.bilibili\.com\/video\//.test(rawUrl);
  const authorUrl = String(row['Label 4'] || '').trim();
  return {
    rank: index + 1,
    title: String(row['Label 2'] || '').trim(),
    url: validVideoUrl ? rawUrl.split('?')[0] : '',
    matchedText: String(row['Label 3'] || '').trim(),
    author: String(row['Label 5'] || '').trim(),
    authorUrl: /^https:\/\/space\.bilibili\.com\//.test(authorUrl) ? authorUrl.split('?')[0] : '',
    publishedText: String(row['Label 6'] || '').replace(/^\s*·\s*/, '').trim(),
    promotedOrTrackingRow: !validVideoUrl,
  };
});

const summary = {
  checkedAt: new Date().toISOString(),
  robotName: 'bilibili-deepseek-titles-poc',
  query: 'DeepSeek',
  runCount: runStats.length,
  allRunsSuccessful: runStats.every((run) => run.status === 'success'),
  allRunsHaveThirtyRows: runStats.every((run) => run.rowCount === 30),
  runs: runStats,
  normalizedFirstRun: {
    rowCount: normalized.length,
    validVideoUrls: normalized.filter((row) => row.url).length,
    promotedOrTrackingRows: normalized.filter((row) => row.promotedOrTrackingRow).length,
  },
  warnings: [
    'Maxun uses generic Label 1..6 names unless the workflow is edited or normalized downstream.',
    'Bilibili promoted cards can be mixed into organic results and may expose long tracking URLs.',
    'The normalized sample removes tracking URLs and leaves promoted rows without a canonical video URL.',
  ],
};

await fs.writeFile(
  path.join(samplesDir, 'maxun-bilibili-deepseek-titles-run-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);
await fs.writeFile(
  path.join(samplesDir, 'maxun-bilibili-deepseek-titles-normalized.json'),
  `${JSON.stringify({
    sourcePlatform: 'bilibili',
    operation: 'search',
    query: 'DeepSeek',
    fetchedAt: new Date().toISOString(),
    partial: true,
    items: normalized,
  }, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify(summary, null, 2));
