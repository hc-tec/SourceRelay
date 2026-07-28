import type { BrowserContext } from 'playwright';
import {
  type BilibiliAccountVideoPageClickRequest,
  type BilibiliAccountVideoPageClickResult,
  type BilibiliCollectionSeriesPageClickRequest,
  type BilibiliCollectionSeriesPageClickResult,
  type BilibiliTranscriptChineseSelectionRequest,
  type BilibiliTranscriptChineseSelectionResult,
  type BilibiliDanmakuInteractionRequest,
  type BilibiliDanmakuInteractionResult,
  type BilibiliVideoDiscussionInteractionRequest,
  type BilibiliVideoDiscussionInteractionResult,
  type AcquirePageRequest,
  type AcquirePageResult,
  type CapturePageVisualEvidenceRequest,
  type CaptureRetainedPageVisualEvidenceRequest,
  type CloseQuarantinedPageRequest,
  type ManagedPageSummary,
  type NavigatePageRequest,
  type PageScrollResult,
  type PageVisualEvidence,
  type ReconcilePageRequest,
  type ReleasePageRequest,
  type ScrollPageRequest,
  type XiaohongshuTrustedSearchRequest,
  type XiaohongshuTrustedSearchResult,
  type XiaohongshuPublicProfileReconRequest,
  type XiaohongshuPublicProfileReconResult,
  type XiaohongshuNoteOverlayReconRequest,
  type XiaohongshuNoteOverlayReconResult,
  type XiaohongshuNoteCommentsReconRequest,
  type XiaohongshuNoteCommentsReconResult,
  type XiaohongshuValidationPageAdoptionRequest
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { attachManagedPageEvents, type PageLedgerEvent } from './page-events.js';
import {
  createLease,
  digestUrl,
    recordSummary,
    targetIdForPage,
  touchRecord,
  transitionRecord,
  type ManagedPageRecord
} from './page-record.js';
import { createManagedPage } from './managed-page-creation.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { executeTrustedScroll } from './trusted-scroll.js';
import { executeTrustedBilibiliAccountVideoPageClick } from './trusted-bilibili-account-video-page-click.js';
import { executeTrustedBilibiliSeriesPageClick } from './trusted-bilibili-series-page-click.js';
import { executeTrustedBilibiliTranscriptChineseSelection } from './trusted-bilibili-transcript-chinese-selection.js';
import { executeTrustedBilibiliVideoDiscussionInteraction } from './trusted-bilibili-video-discussion-interaction.js';
import { executeTrustedBilibiliDanmakuInteraction } from './trusted-bilibili-danmaku-interaction.js';
import { executeTrustedXiaohongshuSearch } from './trusted-xiaohongshu-search.js';
import { executeXiaohongshuPublicProfileEntryRecon } from './recon-xiaohongshu-public-profile-entry.js';
import { executeXiaohongshuNoteOverlayRecon } from './recon-xiaohongshu-note-overlay.js';
import { executeXiaohongshuNoteCommentsRecon } from './recon-xiaohongshu-note-comments.js';
import { closeQuarantinedPageRecord } from './quarantine-maintenance.js';
import { assertRetainedPageVisualEvidenceEligible } from './retained-page-visual-evidence.js';
import { ensureManagedPageForeground } from './page-foreground.js';
import {
  DEFAULT_MAX_IDLE_TRUST_MS,
  leaseSelectedPage,
  selectLeaseablePage,
  validateAcquireRequest
} from './page-selection.js';

export type { PageLedgerEvent } from './page-events.js';

export interface LeasedExtensionPageContext {
  extensionTabId: number;
  recordVersion: number;
  documentGeneration: number;
  routeGeneration: number;
}

export class PageLedger {
  readonly #context: BrowserContext;
  readonly #profileId: string;
  readonly #extensionGeneration: number;
  readonly #offlineOnly: boolean;
  readonly #listExtensionTabIds: (() => Promise<readonly number[]>) | null;
  readonly #onEvent: (event: PageLedgerEvent) => void;
  readonly #records = new Map<string, ManagedPageRecord>();
  readonly #targetAliases = new Map<string, string>();
  #nextPageSequence = 1;
  #maximumManagedPages: number;

  constructor(input: {
    context: BrowserContext;
    profileId: string;
    extensionGeneration: number;
    maximumManagedPages: number;
    offlineOnly: boolean;
    listExtensionTabIds?: (() => Promise<readonly number[]>) | null;
    onEvent: (event: PageLedgerEvent) => void;
  }) {
    this.#context = input.context;
    this.#profileId = input.profileId;
    this.#extensionGeneration = input.extensionGeneration;
    this.#maximumManagedPages = input.maximumManagedPages;
    this.#offlineOnly = input.offlineOnly;
    this.#listExtensionTabIds = input.listExtensionTabIds ?? null;
    this.#onEvent = input.onEvent;
  }

  get maximumManagedPages(): number {
    return this.#maximumManagedPages;
  }

  records(): readonly ManagedPageRecord[] {
    this.#expireLeases();
    this.#markStaleIdlePages();
    return [...this.#records.values()];
  }

  summaries(): readonly ManagedPageSummary[] {
    return [...this.records()]
      .sort((left, right) => left.pageAlias.localeCompare(right.pageAlias, 'en'))
      .map((record) => recordSummary(record));
  }

  async acquire(request: AcquirePageRequest, controllerGeneration: string): Promise<AcquirePageResult> {
    validateAcquireRequest(request, this.#profileId);
    if (request.maximumManagedPages !== undefined) {
      this.#maximumManagedPages = request.maximumManagedPages;
    }
    this.#expireLeases();
    this.#markStaleIdlePages();
    await this.#reconcileStaleCandidates();

    const targetUrlDigest = request.targetUrl ? digestUrl(request.targetUrl) : null;
    const selected = selectLeaseablePage(
      [...this.#records.values()],
      request.platform,
      request.pageRole,
      targetUrlDigest,
      request.targetUrl ?? undefined
    );
    if (selected.record && selected.selection) {
      const result = leaseSelectedPage(
        selected.record,
        request,
        controllerGeneration,
        targetUrlDigest,
        selected.selection
      );
      this.#emit('page_acquired', selected.record, selected.selection, null);
      return result;
    }

    const managedOpen = [...this.#records.values()].filter((record) => record.state !== 'closed').length;
    if (managedOpen >= this.#maximumManagedPages) {
      throw hostError({
        code: 'page_pool_capacity_exhausted',
        category: 'capacity',
        scope: 'profile',
        safeDetails: { profileId: this.#profileId, maximumManagedPages: this.#maximumManagedPages }
      });
    }

    const { page, targetId, extensionTabId } = await createManagedPage(
      this.#context,
      this.#listExtensionTabIds
    );
    const now = new Date();
    const pageAlias = `page-${this.#nextPageSequence++}`;
    const currentDigest = digestUrl(page.url());
    const lease = createLease({
      controllerGeneration,
      profileId: this.#profileId,
      taskId: request.taskId,
      runId: request.runId,
      stageLeaseId: request.stageLeaseId ?? null,
      platform: request.platform,
      pageRole: request.pageRole,
      leaseDurationMs: request.leaseDurationMs,
      now
    });
    const record: ManagedPageRecord = {
      schemaVersion: 1,
      recordVersion: 1,
      pageAlias,
      targetId,
      targetIdentityDigest: digestUrl(targetId),
      page,
      extensionTabId,
      ownershipSource: 'direct_created',
      platform: request.platform,
      pageRole: request.pageRole,
      state: targetUrlDigest && targetUrlDigest !== currentDigest ? 'leased_pre_navigation' : 'leased',
      expectedIdentity: { platform: request.platform, pageRole: request.pageRole, targetUrlDigest: targetUrlDigest ?? currentDigest },
      documentGeneration: 0,
      routeGeneration: 0,
      extensionGeneration: this.#extensionGeneration,
      maxIdleTrustMs: request.maxIdleTrustMs ?? DEFAULT_MAX_IDLE_TRUST_MS,
      activeLease: lease,
      attemptedActionIds: new Set(),
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      lastReconciledAt: now.toISOString(),
      stateChangedAt: now.toISOString(),
      quarantineReason: null
    };
    this.#records.set(pageAlias, record);
    this.#targetAliases.set(targetId, pageAlias);
    attachManagedPageEvents(this.#profileId, record, this.#onEvent);
    this.#emit('page_created', record, null, null);
    return { page: recordSummary(record), lease, selection: 'created_new_page' };
  }

  async adoptXiaohongshuValidationPublicPage(
    request: XiaohongshuValidationPageAdoptionRequest,
    controllerGeneration: string
  ): Promise<AcquirePageResult> {
    if (request.profileId !== this.#profileId) {
      throw hostError({ code: 'profile_id_mismatch', category: 'protocol', scope: 'profile' });
    }
    const managedRecords = [...this.#records.values()].filter((record) => record.state !== 'closed');
    const managedPages = new Set(managedRecords.map((record) => record.page));
    if (managedRecords.length === 1) {
      const existing = managedRecords[0]!;
      if (existing.platform !== 'xiaohongshu' ||
        (existing.pageRole !== 'public_search' && existing.pageRole !== 'public_profile') ||
        existing.activeLease || existing.state !== 'retained_for_review') {
        throw hostError({
          code: 'xiaohongshu_validation_page_adoption_managed_page_ineligible',
          category: 'validation',
          scope: 'page',
          retryClass: 'never'
        });
      }
      const lease = createLease({
        controllerGeneration,
        profileId: this.#profileId,
        taskId: request.taskId,
        runId: request.runId,
        stageLeaseId: null,
        platform: 'xiaohongshu',
        pageRole: existing.pageRole,
        leaseDurationMs: request.leaseDurationMs
      });
      existing.activeLease = lease;
      existing.expectedIdentity.targetUrlDigest = digestUrl(existing.page.url());
      transitionRecord(existing, 'leased', null);
      this.#emit('page_acquired', existing, 'reused_same_role', null);
      return { page: recordSummary(existing), lease, selection: 'reused_same_role' };
    }
    if (managedRecords.length > 1) {
      throw hostError({
        code: 'xiaohongshu_validation_page_adoption_managed_page_present',
        category: 'validation',
        scope: 'profile',
        retryClass: 'never'
      });
    }
    const openPages = this.#context.pages().filter((page) => !page.isClosed());
    const candidates = openPages.filter((page) => {
      if (managedPages.has(page) || page.isClosed()) return false;
      try {
        const url = new URL(page.url());
        return url.origin === 'https://www.xiaohongshu.com' && (
          url.pathname === '/explore' || url.pathname === '/explore/' ||
          url.pathname === '/search_result' || url.pathname === '/search_result/' ||
          url.pathname === '/search_result_ai' || url.pathname === '/search_result_ai/' ||
          url.pathname.startsWith('/user/profile/')
        );
      } catch {
        return false;
      }
    });
    if (candidates.length !== 1) {
      throw hostError({
        code: candidates.length === 0
          ? 'xiaohongshu_validation_public_page_missing'
          : 'xiaohongshu_validation_public_page_ambiguous',
        category: 'validation',
        scope: 'profile',
        retryClass: 'never',
        safeDetails: { candidateCount: candidates.length }
      });
    }
    // Never close the last visible tab. A failed adoption is a read-only
    // precondition and must leave the browser lifecycle unchanged.
    for (const blank of openPages.filter((page) => page.url() === 'about:blank')) {
      if (this.#context.pages().filter((page) => !page.isClosed()).length <= 1) break;
      await blank.close().catch(() => undefined);
    }
    const page = candidates[0]!;
    const targetId = await targetIdForPage(page);
    const pathname = new URL(page.url()).pathname;
    const pageRole = pathname.startsWith('/user/profile/') ? 'public_profile' : 'public_search';
    const now = new Date();
    const pageAlias = `page-${this.#nextPageSequence++}`;
    const lease = createLease({
      controllerGeneration,
      profileId: this.#profileId,
      taskId: request.taskId,
      runId: request.runId,
      stageLeaseId: null,
      platform: 'xiaohongshu',
      pageRole,
      leaseDurationMs: request.leaseDurationMs,
      now
    });
    const record: ManagedPageRecord = {
      schemaVersion: 1,
      recordVersion: 1,
      pageAlias,
      targetId,
      targetIdentityDigest: digestUrl(targetId),
      page,
      extensionTabId: null,
      ownershipSource: 'session_restored',
      platform: 'xiaohongshu',
      pageRole,
      state: 'leased',
      expectedIdentity: { platform: 'xiaohongshu', pageRole, targetUrlDigest: digestUrl(page.url()) },
      documentGeneration: 0,
      routeGeneration: 0,
      extensionGeneration: this.#extensionGeneration,
      maxIdleTrustMs: DEFAULT_MAX_IDLE_TRUST_MS,
      activeLease: lease,
      attemptedActionIds: new Set(),
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      lastReconciledAt: now.toISOString(),
      stateChangedAt: now.toISOString(),
      quarantineReason: null
    };
    this.#records.set(pageAlias, record);
    this.#targetAliases.set(targetId, pageAlias);
    attachManagedPageEvents(this.#profileId, record, this.#onEvent);
    this.#emit('page_adopted', record, 'session_restored', null);
    return { page: recordSummary(record), lease, selection: 'adopted_existing_page' };
  }

  async navigate(request: NavigatePageRequest): Promise<ManagedPageSummary> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    if (record.attemptedActionIds.has(request.actionId)) {
      throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
    }
    const protocol = new URL(request.url).protocol;
    if (this.#offlineOnly && protocol !== 'about:' && protocol !== 'data:') {
      throw hostError({ code: 'offline_profile_navigation_rejected', category: 'action', scope: 'action' });
    }
    // Do this before marking the action attempted. If Chromium cannot make
    // our already-leased page visible, no platform navigation was sent and
    // the caller retains an accurate, safely retryable local precondition
    // failure instead of an ambiguous navigation outcome.
    await ensureManagedPageForeground(record.page);
    record.attemptedActionIds.add(request.actionId);
    touchRecord(record);
    this.#emit('action_attempted', record, null, request.actionId);
    try {
      await record.page.goto(request.url, {
        waitUntil: request.waitUntil ?? 'domcontentloaded',
        timeout: request.timeoutMs
      });
      record.expectedIdentity.targetUrlDigest = digestUrl(record.page.url());
      record.lastReconciledAt = new Date().toISOString();
      transitionRecord(record, 'leased', null);
      this.#emit('navigation_completed', record, null, request.actionId);
      return recordSummary(record);
    } catch (error) {
      record.activeLease = null;
      transitionRecord(record, 'quarantined', 'navigation_outcome_unknown');
      this.#emit('navigation_outcome_unknown', record, 'navigation_outcome_unknown', request.actionId);
      throw hostError({
        code: 'navigation_outcome_unknown',
        category: 'network',
        scope: 'action',
        retryClass: 'new_run_required',
        platformActionAttempted: true,
        pageDisposition: 'quarantined',
        profileSafetyDisposition: 'stop_run_no_retry',
        safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
      });
    }
  }

  async scroll(request: ScrollPageRequest): Promise<PageScrollResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeTrustedScroll({
      record,
      request,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async clickBilibiliAccountVideoPage(
    request: BilibiliAccountVideoPageClickRequest,
    visualEvidenceDirectory: string
  ): Promise<BilibiliAccountVideoPageClickResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeTrustedBilibiliAccountVideoPageClick({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async clickBilibiliCollectionSeriesPage(
    request: BilibiliCollectionSeriesPageClickRequest,
    visualEvidenceDirectory: string
  ): Promise<BilibiliCollectionSeriesPageClickResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeTrustedBilibiliSeriesPageClick({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async selectBilibiliTranscriptChinese(
    request: BilibiliTranscriptChineseSelectionRequest,
    visualEvidenceDirectory: string
  ): Promise<BilibiliTranscriptChineseSelectionResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeTrustedBilibiliTranscriptChineseSelection({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async clickBilibiliVideoDiscussionControl(
    request: BilibiliVideoDiscussionInteractionRequest,
    visualEvidenceDirectory: string
  ): Promise<BilibiliVideoDiscussionInteractionResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeTrustedBilibiliVideoDiscussionInteraction({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async interactBilibiliDanmaku(
    request: BilibiliDanmakuInteractionRequest,
    visualEvidenceDirectory: string
  ): Promise<BilibiliDanmakuInteractionResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeTrustedBilibiliDanmakuInteraction({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async trustedXiaohongshuSearch(
    request: XiaohongshuTrustedSearchRequest,
    visualEvidenceDirectory: string
  ): Promise<XiaohongshuTrustedSearchResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeTrustedXiaohongshuSearch({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async reconXiaohongshuPublicProfileEntry(
    request: XiaohongshuPublicProfileReconRequest,
    visualEvidenceDirectory: string
  ): Promise<XiaohongshuPublicProfileReconResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeXiaohongshuPublicProfileEntryRecon({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async reconXiaohongshuNoteOverlay(
    request: XiaohongshuNoteOverlayReconRequest,
    visualEvidenceDirectory: string
  ): Promise<XiaohongshuNoteOverlayReconResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeXiaohongshuNoteOverlayRecon({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  async reconXiaohongshuNoteComments(
    request: XiaohongshuNoteCommentsReconRequest,
    visualEvidenceDirectory: string
  ): Promise<XiaohongshuNoteCommentsReconResult> {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    return await executeXiaohongshuNoteCommentsRecon({
      record,
      request,
      visualEvidenceDirectory,
      assertLeasedRunRecord: () => this.#assertLeasedRunRecord(record, request),
      emit: (eventType, reason, actionId) => this.#emit(eventType, record, reason, actionId)
    });
  }

  extensionCommandContext(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    expectedRecordVersion: number;
    runId: string;
  }): LeasedExtensionPageContext {
    const record = this.#leasedRunRecord(input);
    if (record.extensionTabId === null) {
      throw hostError({
        code: 'managed_page_extension_binding_missing',
        category: 'extension_runtime',
        scope: 'page'
      });
    }
    return {
      extensionTabId: record.extensionTabId,
      recordVersion: record.recordVersion,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration
    };
  }

  async foregroundExtensionCommandContext(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    expectedRecordVersion: number;
    runId: string;
  }): Promise<LeasedExtensionPageContext> {
    this.extensionCommandContext(input);
    const record = this.#record(input.profileId, input.pageAlias);
    await ensureManagedPageForeground(record.page);
    // Revalidate after the async browser operation so a lease expiry cannot
    // race the internal observer binding.
    return this.extensionCommandContext(input);
  }

  async captureVisualEvidence(
    request: CapturePageVisualEvidenceRequest,
    directory: string
  ): Promise<PageVisualEvidence> {
    const context = this.extensionCommandContext(request);
    const record = this.#record(request.profileId, request.pageAlias);
    return await captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: context.documentGeneration,
      routeGeneration: context.routeGeneration,
      directory
    });
  }

  /**
   * A retained page belongs to a person, not the generic page pool. Allow a
   * current authenticated controller to save visual evidence of that exact
   * page, but do not acquire a lease or expose any arbitrary page inspection
   * surface. The helper verifies state, lease absence, and record version.
   */
  async captureRetainedVisualEvidence(
    request: CaptureRetainedPageVisualEvidenceRequest,
    directory: string
  ): Promise<PageVisualEvidence> {
    const record = this.#record(request.profileId, request.pageAlias);
    assertRetainedPageVisualEvidenceEligible(record, request.expectedRecordVersion);
    return await captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      directory
    });
  }

  release(request: ReleasePageRequest): ManagedPageSummary {
    const record = this.#leasedRecord(request.profileId, request.pageAlias, request.pageLeaseId);
    record.activeLease = null;
    if (request.disposition === 'idle_reusable') {
      const actual = digestUrl(record.page.url());
      if (actual !== record.expectedIdentity.targetUrlDigest) {
        transitionRecord(record, 'quarantined', 'unexpected_navigation');
      } else {
        record.lastReconciledAt = new Date().toISOString();
        transitionRecord(record, 'idle_reusable', null);
      }
    } else if (request.disposition === 'retained_for_review') {
      transitionRecord(record, 'retained_for_review', null);
    } else {
      transitionRecord(record, 'quarantined', request.quarantineReason ?? 'explicit_quarantine');
    }
    this.#emit('page_released', record, record.quarantineReason, null);
    return recordSummary(record);
  }

  async closeQuarantinedPage(request: CloseQuarantinedPageRequest): Promise<ManagedPageSummary> {
    const record = this.#record(request.profileId, request.pageAlias);
    await closeQuarantinedPageRecord(record, request.recordVersion);
    this.#emit('quarantined_page_closed', record, null, null);
    return recordSummary(record);
  }

  reconcile(request: ReconcilePageRequest): ManagedPageSummary {
    const record = this.#record(request.profileId, request.pageAlias);
    if (record.state !== 'idle_reusable' && record.state !== 'idle_stale') {
      throw hostError({ code: 'page_reconcile_state_invalid', category: 'page_identity', scope: 'page' });
    }
    const actual = digestUrl(record.page.url());
    if (actual === record.expectedIdentity.targetUrlDigest && !record.page.isClosed()) {
      record.lastReconciledAt = new Date().toISOString();
      transitionRecord(record, 'idle_reusable', null);
    } else {
      transitionRecord(record, 'quarantined', 'page_identity_unverified');
    }
    this.#emit('page_reconciled', record, record.quarantineReason, null);
    return recordSummary(record);
  }

  disconnectController(controllerGeneration: string): void {
    for (const record of this.#records.values()) {
      if (record.activeLease?.controllerGeneration !== controllerGeneration) continue;
      record.activeLease = null;
      transitionRecord(record, 'quarantined', 'controller_disconnected');
      this.#emit('controller_disconnected', record, 'controller_disconnected', null);
    }
  }

  recordForAlias(pageAlias: string): ManagedPageRecord | null {
    return this.#records.get(pageAlias) ?? null;
  }

  async #reconcileStaleCandidates(): Promise<void> {
    for (const record of this.#records.values()) {
      if (record.state !== 'idle_stale') continue;
      this.reconcile({ profileId: this.#profileId, pageAlias: record.pageAlias });
    }
  }

  #markStaleIdlePages(now = Date.now()): void {
    for (const record of this.#records.values()) {
      if (record.state !== 'idle_reusable') continue;
      if (now - Date.parse(record.lastReconciledAt) <= record.maxIdleTrustMs) continue;
      transitionRecord(record, 'idle_stale', null);
      this.#emit('page_became_stale', record, null, null);
    }
  }

  #expireLeases(now = Date.now()): void {
    for (const record of this.#records.values()) {
      if (!record.activeLease || Date.parse(record.activeLease.expiresAt) > now) continue;
      record.activeLease = null;
      transitionRecord(record, 'quarantined', 'lease_expired');
      this.#emit('lease_expired', record, 'lease_expired', null);
    }
  }

  #leasedRecord(profileId: string, pageAlias: string, pageLeaseId: string): ManagedPageRecord {
    const record = this.#record(profileId, pageAlias);
    if (!record.activeLease || record.activeLease.pageLeaseId !== pageLeaseId) {
      throw hostError({ code: 'page_lease_mismatch', category: 'lease', scope: 'lease' });
    }
    if (Date.parse(record.activeLease.expiresAt) <= Date.now()) {
      record.activeLease = null;
      transitionRecord(record, 'quarantined', 'lease_expired');
      this.#emit('lease_expired', record, 'lease_expired', null);
      throw hostError({ code: 'page_lease_expired', category: 'lease', scope: 'lease', pageDisposition: 'quarantined' });
    }
    return record;
  }

  #leasedRunRecord(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    expectedRecordVersion: number;
    runId: string;
  }): ManagedPageRecord {
    const record = this.#leasedRecord(input.profileId, input.pageAlias, input.pageLeaseId);
    this.#assertLeasedRunRecord(record, input);
    return record;
  }

  #assertLeasedRunRecord(record: ManagedPageRecord, input: {
    expectedRecordVersion: number;
    runId: string;
  }): void {
    if (record.activeLease?.runId !== input.runId) {
      throw hostError({
        code: 'managed_page_run_mismatch',
        category: 'lease',
        scope: 'lease',
        retryClass: 'local_query_only'
      });
    }
    if (record.recordVersion !== input.expectedRecordVersion) {
      throw hostError({
        code: 'managed_page_record_version_mismatch',
        category: 'page_identity',
        scope: 'page',
        retryClass: 'local_query_only'
      });
    }
  }

  #record(profileId: string, pageAlias: string): ManagedPageRecord {
    if (profileId !== this.#profileId) throw hostError({ code: 'profile_mismatch', category: 'profile', scope: 'profile' });
    const record = this.#records.get(pageAlias);
    if (!record) throw hostError({ code: 'managed_page_not_found', category: 'page', scope: 'page' });
    return record;
  }

  #emit(eventType: string, record: ManagedPageRecord, reason: string | null, actionId: string | null): void {
    this.#onEvent({ eventType, profileId: this.#profileId, record, reason, actionId });
  }
}
