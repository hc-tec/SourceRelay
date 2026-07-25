import { describe, expect, test } from 'vitest';
import {
  COLLECTOR_SERVICE_SCHEMA_VERSION,
  collectorServiceCapabilities,
  collectorServiceRequestInput,
  collectorServiceResult
} from '../src/collector-service-contract.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';

describe('Collector service contract', () => {
  test('publishes cloned, registered capabilities with the collection-profile boundary', () => {
    const first = collectorServiceCapabilities();
    const detail = first.find((candidate) => candidate.capability === 'bilibili.video_detail');
    expect(detail).toMatchObject({
      schemaVersion: COLLECTOR_SERVICE_SCHEMA_VERSION,
      platform: 'bilibili',
      status: 'experimental',
      requiresProfile: { kind: 'collection', accountCategory: 'user_managed' },
      input: 'bilibili_video_detail_input',
      output: 'operation_summary_and_artifact_reference'
    });
    expect(first.map((candidate) => candidate.capability)).not.toContain('bilibili.account_inventory.page_two');

    (first[0]!.requiresProfile as { kind: string }).kind = 'validation';
    expect(collectorServiceCapabilities()[0]!.requiresProfile.kind).toBe('collection');
  });

  test('accepts the envelope only when its registered platform and capability agree', () => {
    const request = collectorServiceRequestInput({
      schemaVersion: 1,
      profileId: PROFILE_ID,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    });
    expect(request).toEqual({
      schemaVersion: 1,
      profileId: PROFILE_ID,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    });
    expect(() => collectorServiceRequestInput({
      ...request,
      platform: 'zhihu'
    })).toThrow('collector_service_capability_unavailable');
    expect(() => collectorServiceRequestInput({
      ...request,
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa', profileId: PROFILE_ID }
    })).toThrow('collector_service_input_profile_id_forbidden');
  });

  test('normalizes a single runner result without leaking implementation-only identifiers', () => {
    const request = collectorServiceRequestInput({
      schemaVersion: 1,
      profileId: PROFILE_ID,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    });
    const result = collectorServiceResult(request, {
      run: {
        runId: OPERATION_ID,
        state: 'completed',
        errorCode: null,
        coverage: { terminalReason: 'detail_captured', titleCaptured: true }
      },
      artifact: { artifactId: ARTIFACT_ID, titleCaptured: true }
    });
    expect(result).toMatchObject({
      operationId: OPERATION_ID,
      operationKind: 'run',
      terminalReason: 'detail_captured',
      artifact: {
        artifactId: ARTIFACT_ID,
        retrievalPath: `/v1/video-detail-artifacts/${ARTIFACT_ID}`,
        summary: { artifactId: ARTIFACT_ID, titleCaptured: true }
      }
    });
    expect('runId' in result).toBe(false);
  });

  test('normalizes a batch under an operation id instead of pretending it is a single run', () => {
    const request = collectorServiceRequestInput({
      schemaVersion: 1,
      profileId: PROFILE_ID,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      input: { query: '人工智能', resultType: 'video', sort: 'newest', pages: [1, 2] }
    });
    const result = collectorServiceResult(request, {
      run: {
        batchId: OPERATION_ID,
        state: 'partial',
        errorCode: 'rate_limited',
        coverage: { terminalReason: 'search_batch_page_partial', capturedPages: 1 }
      },
      artifact: { artifactId: ARTIFACT_ID, uniqueItems: 20 }
    });
    expect(result).toMatchObject({
      operationId: OPERATION_ID,
      operationKind: 'batch',
      state: 'partial',
      errorCode: 'rate_limited',
      artifact: {
        retrievalPath: `/v1/bilibili-native-search-batch-artifacts/${ARTIFACT_ID}`
      }
    });
  });

  test('rejects a malformed runner result instead of publishing an unaddressable artifact', () => {
    const request = collectorServiceRequestInput({
      schemaVersion: 1,
      profileId: PROFILE_ID,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    });
    expect(() => collectorServiceResult(request, {
      run: { runId: OPERATION_ID, state: 'completed', errorCode: null, coverage: {} },
      artifact: { artifactId: 'not-a-uuid' }
    })).toThrow('collector_service_runner_result_invalid');
  });
});
