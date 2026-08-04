import { xiaohongshuCurrentPageNetworkPublicSurface } from '@intelligence/collector-contracts';

export interface XiaohongshuPublicEntryDocument {
  tabId: number;
  windowId: number;
  documentId: string;
}

export interface XiaohongshuPublicAuthorTargetCandidate {
  source: 'note_overlay' | 'search_card';
  x: number;
  y: number;
  width: number;
  height: number;
  targetMode: 'same_tab' | 'new_tab';
  pointerHitTarget: boolean;
  containsAvatar: boolean;
  alignedWithOverlayHeader: boolean;
  insideCommentRegion: boolean;
  insideStateChangingControl: boolean;
  order: number;
}

export interface XiaohongshuPublicAuthorTargetProbe {
  overlayPresent: boolean;
  candidates: XiaohongshuPublicAuthorTargetCandidate[];
}

export interface XiaohongshuPublicAuthorTarget {
  tabId: number;
  windowId: number;
  documentId: string;
  x: number;
  y: number;
  targetMode: 'same_tab' | 'new_tab';
}

export type XiaohongshuProfileEntryPublicSurface = 'explore' | 'search' | 'public_note_detail';

/**
 * The shared current-page classifier intentionally keeps `/explore/:noteId`
 * out of its generic admission path. Profile discovery is narrower: an
 * already-admitted, same-document public note overlay is a valid source for
 * its visible author link, so recognise that route locally without exposing
 * its note identity.
 */
export function xiaohongshuProfileEntryPublicSurface(
  value: string
): XiaohongshuProfileEntryPublicSurface | null {
  const base = xiaohongshuCurrentPageNetworkPublicSurface(value);
  if (base === 'explore' || base === 'search') return base;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.xiaohongshu.com' && !url.port &&
      !url.username && !url.password && !url.hash && /^\/explore\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      ? 'public_note_detail'
      : null;
  } catch {
    return null;
  }
}

/**
 * Select only from the currently visible page role. If a note overlay exists,
 * a background search-card author is never an acceptable fallback: doing so
 * would click a different object through the overlay. Within the overlay the
 * author must be aligned with its public header and must not belong to the
 * comment/reply region or any state-changing control.
 */
export function selectXiaohongshuPublicAuthorTargetCandidate(
  probe: XiaohongshuPublicAuthorTargetProbe
): XiaohongshuPublicAuthorTargetCandidate | null {
  const source = probe.overlayPresent ? 'note_overlay' : 'search_card';
  const candidates = probe.candidates.filter((candidate) =>
    candidate.source === source && candidate.pointerHitTarget &&
    !candidate.insideCommentRegion && !candidate.insideStateChangingControl &&
    (!probe.overlayPresent || candidate.alignedWithOverlayHeader) &&
    Number.isFinite(candidate.x) && Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.width) && Number.isFinite(candidate.height) &&
    candidate.x >= 0 && candidate.y >= 0 && candidate.width > 0 && candidate.width <= 360 &&
    candidate.height > 0 && candidate.height <= 160 && Number.isSafeInteger(candidate.order) &&
    candidate.order >= 0 &&
    (candidate.targetMode === 'same_tab' || candidate.targetMode === 'new_tab')
  );
  candidates.sort((left, right) =>
    Number(right.targetMode === 'same_tab') - Number(left.targetMode === 'same_tab') ||
    Number(right.containsAvatar) - Number(left.containsAvatar) ||
    left.y - right.y || left.x - right.x || left.order - right.order
  );
  return candidates[0] ?? null;
}

