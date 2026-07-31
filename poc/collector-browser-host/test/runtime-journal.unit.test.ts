import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { RuntimeJournal, type RuntimeJournalEntry } from '../src/journal/runtime-journal.js';

describe('Browser Host runtime journal', () => {
  test('writes a structured command event and seals it without raw request data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'collector-runtime-journal-'));
    const journal = new RuntimeJournal(directory, '11111111-1111-4111-8111-111111111111');
    await journal.initialise();
    const entry: RuntimeJournalEntry = {
      schemaVersion: 1,
      eventId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-07-31T00:00:00.000Z',
      component: 'browser_host',
      level: 'warn',
      eventType: 'browser.command.failed',
      requestId: null,
      commandId: '33333333-3333-4333-8333-333333333333',
      operationId: null,
      workId: null,
      capability: null,
      durationMs: 42,
      outcome: 'failed',
      errorCode: 'work_tab_user_taken_over',
      details: { bodyType: 'navigate_page' },
      hostInstanceId: '11111111-1111-4111-8111-111111111111',
      browserSessionId: null,
      controllerGeneration: null,
      profileId: null,
      pageAlias: null,
      targetIdentityDigest: null,
      recordVersion: null,
      state: null,
      reason: null,
      actionId: null
    };
    await journal.append(entry);
    await journal.seal();

    const files = await readdir(directory);
    const sealed = files.find((name) => name.endsWith('.sealed.jsonl'))!;
    const content = await readFile(join(directory, sealed), 'utf8');
    expect(JSON.parse(content).eventType).toBe('browser.command.failed');
    expect(content).not.toContain('cookie');
  });
});
