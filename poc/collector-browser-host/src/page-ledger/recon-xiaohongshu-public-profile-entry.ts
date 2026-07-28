import { createHash } from 'node:crypto';
import type { Page, Response } from 'playwright';
import {
  XIAOHONGSHU_PUBLIC_PROFILE_RECON_SCHEMA_VERSION,
  isXiaohongshuPublicProfileReconRequest,
  type XiaohongshuPublicProfileReconRequest,
  type XiaohongshuPublicProfileReconResult
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { ensureManagedPageForeground } from './page-foreground.js';

interface PublicProfileProbe {
  publicSurface: 'search' | 'public_profile' | 'other';
  renderedCardCount: number;
  profileHeaderVisible: boolean;
  authorTarget: null | {
    targetMode: 'same_tab' | 'new_tab';
    displayText: string;
    bounds: { x: number; y: number; width: number; height: number };
    pointerHitTarget: boolean;
  };
  risk: XiaohongshuPublicProfileReconResult['risk'];
}

type NetworkShape = XiaohongshuPublicProfileReconResult['network']['responses'][number];

export async function executeXiaohongshuPublicProfileEntryRecon(input: {
  record: ManagedPageRecord;
  request: XiaohongshuPublicProfileReconRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<XiaohongshuPublicProfileReconResult> {
  const { record, request } = input;
  if (!isXiaohongshuPublicProfileReconRequest(request)) {
    throw hostError({ code: 'xiaohongshu_public_profile_recon_request_invalid', category: 'protocol', scope: 'action' });
  }
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  if (record.state !== 'leased' || record.platform !== 'xiaohongshu' || record.pageRole !== 'public_search') {
    throw hostError({ code: 'xiaohongshu_public_profile_recon_page_role_rejected', category: 'page_identity', scope: 'page' });
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
  const responsePromises: Array<Promise<NetworkShape | null>> = [];
  const onResponse = (response: Response): void => {
    if (responsePromises.length >= 12) return;
    const resourceType = response.request().resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (url.hostname !== 'www.xiaohongshu.com') return;
    responsePromises.push(projectResponseShape(response, url.pathname));
  };

  try {
    await withinDeadline(ensureManagedPageForeground(record.page), remaining(deadline));
    const before = await readProbe(record.page, remaining(deadline));
    if (before.publicSurface !== 'search' || before.renderedCardCount < 1 ||
      before.risk.verificationRequired || before.risk.rateLimited || before.risk.sourceUnavailable) {
      throw hostError({
        code: 'xiaohongshu_public_profile_recon_search_precondition_unmet',
        category: 'action',
        scope: 'action',
        retryClass: 'local_query_only'
      });
    }
    const beforeVisual = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      directory: input.visualEvidenceDirectory
    }), remaining(deadline));
    const base = {
      schemaVersion: XIAOHONGSHU_PUBLIC_PROFILE_RECON_SCHEMA_VERSION,
      pageAlias: record.pageAlias,
      actionId: request.actionId,
      completedAt: new Date().toISOString(),
      before: {
        publicSurface: 'search' as const,
        renderedCardCount: before.renderedCardCount,
        authorTarget: before.authorTarget ? {
          targetMode: before.authorTarget.targetMode,
          targetKind: 'public_note_author' as const,
          displayTextDigest: sha256(before.authorTarget.displayText),
          bounds: before.authorTarget.bounds,
          pointerHitTarget: before.authorTarget.pointerHitTarget
        } : null,
        visualEvidence: beforeVisual
      },
      risk: before.risk
    };
    if (!before.authorTarget || before.authorTarget.targetMode !== 'same_tab' ||
      !before.authorTarget.pointerHitTarget) {
      input.emit('xiaohongshu_public_profile_recon_prerequisite_unmet', null, request.actionId);
      return {
        ...base,
        state: 'prerequisite_unmet',
        semanticAction: { attempted: false, attemptCount: 0 },
        after: null,
        network: { responseBodiesRead: false, temporaryBodyBytesRead: 0, responses: [] }
      };
    }

    record.page.on('response', onResponse);
    record.attemptedActionIds.add(request.actionId);
    actionAttempted = true;
    touchRecord(record);
    input.emit('action_attempted', null, request.actionId);
    const target = before.authorTarget;
    const x = Math.floor(target.bounds.x + target.bounds.width / 2);
    const y = Math.floor(target.bounds.y + target.bounds.height / 2);
    await withinDeadline(record.page.mouse.move(x, y), remaining(deadline));
    const hovered = await readProbe(record.page, remaining(deadline));
    if (!hovered.authorTarget?.pointerHitTarget || hovered.authorTarget.targetMode !== 'same_tab') {
      throw new Error('xiaohongshu_public_profile_recon_hover_context_changed');
    }
    const pageCountBefore = record.page.context().pages().length;
    await withinDeadline(record.page.mouse.click(x, y, { button: 'left' }), remaining(deadline));
    const after = await waitForProfilePostcondition(record.page, pageCountBefore, deadline);
    await delay(Math.min(1_200, Math.max(1, remaining(deadline))));
    const network = (await Promise.all(responsePromises.map((promise) => withinDeadline(
      promise.catch(() => null),
      Math.min(3_000, remaining(deadline))
    )))).filter((value): value is NetworkShape => value !== null);
    const afterVisual = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      directory: input.visualEvidenceDirectory
    }), remaining(deadline));
    input.emit('xiaohongshu_public_profile_recon_completed', null, request.actionId);
    return {
      ...base,
      completedAt: new Date().toISOString(),
      state: 'completed',
      semanticAction: { attempted: true, attemptCount: 1 },
      after: {
        publicSurface: 'public_profile',
        sameTab: true,
        renderedNoteCount: after.renderedCardCount,
        profileHeaderVisible: after.profileHeaderVisible,
        visualEvidence: afterVisual
      },
      network: {
        responseBodiesRead: network.some((response) => response.bodyBytes > 0),
        temporaryBodyBytesRead: network.reduce((total, response) => total + response.bodyBytes, 0),
        responses: network
      },
      risk: after.risk
    };
  } catch (error) {
    if (!actionAttempted) throw error;
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'xiaohongshu_public_profile_recon_outcome_unknown');
    input.emit('xiaohongshu_public_profile_recon_outcome_unknown',
      'xiaohongshu_public_profile_recon_outcome_unknown', request.actionId);
    throw hostError({
      code: 'xiaohongshu_public_profile_recon_outcome_unknown',
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

async function waitForProfilePostcondition(page: Page, pageCountBefore: number, deadline: number): Promise<PublicProfileProbe> {
  let latest: PublicProfileProbe | null = null;
  while (Date.now() < deadline) {
    if (page.context().pages().length !== pageCountBefore) {
      throw new Error('xiaohongshu_public_profile_recon_new_tab_detected');
    }
    latest = await readProbe(page, remaining(deadline));
    if (latest.risk.verificationRequired || latest.risk.rateLimited || latest.risk.sourceUnavailable) {
      throw new Error('xiaohongshu_public_profile_recon_risk_stopped');
    }
    if (latest.publicSurface === 'public_profile' && latest.renderedCardCount > 0) return latest;
    await delay(Math.min(300, Math.max(1, deadline - Date.now())));
  }
  throw new Error('xiaohongshu_public_profile_recon_postcondition_timeout');
}

async function readProbe(page: Page, timeoutMs: number): Promise<PublicProfileProbe> {
  return await withinDeadline(page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const pathname = location.pathname;
    const text = (document.body?.innerText ?? '').slice(0, 16_000);
    const candidates = Array.from(document.querySelectorAll('section.note-item a[href]'))
      .filter((element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement &&
        visible(element) && (() => {
          try {
            const target = new URL(element.href);
            return target.origin === location.origin && target.pathname.startsWith('/user/profile/');
          } catch {
            return false;
          }
        })());
    const anchor = candidates[0] ?? null;
    const rect = anchor?.getBoundingClientRect() ?? null;
    const center = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
    const profileHeaderCandidates = Array.from(document.querySelectorAll(
      '[class*="user-info"], [class*="user-page"], [class*="profile"]'
    )).filter(visible);
    return {
      publicSurface: pathname === '/search_result' || pathname === '/search_result/' ||
        pathname === '/search_result_ai' || pathname === '/search_result_ai/'
        ? 'search' as const
        : pathname.startsWith('/user/profile/') ? 'public_profile' as const : 'other' as const,
      renderedCardCount: document.querySelectorAll('section.note-item').length,
      profileHeaderVisible: profileHeaderCandidates.length > 0,
      authorTarget: anchor && rect ? {
        targetMode: anchor.target && anchor.target !== '_self' ? 'new_tab' as const : 'same_tab' as const,
        displayText: (anchor.innerText || anchor.getAttribute('aria-label') || 'public-author').trim().slice(0, 200),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointerHitTarget: center === anchor || Boolean(center && anchor.contains(center))
      } : null,
      risk: {
        loginRequired: !pathname.startsWith('/website-login/') && /登录后|请登录|扫码登录|登录小红书/.test(text),
        verificationRequired: pathname.startsWith('/website-login/') || /安全验证|验证身份|扫码验证/.test(text),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(text),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|暂时无法浏览/.test(text)
      }
    };
  }), timeoutMs);
}

async function projectResponseShape(response: Response, path: string): Promise<NetworkShape | null> {
  const mime = (response.headers()['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!mime.includes('json')) return {
    method: response.request().method(), path, status: response.status(), mime,
    bodyBytes: 0, topLevelKeys: [], dataKeys: [], firstArrayPath: null, firstArrayLength: 0, firstItemKeys: []
  };
  const body = await response.body();
  if (body.byteLength > 512 * 1024) return null;
  const value = JSON.parse(body.toString('utf8')) as unknown;
  const shape = jsonShape(value);
  return {
    method: response.request().method(),
    path,
    status: response.status(),
    mime,
    bodyBytes: body.byteLength,
    ...shape
  };
}

function jsonShape(value: unknown): Omit<NetworkShape, 'method' | 'path' | 'status' | 'mime' | 'bodyBytes'> {
  const topLevelKeys = safeKeys(value);
  const data = record(value) ? value.data : null;
  const dataKeys = safeKeys(data);
  const array = firstArray(value, '$', 0);
  return {
    topLevelKeys,
    dataKeys,
    firstArrayPath: array?.path ?? null,
    firstArrayLength: array?.value.length ?? 0,
    firstItemKeys: array?.value.length ? safeKeys(array.value[0]) : []
  };
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
