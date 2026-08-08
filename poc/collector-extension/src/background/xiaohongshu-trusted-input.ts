import {
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface
} from '@intelligence/collector-contracts';

const ACTION_STORAGE_KEY = 'collector.xiaohongshu.trusted-input-action.v1';
const DEBUGGER_PROTOCOL_VERSION = '1.3';
const INPUT_DELAY_MS = 55;
const MOUSE_MOVE_SETTLE_MS = 100;
const CLICK_HOLD_MS = 100;
const POST_CLICK_SETTLE_MS = 150;
const POST_TYPE_SETTLE_MS = 200;

export interface XiaohongshuTrustedInputAction {
  schemaVersion: 1;
  actionId: string;
  workId: string;
  runId: string;
  browserBindingId: string;
  query: string;
  expiresAt: string;
}

export interface XiaohongshuTrustedInputResult {
  schemaVersion: 1;
  actionId: string;
  state: 'completed' | 'stopped';
  errorCode: string | null;
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  input: { queryEchoed: boolean; enterAttempted: boolean };
  page: { publicSurface: 'explore' | 'search'; renderedCardCount: number } | null;
  debuggerDetached: boolean;
}

interface PersistedAction {
  schemaVersion: 1;
  actionId: string;
  workId: string;
  runId: string;
  browserBindingId: string;
  expiresAt: string;
  phase: 'claimed' | 'semantic_action_intent_recorded' | 'terminal';
  semanticActionAttempted: boolean;
}

interface EligibleDocument {
  tabId: number;
  windowId: number;
  documentId: string;
}

interface SearchTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PagePostcondition {
  publicSurface: 'explore' | 'search' | null;
  queryEchoed: boolean;
  renderedCardCount: number;
  loginRequired: boolean;
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

interface PagePostconditionProbe {
  publicSurface: PagePostcondition['publicSurface'];
  queryEchoed: boolean;
  renderedCardCount: number;
  pathname: string;
  title: string;
  visibleText: string;
}

export interface XiaohongshuTrustedInputLifecycle {
  /** Internal-only managed-tab binding; never accepted from an AI request. */
  expectedTabId?: number;
  onEligibleDocument?: (document: Readonly<EligibleDocument>) => Promise<void>;
  onSearchPostcondition?: (
    document: Readonly<EligibleDocument>,
    postcondition: Readonly<PagePostcondition>
  ) => Promise<void>;
}

/**
 * Executes exactly one fixed Xiaohongshu search in an Explore document. The
 * normal work-runner path binds this operation to one Collector-managed tab;
 * the legacy canary may provide an internal expected tab. The action accepts
 * no caller URL, selector, coordinate, script or CDP command and never
 * navigates, reloads or closes a tab itself.
 */
export async function executeXiaohongshuTrustedInputSearch(
  value: unknown,
  lifecycle: XiaohongshuTrustedInputLifecycle = {}
): Promise<XiaohongshuTrustedInputResult> {
  const action = parseAction(value);
  const previousActions = await loadPersistedActions();
  if (previousActions.some((entry) => entry.actionId === action.actionId)) {
    throw new Error('xiaohongshu_trusted_input_action_already_claimed');
  }
  if (previousActions.some((entry) => entry.phase !== 'terminal' && Date.parse(entry.expiresAt) > Date.now())) {
    throw new Error('xiaohongshu_trusted_input_action_in_progress');
  }
  if (Date.parse(action.expiresAt) <= Date.now()) throw new Error('xiaohongshu_trusted_input_action_expired');

  await storeAction(action, 'claimed');
  let debuggerTarget: chrome.debugger.Debuggee | null = null;
  let semanticActionAttempted = false;
  let enterAttempted = false;
  let queryEchoed = false;
  let result: XiaohongshuTrustedInputResult;
  try {
    const document = await findUniqueEligibleExploreDocument(lifecycle.expectedTabId);
    await chrome.tabs.update(document.tabId, { active: true });
    await requireSameDocument(document);
    await lifecycle.onEligibleDocument?.(document);
    await requireSameDocument(document);
    const target = await discoverSearchTarget(document);

    debuggerTarget = { tabId: document.tabId };
    try {
      await chrome.debugger.attach(debuggerTarget, DEBUGGER_PROTOCOL_VERSION);
    } catch {
      debuggerTarget = null;
      throw new Error('debugger_attach_failed');
    }
    await requireSameDocument(document);

    // Persist the at-most-once boundary before the first input command. A
    // worker interruption after this write is an unknown outcome, never a
    // reason to replay the semantic action.
    await storeAction(action, 'semantic_action_intent_recorded');
    semanticActionAttempted = true;
    try {
      await dispatchMouseClick(debuggerTarget, target);
      await dispatchSelectAll(debuggerTarget);
      for (const character of Array.from(action.query)) {
        await chrome.debugger.sendCommand(debuggerTarget, 'Input.insertText', { text: character });
        await delay(INPUT_DELAY_MS);
      }
    } catch {
      throw new Error('debugger_input_failed');
    }
    queryEchoed = await waitForQueryEcho(document, action.query);
    if (!queryEchoed) throw new Error('xiaohongshu_trusted_input_query_not_echoed');
    await requireSameDocument(document);
    await delay(POST_TYPE_SETTLE_MS);
    enterAttempted = true;
    try {
      await dispatchEnter(debuggerTarget);
    } catch {
      throw new Error('debugger_input_failed');
    }

    const postcondition = await waitForPostcondition(document, action.query, 20_000);
    stopForRisk(postcondition);
    if (postcondition.publicSurface !== 'search' || !postcondition.queryEchoed ||
      postcondition.renderedCardCount < 1) {
      throw new Error('xiaohongshu_trusted_input_postcondition_unmet');
    }
    await lifecycle.onSearchPostcondition?.(document, postcondition);
    await storeAction(action, 'terminal');
    result = {
      schemaVersion: 1,
      actionId: action.actionId,
      state: 'completed',
      errorCode: null,
      semanticAction: { attempted: true, attemptCount: 1 },
      input: { queryEchoed: true, enterAttempted: true },
      page: {
        publicSurface: postcondition.publicSurface,
        renderedCardCount: postcondition.renderedCardCount
      },
      debuggerDetached: false
    };
  } catch (error) {
    await storeAction(action, 'terminal');
    result = {
      schemaVersion: 1,
      actionId: action.actionId,
      state: 'stopped',
      errorCode: safeErrorCode(error),
      semanticAction: {
        attempted: semanticActionAttempted,
        attemptCount: semanticActionAttempted ? 1 : 0
      },
      input: { queryEchoed, enterAttempted },
      page: null,
      debuggerDetached: false
    };
  } finally {
    if (debuggerTarget) {
      try {
        await chrome.debugger.detach(debuggerTarget);
        result!.debuggerDetached = true;
      } catch {
        result!.state = 'stopped';
        result!.errorCode = 'xiaohongshu_trusted_input_debugger_detach_failed';
      }
    } else {
      result!.debuggerDetached = true;
    }
  }
  return result!;
}

export function isXiaohongshuTrustedInputAction(value: unknown): value is XiaohongshuTrustedInputAction {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'actionId', 'workId', 'runId', 'browserBindingId', 'query', 'expiresAt'
  ])) return false;
  return value.schemaVersion === 1 && identifier(value.actionId) && identifier(value.workId) &&
    identifier(value.runId) && identifier(value.browserBindingId) && boundedQuery(value.query) &&
    typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt));
}

