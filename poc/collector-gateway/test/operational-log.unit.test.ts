import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OperationalLog } from '../src/operational-log.js';

describe('Gateway operational log', () => {
  test('persists bounded structured events and supports correlation filters', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-operational-log-'));
    const log = await OperationalLog.create(stateDirectory);

    await log.record({
      level: 'error',
      eventType: 'extension.work.result_rejected',
      requestId: '11111111-1111-4111-8111-111111111111',
      commandId: null,
      operationId: '22222222-2222-4222-8222-222222222222',
      workId: '33333333-3333-4333-8333-333333333333',
      capability: 'bilibili.danmaku',
      durationMs: 120,
      outcome: 'failed',
      errorCode: 'work_tab_user_taken_over',
      details: { phase: 'observe', token: 'never-retained' }
    });
    await log.record({ eventType: 'http.request.completed', outcome: 'completed', details: { statusCode: 200 } });

    expect(log.list({ operationId: '22222222-2222-4222-8222-222222222222' })).toHaveLength(1);
    expect(log.list({ level: 'error' })[0]).toMatchObject({
      eventType: 'extension.work.result_rejected',
      details: { phase: 'observe', token: '[redacted]' }
    });

    await log.seal();
    const directory = join(stateDirectory, 'operational-logs');
    const files = await readdir(directory);
    expect(files.some((name) => name.endsWith('.sealed.jsonl'))).toBe(true);
    const sealed = files.find((name) => name.endsWith('.sealed.jsonl'))!;
    const persisted = await readFile(join(directory, sealed), 'utf8');
    expect(persisted).toContain('extension.work.result_rejected');
    expect(persisted).not.toContain('never-retained');
  });

  test('does not expose the component-specific log through another component instance', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-operational-log-components-'));
    const gateway = await OperationalLog.create(stateDirectory, 'gateway');
    const browserHost = await OperationalLog.create(stateDirectory, 'browser_host');
    await gateway.record({ eventType: 'gateway.ready', outcome: 'completed' });
    await browserHost.record({ eventType: 'browser_host.ready', outcome: 'completed' });

    expect(gateway.list().map((event) => event.eventType)).toEqual(['gateway.ready']);
    expect(browserHost.list().map((event) => event.eventType)).toEqual(['browser_host.ready']);
  });
});
