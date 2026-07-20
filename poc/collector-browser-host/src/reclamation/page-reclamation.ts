import { randomUUID } from 'node:crypto';
import {
  type CreateReclaimPlanRequest,
  type ReclaimExecutionItem,
  type ReclaimExecutionResult,
  type ReclaimPlan
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import {
  digestUrl,
  touchRecord,
  transitionRecord,
  type ManagedPageRecord
} from '../page-ledger/page-record.js';

interface StoredReclaimPlan {
  publicPlan: ReclaimPlan;
  recordVersions: Map<string, number>;
}

export class PageReclamationManager {
  readonly #profileId: string;
  readonly #browserSessionId: string;
  readonly #records: () => readonly ManagedPageRecord[];
  readonly #onTransition: (eventType: string, record: ManagedPageRecord, reason: string | null) => void;
  readonly #plans = new Map<string, StoredReclaimPlan>();

  constructor(input: {
    profileId: string;
    browserSessionId: string;
    records: () => readonly ManagedPageRecord[];
    onTransition: (eventType: string, record: ManagedPageRecord, reason: string | null) => void;
  }) {
    this.#profileId = input.profileId;
    this.#browserSessionId = input.browserSessionId;
    this.#records = input.records;
    this.#onTransition = input.onTransition;
  }

  create(request: CreateReclaimPlanRequest): ReclaimPlan {
    this.#expirePlans();
    if (request.profileId !== this.#profileId) {
      throw hostError({ code: 'profile_mismatch', category: 'reclamation', scope: 'profile' });
    }
    if (!Number.isSafeInteger(request.maximumPagesToClose) || request.maximumPagesToClose < 1 || request.maximumPagesToClose > 32) {
      throw hostError({ code: 'reclaim_count_invalid', category: 'reclamation', scope: 'profile' });
    }
    if (!Number.isSafeInteger(request.expiresInMs) || request.expiresInMs < 1_000 || request.expiresInMs > 5 * 60 * 1000) {
      throw hostError({ code: 'reclaim_expiry_invalid', category: 'reclamation', scope: 'profile' });
    }

    const candidates = this.#identityVerifiedIdleRecords()
      .sort((left, right) => Date.parse(left.lastUsedAt) - Date.parse(right.lastUsedAt))
      .slice(0, request.maximumPagesToClose);
    const now = new Date();
    const reclaimPlanId = randomUUID();
    const recordVersions = new Map<string, number>();
    for (const record of candidates) {
      transitionRecord(record, 'reclaim_pending', null, now);
      recordVersions.set(record.pageAlias, record.recordVersion);
      this.#onTransition('reclaim_pending', record, null);
    }
    const publicPlan: ReclaimPlan = {
      schemaVersion: 1,
      reclaimPlanId,
      profileId: this.#profileId,
      browserSessionId: this.#browserSessionId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.expiresInMs).toISOString(),
      candidates: candidates.map((record) => ({
        pageAlias: record.pageAlias,
        pageRole: record.pageRole,
        recordVersion: record.recordVersion,
        idleSince: record.lastUsedAt,
        selectionReason: 'least_recently_used'
      }))
    };
    this.#plans.set(reclaimPlanId, { publicPlan, recordVersions });
    return structuredClone(publicPlan);
  }

  async execute(reclaimPlanId: string): Promise<ReclaimExecutionResult> {
    this.#expirePlans();
    const plan = this.#plans.get(reclaimPlanId);
    if (!plan) throw hostError({ code: 'reclaim_plan_not_found', category: 'reclamation', scope: 'profile' });
    this.#plans.delete(reclaimPlanId);
    const byAlias = new Map(this.#records().map((record) => [record.pageAlias, record]));
    const items: ReclaimExecutionItem[] = [];
    for (const candidate of plan.publicPlan.candidates) {
      const record = byAlias.get(candidate.pageAlias);
      if (!record) {
        items.push({ pageAlias: candidate.pageAlias, status: 'skipped', reason: 'record_missing' });
        continue;
      }
      const expectedVersion = plan.recordVersions.get(candidate.pageAlias);
      const identityMatches = digestUrl(record.page.url()) === record.expectedIdentity.targetUrlDigest;
      const unchanged = record.recordVersion === expectedVersion &&
        record.state === 'reclaim_pending' &&
        record.activeLease === null &&
        !record.page.isClosed() &&
        identityMatches;
      if (!unchanged) {
        if (record.state === 'reclaim_pending') {
          if (identityMatches) {
            transitionRecord(record, 'idle_reusable', null);
            this.#onTransition('reclaim_cancelled_changed', record, null);
          } else {
            transitionRecord(record, 'quarantined', 'page_identity_changed');
            this.#onTransition('reclaim_cancelled_identity_changed', record, 'page_identity_changed');
          }
        }
        items.push({
          pageAlias: candidate.pageAlias,
          status: 'changed',
          reason: identityMatches ? 'record_changed' : 'page_identity_changed'
        });
        continue;
      }
      touchRecord(record);
      await record.page.close({ runBeforeUnload: false });
      items.push({ pageAlias: candidate.pageAlias, status: 'closed', reason: 'reclaim_executed' });
    }
    return { reclaimPlanId, items };
  }

  #expirePlans(now = Date.now()): void {
    for (const [planId, plan] of this.#plans) {
      if (Date.parse(plan.publicPlan.expiresAt) > now) continue;
      const byAlias = new Map(this.#records().map((record) => [record.pageAlias, record]));
      for (const candidate of plan.publicPlan.candidates) {
        const record = byAlias.get(candidate.pageAlias);
        if (!record || record.state !== 'reclaim_pending') continue;
        if (digestUrl(record.page.url()) === record.expectedIdentity.targetUrlDigest) {
          transitionRecord(record, 'idle_reusable', null);
          this.#onTransition('reclaim_plan_expired', record, null);
        } else {
          transitionRecord(record, 'quarantined', 'page_identity_changed');
          this.#onTransition('reclaim_plan_expired_identity_changed', record, 'page_identity_changed');
        }
      }
      this.#plans.delete(planId);
    }
  }

  #identityVerifiedIdleRecords(): ManagedPageRecord[] {
    const verified: ManagedPageRecord[] = [];
    for (const record of this.#records()) {
      if (record.state !== 'idle_reusable' || record.activeLease !== null || record.page.isClosed()) continue;
      if (digestUrl(record.page.url()) !== record.expectedIdentity.targetUrlDigest) {
        transitionRecord(record, 'quarantined', 'page_identity_changed');
        this.#onTransition('reclaim_candidate_identity_changed', record, 'page_identity_changed');
        continue;
      }
      verified.push(record);
    }
    return verified;
  }
}
