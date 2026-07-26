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
  type BrowserProfilePagePoolSummary,
  type CapturePageVisualEvidenceRequest,
  type CaptureRetainedPageVisualEvidenceRequest,
  type CloseQuarantinedPageRequest,
  type CreateReclaimPlanRequest,
  type ExtensionRuntimeExpectation,
  type ExtensionRuntimeSummary,
  type ManagedPageSummary,
  type NavigatePageRequest,
  type PageScrollResult,
  type ReclaimExecutionResult,
  type ReclaimPlan,
  type ReconcilePageRequest,
  type ReleasePageRequest,
  type ScrollPageRequest,
  type StrategyObservationReadRequest,
  type StrategyObservationResult,
  type StrategyBindingDiagnostics,
  type StrategyBindingDiagnosticsRequest,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult,
  type PageVisualEvidence
} from '@intelligence/collector-contracts';
import type { NativeBridgeRegistry } from '../native-bridge/native-bridge-registry.js';
import type { NativeBridgeServer } from '../native-bridge/native-bridge-server.js';
import type { NativeMessagingHostRegistration } from '../native-bridge/native-host-installer.js';
import { PageLedger, type PageLedgerEvent } from '../page-ledger/page-ledger.js';
import { PageReclamationManager } from '../reclamation/page-reclamation.js';
import { launchProfileBrowser } from './profile-browser-launcher.js';

export class ProfileRuntime {
  readonly profileId: string;
  readonly browserSessionId: string;
  readonly #context: BrowserContext;
  readonly #ledger: PageLedger;
  readonly #reclamation: PageReclamationManager;
  readonly #nativeBridgeRegistry: NativeBridgeRegistry;
  readonly #nativeBridgeCommands: Pick<NativeBridgeServer, 'command'>;
  readonly #nativeHostRegistration: NativeMessagingHostRegistration | null;
  readonly #extensionRuntime: ExtensionRuntimeSummary | null;
  readonly #visualEvidenceDirectory: string;
  #browserProcessId: number | null = null;
  #livePlatformRequests = 0;
  #running = true;
  #closed = false;

  private constructor(input: {
    profileId: string;
    browserSessionId: string;
    context: BrowserContext;
    browserProcessId: number | null;
    ledger: PageLedger;
    reclamation: PageReclamationManager;
    nativeBridgeRegistry: NativeBridgeRegistry;
    nativeBridgeCommands: Pick<NativeBridgeServer, 'command'>;
    nativeHostRegistration: NativeMessagingHostRegistration | null;
    extensionRuntime: ExtensionRuntimeSummary | null;
    visualEvidenceDirectory: string;
  }) {
    this.profileId = input.profileId;
    this.browserSessionId = input.browserSessionId;
    this.#context = input.context;
    this.#browserProcessId = input.browserProcessId;
    this.#ledger = input.ledger;
    this.#reclamation = input.reclamation;
    this.#nativeBridgeRegistry = input.nativeBridgeRegistry;
    this.#nativeBridgeCommands = input.nativeBridgeCommands;
    this.#nativeHostRegistration = input.nativeHostRegistration;
    this.#extensionRuntime = input.extensionRuntime;
    this.#visualEvidenceDirectory = input.visualEvidenceDirectory;
  }

  static async launch(input: {
    profileId: string;
    browserSessionId: string;
    userDataDirectory: string;
    extensionDirectory: string | null;
    extensionRuntime: ExtensionRuntimeExpectation | null;
    nativeBridgeRegistry: NativeBridgeRegistry;
    nativeBridgeCommands: Pick<NativeBridgeServer, 'command'>;
    nativeHostStateDirectory: string;
    hostEndpointPath: string;
    nativeBridgeModulePath: string;
    visualEvidenceDirectory: string;
    maximumManagedPages: number;
    headless: boolean;
    offlineOnly: boolean;
    onLedgerEvent: (event: PageLedgerEvent) => void;
    onClosed: () => void;
  }): Promise<ProfileRuntime> {
    let runtime: ProfileRuntime | null = null;
    let requestsBeforeRuntime = 0;
    const launched = await launchProfileBrowser({
      ...input,
      onExternalHttpRequest: () => {
        if (runtime) runtime.#livePlatformRequests += 1;
        else requestsBeforeRuntime += 1;
      }
    });
    const { context, extensionRuntime, nativeHostRegistration } = launched;
    context.on('close', () => {
      if (!runtime) return;
      runtime.#running = false;
      runtime.#browserProcessId = null;
      input.onClosed();
    });
    let ledger!: PageLedger;
    try {
      const reclamation = new PageReclamationManager({
        profileId: input.profileId,
        browserSessionId: input.browserSessionId,
        records: () => ledger.records(),
        onTransition: (eventType, record, reason) => input.onLedgerEvent({
          eventType,
          profileId: input.profileId,
          record,
          reason,
          actionId: null
        })
      });
      ledger = new PageLedger({
        context,
        profileId: input.profileId,
        extensionGeneration: extensionRuntime?.finalControlSurfaceRevision ?? 0,
        maximumManagedPages: input.maximumManagedPages,
        offlineOnly: input.offlineOnly,
        listExtensionTabIds: extensionRuntime
          ? async () => {
              const result = await input.nativeBridgeCommands.command(
                input.profileId,
                input.browserSessionId,
                { type: 'collector_list_extension_tabs' },
                3_000
              );
              if (result.type !== 'collector_extension_tab_inventory') {
                throw new Error('native_bridge_tab_inventory_invalid');
              }
              return result.tabIds;
            }
          : null,
        onEvent: input.onLedgerEvent
      });
      runtime = new ProfileRuntime({
        profileId: input.profileId,
        browserSessionId: input.browserSessionId,
        context,
        browserProcessId: await browserProcessId(context),
        ledger,
        reclamation,
        nativeBridgeRegistry: input.nativeBridgeRegistry,
        nativeBridgeCommands: input.nativeBridgeCommands,
        nativeHostRegistration,
        extensionRuntime,
        visualEvidenceDirectory: input.visualEvidenceDirectory
      });
      runtime.#livePlatformRequests = requestsBeforeRuntime;
      return runtime;
    } catch (error) {
      await context.close().catch(() => undefined);
      input.nativeBridgeRegistry.clearProfile(input.profileId, input.browserSessionId);
      await nativeHostRegistration?.uninstall().catch(() => undefined);
      throw error;
    }
  }

