import type { Page, Response } from 'playwright';
import {
  XIAOHONGSHU_TRUSTED_SEARCH_SCHEMA_VERSION,
  isXiaohongshuTrustedSearchRequest,
  type XiaohongshuTrustedSearchResponseShape,
  type XiaohongshuTrustedSearchRequest,
  type XiaohongshuTrustedSearchResult
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { ensureManagedPageForeground } from './page-foreground.js';

interface SearchProbe {
  publicSurface: 'explore' | 'search' | 'other';
  input: null | {
    bounds: { x: number; y: number; width: number; height: number };
    value: string;
    rendered: boolean;
    enabled: boolean;
    pointerHitTarget: boolean;
  };
  renderedCardCount: number;
  risk: {
    loginRequired: boolean;
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export async function executeTrustedXiaohongshuSearch(input: {
  record: ManagedPageRecord;
  request: XiaohongshuTrustedSearchRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<XiaohongshuTrustedSearchResult> {
  const { record, request } = input;
  if (!isXiaohongshuTrustedSearchRequest(request)) {
    throw hostError({ code: 'xiaohongshu_trusted_search_request_invalid', category: 'protocol', scope: 'action' });
  }
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  if (record.state !== 'leased' || record.platform !== 'xiaohongshu' || record.pageRole !== 'public_search') {
    throw hostError({ code: 'xiaohongshu_trusted_search_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({
      code: 'managed_page_document_generation_mismatch',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'local_query_only'
    });
  }

  const deadline = Date.now() + request.timeoutMs;
  let actionAttempted = false;
  const responses: Array<{ successful: boolean; json: boolean }> = [];
  const responseShapePromises: Array<Promise<XiaohongshuTrustedSearchResponseShape | null>> = [];
  const onResponse = (response: Response): void => {
    if (responses.length >= 64) return;
    const resourceType = response.request().resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    const contentType = response.headers()['content-type']?.toLowerCase() ?? '';
    responses.push({
      successful: response.status() >= 200 && response.status() < 300,
      json: contentType.includes('json')
    });
    // This command is a live reconnaissance surface, not a production
    // response API.  Read a bounded body in memory and retain only a
    // query-free first-party shape so we can determine whether a stable
    // public route is worth a separate, reviewed projector.
    // Search pages may emit several telemetry/collection responses before the
    // actual note batch. Keep a bounded shape window large enough to see the
    // content response without retaining an unbounded network archive.
    if (responseShapePromises.length >= 64) return;
    let url: URL;
    try { url = new URL(response.url()); } catch { return; }
    if (url.protocol !== 'https:' ||
      !(url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'))) return;
    responseShapePromises.push(projectResponseShape(response, url.hostname, url.pathname));
  };

  try {
    await withinDeadline(ensureManagedPageForeground(record.page), remaining(deadline));
    const before = await readSearchProbe(record.page, remaining(deadline));
    assertSearchPrecondition(before);
    const beforeVisualEvidence = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      directory: input.visualEvidenceDirectory
    }), remaining(deadline));

    record.page.on('response', onResponse);
    record.attemptedActionIds.add(request.actionId);
    actionAttempted = true;
    touchRecord(record);
    input.emit('action_attempted', null, request.actionId);

    const target = before.input!;
    const x = Math.floor(target.bounds.x + target.bounds.width / 2);
    const y = Math.floor(target.bounds.y + target.bounds.height / 2);
    await withinDeadline(record.page.mouse.move(x, y), remaining(deadline));
    const hovered = await readSearchProbe(record.page, remaining(deadline));
    assertSearchPrecondition(hovered);
    await withinDeadline(record.page.mouse.down({ button: 'left' }), remaining(deadline));
    await withinDeadline(record.page.mouse.up({ button: 'left' }), remaining(deadline));
    await withinDeadline(record.page.keyboard.press('Control+A'), remaining(deadline));
    await withinDeadline(record.page.keyboard.type(request.query, { delay: 55 }), remaining(deadline));

    const populated = await readSearchProbe(record.page, remaining(deadline));
    if (populated.input?.value !== request.query) {
      throw new Error('xiaohongshu_trusted_search_query_echo_unmet');
    }
    await withinDeadline(record.page.keyboard.press('Enter'), remaining(deadline));
    const after = await waitForSearchPostcondition(record.page, request.query, responses, deadline);
    const responseShapes = (await Promise.all(responseShapePromises.map((promise) => withinDeadline(
      promise.catch(() => null), Math.min(3_000, remaining(deadline))
    )))).filter((value): value is XiaohongshuTrustedSearchResponseShape => value !== null);
    const afterVisualEvidence = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      directory: input.visualEvidenceDirectory
    }), remaining(deadline));
    input.emit('xiaohongshu_trusted_search_completed', null, request.actionId);
    return {
      schemaVersion: XIAOHONGSHU_TRUSTED_SEARCH_SCHEMA_VERSION,
      pageAlias: record.pageAlias,
      actionId: request.actionId,
      recordVersion: record.recordVersion,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      completedAt: new Date().toISOString(),
      inputAttempted: true,
      enterAttempted: true,
      before: {
        targetKind: 'visible_search_input',
        targetBounds: target.bounds,
        pointerHitTarget: true,
        visualEvidence: beforeVisualEvidence
      },
      after: {
        queryEchoed: true,
        publicSurface: 'search',
        renderedCardCount: after.renderedCardCount,
        visualEvidence: afterVisualEvidence
      },
      network: {
        responseCount: responses.length,
        successfulResponseCount: responses.filter((response) => response.successful).length,
        jsonResponseCount: responses.filter((response) => response.json).length,
        responseBodiesRead: responseShapes.some((response) => response.bodyBytes > 0),
        responseShapes
      },
      risk: {
        loginRequired: after.risk.loginRequired,
        verificationRequired: false,
        rateLimited: false,
        sourceUnavailable: false
      }
    };
  } catch (error) {
    if (!actionAttempted) throw error;
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'xiaohongshu_trusted_search_outcome_unknown');
    input.emit('xiaohongshu_trusted_search_outcome_unknown', 'xiaohongshu_trusted_search_outcome_unknown', request.actionId);
    throw hostError({
      code: 'xiaohongshu_trusted_search_outcome_unknown',
      category: 'browser_input',
      scope: 'action',
      retryClass: 'new_run_required',
      platformActionAttempted: true,
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry',
      safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
    });
  } finally {
    record.page.off('response', onResponse);
  }
}

