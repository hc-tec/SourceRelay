import { describe, expect, test } from 'vitest';
import {
  buildEvidencePlan,
  evidencePlanDigestPayload,
  unsignedGatewayEnvelope,
  type EvidencePlan
} from '../src/shared/control-plane.js';
import type {
  BrowserProfileBinding,
  CollectionBudgetLimits,
  ResearchTaskContract,
  SupportedPlatform
} from '../src/shared/collection-contracts.js';

const budget: CollectionBudgetLimits = {
  maxDurationMs: 60_000,
  maxRecords: 20,
  maxPages: 2,
  maxScrolls: 2,
  maxReadOnlyActions: 2,
  maxDetails: 2,
  maxCommentItems: 10,
  maxOriginalMediaBytes: 0
};

function profileBinding(platform: SupportedPlatform): BrowserProfileBinding {
  return {
    profileId: `11111111-1111-4111-8111-11111111111${platform.length}`,
    kind: 'collection',
    platform,
    account: { category: 'user_managed', label: `${platform} unit-test profile` }
  };
}

function task(input: Partial<ResearchTaskContract> = {}): ResearchTaskContract {
  return {
    schemaVersion: 1,
    taskId: 'control-plane-unit-task',
    researchQuestion: 'Test the Collector control-plane decision boundary.',
    decisionContext: 'Pure framework validation; no page or platform activity.',
    profile: 'scout',
    lineage: null,
    targets: [{ type: 'keyword_query', query: 'collector' }],
    platforms: ['bilibili'],
    profileBindings: { bilibili: profileBinding('bilibili') },
    evidenceObjectives: ['breadth_search'],
    budget: {
      total: { ...budget },
      perPlatform: { bilibili: { ...budget } },
      unusedBudgetTransfer: 'explicit_approval_required'
    },
    consent: {
      approvedBy: 'user',
      approvedAt: '2026-07-22T00:00:00.000Z',
      approvedActions: ['native_navigation', 'visible_dom'],
      approvedObjectives: ['breadth_search'],
      escalationPolicy: 'explicit_approval_required'
    },
    ...input
  };
}

