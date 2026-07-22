import {
  BILIBILI_TRANSCRIPT_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import { describe, expect, test } from 'vitest';
import {
  BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
  BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID
} from '../../collector-extension/src/shared/transcript-capture.js';
import { bilibiliTranscriptStrategyObservation } from '../src/bilibili-transcript-observation.js';

const bvid = 'BV1qZSLBYEpa';

function result(overrides: Partial<StrategyObservationResult> = {}): StrategyObservationResult {
  return {
    schemaVersion: 1,
    type: 'collector_strategy_observation',
    strategyId: BILIBILI_TRANSCRIPT_STRATEGY_ID,
    observerBindingId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'page-1',
    documentGeneration: 2,
    routeGeneration: 0,
    capturedAt: '2026-07-22T00:00:00.000Z',
    payloadBytes: 2_000,
    payload: {
      schemaVersion: 1,
      strategyId: BILIBILI_TRANSCRIPT_STRATEGY_ID,
      bvid,
      responses: [
        {
          schemaVersion: 1,
          platform: 'bilibili',
          routeId: BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
          status: 'captured',
          method: 'GET',
          responseUrl: 'https://api.bilibili.com/x/player/wbi/v2',
          contentType: 'application/json',
          httpStatus: 200,
          capturedAt: 1_753_144_000_000,
          admission: 'research_validation',
          body: {
            artifactKind: 'bilibili_transcript_track_directory',
            language: 'zh',
            languageLabel: '中文',
            tracks: [],
            sourceTrackCount: 0
          }
        },
        {
          schemaVersion: 1,
          platform: 'bilibili',
          routeId: BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID,
          status: 'captured',
          method: 'GET',
          responseUrl: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/abcdefghijklmnopqrst',
          contentType: 'application/json',
          httpStatus: 200,
          capturedAt: 1_753_144_000_100,
          admission: 'research_validation',
          body: {
            artifactKind: 'bilibili_public_subtitle_document',
            language: 'zh',
            type: null,
            version: null,
            segments: [{ segmentId: 1, from: 0, to: 1, content: '公开字幕' }],
            sourceSegmentCount: 1,
            presentation: {}
          }
        }
      ]
    },
    ...overrides
  };
}

describe('Bilibili trusted transcript Gateway boundary', () => {
  test('accepts only the exact strategy, target BVID, and bounded de-queried public projections', () => {
    const observed = bilibiliTranscriptStrategyObservation(result(), bvid);
    expect(observed.directory?.language).toBe('zh');
    expect(observed.transcript?.segments).toHaveLength(1);
    expect(observed.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ routeId: BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID, path: '/x/player/wbi/v2' }),
      expect.objectContaining({ routeId: BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID, path: '/bfs/ai_subtitle/prod/abcdefghijklmnopqrst' })
    ]));
  });

  test('rejects a response package bound to a different public video identity', () => {
    expect(() => bilibiliTranscriptStrategyObservation(result({
      payload: { ...(result().payload as Record<string, unknown>), bvid: 'BV1xZSLBYEpa' }
    }), bvid)).toThrow('transcript_strategy_observation_payload_invalid');
  });
});
