import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/canonical-json.js';
import { createUserBrowserServiceRouteHarness } from './support/user-browser-service-route-harness.js';

describe('Collector Service route-level idempotency', () => {
  test('persists identity before dispatch and never converts replay ambiguity into a second action', async () => {
    const harness = await createUserBrowserServiceRouteHarness();
    try {
      const firstBindingId = await harness.createOnlineBinding();
      const firstRequest = videoRequest(randomUUID(), firstBindingId);
      const first = await postCollect(harness.origin, harness.token, firstRequest);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        schemaVersion: 3,
        clientRequestId: firstRequest.clientRequestId,
        idempotentReplay: false,
        result: { state: 'queued', capability: 'bilibili.video_detail' }
      });

      const replay = await postCollect(harness.origin, harness.token, {
        ...firstRequest,
        input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
      });
      expect(replay.status).toBe(200);
      expect(replay.body).toMatchObject({
        clientRequestId: firstRequest.clientRequestId,
        idempotentReplay: true,
        result: { operationId: first.body.result.operationId }
      });

      const conflict = await postCollect(harness.origin, harness.token, {
        ...firstRequest,
        input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1xx411c7mD' }
      });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ error: 'collector_service_idempotency_conflict' });

      const rejectedRequest = videoRequest(
        randomUUID(),
        '99999999-9999-4999-8999-999999999999'
      );
      const rejected = await postCollect(harness.origin, harness.token, rejectedRequest);
      const rejectedReplay = await postCollect(harness.origin, harness.token, rejectedRequest);
      expect(rejected.status).toBe(400);
      expect(rejected.body).toMatchObject({
        error: 'browser_binding_not_found',
        clientRequestId: rejectedRequest.clientRequestId
      });
      expect(rejectedReplay.status).toBe(rejected.status);
      expect(rejectedReplay.body).toMatchObject({
        error: rejected.body.error,
        operationId: rejected.body.operationId
      });

      const recoveryBindingId = await harness.createOnlineBinding();
      const recoverableRequest = videoRequest(randomUUID(), recoveryBindingId);
      const recoverableReservation = await harness.context.collectorServiceIdempotency.reserve(
        recoverableRequest.clientRequestId,
        requestDigest(recoverableRequest)
      );
      await harness.context.workQueue.enqueueBilibiliVideoDetail({
        operationId: recoverableReservation.record.operationId,
        browserBindingId: recoveryBindingId,
        canonicalVideoUrl: recoverableRequest.input.canonicalVideoUrl
      });
      const recovered = await postCollect(harness.origin, harness.token, recoverableRequest);
      expect(recovered.status).toBe(200);
      expect(recovered.body).toMatchObject({
        idempotentReplay: true,
        result: { operationId: recoverableReservation.record.operationId }
      });
      expect(harness.context.collectorServiceIdempotency.list()).toContainEqual(expect.objectContaining({
        clientRequestId: recoverableRequest.clientRequestId,
        operationId: recoverableReservation.record.operationId,
        state: 'accepted'
      }));

      const unknownRequest = videoRequest(randomUUID(), recoveryBindingId);
      const unknownReservation = await harness.context.collectorServiceIdempotency.reserve(
        unknownRequest.clientRequestId,
        requestDigest(unknownRequest)
      );
      const unknown = await postCollect(harness.origin, harness.token, unknownRequest);
      expect(unknown.status).toBe(409);
      expect(unknown.body).toMatchObject({
        error: 'collector_service_idempotency_outcome_unknown',
        clientRequestId: unknownRequest.clientRequestId,
        operationId: unknownReservation.record.operationId
      });

      const operations = JSON.parse(
        await readFile(join(harness.stateDirectory, 'extension-work-operations.json'), 'utf8')
      ) as unknown[];
      expect(operations).toHaveLength(2);
      const ledgerText = await readFile(
        join(harness.stateDirectory, 'collector-service-idempotency.json'),
        'utf8'
      );
      expect(ledgerText).not.toContain('BV1qZSLBYEpa');
      expect(ledgerText).not.toContain('bilibili.com');
      expect(ledgerText).not.toContain('canonicalVideoUrl');
      expect(ledgerText).not.toContain('input');
    } finally {
      await harness.close();
    }
  });
});

interface VideoRequest {
  schemaVersion: 3;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.video_detail';
  executionTarget: 'collector_work_tab';
  input: { canonicalVideoUrl: string };
}

function videoRequest(clientRequestId: string, browserBindingId: string): VideoRequest {
  return {
    schemaVersion: 3,
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
  };
}

function requestDigest(request: VideoRequest): string {
  const { clientRequestId: _clientRequestId, ...canonicalRequest } = request;
  return sha256Hex(canonicalJson(canonicalRequest));
}

async function postCollect(
  origin: string,
  token: string,
  request: VideoRequest
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${origin}/v2/collect`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
