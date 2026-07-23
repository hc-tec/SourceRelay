import type {
  BilibiliAccountVideoPageClickRequest,
  BilibiliAccountVideoPageClickResult,
  BilibiliTranscriptChineseSelectionRequest,
  BilibiliTranscriptChineseSelectionResult,
  BilibiliVideoDiscussionInteractionRequest,
  BilibiliVideoDiscussionInteractionResult,
  AcquirePageRequest,
  AcquirePageResult,
  CapturePageVisualEvidenceRequest,
  CloseQuarantinedPageRequest,
  ManagedPageSummary,
  NavigatePageRequest,
  PagePoolSnapshot,
  PageScrollResult,
  PageVisualEvidence,
  ReleasePageRequest,
  ScrollPageRequest,
  StrategyObservationReadRequest,
  StrategyObservationResult,
  StrategyBindingDiagnostics,
  StrategyBindingDiagnosticsRequest,
  StrategyObserverBindingRequest,
  StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import type { GatewayConfig } from './config';
import { GatewayBrowserHostRuntime } from './browser-host-runtime';
import {
  profileSummary,
  type CollectorBrowserProfileSummary
} from './browser-profile-summary';
import type { BrowserProfileRegistry } from './profiles';

export class CollectionBrowserManager {
  readonly #registry: BrowserProfileRegistry;
  readonly #runtime: GatewayBrowserHostRuntime;

  constructor(config: GatewayConfig, registry: BrowserProfileRegistry) {
    this.#registry = registry;
    this.#runtime = new GatewayBrowserHostRuntime(config);
  }

  async list(): Promise<CollectorBrowserProfileSummary[]> {
    const snapshot = await this.#runtime.snapshotIfRunning();
    return this.#registry.list().map((profile) => profileSummary(profile, snapshot));
  }

  async snapshot(): Promise<PagePoolSnapshot> {
    const snapshot = await this.#runtime.snapshotIfRunning();
    if (!snapshot) throw new Error('browser_host_not_running');
    return snapshot;
  }

  async snapshotIfRunning(): Promise<PagePoolSnapshot | null> {
    return await this.#runtime.snapshotIfRunning();
  }

  async launch(profileId: string): Promise<CollectorBrowserProfileSummary> {
    const profile = this.#registry.get(profileId);
    const snapshot = await this.#runtime.launchProfile(profileId);
    const runtime = snapshot.profiles.find((candidate) => candidate.profileId === profileId);
    const version = runtime?.extensionRuntime?.finalRuntimeVersion;
    if (!runtime?.running || !version) throw new Error('browser_host_profile_launch_incomplete');
    const launchedProfile = await this.#registry.markLaunched(profileId, version);
    return profileSummary(launchedProfile, snapshot);
  }

  async close(profileId: string): Promise<CollectorBrowserProfileSummary> {
    const profile = this.#registry.get(profileId);
    await this.#runtime.closeProfile(profileId);
    return profileSummary(profile, await this.#runtime.snapshotIfRunning());
  }

  async acquirePage(request: AcquirePageRequest): Promise<AcquirePageResult> {
    this.#registry.get(request.profileId);
    return await this.#runtime.acquirePage(request);
  }

  async navigatePage(request: NavigatePageRequest): Promise<ManagedPageSummary> {
    this.#registry.get(request.profileId);
    return await this.#runtime.navigatePage(request);
  }

  async scrollPage(request: ScrollPageRequest): Promise<PageScrollResult> {
    this.#registry.get(request.profileId);
    return await this.#runtime.scrollPage(request);
  }

  async clickBilibiliAccountVideoPage(
    request: BilibiliAccountVideoPageClickRequest
  ): Promise<BilibiliAccountVideoPageClickResult> {
    this.#registry.get(request.profileId);
    return await this.#runtime.clickBilibiliAccountVideoPage(request);
  }

  async selectBilibiliTranscriptChinese(
    request: BilibiliTranscriptChineseSelectionRequest
  ): Promise<BilibiliTranscriptChineseSelectionResult> {
    this.#registry.get(request.profileId);
    return await this.#runtime.selectBilibiliTranscriptChinese(request);
  }

  async clickBilibiliVideoDiscussionControl(
    request: BilibiliVideoDiscussionInteractionRequest
  ): Promise<BilibiliVideoDiscussionInteractionResult> {
    this.#registry.get(request.profileId);
    return await this.#runtime.clickBilibiliVideoDiscussionControl(request);
  }

  async capturePageVisualEvidence(request: CapturePageVisualEvidenceRequest): Promise<PageVisualEvidence> {
    this.#registry.get(request.profileId);
    return await this.#runtime.capturePageVisualEvidence(request);
  }

  async bindStrategyObserver(request: StrategyObserverBindingRequest): Promise<StrategyObserverBindingResult> {
    this.#registry.get(request.profileId);
    return await this.#runtime.bindStrategyObserver(request);
  }

  async readStrategyObservation(request: StrategyObservationReadRequest): Promise<StrategyObservationResult> {
    this.#registry.get(request.profileId);
    return await this.#runtime.readStrategyObservation(request);
  }

  async readStrategyBindingDiagnostics(
    request: StrategyBindingDiagnosticsRequest
  ): Promise<StrategyBindingDiagnostics> {
    this.#registry.get(request.profileId);
    return await this.#runtime.readStrategyBindingDiagnostics(request);
  }

  async releasePage(request: ReleasePageRequest): Promise<ManagedPageSummary> {
    this.#registry.get(request.profileId);
    return await this.#runtime.releasePage(request);
  }

  async closeQuarantinedPage(request: CloseQuarantinedPageRequest): Promise<ManagedPageSummary> {
    this.#registry.get(request.profileId);
    return await this.#runtime.closeQuarantinedPage(request);
  }

  disconnect(): void {
    this.#runtime.disconnect();
  }

  async exitBrowserHost(): Promise<void> {
    if (await this.#runtime.snapshotIfRunning()) await this.#runtime.shutdownHost();
  }
}
