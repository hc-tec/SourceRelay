import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { ExtensionWorkItem, ExtensionWorkResult } from '@intelligence/collector-contracts';
import { BilibiliVideoDetailArtifactStore } from '../src/bilibili-video-detail-artifacts.js';
import { recordBilibiliVideoDetailExtensionWork } from '../src/extension-work-bilibili-video-detail.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const item: Extract<ExtensionWorkItem, { capability: 'bilibili.video_detail' }> = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.video_detail',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-26T00:00:00.000Z',
  expiresAt: '2026-07-26T00:01:00.000Z',
  input: {
    canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    bvid: 'BV1qZSLBYEpa'
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 3,
    maximumResponseObservations: 2,
    maximumPayloadBytes: 200_000
  },
  gatewaySignature: 'a'.repeat(86)
};

describe('user-browser video-detail failure artifact', () => {
  test('persists only structural DOM diagnostics when a submitted navigation has no admitted detail projection', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-user-browser-video-detail-'));
    temporaryDirectories.push(stateDirectory);
    const artifacts = await BilibiliVideoDetailArtifactStore.create(stateDirectory);
    const result: Extract<ExtensionWorkResult, { capability: 'bilibili.video_detail' }> = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      executionTarget: 'collector_work_tab',
      state: 'partial',
      errorCode: 'bilibili_video_detail_dom_not_ready',
      terminalReason: 'dom_projection_failed',
      completedAt: '2026-07-26T00:00:30.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'reused',
      workTabDisposition: 'retained_not_reusable',
      observation: {
        bvid: item.input.bvid,
        title: '不应在失败诊断中持久化的标题',
        metadataVisibleText: null,
        description: null,
        creator: null,
        tagTexts: [],
        episodeSummaryText: null,
        titleVisible: true,
        playerVisible: false,
        chargeExclusiveTrialVisible: false,
        subtitle: { available: false, language: null, panelVisible: false, segmentCount: 0, partial: false, segments: [] },
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };

    const reference = await recordBilibiliVideoDetailExtensionWork({ item, result, artifacts });
    const view = await artifacts.get(reference.artifactId);

    expect(view?.detail).toBeNull();
    expect(view?.manifest.actions).toMatchObject([{ outcome: 'postcondition_unmet', attemptCount: 1 }]);
    expect(view?.manifest.domDiagnostics).toEqual({
      observationPresent: true,
      titlePresent: true,
      titleVisible: true,
      playerVisible: false,
      chargeExclusiveTrialVisible: false,
      subtitle: { available: false, language: null, panelVisible: false, segmentCount: 0, partial: false, segments: [] },
      loginOverlayVisible: false,
      verificationRequired: false,
      rateLimited: false,
      sourceUnavailable: false
    });
    expect(JSON.stringify(view?.manifest.domDiagnostics)).not.toContain('不应在失败诊断中持久化的标题');
  });
});
