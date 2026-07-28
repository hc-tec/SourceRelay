import { createHash } from 'node:crypto';
import type { Page, Response } from 'playwright';
import {
  XIAOHONGSHU_NOTE_COMMENTS_RECON_SCHEMA_VERSION,
  isXiaohongshuNoteCommentsReconRequest,
  type XiaohongshuNoteCommentsReconRequest,
  type XiaohongshuNoteCommentsReconResult,
  type XiaohongshuReconPublicComment
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { ensureManagedPageForeground } from './page-foreground.js';

type Risk = XiaohongshuNoteCommentsReconResult['risk'];
type NetworkResponse = XiaohongshuNoteCommentsReconResult['network']['responses'][number];

interface CommentsProbe {
  overlayVisible: boolean;
  timeOrigin: number;
  scrollContainer: null | {
    bounds: { x: number; y: number; width: number; height: number };
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
    pointerHitTarget: boolean;
  };
  renderedCommentCount: number;
  renderedCommentText: string;
  replyTarget: null | {
    label: string;
    bounds: { x: number; y: number; width: number; height: number };
    pointerHitTarget: boolean;
  };
  risk: Risk;
}

export async function executeXiaohongshuNoteCommentsRecon(input: {
  record: ManagedPageRecord;
  request: XiaohongshuNoteCommentsReconRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<XiaohongshuNoteCommentsReconResult> {
  const { record, request } = input;
  if (!isXiaohongshuNoteCommentsReconRequest(request)) {
    throw hostError({ code: 'xiaohongshu_note_comments_recon_request_invalid', category: 'protocol', scope: 'action' });
  }
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  if (record.state !== 'leased' || record.platform !== 'xiaohongshu' || record.pageRole !== 'public_search') {
    throw hostError({ code: 'xiaohongshu_note_comments_recon_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({ code: 'managed_page_document_generation_mismatch', category: 'page_identity', scope: 'page' });
  }

  const deadline = Date.now() + request.timeoutMs;
  let actionAttempted = false;
  const responsePromises: Array<Promise<{ response: NetworkResponse; comments: XiaohongshuReconPublicComment[] } | null>> = [];
  const onResponse = (response: Response): void => {
    if (responsePromises.length >= 8) return;
    const resourceType = response.request().resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    let url: URL;
    try { url = new URL(response.url()); } catch { return; }
    if (url.hostname !== 'www.xiaohongshu.com' || !/comment/i.test(url.pathname)) return;
    responsePromises.push(projectCommentResponse(response, url.pathname));
  };

  try {
    await withinDeadline(ensureManagedPageForeground(record.page), remaining(deadline));
    record.page.on('response', onResponse);
    await delay(Math.min(4_500, Math.max(1, remaining(deadline))));
    const before = await readProbe(record.page, remaining(deadline));
    if (!before.overlayVisible || risky(before.risk)) {
      throw hostError({ code: 'xiaohongshu_note_comments_overlay_precondition_unmet', category: 'action', scope: 'action' });
    }
    const beforeVisual = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page, pageAlias: record.pageAlias, documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration, directory: input.visualEvidenceDirectory
    }), remaining(deadline));
    const base = {
      schemaVersion: XIAOHONGSHU_NOTE_COMMENTS_RECON_SCHEMA_VERSION,
      pageAlias: record.pageAlias,
      actionId: request.actionId,
      completedAt: new Date().toISOString(),
      before: {
        publicSurface: 'note_detail_overlay' as const,
        scrollContainer: before.scrollContainer,
        renderedCommentCount: before.renderedCommentCount,
        replyTarget: before.replyTarget,
        visualEvidence: beforeVisual
      }
    };
    if (request.action === 'expand_first_reply_thread') {
      if (!before.replyTarget?.pointerHitTarget) {
        const passiveParts = await settleNetworkParts(responsePromises, deadline);
        input.emit('xiaohongshu_comment_replies_recon_prerequisite_unmet', null, request.actionId);
        return { ...base, state: 'prerequisite_unmet', semanticAction: { attempted: false, attemptCount: 0 },
          after: null, network: networkResult(passiveParts,
            deduplicateComments(passiveParts.flatMap((part) => part.comments))), risk: before.risk };
      }
      record.attemptedActionIds.add(request.actionId);
      actionAttempted = true;
      touchRecord(record);
      input.emit('action_attempted', null, request.actionId);
      const bounds = before.replyTarget.bounds;
      const x = Math.floor(bounds.x + bounds.width / 2);
      const y = Math.floor(bounds.y + bounds.height / 2);
      await withinDeadline(record.page.mouse.move(x, y), remaining(deadline));
      const pageCount = record.page.context().pages().length;
      await withinDeadline(record.page.mouse.click(x, y), remaining(deadline));
      await delay(Math.min(3_500, Math.max(1, remaining(deadline))));
      if (record.page.context().pages().length !== pageCount) throw new Error('xiaohongshu_comment_replies_new_tab_detected');
      const after = await readProbe(record.page, remaining(deadline));
      if (after.timeOrigin !== before.timeOrigin) throw new Error('xiaohongshu_comment_replies_document_changed');
      if (risky(after.risk)) throw new Error('xiaohongshu_comment_replies_risk_stopped');
      const networkParts = await settleNetworkParts(responsePromises, deadline);
      const comments = deduplicateComments(networkParts.flatMap((part) => part.comments));
      const targetChanged = after.replyTarget?.label !== before.replyTarget.label;
      const publicTextChanged = after.renderedCommentText !== before.renderedCommentText;
      if (!targetChanged && !publicTextChanged && comments.length === 0) {
        throw new Error('xiaohongshu_comment_replies_postcondition_unmet');
      }
      const afterVisual = await withinDeadline(captureManagedPageVisualEvidence({
        page: record.page, pageAlias: record.pageAlias, documentGeneration: record.documentGeneration,
        routeGeneration: record.routeGeneration, directory: input.visualEvidenceDirectory
      }), remaining(deadline));
      input.emit('xiaohongshu_comment_replies_recon_completed', null, request.actionId);
      return { ...base, completedAt: new Date().toISOString(), state: 'completed',
        semanticAction: { attempted: true, attemptCount: 1 },
        after: { publicSurface: 'note_detail_overlay', sameDocument: true,
          scrollTop: after.scrollContainer?.scrollTop ?? before.scrollContainer?.scrollTop ?? 0,
          renderedCommentCount: after.renderedCommentCount, replyTargetVisible: after.replyTarget !== null,
          renderedCommentTextDigest: after.renderedCommentText ? sha256(after.renderedCommentText) : null,
          visualEvidence: afterVisual }, network: networkResult(networkParts, comments), risk: after.risk };
    }
    if (!before.scrollContainer || !before.scrollContainer.pointerHitTarget ||
      before.scrollContainer.scrollTop >= before.scrollContainer.scrollHeight - before.scrollContainer.clientHeight) {
      const passiveParts = await settleNetworkParts(responsePromises, deadline);
      const passiveComments = deduplicateComments(passiveParts.flatMap((part) => part.comments));
      if (before.renderedCommentCount > 0 || passiveComments.length > 0) {
        input.emit('xiaohongshu_note_comments_recon_completed_without_scroll', null, request.actionId);
        return {
          ...base,
          completedAt: new Date().toISOString(),
          state: 'completed',
          semanticAction: { attempted: false, attemptCount: 0 },
          after: {
            publicSurface: 'note_detail_overlay',
            sameDocument: true,
            scrollTop: before.scrollContainer?.scrollTop ?? 0,
            renderedCommentCount: before.renderedCommentCount,
            replyTargetVisible: before.replyTarget !== null,
            renderedCommentTextDigest: before.renderedCommentText ? sha256(before.renderedCommentText) : null,
            visualEvidence: beforeVisual
          },
          network: networkResult(passiveParts, passiveComments),
          risk: before.risk
        };
      }
      input.emit('xiaohongshu_note_comments_recon_prerequisite_unmet', null, request.actionId);
      return {
        ...base,
        state: 'prerequisite_unmet',
        semanticAction: { attempted: false, attemptCount: 0 },
        after: null,
        network: networkResult(passiveParts, passiveComments),
        risk: before.risk
      };
    }

    record.attemptedActionIds.add(request.actionId);
    actionAttempted = true;
    touchRecord(record);
    input.emit('action_attempted', null, request.actionId);
    const bounds = before.scrollContainer.bounds;
    const x = Math.floor(bounds.x + bounds.width * 0.72);
    const y = Math.floor(bounds.y + bounds.height * 0.68);
    await withinDeadline(record.page.mouse.move(x, y), remaining(deadline));
    const pageCount = record.page.context().pages().length;
    await withinDeadline(record.page.mouse.wheel(0, 1_100), remaining(deadline));
    await delay(Math.min(2_800, Math.max(1, remaining(deadline))));
    if (record.page.context().pages().length !== pageCount) throw new Error('xiaohongshu_note_comments_new_tab_detected');
    const after = await readProbe(record.page, remaining(deadline));
    if (after.timeOrigin !== before.timeOrigin) throw new Error('xiaohongshu_note_comments_document_changed');
    if (risky(after.risk)) throw new Error('xiaohongshu_note_comments_risk_stopped');
    const networkParts = await settleNetworkParts(responsePromises, deadline);
    const comments = deduplicateComments(networkParts.flatMap((part) => part.comments));
    const scrollAdvanced = after.scrollContainer !== null &&
      after.scrollContainer.scrollTop > before.scrollContainer.scrollTop;
    const commentsAdvanced = after.renderedCommentCount > before.renderedCommentCount || comments.length > 0;
    if (!scrollAdvanced && !commentsAdvanced) throw new Error('xiaohongshu_note_comments_postcondition_unmet');
    const afterVisual = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page, pageAlias: record.pageAlias, documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration, directory: input.visualEvidenceDirectory
    }), remaining(deadline));
    input.emit('xiaohongshu_note_comments_recon_completed', null, request.actionId);
    return {
      ...base,
      completedAt: new Date().toISOString(),
      state: 'completed',
      semanticAction: { attempted: true, attemptCount: 1 },
      after: {
        publicSurface: 'note_detail_overlay',
        sameDocument: true,
        scrollTop: after.scrollContainer?.scrollTop ?? before.scrollContainer.scrollTop,
        renderedCommentCount: after.renderedCommentCount,
        replyTargetVisible: after.replyTarget !== null,
        renderedCommentTextDigest: after.renderedCommentText ? sha256(after.renderedCommentText) : null,
        visualEvidence: afterVisual
      },
      network: networkResult(networkParts, comments),
      risk: after.risk
    };
  } catch (error) {
    if (!actionAttempted) throw error;
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'xiaohongshu_note_comments_recon_outcome_unknown');
    input.emit('xiaohongshu_note_comments_recon_outcome_unknown',
      'xiaohongshu_note_comments_recon_outcome_unknown', request.actionId);
    throw hostError({
      code: 'xiaohongshu_note_comments_recon_outcome_unknown', category: 'browser_input', scope: 'action',
      retryClass: 'new_run_required', platformActionAttempted: true, pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry', safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
    });
  } finally {
    record.page.off('response', onResponse);
  }
}

