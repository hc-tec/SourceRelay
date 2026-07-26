import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BrowserHostClient,
  launchBrowserHost
} from '@intelligence/collector-browser-host/client';
import {
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
  BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
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
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION,
  COLLECTOR_RUNTIME_BUILD_METADATA_FILENAME,
  BrowserHostError,
  PAGE_POOL_SCHEMA_VERSION,
  type AcquirePageRequest,
  type AcquirePageResult,
  type BrowserHostCommandBody,
  type BrowserHostCommandResult,
  type CapturePageVisualEvidenceRequest,
  type CloseQuarantinedPageRequest,
  type ManagedPageSummary,
  type NavigatePageRequest,
  type PagePoolSnapshot,
  type PageScrollResult,
  type PageVisualEvidence,
  type ReleasePageRequest,
  type ScrollPageRequest,
  type StrategyObservationReadRequest,
  type StrategyObservationResult,
  type StrategyBindingDiagnostics,
  type StrategyBindingDiagnosticsRequest,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult,
  type ExtensionRuntimeExpectation
} from '@intelligence/collector-contracts';
import type { GatewayConfig } from './config';

export class GatewayBrowserHostRuntime {
  readonly #config: GatewayConfig;
  readonly #gatewayInstanceId = randomUUID();
  #client: BrowserHostClient | null = null;
  #connecting: Promise<BrowserHostClient | null> | null = null;

  constructor(config: GatewayConfig) {
    this.#config = config;
  }

  async snapshotIfRunning(): Promise<PagePoolSnapshot | null> {
    const client = await this.#connect(false);
    if (!client) return null;
    try {
      return snapshotResult(await client.command({ type: 'get_snapshot' }));
    } catch {
      if (this.#client === client) this.disconnect();
      return null;
    }
  }

  async launchProfile(profileId: string): Promise<PagePoolSnapshot> {
    const extensionRuntime = await readExtensionRuntimeExpectation(this.#config.extensionDirectory);
    return snapshotResult(await this.#command({
      type: 'launch_profile',
      request: {
        profileId,
        maximumManagedPages: 3,
        headless: this.#config.browserHeadless,
        offlineOnly: false,
        extensionRuntime
      }
    }, true));
  }

  async closeProfile(profileId: string): Promise<void> {
    const result = await this.#command({ type: 'close_profile', profileId }, false);
    if (!isOkState(result, profileId, 'closed')) throw new Error('browser_host_close_profile_response_invalid');
  }

  async acquirePage(request: AcquirePageRequest): Promise<AcquirePageResult> {
    const result = await this.#command({ type: 'acquire_page', request }, false);
    if (!result || typeof result !== 'object' ||
      !('lease' in result) || !('page' in result) || !('selection' in result)) {
      throw new Error('browser_host_acquire_page_response_invalid');
    }
    return structuredClone(result as AcquirePageResult);
  }

  async navigatePage(request: NavigatePageRequest): Promise<ManagedPageSummary> {
    return managedPageResult(await this.#command({ type: 'navigate_page', request }, false));
  }

  async scrollPage(request: ScrollPageRequest): Promise<PageScrollResult> {
    const result = await this.#command({ type: 'scroll_page', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (result as { pageAlias?: unknown }).pageAlias !== 'string' ||
      typeof (result as { actionId?: unknown }).actionId !== 'string' ||
      typeof (result as { recordVersion?: unknown }).recordVersion !== 'number' ||
      !('before' in result) || !('after' in result)) {
      throw new Error('browser_host_scroll_page_response_invalid');
    }
    return structuredClone(result as PageScrollResult);
  }

  async clickBilibiliAccountVideoPage(
    request: BilibiliAccountVideoPageClickRequest
  ): Promise<BilibiliAccountVideoPageClickResult> {
    return bilibiliAccountVideoPageClickResponse(
      await this.#command({ type: 'click_bilibili_account_video_page', request }, false)
    );
  }

  async clickBilibiliCollectionSeriesPage(
    request: BilibiliCollectionSeriesPageClickRequest
  ): Promise<BilibiliCollectionSeriesPageClickResult> {
    return bilibiliAccountVideoPageClickResponse(
      await this.#command({ type: 'click_bilibili_collection_series_page', request }, false)
    );
  }

  async selectBilibiliTranscriptChinese(
    request: BilibiliTranscriptChineseSelectionRequest
  ): Promise<BilibiliTranscriptChineseSelectionResult> {
    return bilibiliTranscriptChineseSelectionResponse(
      await this.#command({ type: 'select_bilibili_transcript_chinese', request }, false)
    );
  }