export async function wasXiaohongshuTrustedInputAttempted(actionId: string): Promise<boolean> {
  if (!identifier(actionId)) return false;
  const action = (await loadPersistedActions()).find((entry) => entry.actionId === actionId);
  return action?.semanticActionAttempted === true;
}

export async function readXiaohongshuTrustedInputLedgerSummary(): Promise<{
  type: 'collector_xiaohongshu_trusted_input_ledger_summary';
  schemaVersion: 1;
  entryCount: number;
  latestPhase: 'none' | PersistedAction['phase'];
  latestSemanticActionAttempted: boolean;
}> {
  const actions = await loadPersistedActions();
  return {
    type: 'collector_xiaohongshu_trusted_input_ledger_summary',
    schemaVersion: 1,
    entryCount: actions.length,
    latestPhase: actions.at(-1)?.phase ?? 'none',
    latestSemanticActionAttempted: actions.at(-1)?.semanticActionAttempted ?? false
  };
}

async function findUniqueEligibleExploreDocument(expectedTabId?: number): Promise<EligibleDocument> {
  const tabs = expectedTabId === undefined
    ? await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/explore', 'https://www.xiaohongshu.com/explore/'] })
    : [await chrome.tabs.get(expectedTabId).catch(() => null)].filter((tab): tab is chrome.tabs.Tab => tab !== null);
  const eligible = tabs.filter((tab) => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId) &&
    !tab.incognito && tab.status === 'complete' && xiaohongshuCurrentPageNetworkPublicSurface(tab.url ?? '') === 'explore');
  if (eligible.length === 0) throw new Error('xiaohongshu_trusted_input_explore_tab_required');
  if (eligible.length !== 1) throw new Error('xiaohongshu_trusted_input_explore_tab_ambiguous');
  const tab = eligible[0]!;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || xiaohongshuCurrentPageNetworkPublicSurface(frame.url) !== 'explore') {
    throw new Error('xiaohongshu_trusted_input_explore_document_unavailable');
  }
  return { tabId: tab.id!, windowId: tab.windowId!, documentId: frame.documentId };
}