  acquire(request: AcquirePageRequest, controllerGeneration: string): Promise<AcquirePageResult> {
    return this.#ledger.acquire(request, controllerGeneration);
  }

  release(request: ReleasePageRequest) {
    return this.#ledger.release(request);
  }

  closeQuarantinedPage(request: CloseQuarantinedPageRequest): Promise<ManagedPageSummary> {
    return this.#ledger.closeQuarantinedPage(request);
  }

  navigate(request: NavigatePageRequest) {
    return this.#ledger.navigate(request);
  }

  scroll(request: ScrollPageRequest): Promise<PageScrollResult> {
    return this.#ledger.scroll(request);
  }

  clickBilibiliAccountVideoPage(
    request: BilibiliAccountVideoPageClickRequest
  ): Promise<BilibiliAccountVideoPageClickResult> {
    return this.#ledger.clickBilibiliAccountVideoPage(request, this.#visualEvidenceDirectory);
  }

  clickBilibiliCollectionSeriesPage(
    request: BilibiliCollectionSeriesPageClickRequest
  ): Promise<BilibiliCollectionSeriesPageClickResult> {
    return this.#ledger.clickBilibiliCollectionSeriesPage(request, this.#visualEvidenceDirectory);
  }

  selectBilibiliTranscriptChinese(
    request: BilibiliTranscriptChineseSelectionRequest
  ): Promise<BilibiliTranscriptChineseSelectionResult> {
    return this.#ledger.selectBilibiliTranscriptChinese(request, this.#visualEvidenceDirectory);
  }

  clickBilibiliVideoDiscussionControl(
    request: BilibiliVideoDiscussionInteractionRequest
  ): Promise<BilibiliVideoDiscussionInteractionResult> {
    return this.#ledger.clickBilibiliVideoDiscussionControl(request, this.#visualEvidenceDirectory);
  }

  interactBilibiliDanmaku(
    request: BilibiliDanmakuInteractionRequest
  ): Promise<BilibiliDanmakuInteractionResult> {
    return this.#ledger.interactBilibiliDanmaku(request, this.#visualEvidenceDirectory);
  }

