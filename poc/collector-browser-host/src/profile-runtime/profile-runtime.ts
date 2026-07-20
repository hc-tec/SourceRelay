import type { BrowserContext } from 'playwright';
import {
  type AcquirePageRequest,
  type AcquirePageResult,
  type BrowserProfilePagePoolSummary,
  type CreateReclaimPlanRequest,
  type ExtensionRuntimeExpectation,
  type ExtensionRuntimeSummary,
  type NavigatePageRequest,
  type ReclaimExecutionResult,
  type ReclaimPlan,
  type ReconcilePageRequest,
  type ReleasePageRequest
} from '@intelligence/collector-contracts';
import type { NativeBridgeRegistry } from '../native-bridge/native-bridge-registry.js';
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
  readonly #nativeHostRegistration: NativeMessagingHostRegistration | null;
  readonly #extensionRuntime: ExtensionRuntimeSummary | null;
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
    nativeHostRegistration: NativeMessagingHostRegistration | null;
    extensionRuntime: ExtensionRuntimeSummary | null;
  }) {
    this.profileId = input.profileId;
    this.browserSessionId = input.browserSessionId;
    this.#context = input.context;
    this.#browserProcessId = input.browserProcessId;
    this.#ledger = input.ledger;
    this.#reclamation = input.reclamation;
    this.#nativeBridgeRegistry = input.nativeBridgeRegistry;
    this.#nativeHostRegistration = input.nativeHostRegistration;
    this.#extensionRuntime = input.extensionRuntime;
  }

  static async launch(input: {
    profileId: string;
    browserSessionId: string;
    userDataDirectory: string;
    extensionDirectory: string | null;
    extensionRuntime: ExtensionRuntimeExpectation | null;
    nativeBridgeRegistry: NativeBridgeRegistry;
    nativeHostStateDirectory: string;
    hostEndpointPath: string;
    nativeBridgeModulePath: string;
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
        nativeHostRegistration,
        extensionRuntime
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

  navigate(request: NavigatePageRequest) {
    return this.#ledger.navigate(request);
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