  async clickBilibiliVideoDiscussionControl(
    request: BilibiliVideoDiscussionInteractionRequest
  ): Promise<BilibiliVideoDiscussionInteractionResult> {
    const result = await this.#command({ type: 'click_bilibili_video_discussion_control', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (result as { actionId?: unknown }).actionId !== 'string' ||
      typeof (result as { pageAlias?: unknown }).pageAlias !== 'string' ||
      !('before' in result) || !('after' in result) || !('network' in result)) {
      throw new Error('browser_host_bilibili_video_discussion_interaction_response_invalid');
    }
    return structuredClone(result as BilibiliVideoDiscussionInteractionResult);
  }

  async interactBilibiliDanmaku(
    request: BilibiliDanmakuInteractionRequest
  ): Promise<BilibiliDanmakuInteractionResult> {
    const result = await this.#command({ type: 'interact_bilibili_danmaku', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (result as { actionId?: unknown }).actionId !== 'string' ||
      typeof (result as { pageAlias?: unknown }).pageAlias !== 'string' ||
      !('before' in result) || !('after' in result)) {
      throw new Error('browser_host_bilibili_danmaku_interaction_response_invalid');
    }
    return structuredClone(result as BilibiliDanmakuInteractionResult);
  }

  async capturePageVisualEvidence(request: CapturePageVisualEvidenceRequest): Promise<PageVisualEvidence> {
    const result = await this.#command({ type: 'capture_page_visual_evidence', request }, false);
    if (!result || typeof result !== 'object' ||
      !('evidenceId' in result) || !('screenshot' in result) || !('viewport' in result)) {
      throw new Error('browser_host_visual_evidence_response_invalid');
    }
    return structuredClone(result as PageVisualEvidence);
  }

  async releasePage(request: ReleasePageRequest): Promise<ManagedPageSummary> {
    return managedPageResult(await this.#command({ type: 'release_page', request }, false));
  }

  async closeQuarantinedPage(request: CloseQuarantinedPageRequest): Promise<ManagedPageSummary> {
    return managedPageResult(await this.#command({ type: 'close_quarantined_page', request }, false));
  }

  async bindStrategyObserver(request: StrategyObserverBindingRequest): Promise<StrategyObserverBindingResult> {
    const result = await this.#command({ type: 'bind_strategy_observer', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { type?: unknown }).type !== 'collector_strategy_observer_binding') {
      throw new Error('browser_host_strategy_binding_response_invalid');
    }
    return structuredClone(result as StrategyObserverBindingResult);
  }

  async readStrategyObservation(request: StrategyObservationReadRequest): Promise<StrategyObservationResult> {
    const result = await this.#command({ type: 'read_strategy_observation', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { type?: unknown }).type !== 'collector_strategy_observation') {
      throw new Error('browser_host_strategy_observation_response_invalid');
    }
    return structuredClone(result as StrategyObservationResult);
  }

  async readStrategyBindingDiagnostics(
    request: StrategyBindingDiagnosticsRequest
  ): Promise<StrategyBindingDiagnostics> {
    const result = await this.#command({ type: 'read_strategy_binding_diagnostics', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { type?: unknown }).type !== 'collector_strategy_binding_diagnostics') {
      throw new Error('browser_host_strategy_binding_diagnostics_response_invalid');
    }
    return structuredClone(result as StrategyBindingDiagnostics);
  }

  async shutdownHost(): Promise<void> {
    const result = await this.#command({ type: 'shutdown_host' }, false);
    if (!result || typeof result !== 'object' ||
      (result as { ok?: unknown }).ok !== true ||
      (result as { shuttingDown?: unknown }).shuttingDown !== true) {
      throw new Error('browser_host_shutdown_response_invalid');
    }
    this.disconnect();
  }

  disconnect(): void {
    this.#client?.close();
    this.#client = null;
  }

  async #command(body: BrowserHostCommandBody, startIfMissing: boolean): Promise<BrowserHostCommandResult> {
    const client = await this.#connect(startIfMissing);
    if (!client) throw new Error('browser_host_not_running');
    try {
      return await client.command(body);
    } catch (error) {
      // A typed Host error is a completed, correlated command result (for
      // example a lease, extension, or platform-context rejection). Closing
      // the IPC client here would make Host quarantine the live PageLease and
      // hide the original error behind a later page_lease_mismatch.
      if (this.#client === client && !(error instanceof BrowserHostError)) this.disconnect();
      throw error;
    }
  }

  async #connect(startIfMissing: boolean): Promise<BrowserHostClient | null> {
    if (this.#client) return this.#client;
    if (this.#connecting) {
      const connected = await this.#connecting;
      if (connected || !startIfMissing) return connected;
    }
    if (!startIfMissing && !(await fileExists(this.#config.browserHostEndpointPath))) return null;
    const connecting = (async () => {
      try {
        if (startIfMissing) {
          await launchBrowserHost({
            mainModulePath: this.#config.browserHostMainModulePath,
            stateDirectory: this.#config.browserHostStateDirectory,
            profileRoot: this.#config.profileDirectory,
            extensionDirectory: this.#config.extensionDirectory,
            endpointPath: this.#config.browserHostEndpointPath,
            timeoutMs: 30_000
          });
        }
        return await BrowserHostClient.connect(
          this.#config.browserHostEndpointPath,
          this.#gatewayInstanceId
        );
      } catch (error) {
        if (startIfMissing) throw error;
        return null;
      }
    })();
    this.#connecting = connecting;
    try {
      const connected = await connecting;
      this.#client = connected;
      return connected;
    } finally {
      if (this.#connecting === connecting) this.#connecting = null;
    }
  }
}

async function readExtensionRuntimeExpectation(extensionDirectory: string): Promise<ExtensionRuntimeExpectation> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(
      resolve(extensionDirectory, COLLECTOR_RUNTIME_BUILD_METADATA_FILENAME),
      'utf8'
    ));
  } catch {
    throw new Error('collector_extension_build_metadata_missing');
  }
  if (!value || typeof value !== 'object' ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (value as { collectorVersion?: unknown }).collectorVersion !== COLLECTOR_EXTENSION_VERSION ||
    (value as { controlSurfaceRevision?: unknown }).controlSurfaceRevision !== COLLECTOR_CONTROL_SURFACE_REVISION ||
    typeof (value as { buildFingerprint?: unknown }).buildFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test((value as { buildFingerprint: string }).buildFingerprint)) {
    throw new Error('collector_extension_build_metadata_invalid');
  }
  return {
    version: COLLECTOR_EXTENSION_VERSION,
    controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
    runtimeBootstrapKey: 'collector.runtime-bootstrap.v1',
    buildFingerprint: (value as { buildFingerprint: string }).buildFingerprint
  };
}

