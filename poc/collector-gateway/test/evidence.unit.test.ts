import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  GatewayEvidenceRegistry,
  gatewayEvidenceSubmission,
  sanitiseVisibleCollectionResult
} from '../src/evidence.js';

const temporaryDirectories: string[] = [];
const taskId = '11111111-1111-4111-8111-111111111111';
const leaseId = '22222222-2222-4222-8222-222222222222';
const extensionInstanceId = '33333333-3333-4333-8333-333333333333';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'collector-evidence-unit-'));
  temporaryDirectories.push(directory);
  return directory;
}

function validSubmission() {
  const strategy = {
    strategyId: 'bilibili.search.visible-dom.v1',
    version: '1.0.0',
    platform: 'bilibili',
    evidenceObjectives: ['breadth_search'],
    acquisition: ['visible_dom'],
    maturity: 'live_authenticated_verified',
    liveValidation: null
  };
  return gatewayEvidenceSubmission({
    schemaVersion: 1,
    collectorVersion: '0.7.9',
    taskId,
    stageId: 'stage-1',
    leaseId,
    platform: 'bilibili',
    strategy,
    capturedAt: '2026-07-22T00:00:00.000Z',
    result: {
      schemaVersion: 1,
      platform: 'bilibili',
      operation: 'breadth_search',
      strategy,
      sourceUrl: 'https://search.bilibili.com/all?keyword=collector',
      pageState: 'results_visible',
      partial: true,
      itemCount: 1,
      items: [{
        rank: 1,
        title: '公开可见结果',
        url: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
        contentType: 'video'
      }],
      warnings: []
    }
  });
}

describe('Gateway evidence validation', () => {
  test('keeps only an explicitly bounded visible-DOM evidence shape', () => {
    const submission = validSubmission();
    expect(sanitiseVisibleCollectionResult(submission.result)).toEqual(submission.result);

    if (submission.result.operation !== 'breadth_search') throw new Error('expected_breadth_search_fixture');
    const firstItem = submission.result.items[0];
    if (!firstItem) throw new Error('expected_visible_item_fixture');

    expect(sanitiseVisibleCollectionResult({
      ...submission.result,
      items: [{ ...firstItem, rank: 2 }]
    })).toBeNull();
    expect(sanitiseVisibleCollectionResult({
      ...submission.result,
      sourceUrl: 'https://user:secret@search.bilibili.com/all'
    })).toBeNull();
    expect(() => gatewayEvidenceSubmission({ ...submission, cookie: 'never persist' })).toThrow(
      'evidence_submission_invalid'
    );
  });

  test('persists an idempotent evidence batch exactly once and refuses a tampered batch after restart', async () => {
    const directory = await stateDirectory();
    const submission = validSubmission();
    const registry = await GatewayEvidenceRegistry.create(directory);

    const [first, second] = await Promise.all([
      registry.record(submission, extensionInstanceId, new Date('2026-07-22T00:00:01.000Z')),
      registry.record(submission, extensionInstanceId, new Date('2026-07-22T00:00:02.000Z'))
    ]);
    expect(second).toEqual(first);
    expect(registry.list(taskId)).toEqual([first]);

    const recovered = await GatewayEvidenceRegistry.create(directory);
    expect(recovered.list(taskId)).toEqual([first]);
    expect(recovered.getBatch(first.batchId, taskId)).toMatchObject({
      batchId: first.batchId,
      safety: {
        browserSurface: 'user_controlled_collection_profile',
        acquisition: 'visible_dom',
        responseObservation: 'disabled',
        browserCredentialData: 'not_collected'
      }
    });

    const evidenceDirectory = join(directory, 'evidence', taskId);
    const batchName = (await readdir(evidenceDirectory)).find((name) => name.endsWith('.json') && name !== 'manifest.json');
    if (!batchName) throw new Error('evidence_batch_missing');
    const batchPath = join(evidenceDirectory, batchName);
    const damaged = JSON.parse(await readFile(batchPath, 'utf8')) as { digest: string };
    damaged.digest = '0'.repeat(64);
    await writeFile(batchPath, `${JSON.stringify(damaged)}\n`, 'utf8');

    const afterTamper = await GatewayEvidenceRegistry.create(directory);
    expect(afterTamper.list(taskId)).toEqual([]);
  });
});
