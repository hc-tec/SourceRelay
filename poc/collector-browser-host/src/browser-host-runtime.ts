import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BrowserHostError,
  PAGE_POOL_SCHEMA_VERSION,
  type BrowserHostCommandBody,
  type BrowserHostCommandResult,
  type LaunchProfileRequest,
  type PagePoolSnapshot
} from '@intelligence/collector-contracts';
import { hostError } from './host-errors.js';
import { RuntimeJournal } from './journal/runtime-journal.js';
import type { PageLedgerEvent } from './page-ledger/page-ledger.js';
import type { NativeBridgeRegistry } from './native-bridge/native-bridge-registry.js';
import type { NativeBridgeServer } from './native-bridge/native-bridge-server.js';
import { ProfileRuntime } from './profile-runtime/profile-runtime.js';
import { boundedIdentifier, boundedPositiveInteger, childPath } from './validation.js';

export interface BrowserHostRuntimeConfig {
  hostInstanceId: string;
  profileRoot: string;
  extensionDirectory: string | null;
  journalDirectory: string;
  endpointPath: string;
  nativeBridgeModulePath: string;
  nativeHostStateDirectory: string;
  visualEvidenceDirectory: string;
  nativeBridgeRegistry: NativeBridgeRegistry;
  nativeBridgeCommands: Pick<NativeBridgeServer, 'command'>;
}

export class BrowserHostRuntime {
  readonly hostInstanceId: string;
  readonly #profileRoot: string;
  readonly #extensionDirectory: string | null;
  readonly #journal: RuntimeJournal;
  readonly #endpointPath: string;
  readonly #nativeBridgeModulePath: string;
  readonly #nativeHostStateDirectory: string;
  readonly #visualEvidenceDirectory: string;
  readonly #nativeBridgeRegistry: NativeBridgeRegistry;
  readonly #nativeBridgeCommands: Pick<NativeBridgeServer, 'command'>;
  readonly #profiles = new Map<string, ProfileRuntime>();
  #controllerGeneration: string | null = null;
  #snapshotRevision = 0;

  constructor(config: BrowserHostRuntimeConfig) {
    this.hostInstanceId = config.hostInstanceId;
    this.#profileRoot = resolve(config.profileRoot);
    this.#extensionDirectory = config.extensionDirectory ? resolve(config.extensionDirectory) : null;
    this.#journal = new RuntimeJournal(config.journalDirectory, config.hostInstanceId);
    this.#endpointPath = resolve(config.endpointPath);
    this.#nativeBridgeModulePath = resolve(config.nativeBridgeModulePath);
    this.#nativeHostStateDirectory = resolve(config.nativeHostStateDirectory);
    this.#visualEvidenceDirectory = resolve(config.visualEvidenceDirectory);
    this.#nativeBridgeRegistry = config.nativeBridgeRegistry;
    this.#nativeBridgeCommands = config.nativeBridgeCommands;
  }