async function requireSameDocument(document: EligibleDocument): Promise<void> {
  const tab = await chrome.tabs.get(document.tabId).catch(() => null);
  const frame = await chrome.webNavigation.getFrame({ tabId: document.tabId, frameId: 0 }).catch(() => null);
  if (!tab || tab.windowId !== document.windowId || tab.incognito || !frame ||
    frame.documentId !== document.documentId ||
    xiaohongshuCurrentPageNetworkPublicSurface(frame.url) !== 'explore') {
    throw new Error('xiaohongshu_trusted_input_document_changed');
  }
}

async function discoverSearchTarget(eligibleDocument: EligibleDocument): Promise<SearchTarget> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: eligibleDocument.tabId, documentIds: [eligibleDocument.documentId] },
    func: () => {
      const candidates = [
        document.querySelector('#search-input-in-feeds'),
        document.querySelector('#search-input'),
        ...document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')
      ].filter((value, index, all): value is HTMLElement =>
        value instanceof HTMLElement && all.indexOf(value) === index
      );
      for (const input of candidates) {
        const rect = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        const label = `${input.getAttribute('placeholder') ?? ''} ${input.getAttribute('aria-label') ?? ''} ${input.getAttribute('role') ?? ''}`;
        const knownSearchIdentity = input.id === 'search-input-in-feeds' || input.id === 'search-input';
        const disabled = (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
          ? input.disabled : input.getAttribute('aria-disabled') === 'true';
        const readOnly = (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
          ? input.readOnly : input.getAttribute('contenteditable') !== 'true';
        if ((!knownSearchIdentity && !/搜索|search|textbox/i.test(label)) || disabled || readOnly ||
          rect.width < 80 || rect.height < 20 ||
          style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit !== input && !input.contains(hit)) continue;
        return { x, y, width: rect.width, height: rect.height };
      }
      return null;
    }
  });
  const target = results[0]?.result as SearchTarget | null | undefined;
  if (!target || !finiteBounds(target)) throw new Error('xiaohongshu_trusted_input_search_target_unavailable');
  return target;
}

async function readQueryEcho(eligibleDocument: EligibleDocument, query: string): Promise<boolean> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: eligibleDocument.tabId, documentIds: [eligibleDocument.documentId] },
    args: [query],
    func: (expected) => [...document.querySelectorAll<HTMLElement>(
      'input, textarea, [contenteditable="true"], [role="textbox"]'
    )].some((input) => {
      const text = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
        ? input.value : input.innerText || input.textContent || '';
      return text.trim() === expected && (
        input.id === 'search-input-in-feeds' || input.id === 'search-input' ||
        /搜索|search|textbox/i.test(
          `${input.getAttribute('placeholder') ?? ''} ${input.getAttribute('aria-label') ?? ''} ${input.getAttribute('role') ?? ''}`
        )
      );
    })
  });
  return results[0]?.result === true;
}

/**
 * The page owns the search input state; React may commit the typed value a
 * moment after the last insertText. Poll the echo for a short bounded window
 * instead of declaring failure from one immediate read. This never replays
 * the semantic action and never navigates the page.
 */
async function waitForQueryEcho(eligibleDocument: EligibleDocument, query: string): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (await readQueryEcho(eligibleDocument, query)) return true;
    await requireSameDocument(eligibleDocument);
    await delay(120);
  }
  return false;
}

async function dispatchMouseClick(target: chrome.debugger.Debuggee, bounds: SearchTarget): Promise<void> {
  const x = bounds.x;
  const y = bounds.y;
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await delay(MOUSE_MOVE_SETTLE_MS);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1
  });
  await delay(CLICK_HOLD_MS);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1
  });
  await delay(POST_CLICK_SETTLE_MS);
}

async function dispatchSelectAll(target: chrome.debugger.Debuggee): Promise<void> {
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17
  });
}

async function dispatchEnter(target: chrome.debugger.Debuggee): Promise<void> {
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
  });
}

async function waitForPostcondition(
  document: EligibleDocument,
  query: string,
  timeoutMs: number
): Promise<PagePostcondition> {
  const deadline = Date.now() + timeoutMs;
  let latest: PagePostcondition | null = null;
  while (Date.now() < deadline) {
    latest = await readPostcondition(document, query);
    stopForRisk(latest);
    if (latest.publicSurface === 'search' && latest.queryEchoed && latest.renderedCardCount > 0) return latest;
    await delay(250);
  }
  return latest ?? {
    publicSurface: null,
    queryEchoed: false,
    renderedCardCount: 0,
    loginRequired: false,
    verificationRequired: false,
    rateLimited: false,
    sourceUnavailable: true
  };
}

