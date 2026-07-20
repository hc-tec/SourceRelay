import type { PageScrollResult } from '@intelligence/collector-contracts';
import type {
  BilibiliDynamicAction,
  BilibiliDynamicPageProjection
} from './bilibili-dynamic-contract';

/**
 * This is deliberately a Bilibili-dynamic canary budget, not a reusable
 * pagination abstraction. The real page determines whether the second feed
 * response arrives before the third bounded human-like wheel gesture.
 */
export const BILIBILI_DYNAMIC_TWO_PAGE_LIMIT = 2 as const;
export const BILIBILI_DYNAMIC_SECOND_PAGE_MAX_SCROLL_ACTIONS = 3 as const;
export const BILIBILI_DYNAMIC_TRUSTED_SCROLL_DELTA_Y = 1_200 as const;

export function bilibiliDynamicNavigationAction(runId: string): BilibiliDynamicAction {
  return {
    actionId: `navigate_dynamic_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    intent: 'Navigate once to the canonical Bilibili account dynamic feed.',
    expectedPageNumber: 1,
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null,
    scroll: null
  };
}

export function bilibiliDynamicSecondPageScrollAction(
  runId: string,
  ordinal: number
): BilibiliDynamicAction {
  return {
    actionId: `scroll_dynamic_second_page_${ordinal}_${runId.replace(/-/g, '_')}`,
    kind: 'trusted_scroll',
    intent: 'Move down once with Browser Host trusted wheel input while observing the second dynamic feed response.',
    expectedPageNumber: 2,
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null,
    scroll: null
  };
}

export function completeBilibiliDynamicScrollAction(
  action: BilibiliDynamicAction,
  result: PageScrollResult
): void {
  action.attempted = true;
  action.attemptCount = 1;
  action.outcome = 'completed';
  action.errorCode = null;
  action.scroll = {
    deltaY: result.after.scrollY - result.before.scrollY,
    beforeScrollY: result.before.scrollY,
    afterScrollY: result.after.scrollY,
    beforeScrollHeight: result.before.scrollHeight,
    afterScrollHeight: result.after.scrollHeight,
    viewportHeight: result.after.viewportHeight
  };
}

export function hasDuplicateBilibiliDynamicIds(pages: readonly BilibiliDynamicPageProjection[]): boolean {
  const ids = pages.flatMap((page) => page.items.map((item) => item.stableDynamicId));
  return new Set(ids).size !== ids.length;
}