  async initialise(): Promise<void> {
    await mkdir(this.#profileRoot, { recursive: true });
    await mkdir(this.#visualEvidenceDirectory, { recursive: true, mode: 0o700 });
    await this.#journal.initialise();
  }

  adoptController(controllerGeneration: string): void {
    if (this.#controllerGeneration && this.#controllerGeneration !== controllerGeneration) {
      this.disconnectController(this.#controllerGeneration);
    }
    this.#controllerGeneration = controllerGeneration;
    this.#snapshotRevision += 1;
  }

  disconnectController(controllerGeneration: string): void {
    if (this.#controllerGeneration !== controllerGeneration) return;
    for (const profile of this.#profiles.values()) profile.disconnectController(controllerGeneration);
    this.#controllerGeneration = null;
    this.#snapshotRevision += 1;
  }

  async execute(body: BrowserHostCommandBody, controllerGeneration: string): Promise<BrowserHostCommandResult> {
    if (this.#controllerGeneration !== controllerGeneration) {
      throw hostError({ code: 'controller_generation_rejected', category: 'protocol', scope: 'host' });
    }
    switch (body.type) {
      case 'get_snapshot':
        return this.snapshot();
      case 'launch_profile':
        await this.#launchProfile(body.request);
        return this.snapshot();
      case 'acquire_page':
        return await this.#profile(body.request.profileId).acquire(body.request, controllerGeneration);
      case 'release_page':
        return this.#profile(body.request.profileId).release(body.request);
      case 'close_quarantined_page':
        return await this.#profile(body.request.profileId).closeQuarantinedPage(body.request);
      case 'navigate_page':
        return await this.#profile(body.request.profileId).navigate(body.request);
      case 'scroll_page':
        return await this.#profile(body.request.profileId).scroll(body.request);
      case 'click_bilibili_account_video_page':
        return await this.#profile(body.request.profileId).clickBilibiliAccountVideoPage(body.request);
      case 'select_bilibili_transcript_chinese':
        return await this.#profile(body.request.profileId).selectBilibiliTranscriptChinese(body.request);
      case 'click_bilibili_video_discussion_control':
        return await this.#profile(body.request.profileId).clickBilibiliVideoDiscussionControl(body.request);
      case 'interact_bilibili_danmaku':
        return await this.#profile(body.request.profileId).interactBilibiliDanmaku(body.request);
      case 'capture_page_visual_evidence':
        return await this.#profile(body.request.profileId).captureVisualEvidence(body.request);
      case 'bind_strategy_observer':
        return await this.#profile(body.request.profileId).bindStrategyObserver(body.request);
      case 'read_strategy_observation':
        return await this.#profile(body.request.profileId).readStrategyObservation(body.request);
      case 'read_strategy_binding_diagnostics':
        return await this.#profile(body.request.profileId).readStrategyBindingDiagnostics(body.request);
      case 'reconcile_page':
        return this.#profile(body.request.profileId).reconcile(body.request);
      case 'create_reclaim_plan':
        return this.#profile(body.request.profileId).createReclaimPlan(body.request);
      case 'execute_reclaim_plan': {
        for (const profile of this.#profiles.values()) {
          try {
            return await profile.executeReclaimPlan(body.request.reclaimPlanId);
          } catch (error) {
            if (!(error instanceof BrowserHostError) || error.record.code !== 'reclaim_plan_not_found') throw error;
          }
        }
        throw hostError({ code: 'reclaim_plan_not_found', category: 'reclamation', scope: 'host' });
      }
      case 'close_profile':
        await this.#closeProfile(body.profileId);
        return { ok: true, profileId: body.profileId, state: 'closed' };
      case 'shutdown_host':
        return { ok: true, shuttingDown: true };
    }
  }

  snapshot(): PagePoolSnapshot {
    const profiles = [...this.#profiles.values()].map((profile) => profile.summary());
    return {
      schemaVersion: PAGE_POOL_SCHEMA_VERSION,
      hostInstanceId: this.hostInstanceId,
      hostProcessId: process.pid,
      browserSessionId: profiles.length === 1 ? profiles[0]!.browserSessionId : null,
      controllerGeneration: this.#controllerGeneration,
      snapshotRevision: this.#snapshotRevision,
      capturedAt: new Date().toISOString(),
      profiles
    };
  }

  async shutdown(): Promise<void> {
    for (const profile of this.#profiles.values()) await profile.close().catch(() => undefined);
    await this.#journal.seal();
  }

  async #launchProfile(request: LaunchProfileRequest): Promise<void> {
    const profileId = boundedIdentifier(request.profileId, 'profile_id');
    const existing = this.#profiles.get(profileId);
    if (existing?.summary().running) return;
    const maximumManagedPages = request.maximumManagedPages === undefined
      ? 3
      : boundedPositiveInteger(request.maximumManagedPages, 'maximum_managed_pages', 32);
    const browserSessionId = randomUUID();
    const runtime = await ProfileRuntime.launch({
      profileId,
      browserSessionId,
      userDataDirectory: childPath(this.#profileRoot, profileId),
      extensionDirectory: this.#extensionDirectory,
      extensionRuntime: request.extensionRuntime ?? null,
      nativeBridgeRegistry: this.#nativeBridgeRegistry,
      nativeBridgeCommands: this.#nativeBridgeCommands,
      nativeHostStateDirectory: this.#nativeHostStateDirectory,
      hostEndpointPath: this.#endpointPath,
      nativeBridgeModulePath: this.#nativeBridgeModulePath,
      visualEvidenceDirectory: this.#visualEvidenceDirectory,
      maximumManagedPages,
      headless: request.headless ?? false,
      offlineOnly: request.offlineOnly ?? false,
      onLedgerEvent: (event) => this.#recordLedgerEvent(browserSessionId, event),
      onClosed: () => {
        this.#snapshotRevision += 1;
      }
    });
    this.#profiles.set(profileId, runtime);
    this.#snapshotRevision += 1;
    await this.#journal.append({
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: 'profile_launched',
      occurredAt: new Date().toISOString(),
      hostInstanceId: this.hostInstanceId,
      browserSessionId,
      controllerGeneration: this.#controllerGeneration,
      profileId,
      pageAlias: null,
      targetIdentityDigest: null,
      recordVersion: null,
      state: 'running',
      reason: null,
      commandId: null,
      actionId: null
    });
  }

  async #closeProfile(rawProfileId: string): Promise<void> {
    const profileId = boundedIdentifier(rawProfileId, 'profile_id');
    const profile = this.#profile(profileId);
    const summary = profile.summary();
    if (summary.leasedPages > 0) {
      throw hostError({
        code: 'profile_has_active_page_leases',
        category: 'profile',
        scope: 'profile',
        retryClass: 'user_action_required',
        safeDetails: { profileId, leasedPages: summary.leasedPages }
      });
    }
    await profile.close();
    this.#snapshotRevision += 1;
  }

  #profile(rawProfileId: string): ProfileRuntime {
    const profileId = boundedIdentifier(rawProfileId, 'profile_id');
    const profile = this.#profiles.get(profileId);
    if (!profile || !profile.summary().running) {
      throw hostError({ code: 'profile_browser_not_running', category: 'profile', scope: 'profile' });
    }
    return profile;
  }

  #recordLedgerEvent(browserSessionId: string, event: PageLedgerEvent): void {
    this.#snapshotRevision += 1;
    void this.#journal.append({
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: event.eventType,
      occurredAt: new Date().toISOString(),
      hostInstanceId: this.hostInstanceId,
      browserSessionId,
      controllerGeneration: this.#controllerGeneration,
      profileId: event.profileId,
      pageAlias: event.record.pageAlias,
      targetIdentityDigest: event.record.targetIdentityDigest,
      recordVersion: event.record.recordVersion,
      state: event.record.state,
      reason: event.reason,
      commandId: null,
      actionId: event.actionId
    });
  }
}