async function settleNetworkParts(
  promises: Array<Promise<{ response: NetworkResponse; comments: XiaohongshuReconPublicComment[] } | null>>,
  deadline: number
): Promise<Array<{ response: NetworkResponse; comments: XiaohongshuReconPublicComment[] }>> {
  return (await Promise.all(promises.map((promise) => withinDeadline(
    promise.catch(() => null), Math.min(4_000, remaining(deadline))
  )))).filter((value): value is { response: NetworkResponse; comments: XiaohongshuReconPublicComment[] } => value !== null);
}

function networkResult(
  parts: Array<{ response: NetworkResponse; comments: XiaohongshuReconPublicComment[] }>,
  comments: XiaohongshuReconPublicComment[]
): XiaohongshuNoteCommentsReconResult['network'] {
  return {
    responseBodiesRead: parts.some((part) => part.response.bodyBytes > 0),
    temporaryBodyBytesRead: parts.reduce((total, part) => total + part.response.bodyBytes, 0),
    responses: parts.map((part) => part.response),
    comments
  };
}

async function readProbe(page: Page, timeoutMs: number): Promise<CommentsProbe> {
  return await withinDeadline(page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const pathname = location.pathname;
    const bodyText = (document.body?.innerText ?? '').slice(0, 16_000);
    const authors = Array.from(document.querySelectorAll('a[href*="/user/profile/"]')).filter(visible);
    const ancestors = authors.flatMap((author) => {
      const candidates: Element[] = [];
      let current = author.parentElement;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        if (current !== document.body && current !== document.documentElement && visible(current) &&
          rect.width >= 400 && rect.width <= window.innerWidth * 0.92 && rect.height >= 300) candidates.push(current);
      }
      return candidates;
    });
    const overlay = ancestors.sort((left, right) =>
      (right.textContent ?? '').trim().length - (left.textContent ?? '').trim().length)[0] ?? null;
    const scrollables = overlay ? [overlay, ...Array.from(overlay.querySelectorAll('*'))].filter((element) => {
      if (!visible(element)) return false;
      const html = element as HTMLElement;
      const rect = element.getBoundingClientRect();
      const overflowY = getComputedStyle(element).overflowY;
      return rect.width >= 300 && rect.x >= window.innerWidth * 0.35 && rect.height >= 180 &&
        html.scrollHeight > html.clientHeight + 80 && (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay');
    }) as HTMLElement[] : [];
    const scroll = scrollables.sort((left, right) =>
      (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))[0] ?? null;
    const rect = scroll?.getBoundingClientRect() ?? null;
    const x = rect ? rect.x + rect.width * 0.72 : 0;
    const y = rect ? rect.y + rect.height * 0.68 : 0;
    const hit = rect ? document.elementFromPoint(x, y) : null;
    const commentNodes = overlay ? Array.from(overlay.querySelectorAll(
      '[class*="comment-item"], [class*="comment-inner"], [data-comment-id]'
    )).filter(visible) : [];
    const replyTargets = overlay ? Array.from(overlay.querySelectorAll('*')).filter((element) => {
      if (!visible(element)) return false;
      const ownText = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
      return /^展开\s*\d+\s*条回复$/.test(ownText);
    }).sort((left, right) => {
      const l = left.getBoundingClientRect(); const r = right.getBoundingClientRect();
      return l.width * l.height - r.width * r.height;
    }) : [];
    const replyTarget = replyTargets[0] ?? null;
    const replyRect = replyTarget?.getBoundingClientRect() ?? null;
    const replyX = replyRect ? replyRect.x + replyRect.width / 2 : 0;
    const replyY = replyRect ? replyRect.y + replyRect.height / 2 : 0;
    const replyHit = replyRect ? document.elementFromPoint(replyX, replyY) : null;
    const renderedCommentText = (commentNodes.length > 0
      ? commentNodes.map((node) => node.textContent ?? '').join(' ')
      : overlay?.textContent ?? '')
      .replace(/\s+/g, ' ').trim().slice(0, 8_000);
    return {
      overlayVisible: Boolean(overlay),
      timeOrigin: performance.timeOrigin,
      scrollContainer: scroll && rect ? {
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scrollTop: Math.round(scroll.scrollTop),
        clientHeight: Math.round(scroll.clientHeight),
        scrollHeight: Math.round(scroll.scrollHeight),
        pointerHitTarget: Boolean(hit && scroll.contains(hit))
      } : null,
      renderedCommentCount: commentNodes.length,
      renderedCommentText,
      replyTarget: replyTarget && replyRect ? {
        label: (replyTarget.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
        bounds: { x: replyRect.x, y: replyRect.y, width: replyRect.width, height: replyRect.height },
        pointerHitTarget: Boolean(replyHit && (replyTarget === replyHit || replyTarget.contains(replyHit)))
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

async function projectCommentResponse(
  response: Response,
  path: string
): Promise<{ response: NetworkResponse; comments: XiaohongshuReconPublicComment[] } | null> {
  const mime = (response.headers()['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!mime.includes('json')) return {
    response: { method: response.request().method(), path, status: response.status(), mime, bodyBytes: 0,
      projectedCommentCount: 0, hasMore: null, cursorPresent: false },
    comments: []
  };
  const body = await response.body();
  if (body.byteLength > 1024 * 1024) return null;
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')) as unknown; } catch { return null; }
  const comments = projectComments(value);
  const flags = findPagination(value, 0);
  return {
    response: {
      method: response.request().method(), path, status: response.status(), mime, bodyBytes: body.byteLength,
      projectedCommentCount: comments.length, hasMore: flags.hasMore, cursorPresent: flags.cursorPresent
    },
    comments
  };
}

function projectComments(value: unknown): XiaohongshuReconPublicComment[] {
  const found: XiaohongshuReconPublicComment[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 7 || found.length >= 40) return;
    if (Array.isArray(node)) {
      for (const entry of node.slice(0, 80)) visit(entry, depth + 1);
      return;
    }
    const item = record(node);
    if (!item) return;
    const content = clean(item.content ?? item.content_text ?? item.text, 2_000);
    const commentId = clean(item.id ?? item.comment_id ?? item.commentId, 100);
    const user = record(item.user_info ?? item.userInfo ?? item.user) ?? {};
    if (content && commentId) {
      found.push({
        rank: found.length + 1,
        commentId,
        content,
        authorNickname: clean(user.nickname ?? user.nick_name, 200),
        likedCountText: clean(item.like_count ?? item.liked_count ?? item.likeCount, 40),
        subCommentCountText: clean(item.sub_comment_count ?? item.subCommentCount, 40),
        createdAtText: clean(item.create_time ?? item.created_at ?? item.createTime, 100),
        locationText: clean(item.ip_location ?? item.ipLocation, 100)
      });
    }
    for (const [key, child] of Object.entries(item).slice(0, 80)) {
      if (/token|cookie|session|captcha|verify|phone|email|xsec|secret|password/i.test(key)) continue;
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return deduplicateComments(found);
}

function deduplicateComments(comments: XiaohongshuReconPublicComment[]): XiaohongshuReconPublicComment[] {
  const seen = new Set<string>();
  return comments.filter((comment) => {
    if (seen.has(comment.commentId)) return false;
    seen.add(comment.commentId);
    return true;
  }).slice(0, 40).map((comment, index) => ({ ...comment, rank: index + 1 }));
}

function findPagination(value: unknown, depth: number): { hasMore: boolean | null; cursorPresent: boolean } {
  if (depth > 6) return { hasMore: null, cursorPresent: false };
  if (Array.isArray(value)) {
    return value.slice(0, 40).reduce((result, entry) => mergeFlags(result, findPagination(entry, depth + 1)),
      { hasMore: null, cursorPresent: false } as { hasMore: boolean | null; cursorPresent: boolean });
  }
  const item = record(value);
  if (!item) return { hasMore: null, cursorPresent: false };
  let result = {
    hasMore: typeof item.has_more === 'boolean' ? item.has_more :
      typeof item.hasMore === 'boolean' ? item.hasMore : null,
    cursorPresent: typeof item.cursor === 'string' || typeof item.cursor === 'number' ||
      typeof item.next_cursor === 'string' || typeof item.nextCursor === 'string'
  };
  for (const child of Object.values(item).slice(0, 80)) result = mergeFlags(result, findPagination(child, depth + 1));
  return result;
}

function mergeFlags(
  left: { hasMore: boolean | null; cursorPresent: boolean },
  right: { hasMore: boolean | null; cursorPresent: boolean }
): { hasMore: boolean | null; cursorPresent: boolean } {
  return { hasMore: left.hasMore ?? right.hasMore, cursorPresent: left.cursorPresent || right.cursorPresent };
}

function clean(value: unknown, maximum: number): string {
  return (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function risky(risk: Risk): boolean {
  return risk.verificationRequired || risk.rateLimited || risk.sourceUnavailable;
}
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value < 100) throw new Error('run_deadline_exceeded');
  return value;
}
async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([promise, new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('run_deadline_exceeded')), timeoutMs))]);
}
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
