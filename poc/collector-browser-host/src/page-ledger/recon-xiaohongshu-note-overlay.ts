import { createHash } from 'node:crypto';
import type { Page, Response } from 'playwright';
import {
  XIAOHONGSHU_NOTE_OVERLAY_RECON_SCHEMA_VERSION,
  isXiaohongshuNoteOverlayReconRequest,
  type XiaohongshuNoteOverlayReconRequest,
  type XiaohongshuNoteOverlayReconResult
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { ensureManagedPageForeground } from './page-foreground.js';

type Risk = XiaohongshuNoteOverlayReconResult['risk'];
type NetworkShape = XiaohongshuNoteOverlayReconResult['network']['responses'][number];

interface SearchProbe {
  publicSurface: 'search' | 'other';
  renderedCardCount: number;
  timeOrigin: number;
  detailTarget: null | {
    targetMode: 'same_tab' | 'new_tab';
    interactionElement: 'anchor' | 'image' | 'container';
    bounds: { x: number; y: number; width: number; height: number };
    pointerHitTarget: boolean;
  };
  risk: Risk;
}

interface OverlayProbe {
  publicSurface: 'note_detail_overlay' | 'other';
  timeOrigin: number;
  overlayVisible: boolean;
  publicText: string;
  closeTarget: null | {
    tag: string;
    role: string | null;
    labelClass: 'close_like' | 'icon_only' | 'unclassified';
    insideOverlay: true;
    bounds: { x: number; y: number; width: number; height: number };
    pointerHitTarget: boolean;
  };
  authorTarget: null | {
    targetMode: 'same_tab' | 'new_tab';
    displayText: string;
    bounds: { x: number; y: number; width: number; height: number };
    pointerHitTarget: boolean;
  };
  risk: Risk;
}

export async function executeXiaohongshuNoteOverlayRecon(input: {
  record: ManagedPageRecord;
  request: XiaohongshuNoteOverlayReconRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<XiaohongshuNoteOverlayReconResult> {
  const { record, request } = input;
  if (!isXiaohongshuNoteOverlayReconRequest(request)) {
    throw hostError({ code: 'xiaohongshu_note_overlay_recon_request_invalid', category: 'protocol', scope: 'action' });
  }
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  if (record.state !== 'leased' || record.platform !== 'xiaohongshu' || record.pageRole !== 'public_search') {
    throw hostError({ code: 'xiaohongshu_note_overlay_recon_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({
      code: 'managed_page_document_generation_mismatch', category: 'page_identity', scope: 'page',
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
    // Xiaohongshu serves public note data from more than the document host.
    // Keep this recon-only observer limited to HTTPS first-party subdomains;
    // never capture arbitrary third-party responses.  The host+path value is
    // a temporary, query-free shape diagnostic and is not a production route.
    if (url.protocol !== 'https:' ||
      !(url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'))) return;
    responsePromises.push(projectResponseShape(response, `${url.hostname}${url.pathname}`));
  };

  try {
    await withinDeadline(ensureManagedPageForeground(record.page), remaining(deadline));
    const before = await readSearchProbe(record.page, remaining(deadline));
    if (before.publicSurface !== 'search' || before.renderedCardCount < 1 || risky(before.risk)) {
      throw hostError({
        code: 'xiaohongshu_note_overlay_recon_search_precondition_unmet', category: 'action', scope: 'action',
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
      schemaVersion: XIAOHONGSHU_NOTE_OVERLAY_RECON_SCHEMA_VERSION,
      pageAlias: record.pageAlias,
      actionId: request.actionId,
      completedAt: new Date().toISOString(),
      before: {
        publicSurface: 'search' as const,
        renderedCardCount: before.renderedCardCount,
        detailTarget: before.detailTarget ? {
          targetMode: before.detailTarget.targetMode,
          targetKind: 'public_note_detail' as const,
          interactionElement: before.detailTarget.interactionElement,
          bounds: before.detailTarget.bounds,
          pointerHitTarget: before.detailTarget.pointerHitTarget
        } : null,
        visualEvidence: beforeVisual
      }
    };
    if (!before.detailTarget || before.detailTarget.targetMode !== 'same_tab' ||
      !before.detailTarget.pointerHitTarget) {
      input.emit('xiaohongshu_note_overlay_recon_prerequisite_unmet', null, request.actionId);
      return {
        ...base,
        state: 'prerequisite_unmet',
        semanticAction: { attempted: false, attemptCount: 0 },
        after: null,
        network: { responseBodiesRead: false, temporaryBodyBytesRead: 0, responses: [] },
        risk: before.risk
      };
    }

    record.page.on('response', onResponse);
    record.attemptedActionIds.add(request.actionId);
    actionAttempted = true;
    touchRecord(record);
    input.emit('action_attempted', null, request.actionId);
    const target = before.detailTarget;
    const x = Math.floor(target.bounds.x + target.bounds.width / 2);
    const y = Math.floor(target.bounds.y + target.bounds.height / 2);
    await withinDeadline(record.page.mouse.move(x, y), remaining(deadline));
    const hovered = await readSearchProbe(record.page, remaining(deadline));
    if (!hovered.detailTarget?.pointerHitTarget || hovered.detailTarget.targetMode !== 'same_tab') {
      throw new Error('xiaohongshu_note_overlay_recon_hover_context_changed');
    }
    const pageCountBefore = record.page.context().pages().length;
    await withinDeadline(record.page.mouse.click(x, y, { button: 'left' }), remaining(deadline));
    const after = await waitForOverlayPostcondition(record.page, pageCountBefore, before.timeOrigin, deadline);
    // Public comments initialise asynchronously after the overlay itself is
    // visible. Keep the response observer alive long enough to distinguish
    // that automatic load from any later scroll-triggered pagination.
    await delay(Math.min(5_500, Math.max(1, remaining(deadline))));
    const network = (await Promise.all(responsePromises.map((promise) => withinDeadline(
      promise.catch(() => null), Math.min(3_000, remaining(deadline))
    )))).filter((value): value is NetworkShape => value !== null);
    const afterVisual = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      directory: input.visualEvidenceDirectory
    }), remaining(deadline));
    input.emit('xiaohongshu_note_overlay_recon_completed', null, request.actionId);
    return {
      ...base,
      completedAt: new Date().toISOString(),
      state: 'completed',
      semanticAction: { attempted: true, attemptCount: 1 },
      after: {
        publicSurface: 'note_detail_overlay',
        sameDocument: true,
        overlayVisible: true,
        publicTextDigest: sha256(after.publicText),
        closeTarget: after.closeTarget,
        authorTarget: after.authorTarget ? {
          targetMode: after.authorTarget.targetMode,
          targetKind: 'overlay_public_author',
          displayTextDigest: sha256(after.authorTarget.displayText),
          bounds: after.authorTarget.bounds,
          pointerHitTarget: after.authorTarget.pointerHitTarget
        } : null,
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
    transitionRecord(record, 'quarantined', 'xiaohongshu_note_overlay_recon_outcome_unknown');
    input.emit('xiaohongshu_note_overlay_recon_outcome_unknown',
      'xiaohongshu_note_overlay_recon_outcome_unknown', request.actionId);
    throw hostError({
      code: 'xiaohongshu_note_overlay_recon_outcome_unknown',
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

async function readSearchProbe(page: Page, timeoutMs: number): Promise<SearchProbe> {
  return await withinDeadline(page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const pathname = location.pathname;
    const text = (document.body?.innerText ?? '').slice(0, 16_000);
    const sections = Array.from(document.querySelectorAll('section.note-item')).filter(visible)
      .sort((left, right) => left.getBoundingClientRect().y - right.getBoundingClientRect().y ||
        left.getBoundingClientRect().x - right.getBoundingClientRect().x);
    const section = sections[0] ?? null;
    const image = section ? Array.from(section.querySelectorAll('img')).filter(visible)
      .sort((left, right) => {
        const l = left.getBoundingClientRect();
        const r = right.getBoundingClientRect();
        return (r.width * r.height) - (l.width * l.height);
      })[0] ?? null : null;
    const explicitAnchor = section ? Array.from(section.querySelectorAll('a[href]')).find((element) => {
      if (!(element instanceof HTMLAnchorElement) || !visible(element)) return false;
      try {
        const targetUrl = new URL(element.href);
        return targetUrl.origin === location.origin &&
          (targetUrl.pathname.startsWith('/explore/') || targetUrl.pathname.startsWith('/discovery/item/'));
      } catch {
        return false;
      }
    }) as HTMLAnchorElement | undefined : undefined;
    const target = explicitAnchor ?? image ?? section;
    const rect = target?.getBoundingClientRect() ?? null;
    const center = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
    const hitAnchor = center?.closest('a[href]');
    const targetAnchor = hitAnchor instanceof HTMLAnchorElement ? hitAnchor : explicitAnchor ?? null;
    return {
      publicSurface: pathname === '/search_result' || pathname === '/search_result/' ||
        pathname === '/search_result_ai' || pathname === '/search_result_ai/' ? 'search' as const : 'other' as const,
      renderedCardCount: document.querySelectorAll('section.note-item').length,
      timeOrigin: performance.timeOrigin,
      detailTarget: section && target && rect ? {
        targetMode: targetAnchor?.target && targetAnchor.target !== '_self' ? 'new_tab' as const : 'same_tab' as const,
        interactionElement: target instanceof HTMLAnchorElement ? 'anchor' as const
          : target instanceof HTMLImageElement ? 'image' as const : 'container' as const,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointerHitTarget: Boolean(center && section.contains(center))
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

async function waitForOverlayPostcondition(
  page: Page,
  pageCountBefore: number,
  timeOriginBefore: number,
  deadline: number
): Promise<OverlayProbe> {
  let latest: OverlayProbe | null = null;
  while (Date.now() < deadline) {
    if (page.context().pages().length !== pageCountBefore) {
      throw new Error('xiaohongshu_note_overlay_recon_new_tab_detected');
    }
    latest = await readOverlayProbe(page, remaining(deadline));
    if (risky(latest.risk)) throw new Error('xiaohongshu_note_overlay_recon_risk_stopped');
    if (latest.timeOrigin !== timeOriginBefore) {
      throw new Error('xiaohongshu_note_overlay_recon_document_changed');
    }
    if (latest.publicSurface === 'note_detail_overlay' && latest.overlayVisible && latest.publicText.length > 0) {
      return latest;
    }
    await delay(Math.min(300, Math.max(1, deadline - Date.now())));
  }
  throw new Error('xiaohongshu_note_overlay_recon_postcondition_timeout');
}

async function readOverlayProbe(page: Page, timeoutMs: number): Promise<OverlayProbe> {
  return await withinDeadline(page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const pathname = location.pathname;
    const bodyText = (document.body?.innerText ?? '').slice(0, 16_000);
    const roots = Array.from(document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [class*="note-detail"], [class*="note-container"], [class*="modal"]'
    )).filter(visible);
    const visibleAuthors = Array.from(document.querySelectorAll('a[href*="/user/profile/"]')).filter(visible);
    const authorAncestors = visibleAuthors.flatMap((author) => {
      const ancestors: Element[] = [];
      let current = author.parentElement;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        if (current !== document.body && current !== document.documentElement && visible(current) &&
          rect.width >= 400 && rect.width <= window.innerWidth * 0.92 && rect.height >= 300) ancestors.push(current);
      }
      return ancestors;
    });
    for (const ancestor of authorAncestors) if (!roots.includes(ancestor)) roots.push(ancestor);
    const withAuthor = roots.filter((root) => root.querySelector('a[href*="/user/profile/"]'));
    const overlay = (withAuthor.length > 0 ? withAuthor : roots).sort((left, right) => {
      const leftText = (left.textContent ?? '').replace(/\s+/g, ' ').trim().length;
      const rightText = (right.textContent ?? '').replace(/\s+/g, ' ').trim().length;
      if (rightText !== leftText) return rightText - leftText;
      const l = left.getBoundingClientRect();
      const r = right.getBoundingClientRect();
      return (r.width * r.height) - (l.width * l.height);
    })[0] ?? null;
    const closeTarget = overlay ? (() => {
      const overlayAncestors = new Set<Element>();
      for (let current: Element | null = overlay; current && current !== document.body &&
        overlayAncestors.size < 6; current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        if (style.position === 'fixed' || rect.width >= window.innerWidth * 0.8 ||
          rect.height >= window.innerHeight * 0.8) overlayAncestors.add(current);
      }
      const candidates = Array.from(document.querySelectorAll(
        'button, [role="button"], [aria-label], [title], [class*="close"], [class*="Close"], svg, path'
      )).filter(visible).map((rawElement) => {
        const interactive = rawElement.closest(
          'button, [role="button"], [aria-label], [title], [class*="close"], [class*="Close"]'
        ) ?? rawElement;
        if (!visible(interactive)) return null;
        const rect = interactive.getBoundingClientRect();
        const semantic = [interactive.getAttribute('aria-label'), interactive.getAttribute('title'),
          interactive.textContent, typeof interactive.className === 'string' ? interactive.className : '',
          rawElement.getAttribute('aria-label'), rawElement.getAttribute('title')]
          .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        const topLeft = rect.left >= 0 && rect.top >= 0 && rect.left < 140 && rect.top < 140;
        const hasCrossGlyph = /[×✕✖]/.test(semantic) || /(^|\b)close(\b|[-_])/i.test(semantic);
        const labelClass = /关闭|close|退出/i.test(semantic) ? 'close_like' as const
          : (rawElement.tagName.toLowerCase() === 'svg' || rawElement.tagName.toLowerCase() === 'path') &&
            (hasCrossGlyph || topLeft) ? 'icon_only' as const
          : 'unclassified' as const;
        const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const insideOverlay = overlay.contains(interactive) || [...overlayAncestors].some((ancestor) => ancestor.contains(interactive));
        return {
          element: interactive,
          rect,
          labelClass,
          insideOverlay,
          topLeft,
          pointerHitTarget: Boolean(center && (center === interactive || interactive.contains(center)))
        };
      }).filter((candidate): candidate is {
        element: Element;
        rect: DOMRect;
        labelClass: 'close_like' | 'icon_only' | 'unclassified';
        insideOverlay: boolean;
        topLeft: boolean;
        pointerHitTarget: boolean;
      } => Boolean(candidate) && candidate.rect.top >= 0 && candidate.rect.left >= 0 &&
        candidate.rect.right <= window.innerWidth && candidate.rect.bottom <= window.innerHeight &&
        candidate.pointerHitTarget && candidate.labelClass !== 'unclassified')
        .sort((left, right) => Number(right.insideOverlay) - Number(left.insideOverlay) ||
          Number(right.topLeft) - Number(left.topLeft) ||
          (left.labelClass === 'close_like' ? 0 : 1) - (right.labelClass === 'close_like' ? 0 : 1) ||
          left.rect.top - right.rect.top || left.rect.left - right.rect.left);
      const target = candidates[0];
      if (!target) return null;
      return {
        tag: target.element.tagName.toLowerCase(),
        role: target.element.getAttribute('role'),
        labelClass: target.labelClass,
        insideOverlay: target.insideOverlay,
        bounds: { x: target.rect.x, y: target.rect.y, width: target.rect.width, height: target.rect.height },
        pointerHitTarget: target.pointerHitTarget
      };
    })() : null;
    const author = overlay ? Array.from(overlay.querySelectorAll('a[href]')).find((element) => {
      if (!(element instanceof HTMLAnchorElement) || !visible(element)) return false;
      try {
        const target = new URL(element.href);
        return target.origin === location.origin && target.pathname.startsWith('/user/profile/');
      } catch {
        return false;
      }
    }) as HTMLAnchorElement | undefined : undefined;
    const rect = author?.getBoundingClientRect() ?? null;
    const center = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
    const publicText = (overlay?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 4_000);
    return {
      publicSurface: overlay && publicText ? 'note_detail_overlay' as const : 'other' as const,
      timeOrigin: performance.timeOrigin,
      overlayVisible: Boolean(overlay),
      publicText,
      closeTarget,
      authorTarget: author && rect ? {
        targetMode: author.target && author.target !== '_self' ? 'new_tab' as const : 'same_tab' as const,
        displayText: (author.innerText || author.getAttribute('aria-label') || 'public-author').trim().slice(0, 200),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointerHitTarget: center === author || Boolean(center && author.contains(center))
      } : null,
      risk: {
        loginRequired: !pathname.startsWith('/website-login/') && /登录后|请登录|扫码登录|登录小红书/.test(bodyText),
        verificationRequired: pathname.startsWith('/website-login/') || /安全验证|验证身份|扫码验证/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|暂时无法浏览/.test(bodyText)
      }
    };
  }), timeoutMs);
}

function risky(risk: Risk): boolean {
  return risk.verificationRequired || risk.rateLimited || risk.sourceUnavailable;
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
  return { method: response.request().method(), path, status: response.status(), mime, bodyBytes: body.byteLength, ...shape };
}

function jsonShape(value: unknown): Omit<NetworkShape, 'method' | 'path' | 'status' | 'mime' | 'bodyBytes'> {
  const data = record(value) ? value.data : null;
  const array = firstArray(value, '$', 0);
  return {
    topLevelKeys: safeKeys(value),
    dataKeys: safeKeys(data),
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