/**
 * Keeps the Browser Host wire contract explicit and independently testable.
 * A malformed result is safety-significant because the trusted input may
 * already have been delivered before Gateway receives the response.
 */
export function bilibiliAccountVideoPageClickResponse(value: unknown): BilibiliAccountVideoPageClickResult {
  if (!value || typeof value !== 'object' ||
    (value as { schemaVersion?: unknown }).schemaVersion !== BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION ||
    (value as { clickAttempted?: unknown }).clickAttempted !== true ||
    typeof (value as { pageAlias?: unknown }).pageAlias !== 'string' ||
    typeof (value as { actionId?: unknown }).actionId !== 'string' ||
    !('before' in value) || !('after' in value) || !('network' in value)) {
    throw new Error('browser_host_bilibili_page_click_response_invalid');
  }
  return structuredClone(value as BilibiliAccountVideoPageClickResult);
}

export function bilibiliTranscriptChineseSelectionResponse(value: unknown): BilibiliTranscriptChineseSelectionResult {
  if (!value || typeof value !== 'object' ||
    (value as { schemaVersion?: unknown }).schemaVersion !== BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION ||
    typeof (value as { pageAlias?: unknown }).pageAlias !== 'string' ||
    typeof (value as { actionId?: unknown }).actionId !== 'string' ||
    !Array.isArray((value as { actions?: unknown }).actions) ||
    !('dom' in value) || !('visualEvidence' in value)) {
    throw new Error('browser_host_bilibili_transcript_selection_response_invalid');
  }
  return structuredClone(value as BilibiliTranscriptChineseSelectionResult);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function snapshotResult(value: BrowserHostCommandResult): PagePoolSnapshot {
  if (!value || typeof value !== 'object') throw new Error('browser_host_snapshot_invalid');
  const candidate = value as Partial<PagePoolSnapshot>;
  if (candidate.schemaVersion !== PAGE_POOL_SCHEMA_VERSION ||
    typeof candidate.hostInstanceId !== 'string' ||
    !Number.isSafeInteger(candidate.hostProcessId) ||
    !Number.isSafeInteger(candidate.snapshotRevision) ||
    typeof candidate.capturedAt !== 'string' ||
    !Array.isArray(candidate.profiles)) throw new Error('browser_host_snapshot_invalid');
  return structuredClone(value as PagePoolSnapshot);
}

function isOkState(
  value: BrowserHostCommandResult,
  profileId: string,
  state: string
): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; profileId?: unknown; state?: unknown };
  return candidate.ok === true && candidate.profileId === profileId && candidate.state === state;
}

function managedPageResult(value: BrowserHostCommandResult): ManagedPageSummary {
  if (!value || typeof value !== 'object') throw new Error('browser_host_managed_page_response_invalid');
  const candidate = value as Partial<ManagedPageSummary>;
  if (candidate.schemaVersion !== 1 || typeof candidate.pageAlias !== 'string' || typeof candidate.state !== 'string') {
    throw new Error('browser_host_managed_page_response_invalid');
  }
  return structuredClone(value as ManagedPageSummary);
}