describe('Evidence Plan control-plane', () => {
  test('builds the target-platform-objective lattice once and preserves strategy maturity boundaries', async () => {
    const permissionChecks: string[][] = [];
    const plan = await buildEvidencePlan(task({
      targets: [
        { type: 'keyword_query', query: 'collector' },
        {
          type: 'account_target',
          platform: 'bilibili',
          canonicalProfileUrl: 'https://space.bilibili.com/7481602',
          stableAccountId: '7481602'
        }
      ],
      platforms: ['bilibili', 'zhihu', 'bilibili'],
      profileBindings: {
        bilibili: profileBinding('bilibili'),
        zhihu: profileBinding('zhihu')
      },
      evidenceObjectives: ['breadth_search', 'breadth_search'],
      budget: {
        total: { ...budget },
        perPlatform: { bilibili: { ...budget }, zhihu: { ...budget } },
        unusedBudgetTransfer: 'explicit_approval_required'
      }
    }), async (origins) => {
      permissionChecks.push([...origins]);
      return true;
    }, new Date('2026-07-22T00:00:01.000Z'));

    expect(plan).toMatchObject({
      schemaVersion: 1,
      planId: 'control-plane-unit-task.plan.v1',
      generatedAt: '2026-07-22T00:00:01.000Z',
      approval: { status: 'pending' }
    });
    expect(plan.stages).toHaveLength(3);
    expect(plan.stages.map((stage) => [stage.stageId, stage.targetIndex, stage.platform])).toEqual([
      ['control-plane-unit-task.stage.1', 0, 'bilibili'],
      ['control-plane-unit-task.stage.2', 0, 'zhihu'],
      ['control-plane-unit-task.stage.3', 1, 'bilibili']
    ]);

    const [bilibiliSearch, zhihuSearch, bilibiliAccount] = plan.stages;
    expect(bilibiliSearch?.preflight).toMatchObject({
      status: 'live_validation_required',
      releaseTrack: 'experimental',
      budgetStatus: 'accepted',
      requiredUserActions: []
    });
    expect(bilibiliSearch?.preflight.knownGaps).toContain('No user-controlled live-platform validation record is admitted.');
    expect(zhihuSearch?.preflight).toMatchObject({
      status: 'live_validation_required',
      releaseTrack: 'experimental',
      budgetStatus: 'accepted'
    });
    expect(zhihuSearch?.preflight.knownGaps).toContain('No user-controlled live-platform validation record is admitted.');
    expect(bilibiliAccount?.preflight).toMatchObject({
      status: 'live_validation_required',
      releaseTrack: 'experimental'
    });
    expect(permissionChecks).toEqual([
      ['https://search.bilibili.com/*', 'https://www.bilibili.com/*'],
      ['https://www.zhihu.com/*', 'https://zhuanlan.zhihu.com/*'],
      ['https://search.bilibili.com/*', 'https://www.bilibili.com/*']
    ]);
  });

  test('keeps budget, consent, Profile, permission, suspension, and unsupported states distinct', async () => {
    const invalidBudget = await planFor(task({
      budget: {
        total: { ...budget, maxDurationMs: 0 },
        perPlatform: { bilibili: { ...budget } },
        unusedBudgetTransfer: 'explicit_approval_required'
      },
      consent: {
        approvedBy: 'user',
        approvedAt: '2026-07-22T00:00:00.000Z',
        approvedActions: [],
        approvedObjectives: [],
        escalationPolicy: 'explicit_approval_required'
      },
      profileBindings: {}
    }), false);
    expect(invalidBudget.preflight).toMatchObject({
      status: 'budget_invalid',
      budgetStatus: 'invalid'
    });
    expect(invalidBudget.preflight.requiredUserActions).toEqual([
      'approve_task_plan',
      'grant_host_permission',
      'select_collection_profile'
    ]);

    const missingConsent = await planFor(task({
      consent: {
        approvedBy: 'user',
        approvedAt: '2026-07-22T00:00:00.000Z',
        approvedActions: [],
        approvedObjectives: [],
        escalationPolicy: 'explicit_approval_required'
      }
    }), true);
    expect(missingConsent.preflight).toMatchObject({
      status: 'consent_required',
      missingConsent: ['native_navigation', 'visible_dom'],
      requiredUserActions: ['approve_task_plan']
    });

    const missingProfile = await planFor(task({ profileBindings: {} }), true);
    expect(missingProfile.preflight).toMatchObject({
      status: 'user_action_required',
      requiredUserActions: ['select_collection_profile']
    });

    const missingPermission = await planFor(task(), false);
    expect(missingPermission.preflight).toMatchObject({
      status: 'permission_required',
      requiredUserActions: ['grant_host_permission']
    });

    const transcript = await planFor(task({
      targets: [{ type: 'known_url', url: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }],
      evidenceObjectives: ['transcript_read'],
      consent: {
        approvedBy: 'user',
        approvedAt: '2026-07-22T00:00:00.000Z',
        approvedActions: ['detail_navigation', 'visible_dom', 'bounded_interaction', 'approved_response'],
        approvedObjectives: ['transcript_read'],
        escalationPolicy: 'explicit_approval_required'
      }
    }), true);
    expect(transcript.preflight).toMatchObject({ status: 'live_validation_required', releaseTrack: 'experimental' });

    const discussion = await planFor(task({
      targets: [{ type: 'known_url', url: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }],
      evidenceObjectives: ['discussion_sample'],
      consent: {
        approvedBy: 'user',
        approvedAt: '2026-07-22T00:00:00.000Z',
        approvedActions: ['detail_navigation', 'visible_dom', 'bounded_interaction', 'comment_navigation'],
        approvedObjectives: ['discussion_sample'],
        escalationPolicy: 'explicit_approval_required'
      }
    }), true);
    expect(discussion.preflight).toMatchObject({
      status: 'live_validation_required',
      releaseTrack: 'experimental',
      strategy: { strategyId: 'bilibili.video.discussion.dom.v1' }
    });
  });

  test('limits digest and wire-signing payloads to the intended control-plane fields', async () => {
    const plan = await buildEvidencePlan(task(), async () => true, new Date('2026-07-22T00:00:02.000Z'));
    const approved = {
      ...plan,
      approval: {
        status: 'approved' as const,
        approvedBy: 'user' as const,
        approvedAt: '2026-07-22T00:00:03.000Z',
        planDigest: 'digest-value'
      }
    };
    expect(evidencePlanDigestPayload(approved)).toEqual({
      schemaVersion: plan.schemaVersion,
      planId: plan.planId,
      taskId: plan.taskId,
      generatedAt: plan.generatedAt,
      stages: plan.stages
    });

    const envelope = {
      schemaVersion: 1,
      taskId: plan.taskId,
      signature: 'signature-must-not-enter-the-payload'
    };
    expect(unsignedGatewayEnvelope(envelope)).toEqual({ schemaVersion: 1, taskId: plan.taskId });
    expect(envelope.signature).toBe('signature-must-not-enter-the-payload');
  });
});

async function planFor(input: ResearchTaskContract, permissionsGranted: boolean): Promise<EvidencePlan['stages'][number]> {
  const plan = await buildEvidencePlan(input, async () => permissionsGranted, new Date('2026-07-22T00:00:00.000Z'));
  const stage = plan.stages[0];
  if (!stage) throw new Error('control_plane_stage_missing');
  return stage;
}