  async bindStrategyObserver(request: StrategyObserverBindingRequest): Promise<StrategyObserverBindingResult> {
    const context = this.#ledger.extensionCommandContext(request);
    const result = await this.#nativeBridgeCommands.command(
      this.profileId,
      this.browserSessionId,
      {
        type: 'collector_bind_strategy_observer',
        tabId: context.extensionTabId,
        nextDocumentGeneration: context.documentGeneration + 1,
        binding: request
      },
      5_000
    );
    if (result.type !== 'collector_strategy_observer_binding' ||
      result.observerBindingId !== request.observerBindingId ||
      result.pageAlias !== request.pageAlias ||
      result.nextDocumentGeneration !== context.documentGeneration + 1) {
      throw new Error('strategy_observer_binding_result_invalid');
    }
    return result;
  }

  async readStrategyObservation(request: StrategyObservationReadRequest): Promise<StrategyObservationResult> {
    const context = this.#ledger.extensionCommandContext(request);
    const result = await this.#nativeBridgeCommands.command(
      this.profileId,
      this.browserSessionId,
      {
        type: 'collector_read_strategy_observation',
        tabId: context.extensionTabId,
        documentGeneration: context.documentGeneration,
        routeGeneration: context.routeGeneration,
        request
      },
      request.deadlineMs + 2_000
    );
    if (result.type !== 'collector_strategy_observation' ||
      result.observerBindingId !== request.observerBindingId ||
      result.pageAlias !== request.pageAlias ||
      result.documentGeneration !== context.documentGeneration ||
      result.routeGeneration !== context.routeGeneration) {
      throw new Error('strategy_observation_result_invalid');
    }
    return result;
  }

  async readStrategyBindingDiagnostics(
    request: StrategyBindingDiagnosticsRequest
  ): Promise<StrategyBindingDiagnostics> {
    const context = this.#ledger.extensionCommandContext(request);
    const result = await this.#nativeBridgeCommands.command(
      this.profileId,
      this.browserSessionId,
      {
        type: 'collector_read_strategy_binding_diagnostics',
        tabId: context.extensionTabId,
        observerBindingId: request.observerBindingId,
        strategyId: request.strategyId
      },
      5_000
    );
    if (result.type !== 'collector_strategy_binding_diagnostics' ||
      result.observerBindingId !== request.observerBindingId ||
      result.strategyId !== request.strategyId) {
      throw new Error('strategy_binding_diagnostics_result_invalid');
    }
    return result;
  }

  async captureVisualEvidence(request: CapturePageVisualEvidenceRequest): Promise<PageVisualEvidence> {
    return await this.#ledger.captureVisualEvidence(request, this.#visualEvidenceDirectory);
  }

  async captureRetainedVisualEvidence(request: CaptureRetainedPageVisualEvidenceRequest): Promise<PageVisualEvidence> {
    return await this.#ledger.captureRetainedVisualEvidence(request, this.#visualEvidenceDirectory);
  }

  reconcile(request: ReconcilePageRequest) {
    return this.#ledger.reconcile(request);
  }

  createReclaimPlan(request: CreateReclaimPlanRequest): ReclaimPlan {
    return this.#reclamation.create(request);
  }

  executeReclaimPlan(reclaimPlanId: string): Promise<ReclaimExecutionResult> {
    return this.#reclamation.execute(reclaimPlanId);
  }

  disconnectController(controllerGeneration: string): void {
    this.#ledger.disconnectController(controllerGeneration);
  }

  summary(): BrowserProfilePagePoolSummary {
    const records = this.#ledger.records();
    const openPages = this.#context.pages().filter((page) => !page.isClosed());
    const managedPages = new Set(records.filter((record) => record.state !== 'closed').map((record) => record.page));
    const extensionPages = openPages.filter((page) => page.url().startsWith('chrome-extension://')).length;
    const unmanagedPages = openPages.filter((page) => !managedPages.has(page) && !page.url().startsWith('chrome-extension://')).length;
    const count = (state: string) => records.filter((record) => record.state === state).length;
    return {
      profileId: this.profileId,
      browserSessionId: this.browserSessionId,
      browserProcessId: this.#browserProcessId,
      running: this.#running,
      maximumManagedPages: this.#ledger.maximumManagedPages,
      managedPages: records.filter((record) => record.state !== 'closed').length,
      leasedPages: records.filter((record) => record.state === 'leased' || record.state === 'leased_pre_navigation').length,
      idleReusablePages: count('idle_reusable'),
      idleStalePages: count('idle_stale'),
      retainedPages: count('retained_for_review'),
      quarantinedPages: count('quarantined'),
      reclaimPendingPages: count('reclaim_pending'),
      closedPages: count('closed'),
      unmanagedPages,
      extensionPages,
      extensionRuntime: this.#extensionRuntime
        ? {
            ...structuredClone(this.#extensionRuntime),
            nativeBridgeConnected: this.#nativeBridgeRegistry.isReady(this.profileId, this.browserSessionId)
          }
        : null,
      livePlatformRequests: this.#livePlatformRequests,
      pages: this.#ledger.summaries()
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#running) await this.#context.close().catch(() => undefined);
    this.#running = false;
    this.#browserProcessId = null;
    this.#nativeBridgeRegistry.clearProfile(this.profileId, this.browserSessionId);
    await this.#nativeHostRegistration?.uninstall().catch(() => undefined);
  }
}

async function browserProcessId(context: BrowserContext): Promise<number | null> {
  const browser = context.browser();
  if (!browser) return null;
  const session = await browser.newBrowserCDPSession().catch(() => null);
  if (!session) return null;
  try {
    const result = await session.send('SystemInfo.getProcessInfo') as {
      processInfo?: Array<{ type?: unknown; id?: unknown }>;
    };
    const browserProcess = result.processInfo?.find((process) => process.type === 'browser');
    return typeof browserProcess?.id === 'number' ? browserProcess.id : null;
  } catch {
    return null;
  } finally {
    await session.detach().catch(() => undefined);
  }
}
