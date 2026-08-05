import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/canonical-json.js';
import { createUserBrowserServiceRouteHarness } from './support/user-browser-service-route-harness.js';

describe('Collector Service route-level idempotency', () => {
  test('admits every direct browser capability into the signed extension queue', async () => {
    const harness = await createUserBrowserServiceRouteHarness();
    try {
      const cases = [
        {
          platform: 'bilibili', capability: 'bilibili.native_search', executionTarget: 'collector_work_tab',
          input: { query: 'DeepSeek' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.native_search_batch', executionTarget: 'collector_work_tab',
          input: { query: 'DeepSeek' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.account_profile', executionTarget: 'collector_work_tab',
          input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.account_inventory', executionTarget: 'collector_work_tab',
          input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.video_detail', executionTarget: 'collector_work_tab',
          input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.discussion', executionTarget: 'collector_work_tab',
          input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.danmaku', executionTarget: 'collector_work_tab',
          input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.dynamic', executionTarget: 'collector_work_tab',
          input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.collection_series.overview', executionTarget: 'collector_work_tab',
          input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
        },
        {
          platform: 'bilibili', capability: 'bilibili.collection_series.detail', executionTarget: 'collector_work_tab',
          input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602', stableSeriesId: '123', listType: 'series' }
        },
        {
          platform: 'xiaohongshu', capability: 'xiaohongshu.search.public_notes.v1', executionTarget: 'existing_public_explore_tab',
          input: { query: '咖啡' }
        },
        {
          platform: 'xiaohongshu', capability: 'xiaohongshu.account.public_notes.v1', executionTarget: 'existing_public_profile_tab',
          input: { maximumScrolls: 1 }
        },
        {
          platform: 'xiaohongshu', capability: 'xiaohongshu.note.public_detail.v1', executionTarget: 'existing_public_search_tab',
          input: { resultRank: 1 }
        },
        {
          platform: 'xiaohongshu', capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
          input: { maximumScrolls: 1 }
        },
        {
          platform: 'xiaohongshu', capability: 'xiaohongshu.note.public_comment_replies.v1', executionTarget: 'existing_public_note_overlay',
          input: { maximumThreads: 1 }
        }
      ] as const;

      for (const candidate of cases) {
        const browserBindingId = await harness.createOnlineBinding();
        const request = {
          schemaVersion: 3,
          clientRequestId: randomUUID(),
          browserBindingId,
          ...candidate
        };
        const response = await postCollect(harness.origin, harness.token, request);
        expect(response.status, `${candidate.capability}: ${JSON.stringify(response.body)}`).toBe(201);
        const result = response.body.result as { operationId?: string } | undefined;
        expect(result).toMatchObject({
          capability: candidate.capability,
          executionTarget: candidate.executionTarget,
          state: 'queued'
        });
        expect(result?.operationId).toMatch(/^[0-9a-f-]{36}$/i);
        await expect(harness.context.workQueue.get(result!.operationId!)).resolves.toMatchObject({
          operationId: result!.operationId,
          browserBindingId,
          capability: candidate.capability,
          executionTarget: candidate.executionTarget,
          state: 'queued'
        });
      }
    } finally {
      await harness.close();
    }
  });

  test('completes an official Zhihu request inline and replays without a second provider call', async () => {
    let providerCalls = 0;
    const harness = await createUserBrowserServiceRouteHarness({
      zhihuAccessSecret: 'route-unit-secret',
      zhihuFetchImpl: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify({
          Code: 0,
          Message: 'success',
          Data: {
            HasMore: false,
            Items: [{
              Title: '公开结果', ContentType: 'Answer', ContentID: '123', ContentText: '公开摘要',
              Url: 'https://www.zhihu.com/question/1/answer/2', CommentCount: 1, VoteUpCount: 2,
              AuthorName: '公开作者', AuthorAvatar: '', AuthorBadge: '', AuthorBadgeText: '',
              EditTime: 1, AuthorityLevel: '1', RankingScore: 0.9
            }]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    });
    try {
      const request: ZhihuSearchRequest = {
        schemaVersion: 3,
        clientRequestId: randomUUID(),
        platform: 'zhihu',
        capability: 'zhihu.search.public_content.v1',
        executionTarget: 'official_api',
        input: { query: 'route-query-sentinel', count: 1 }
      };
      const first = await postCollect(harness.origin, harness.token, request);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        clientRequestId: request.clientRequestId,
        idempotentReplay: false,
        result: {
          browserBindingId: null,
          platform: 'zhihu',
          capability: request.capability,
          executionTarget: 'official_api',
          state: 'completed'
        }
      });
      const operationId = first.body.result.operationId as string;
      const artifactId = first.body.result.artifact.artifactId as string;
      const operationResponse = await fetch(`${harness.origin}/v2/collect/operations/${operationId}`, {
        headers: { authorization: `Bearer ${harness.token}` }
      });
      expect(operationResponse.status).toBe(200);
      expect(await operationResponse.json()).toMatchObject({ result: { operationId, artifact: { artifactId } } });
      const artifactResponse = await fetch(
        `${harness.origin}/v2/collect/artifacts/${artifactId}/content?offset=0&maxBytes=65536`,
        { headers: { authorization: `Bearer ${harness.token}` } }
      );
      expect(artifactResponse.status).toBe(200);
      const window = await artifactResponse.json() as Record<string, any>;
      expect(JSON.parse(window.window.text)).toMatchObject({
        capability: request.capability,
        artifact: {
          operationId,
          capability: request.capability,
          response: { Code: 0 }
        }
      });

      const replay = await postCollect(harness.origin, harness.token, request);
      expect(replay.status).toBe(200);
      expect(replay.body).toMatchObject({
        idempotentReplay: true,
        result: { operationId, artifact: { artifactId } }
      });
      expect(providerCalls).toBe(1);
      const stateText = (await Promise.all([
        readFile(join(harness.stateDirectory, 'collector-service-idempotency.json'), 'utf8'),
        readFile(join(harness.stateDirectory, 'collector-service-audit.json'), 'utf8'),
        readFile(join(harness.stateDirectory, 'official-source-operations.json'), 'utf8')
      ])).join('\n');
      expect(stateText).not.toContain('route-unit-secret');
      expect(stateText).not.toContain('route-query-sentinel');
    } finally {
      await harness.close();
    }
  });

  test('keeps one reply Operation identity across ledger, queue, response, and replay', async () => {
    const harness = await createUserBrowserServiceRouteHarness();
    try {
      const browserBindingId = await harness.createOnlineBinding();
      const request = replyRequest(randomUUID(), browserBindingId);

      const first = await postCollect(harness.origin, harness.token, request);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        clientRequestId: request.clientRequestId,
        idempotentReplay: false,
        result: {
          capability: 'xiaohongshu.note.public_comment_replies.v1',
          state: 'queued'
        }
      });
      const operationId = first.body.result.operationId as string;
      expect(harness.context.collectorServiceIdempotency.list()).toContainEqual(
        expect.objectContaining({
          clientRequestId: request.clientRequestId,
          operationId,
          state: 'accepted'
        })
      );
      await expect(harness.context.workQueue.get(operationId)).resolves.toMatchObject({
        operationId,
        capability: 'xiaohongshu.note.public_comment_replies.v1',
        state: 'queued'
      });

      const replay = await postCollect(harness.origin, harness.token, request);
      expect(replay.status).toBe(200);
      expect(replay.body).toMatchObject({
        clientRequestId: request.clientRequestId,
        idempotentReplay: true,
        result: { operationId }
      });

      const operations = JSON.parse(
        await readFile(join(harness.stateDirectory, 'extension-work-operations.json'), 'utf8')
      ) as unknown[];
      expect(operations).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

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

interface ReplyRequest {
  schemaVersion: 3;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.note.public_comment_replies.v1';
  executionTarget: 'existing_public_note_overlay';
  input: { maximumThreads: 1 };
}

interface ZhihuSearchRequest {
  schemaVersion: 3;
  clientRequestId: string;
  platform: 'zhihu';
  capability: 'zhihu.search.public_content.v1';
  executionTarget: 'official_api';
  input: { query: string; count: number };
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

function replyRequest(clientRequestId: string, browserBindingId: string): ReplyRequest {
  return {
    schemaVersion: 3,
    clientRequestId,
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comment_replies.v1',
    executionTarget: 'existing_public_note_overlay',
    input: { maximumThreads: 1 }
  };
}

function requestDigest(request: VideoRequest): string {
  const { clientRequestId: _clientRequestId, ...canonicalRequest } = request;
  return sha256Hex(canonicalJson(canonicalRequest));
}

async function postCollect(
  origin: string,
  token: string,
  request: object
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
