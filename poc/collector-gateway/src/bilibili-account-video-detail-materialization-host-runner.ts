import { COLLECTOR_EXTENSION_VERSION } from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry } from './account-safety';
import type { BilibiliAccountVideoDetailMaterializationArtifactStore } from './bilibili-account-video-detail-materialization-artifacts';
import {
  bilibiliAccountVideoDetailMaterializationInput,
  materializationSource,
  selectBilibiliAccountVideoDetailMaterializations,
  type BilibiliAccountVideoDetailMaterializationItem,
  type BilibiliAccountVideoDetailMaterializationRunRecord,
  type BilibiliAccountVideoDetailMaterializationTerminalReason
} from './bilibili-account-video-detail-materialization-contract';
import type { BilibiliAccountVideoPaginationArtifactStore } from './bilibili-account-video-pagination-artifacts';
import { createBilibiliAccountVideoDetailMaterializationRunRecord } from './bilibili-account-video-detail-materialization-run-record';
import type { BilibiliVideoDetailHostRunner } from './bilibili-video-detail-host-runner';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BilibiliAccountVideoDetailMaterializationHostRunInput {
  profileId: string;
  sourceArtifactId: string;
  bvids: string[];
}

export interface BilibiliAccountVideoDetailMaterializationHostRunResult {
  run: BilibiliAccountVideoDetailMaterializationRunRecord;
  artifact: Awaited<ReturnType<BilibiliAccountVideoDetailMaterializationArtifactStore['record']>>;
}

function input(
  value: BilibiliAccountVideoDetailMaterializationHostRunInput
): BilibiliAccountVideoDetailMaterializationHostRunInput {
  if (!PROFILE_ID.test(value.profileId) || !UUID.test(value.sourceArtifactId)) {
    throw new Error('bilibili_account_video_detail_materialization_input_invalid');
  }
  return {
    profileId: value.profileId,
    sourceArtifactId: value.sourceArtifactId,
    ...bilibiliAccountVideoDetailMaterializationInput({ bvids: value.bvids })
  };
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate)
    ? candidate
    : 'bilibili_account_video_detail_materialization_runner_failed';
}

function notAttemptedItem(
  selection: Pick<BilibiliAccountVideoDetailMaterializationItem, 'bvid' | 'sourcePageNumber' | 'canonicalVideoUrl'>,
  errorCode: string | null
): BilibiliAccountVideoDetailMaterializationItem {
  return {
    ...selection,
    detailRunStarted: false,
    navigationAttempted: false,
    navigationAttemptCount: 0,
    outcome: 'not_attempted',
    errorCode,
    detailRunId: null,
    detailArtifact: null
  };
}

/**
 * Materialises a small, explicit subset of one completed account inventory.
 * The existing single-video runner remains the only component allowed to
 * navigate a detail page; this coordinator only proves source provenance,
 * serialises the budget, and records where execution stopped.
 */
export class BilibiliAccountVideoDetailMaterializationHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #profiles: BrowserProfileRegistry;
  readonly #sourceArtifacts: BilibiliAccountVideoPaginationArtifactStore;
  readonly #detailRunner: BilibiliVideoDetailHostRunner;
  readonly #artifacts: BilibiliAccountVideoDetailMaterializationArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    profiles: BrowserProfileRegistry;
    sourceArtifacts: BilibiliAccountVideoPaginationArtifactStore;
    detailRunner: BilibiliVideoDetailHostRunner;
    artifacts: BilibiliAccountVideoDetailMaterializationArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#profiles = input.profiles;
    this.#sourceArtifacts = input.sourceArtifacts;
    this.#detailRunner = input.detailRunner;
    this.#artifacts = input.artifacts;
  }

  async run(
    rawInput: BilibiliAccountVideoDetailMaterializationHostRunInput
  ): Promise<BilibiliAccountVideoDetailMaterializationHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_account_video_detail_materialization_collection_profile_required');
    const sourceArtifact = await this.#sourceArtifacts.get(request.sourceArtifactId);
    if (!sourceArtifact) throw new Error('bilibili_account_video_detail_materialization_source_not_found');
    const selections = selectBilibiliAccountVideoDetailMaterializations(sourceArtifact, { bvids: request.bvids });
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const items: BilibiliAccountVideoDetailMaterializationItem[] = [];
    let terminalReason: BilibiliAccountVideoDetailMaterializationTerminalReason = 'all_selected_details_materialized';
    let errorCode: string | null = null;
    let stopAt = selections.length;

    for (let index = 0; index < selections.length; index += 1) {
      const selection = selections[index]!;
      const safety = this.#accountSafety.get(profile.profileId, 'bilibili');
      if (safety.state !== 'ready' || safety.activeRun !== null) {
        terminalReason = 'account_safety_stopped';
        errorCode = safety.reasonCode ?? 'account_safety_not_ready';
        stopAt = index;
        break;
      }
      try {
        const detail = await this.#detailRunner.run({
          profileId: profile.profileId,
          canonicalVideoUrl: selection.canonicalVideoUrl
        });
        const navigation = detail.run.actions[0] ?? null;
        items.push({
          ...selection,
          detailRunStarted: true,
          navigationAttempted: navigation?.attempted === true,
          navigationAttemptCount: navigation?.attemptCount ?? 0,
          outcome: detail.run.state,
          errorCode: detail.run.errorCode,
          detailRunId: detail.run.runId,
          detailArtifact: detail.artifact
        });
        if (detail.run.state !== 'completed') {
          terminalReason = 'detail_run_not_completed';
          errorCode = detail.run.errorCode ?? detail.run.coverage.terminalReason;
          stopAt = index + 1;
          break;
        }
      } catch (error) {
        terminalReason = 'detail_runner_error';
        errorCode = safeErrorCode(error);
        items.push({
          ...selection,
          detailRunStarted: true,
          navigationAttempted: false,
          navigationAttemptCount: 0,
          outcome: 'failed',
          errorCode,
          detailRunId: null,
          detailArtifact: null
        });
        stopAt = index + 1;
        break;
      }
    }

    for (let index = stopAt; index < selections.length; index += 1) {
      items.push(notAttemptedItem(selections[index]!, errorCode));
    }
    const state: BilibiliAccountVideoDetailMaterializationRunRecord['state'] = terminalReason === 'all_selected_details_materialized'
      ? 'completed'
      : items.some((item) => item.detailRunStarted)
        ? 'partial'
        : 'failed';
    const run = createBilibiliAccountVideoDetailMaterializationRunRecord({
      runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      source: materializationSource(sourceArtifact),
      startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      items,
      terminalReason
    });
    const artifact = await this.#artifacts.record(run);
    return { run, artifact };
  }
}
