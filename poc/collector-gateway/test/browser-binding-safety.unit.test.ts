import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { BrowserBindingSafetyRegistry } from '../src/browser-binding-safety.js';

const bindingId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const base = new Date('2026-07-25T00:00:00.000Z');

describe('browser binding safety state', () => {
  test('locks an uncertain navigation and requires explicit recovery before another work item', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-binding-safety-'));
    try {
      const safety = await BrowserBindingSafetyRegistry.create(stateDirectory, base);
      await safety.begin(bindingId, 'bilibili', operationId, base);
      await safety.recordNavigationIntent(bindingId, 'bilibili', operationId, new Date(base.getTime() + 1));
      const terminal = await safety.finish(bindingId, 'bilibili', operationId, {
        terminalReason: 'navigation_outcome_unknown',
        errorCode: 'navigation_outcome_unknown',
        navigation: { attempted: true, attemptCount: 1 }
      }, new Date(base.getTime() + 2));
      expect(terminal).toMatchObject({ state: 'locked', manualUnlockRequired: true });
      await expect(safety.begin(bindingId, 'bilibili', operationId, new Date(base.getTime() + 3)))
        .rejects.toThrow('browser_binding_safety_manual_unlock_required');
      expect(await safety.unlock(bindingId, 'bilibili', new Date(base.getTime() + 4)))
        .toMatchObject({ state: 'ready', manualUnlockRequired: false });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
