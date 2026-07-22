import {
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  BrowserHostError,
  type PageVisualEvidence
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import { bilibiliAccountVideoBvidSetDigest } from './bilibili-account-video-pagination-contract';
import {
  projectBilibiliAccountVideoInventoryDom,
  type BilibiliAccountVideoInventoryProjection
} from './bilibili-account-video-inventory-contract';
import {
  bilibiliAccountVideoInventoryStrategyObservation,
  type BilibiliAccountVideoInventoryStrategyObservation
} from './bilibili-account-video-inventory-observation';
import type { CollectionBrowserManager } from './browser-manager';

const OBSERVATION_DEADLINE_MS = 12_000;

export interface BilibiliAccountVideoPaginationLeaseContext {
  recordVersion: number;
  documentGeneration: number;
}

export function paginationRemainingDeadline(deadline: number, minimumMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining < minimumMs) throw new Error('run_deadline_exceeded');
  return remaining;
}

/**
 * Owns the per-run tab/document binding and bounded local observation loops.
 * It deliberately has no Account Safety or action-planning authority: callers
 * must account for every navigation and click before calling the Browser Host.
 */
export class BilibiliAccountVideoPaginationSession {
  readonly #browserManager: CollectionBrowserManager;
  readonly #profileId: string;
  readonly #pageAlias: string;
  readonly #pageLeaseId: string;
  readonly #runId: string;
  readonly #canonicalInventoryUrl: string;
  readonly #stableAccountId: string;
  readonly #deadline: number;
  #observerBindingId: string | null = null;

  constructor(input: {
    browserManager: CollectionBrowserManager;
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    canonicalInventoryUrl: string;
    stableAccountId: string;
    deadline: number;
  }) {
    this.#browserManager = input.browserManager;
    this.#profileId = input.profileId;
    this.#pageAlias = input.pageAlias;
    this.#pageLeaseId = input.pageLeaseId;
    this.#runId = input.runId;
    this.#canonicalInventoryUrl = input.canonicalInventoryUrl;
    this.#stableAccountId = input.stableAccountId;
    this.#deadline = input.deadline;
  }

  async bindBeforeNavigation(): Promise<void> {
    const observerBindingId = randomUUID();
    const context = await this.leaseContext(true);
    await this.#browserManager.bindStrategyObserver({
      schemaVersion: 1,
      profileId: this.#profileId,
      pageAlias: this.#pageAlias,
      pageLeaseId: this.#pageLeaseId,
      expectedRecordVersion: context.recordVersion,
      runId: this.#runId,
      observerBindingId,
      strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
      target: { canonicalUrl: this.#canonicalInventoryUrl, stableAccountId: this.#stableAccountId },
      expiresAt: new Date(Date.now() + Math.min(55_000, paginationRemainingDeadline(this.#deadline, 1_000))).toISOString(),
      maximumResponseObservations: 0,
      maximumPayloadBytes: 128 * 1024
    });
    this.#observerBindingId = observerBindingId;
  }

  async leaseContext(allowPreNavigationState = false): Promise<BilibiliAccountVideoPaginationLeaseContext> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === this.#profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === this.#pageAlias);
    const stateAccepted = page?.state === 'leased' ||
      (allowPreNavigationState && page?.state === 'leased_pre_navigation');
    if (
      !page ||
      !stateAccepted ||
      page.activeLease?.pageLeaseId !== this.#pageLeaseId ||
      page.activeLease.runId !== this.#runId
    ) throw new Error('account_video_pagination_managed_page_context_changed');
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }

  async captureVisualEvidence(): Promise<PageVisualEvidence> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = await this.leaseContext();
      try {
        return await this.#browserManager.capturePageVisualEvidence({
          profileId: this.#profileId,
          pageAlias: this.#pageAlias,
          pageLeaseId: this.#pageLeaseId,
          expectedRecordVersion: context.recordVersion,
          runId: this.#runId
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          throw error;
        }
        paginationRemainingDeadline(this.#deadline, 100);
      }
    }
    throw new Error('account_video_pagination_visual_local_version_unavailable');
  }

  async observeInitial(): Promise<BilibiliAccountVideoInventoryStrategyObservation> {
    let observed: BilibiliAccountVideoInventoryStrategyObservation | null = null;
    while (Date.now() < this.#deadline) {
      observed = await this.#readObservation();
      const page = projectBilibiliAccountVideoInventoryDom(
        observed.dom,
        this.#stableAccountId,
        new Date().toISOString()
      );
      if (hasRiskSignal(observed) || page) return observed;
      await localDelay(250);
    }
    if (!observed) throw new Error('account_video_pagination_initial_observation_unavailable');
    return observed;
  }

  async observeChange(beforeBvidSetDigest: string): Promise<BilibiliAccountVideoInventoryStrategyObservation> {
    let observed: BilibiliAccountVideoInventoryStrategyObservation | null = null;
    while (Date.now() < this.#deadline) {
      observed = await this.#readObservation();
      const page = projectBilibiliAccountVideoInventoryDom(
        observed.dom,
        this.#stableAccountId,
        new Date().toISOString()
      );
      if (hasRiskSignal(observed) || (page && bilibiliAccountVideoBvidSetDigest(page) !== beforeBvidSetDigest)) {
        return observed;
      }
      await localDelay(250);
    }
    if (!observed) throw new Error('account_video_pagination_changed_observation_unavailable');
    return observed;
  }

  async #readObservation(): Promise<BilibiliAccountVideoInventoryStrategyObservation> {
    const observerBindingId = this.#observerBindingId;
    if (!observerBindingId) throw new Error('account_video_pagination_observer_not_bound');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = await this.leaseContext();
      try {
        const result = await this.#browserManager.readStrategyObservation({
          schemaVersion: 1,
          profileId: this.#profileId,
          pageAlias: this.#pageAlias,
          pageLeaseId: this.#pageLeaseId,
          expectedRecordVersion: context.recordVersion,
          runId: this.#runId,
          observerBindingId,
          strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
          deadlineMs: Math.min(OBSERVATION_DEADLINE_MS, paginationRemainingDeadline(this.#deadline, 100))
        });
        return bilibiliAccountVideoInventoryStrategyObservation(result, this.#stableAccountId);
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          throw error;
        }
      }
    }
    throw new Error('account_video_pagination_local_version_unavailable');
  }
}

function hasRiskSignal(observed: BilibiliAccountVideoInventoryStrategyObservation): boolean {
  return observed.dom.risk.verificationRequired ||
    observed.dom.risk.rateLimited ||
    observed.dom.risk.sourceUnavailable ||
    observed.dom.loginOverlayVisible;
}

async function localDelay(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
}
