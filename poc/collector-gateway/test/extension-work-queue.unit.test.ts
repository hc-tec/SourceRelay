import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LoadedGatewayIdentity } from '../src/identity.js';
import { ExtensionWorkQueue } from '../src/extension-work-queue.js';

const bindingId = '11111111-1111-4111-8111-111111111111';
const base = new Date('2026-07-25T00:00:00.000Z');

function identity(): LoadedGatewayIdentity {
  return {
    publicIdentity: {
      schemaVersion: 1,
      protocolVersion: 1,
      gatewayInstanceId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Unit Gateway',
      loopbackOrigin: 'http://127.0.0.1:43127',
      signingPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      identityFingerprint: 'a'.repeat(64)
    },
    signPayload: () => 'b'.repeat(86)
  } as LoadedGatewayIdentity;
}

describe('extension work queue state machine', () => {
  test('delivers one signed work item once and never requeues a claimed platform action', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliVideoDetail({
        browserBindingId: bindingId,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        browserBindingId: bindingId,
        capability: 'bilibili.video_detail',
        executionTarget: 'collector_work_tab'
      });
      expect(await queue.claimNext(bindingId, new Date(base.getTime() + 2))).toBeNull();
      await expect(queue.enqueueBilibiliVideoDetail({
        browserBindingId: bindingId,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }, new Date(base.getTime() + 3))).rejects.toThrow('extension_work_binding_busy');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('conservatively stops pending work after a Gateway restart instead of replaying it', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliVideoDetail({
        browserBindingId: bindingId,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }, base);
      const restored = await ExtensionWorkQueue.create(identity(), stateDirectory, new Date(base.getTime() + 1));
      const operation = await restored.get(queued.operationId, new Date(base.getTime() + 2));
      expect(operation).toMatchObject({
        state: 'stopped',
        errorCode: 'gateway_restarted_before_completion',
        terminalReason: 'gateway_restarted_before_completion'
      });
      expect(await restored.claimNext(bindingId, new Date(base.getTime() + 2))).toBeNull();
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