export async function readXiaohongshuPublicAuthorTarget(
  pageDocument: XiaohongshuPublicEntryDocument
): Promise<XiaohongshuPublicAuthorTarget | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    func: () => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01 &&
          rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      };
      const publicProfileAnchor = (element: Element): element is HTMLAnchorElement => {
        if (!(element instanceof HTMLAnchorElement) || !visible(element)) return false;
        try {
          const target = new URL(element.href);
          return target.origin === location.origin && /^\/user\/profile\/[A-Za-z0-9_-]+\/?$/.test(target.pathname);
        } catch {
          return false;
        }
      };
      const text = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      const stateChangingLabel = /^(关注|已关注|互相关注|点赞|已点赞|收藏|已收藏|评论|回复|私信|发消息|发布|删除)$/;
      const insideStateChangingControl = (anchor: HTMLAnchorElement): boolean => {
        let current: Element | null = anchor;
        for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
          const role = current.getAttribute('role') ?? '';
          if ((current.matches('button, input, textarea, select') || role === 'button') &&
            stateChangingLabel.test(text(current))) return true;
        }
        return false;
      };
      const insideCommentRegion = (anchor: HTMLAnchorElement): boolean => {
        let current = anchor.parentElement;
        for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
          const marker = [
            typeof current.className === 'string' ? current.className : '',
            current.id,
            current.getAttribute('data-testid') ?? '',
            current.getAttribute('aria-label') ?? ''
          ].join(' ');
          if (/(?:^|[-_\s])(comment|reply|comments|replies)(?:$|[-_\s])|评论|回复/i.test(marker)) return true;
        }
        return false;
      };
      const anchors = Array.from(document.querySelectorAll('a[href]')).filter(publicProfileAnchor);
      const detailPath = /^\/explore\/[A-Za-z0-9_-]+\/?$/.test(location.pathname);
      const rootSelector = [
        '[role="dialog"]', '[aria-modal="true"]', '[class*="note-detail"]',
        '[class*="note-container"]', '[class*="modal"]', '[class*="Modal"]'
      ].join(', ');
      const explicitRoots = Array.from(document.querySelectorAll(rootSelector)).filter((element) => {
        if (!visible(element) || !anchors.some((anchor) => element.contains(anchor))) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 360 || rect.height < 280) return false;
        const style = getComputedStyle(element);
        const modalSemantic = element.getAttribute('role') === 'dialog' || element.getAttribute('aria-modal') === 'true';
        const fixedLayer = style.position === 'fixed' || Number.parseInt(style.zIndex || '0', 10) >= 10;
        const hasHeaderAction = Array.from(element.querySelectorAll('button, [role="button"]'))
          .some((control) => visible(control) && /^(关注|已关注|互相关注)$/.test(text(control)));
        return modalSemantic || fixedLayer || hasHeaderAction;
      });
      const roots = [...explicitRoots];
      if (detailPath) {
        for (const anchor of anchors) {
          let current = anchor.parentElement;
          for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
            const rect = current.getBoundingClientRect();
            if (current !== document.body && current !== document.documentElement && visible(current) &&
              rect.width >= 360 && rect.width <= innerWidth * 0.98 && rect.height >= 280 && !roots.includes(current)) {
              roots.push(current);
            }
          }
        }
      }
      const overlayPresent = detailPath || explicitRoots.length > 0;
      const projected = new Map<HTMLAnchorElement, {
        source: 'note_overlay' | 'search_card';
        x: number;
        y: number;
        width: number;
        height: number;
        targetMode: 'same_tab' | 'new_tab';
        pointerHitTarget: boolean;
        containsAvatar: boolean;
        alignedWithOverlayHeader: boolean;
        insideCommentRegion: boolean;
        insideStateChangingControl: boolean;
        order: number;
      }>();
      const add = (
        anchor: HTMLAnchorElement,
        source: 'note_overlay' | 'search_card',
        alignedWithOverlayHeader: boolean,
        order: number
      ): void => {
        const rect = anchor.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const value = {
          source,
          x,
          y,
          width: rect.width,
          height: rect.height,
          targetMode: anchor.target && anchor.target !== '_self' ? 'new_tab' as const : 'same_tab' as const,
          pointerHitTarget: Boolean(hit && (hit === anchor || anchor.contains(hit))),
          containsAvatar: Boolean(anchor.querySelector('img, [class*="avatar"], [class*="Avatar"], [aria-label*="头像"]')),
          alignedWithOverlayHeader,
          insideCommentRegion: insideCommentRegion(anchor),
          insideStateChangingControl: insideStateChangingControl(anchor),
          order
        };
        const previous = projected.get(anchor);
        if (!previous || (!previous.alignedWithOverlayHeader && alignedWithOverlayHeader)) projected.set(anchor, value);
      };
      if (overlayPresent) {
        const usableRoots = roots.length > 0 ? roots : document.body ? [document.body] : [];
        const rootStates = usableRoots.map((root) => ({
          root,
          headerControl: Array.from(root.querySelectorAll('button, [role="button"]'))
            .filter((control) => visible(control) && /^(关注|已关注|互相关注)$/.test(text(control)))
            .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] ?? null
        }));
        const rootsWithHeader = rootStates.filter((state) => state.headerControl !== null);
        const candidateRootStates = rootsWithHeader.length > 0
          ? rootsWithHeader
          : rootStates.sort((left, right) => left.root.getBoundingClientRect().top - right.root.getBoundingClientRect().top)
            .filter((state, _index, ordered) => state.root.getBoundingClientRect().top <=
              ordered[0]!.root.getBoundingClientRect().top + 8);
        for (const { root, headerControl } of candidateRootStates) {
          const rootRect = root.getBoundingClientRect();
          const controlRect = headerControl?.getBoundingClientRect() ?? null;
          anchors.filter((anchor) => root.contains(anchor)).forEach((anchor, order) => {
            const rect = anchor.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const aligned = controlRect
              ? Math.abs(centerY - (controlRect.top + controlRect.height / 2)) <=
                Math.max(36, (rect.height + controlRect.height) / 2)
              : rect.top <= rootRect.top + 88;
            add(anchor, 'note_overlay', aligned, order);
          });
        }
      } else {
        const cards = Array.from(document.querySelectorAll('section.note-item')).filter(visible)
          .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top ||
            left.getBoundingClientRect().left - right.getBoundingClientRect().left);
        let order = 0;
        for (const card of cards) {
          for (const anchor of anchors.filter((candidate) => card.contains(candidate))) {
            add(anchor, 'search_card', false, order);
            order += 1;
          }
        }
      }
      return { overlayPresent, candidates: [...projected.values()] };
    }
  });
  const probe = normaliseProbe(results[0]?.result);
  if (!probe) return null;
  const target = selectXiaohongshuPublicAuthorTargetCandidate(probe);
  return target ? {
    tabId: pageDocument.tabId,
    windowId: pageDocument.windowId,
    documentId: pageDocument.documentId,
    x: target.x,
    y: target.y,
    targetMode: target.targetMode
  } : null;
}