async function projectResponseShape(
  response: Response,
  host: string,
  path: string
): Promise<XiaohongshuTrustedSearchResponseShape | null> {
  const mime = (response.headers()['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  const base = { host, path, status: response.status(), mime };
  if (!mime.includes('json')) return {
    ...base,
    bodyBytes: 0,
    topLevelKeys: [],
    dataKeys: [],
    firstArrayPath: null,
    firstArrayLength: 0,
    firstItemKeys: []
  };
  const body = await response.body();
  if (body.byteLength > 512 * 1024) return null;
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')); } catch { return null; }
  const array = firstArray(value, '$', 0);
  const data = record(value) ? value.data : null;
  return {
    ...base,
    bodyBytes: body.byteLength,
    topLevelKeys: safeKeys(value),
    dataKeys: safeKeys(data),
    firstArrayPath: array?.path ?? null,
    firstArrayLength: array?.value.length ?? 0,
    firstItemKeys: array?.value.length ? firstItemShapeKeys(array.value[0]) : []
  };
}

function firstItemShapeKeys(value: unknown): string[] {
  const keys = safeKeys(value);
  const item = record(value);
  if (item) {
    for (const [key, nested] of Object.entries(item)) {
      if (record(nested)) keys.push(...safeKeys(nested).map((nestedKey) => `${safeKey(key)}.${nestedKey}`));
      else if (Array.isArray(nested)) {
        keys.push(`${safeKey(key)}.array`);
        if (record(nested[0])) keys.push(...safeKeys(nested[0]).map((nestedKey) => `${safeKey(key)}[0].${nestedKey}`));
      } else keys.push(`${safeKey(key)}.type.${nested === null ? 'null' : typeof nested}`);
    }
  }
  return [...new Set(keys)].sort().slice(0, 80);
}

function firstArray(value: unknown, path: string, depth: number): { path: string; value: unknown[] } | null {
  if (Array.isArray(value)) return { path, value };
  if (!record(value) || depth >= 4) return null;
  for (const key of Object.keys(value).sort()) {
    const found = firstArray(value[key], `${path}.${safeKey(key)}`, depth + 1);
    if (found) return found;
  }
  return null;
}

function safeKeys(value: unknown): string[] {
  return record(value) ? Object.keys(value).map(safeKey).filter(Boolean).sort().slice(0, 40) : [];
}

function safeKey(value: string): string {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'other';
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSearchPrecondition(probe: SearchProbe): void {
  if (probe.publicSurface !== 'explore' || !probe.input?.rendered || !probe.input.enabled ||
    !probe.input.pointerHitTarget || probe.risk.verificationRequired || probe.risk.rateLimited ||
    probe.risk.sourceUnavailable) {
    throw hostError({
      code: 'xiaohongshu_trusted_search_precondition_unmet',
      category: 'action',
      scope: 'action',
      retryClass: 'local_query_only'
    });
  }
}

async function waitForSearchPostcondition(
  page: Page,
  query: string,
  responses: readonly unknown[],
  deadline: number
): Promise<SearchProbe> {
  let latest: SearchProbe | null = null;
  while (Date.now() < deadline) {
    latest = await readSearchProbe(page, remaining(deadline));
    if (latest.risk.verificationRequired || latest.risk.rateLimited || latest.risk.sourceUnavailable) {
      throw new Error('xiaohongshu_trusted_search_risk_stopped');
    }
    if (latest.publicSurface === 'search' && latest.input?.value === query &&
      latest.renderedCardCount > 0 && responses.length > 0) return latest;
    await delay(Math.min(350, Math.max(1, deadline - Date.now())));
  }
  throw new Error('xiaohongshu_trusted_search_postcondition_timeout');
}

async function readSearchProbe(page: Page, timeoutMs: number): Promise<SearchProbe> {
  return await withinDeadline(page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const candidates = [
      document.querySelector('#search-input-in-feeds'),
      document.querySelector('#search-input'),
      ...Array.from(document.querySelectorAll('input, textarea')).filter((element) =>
        /搜索|search/i.test(`${element.getAttribute('placeholder') ?? ''} ${element.getAttribute('aria-label') ?? ''}`))
    ].filter((element, index, all): element is HTMLInputElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      all.indexOf(element) === index && visible(element)
    );
    const element = candidates[0] ?? null;
    const rect = element?.getBoundingClientRect() ?? null;
    const center = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
    const text = (document.body?.innerText ?? '').slice(0, 12_000);
    const pathname = location.pathname;
    const verificationRequired = pathname.startsWith('/website-login/') || /安全验证|验证身份|扫码验证/.test(text);
    const rateLimited = /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(text);
    const sourceUnavailable = /页面不存在|加载失败|网络错误|服务不可用|暂时无法浏览/.test(text);
    const loginRequired = !verificationRequired && /登录后|请登录|扫码登录|登录小红书/.test(text);
    return {
      publicSurface: pathname === '/explore' || pathname === '/explore/'
        ? 'explore' as const
        : pathname === '/search_result' || pathname === '/search_result/' ||
          pathname === '/search_result_ai' || pathname === '/search_result_ai/'
          ? 'search' as const
          : 'other' as const,
      input: element && rect ? {
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        value: element.value,
        rendered: visible(element),
        enabled: !element.disabled && !element.readOnly,
        pointerHitTarget: center === element || Boolean(center && element.contains(center))
      } : null,
      renderedCardCount: document.querySelectorAll('section.note-item').length,
      risk: { loginRequired, verificationRequired, rateLimited, sourceUnavailable }
    };
  }), timeoutMs);
}

function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value < 100) throw new Error('run_deadline_exceeded');
  return value;
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('run_deadline_exceeded')), timeoutMs))
  ]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
