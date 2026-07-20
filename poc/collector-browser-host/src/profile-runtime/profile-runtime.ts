import { mkdir } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import {
  type AcquirePageRequest,
  type AcquirePageResult,
  type BrowserProfilePagePoolSummary,
  type CreateReclaimPlanRequest,
  type NavigatePageRequest,
  type ReclaimExecutionResult,
  type ReclaimPlan,
  type ReconcilePageRequest,
  type ReleasePageRequest
} from '@intelligence/collector-contracts';
import { PageLedger, type PageLedgerEvent } from '../page-ledger/page-ledger.js';
import { PageReclamationManager } from '../reclamation/page-reclamation.js';

export class ProfileRuntime {
  readonly profileId: string;
  readonly browserSessionId: string;
  readonly #context: BrowserContext;
  readonly #ledger: PageLedger;
  readonly #reclamation: PageReclamationManager;
  #browserProcessId: number | null = null;
  #livePlatformRequests = 0;
  #running = true;

  private constructor(input: {
    profileId: string;
    browserSessionId: string;
    context: BrowserContext;
    browserProcessId: number | null;
    ledger: PageLedger;
    reclamation: PageReclamationManager;
  }) {
    this.profileId = input.profileId;
    this.browserSessionId = input.browserSessionId;
    this.#context = input.context;
    this.#browserProcessId = input.browserProcessId;
    this.#ledger = input.ledger;
    this.#reclamation = input.reclamation;
  }

  static async launch(input: {
    profileId: string;
    browserSessionId: string;
    userDataDirectory: string;
    extensionDirectory: string | null;
    maximumManagedPages: number;
    headless: boolean;
    offlineOnly: boolean;
    onLedgerEvent: (event: PageLedgerEvent) => void;
    onClosed: () => void;
  }): Promise<ProfileRuntime> {
    await mkdir(input.userDataDirectory, { recursive: true });
    const extensionArgs = input.extensionDirectory
      ? [
          `--disable-extensions-except=${input.extensionDirectory}`,
          `--load-extension=${input.extensionDirectory}`
        ]
      : [];
    const context = await chromium.launchPersistentContext(input.userDataDirectory, {
      channel: 'chromium',
      headless: input.headless,
      offline: input.offlineOnly,
      args: [
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=user-gesture-required',
        '--mute-audio',
        ...extensionArgs
      ]
    });
    let ledger!: PageLedger;
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
      extensionGeneration: 1,
      maximumManagedPages: input.maximumManagedPages,
      offlineOnly: input.offlineOnly,
      onEvent: input.onLedgerEvent
    });
    const runtime = new ProfileRuntime({
      profileId: input.profileId,
      browserSessionId: input.browserSessionId,
      context,
      browserProcessId: await browserProcessId(context),
      ledger,
      reclamation
    });
    context.on('request', (request) => {
      if (isExternalHttpRequest(request.url())) runtime.#livePlatformRequests += 1;
    });
    context.on('close', () => {
      runtime.#running = false;
      input.onClosed();
    });
    return runtime;
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
      livePlatformRequests: this.#livePlatformRequests,
      pages: this.#ledger.summaries()
    };
  }

  async close(): Promise<void> {
    if (!this.#running) return;
    await this.#context.close();
    this.#running = false;
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

function isExternalHttpRequest(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