function normaliseProbe(value: unknown): XiaohongshuPublicAuthorTargetProbe | null {
  if (!value || typeof value !== 'object') return null;
  const probe = value as { overlayPresent?: unknown; candidates?: unknown };
  if (typeof probe.overlayPresent !== 'boolean' || !Array.isArray(probe.candidates)) return null;
  const candidates: XiaohongshuPublicAuthorTargetCandidate[] = [];
  for (const raw of probe.candidates.slice(0, 80)) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    if ((candidate.source !== 'note_overlay' && candidate.source !== 'search_card') ||
      (candidate.targetMode !== 'same_tab' && candidate.targetMode !== 'new_tab') ||
      typeof candidate.x !== 'number' || typeof candidate.y !== 'number' ||
      typeof candidate.width !== 'number' || typeof candidate.height !== 'number' ||
      typeof candidate.pointerHitTarget !== 'boolean' || typeof candidate.containsAvatar !== 'boolean' ||
      typeof candidate.alignedWithOverlayHeader !== 'boolean' || typeof candidate.insideCommentRegion !== 'boolean' ||
      typeof candidate.insideStateChangingControl !== 'boolean' || typeof candidate.order !== 'number') continue;
    candidates.push(candidate as unknown as XiaohongshuPublicAuthorTargetCandidate);
  }
  return { overlayPresent: probe.overlayPresent, candidates };
}