async function readPostcondition(eligibleDocument: EligibleDocument, query: string): Promise<PagePostcondition> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: eligibleDocument.tabId, documentIds: [eligibleDocument.documentId] },
    args: [query],
    func: (expected) => {
      const pathname = location.pathname;
      const bodyText = (document.body?.innerText ?? '').slice(0, 12_000);
      const queryEchoed = [...document.querySelectorAll<HTMLElement>(
        'input, textarea, [contenteditable="true"], [role="textbox"]'
      )].some((input) => {
        const text = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
          ? input.value : input.innerText || input.textContent || '';
        return text.trim() === expected;
      });
      const cards = document.querySelectorAll('[data-v-a264b01a], section.note-item, .note-item, .feeds-page .note-item').length;
      return {
        publicSurface: pathname === '/explore' || pathname === '/explore/' ? 'explore' :
          /^\/search_result(?:_ai)?\/?$/.test(pathname) ? 'search' : null,
        queryEchoed,
        renderedCardCount: Math.min(40, cards),
        pathname,
        title: document.title.slice(0, 300),
        visibleText: bodyText
      };
    }
  });
  const value = results[0]?.result as PagePostconditionProbe | undefined;
  if (!value || (value.publicSurface !== 'explore' && value.publicSurface !== 'search' && value.publicSurface !== null) ||
    typeof value.queryEchoed !== 'boolean' || !Number.isSafeInteger(value.renderedCardCount) ||
    value.renderedCardCount < 0 || value.renderedCardCount > 40 || typeof value.pathname !== 'string' ||
    typeof value.title !== 'string' || typeof value.visibleText !== 'string') {
    throw new Error('xiaohongshu_trusted_input_postcondition_unavailable');
  }
  return {
    publicSurface: value.publicSurface,
    queryEchoed: value.queryEchoed,
    renderedCardCount: value.renderedCardCount,
    ...classifyXiaohongshuCurrentPageRisk({
      pathname: value.pathname,
      title: value.title,
      visibleText: value.visibleText
    })
  };
}

function stopForRisk(value: PagePostcondition): void {
  if (value.verificationRequired) throw new Error('xiaohongshu_verification_required');
  if (value.rateLimited) throw new Error('xiaohongshu_rate_limited');
  if (value.sourceUnavailable) throw new Error('xiaohongshu_source_unavailable');
  if (value.loginRequired) throw new Error('xiaohongshu_login_required');
}

async function loadPersistedActions(): Promise<PersistedAction[]> {
  const stored = await chrome.storage.local.get(ACTION_STORAGE_KEY);
  const value = stored[ACTION_STORAGE_KEY];
  if (!Array.isArray(value)) return [];
  return value.map(parsePersistedAction).filter((entry): entry is PersistedAction => entry !== null).slice(-100);
}

function parsePersistedAction(candidate: unknown): PersistedAction | null {
  if (!record(candidate) || !exactKeys(candidate, [
    'schemaVersion', 'actionId', 'workId', 'runId', 'browserBindingId', 'expiresAt', 'phase',
    'semanticActionAttempted'
  ])) return null;
  if (candidate.schemaVersion !== 1 || !identifier(candidate.actionId) || !identifier(candidate.workId) ||
    !identifier(candidate.runId) || !identifier(candidate.browserBindingId) || typeof candidate.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) || (candidate.phase !== 'claimed' &&
      candidate.phase !== 'semantic_action_intent_recorded' && candidate.phase !== 'terminal') ||
    typeof candidate.semanticActionAttempted !== 'boolean') return null;
  return candidate as unknown as PersistedAction;
}

async function storeAction(action: XiaohongshuTrustedInputAction, phase: PersistedAction['phase']): Promise<void> {
  const current = await loadPersistedActions();
  const record: PersistedAction = {
    schemaVersion: 1,
    actionId: action.actionId,
    workId: action.workId,
    runId: action.runId,
    browserBindingId: action.browserBindingId,
    expiresAt: action.expiresAt,
    phase,
    semanticActionAttempted: phase === 'semantic_action_intent_recorded' ||
      (phase === 'terminal' && current.find((entry) => entry.actionId === action.actionId)?.semanticActionAttempted === true)
  };
  const next = [...current.filter((entry) => entry.actionId !== action.actionId), record].slice(-100);
  await chrome.storage.local.set({ [ACTION_STORAGE_KEY]: next });
}

function parseAction(value: unknown): XiaohongshuTrustedInputAction {
  if (!isXiaohongshuTrustedInputAction(value)) throw new Error('xiaohongshu_trusted_input_action_invalid');
  return value;
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'xiaohongshu_trusted_input_failed';
}

function finiteBounds(value: SearchTarget): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.width >= 80 && value.height >= 20;
}

function boundedQuery(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 180 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
