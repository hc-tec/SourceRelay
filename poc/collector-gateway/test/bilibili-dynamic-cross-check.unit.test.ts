import { describe, expect, test } from 'vitest';
import {
  bilibiliDynamicCardEvidenceCheck
} from '../src/bilibili-dynamic-response';
import type { BilibiliDynamicItemProjection } from '../src/bilibili-dynamic-contract';

function opusItem(
  overrides: Partial<Omit<BilibiliDynamicItemProjection, 'domEvidence'>> = {}
): Omit<BilibiliDynamicItemProjection, 'domEvidence'> {
  return {
    stableDynamicId: '1203013317350653957',
    dynamicType: 'DYNAMIC_TYPE_DRAW',
    stableAccountId: '7481602',
    displayName: '安州牧',
    publishedAction: null,
    publishedVisibleText: '05月16日',
    publishedAt: '2026-05-16T10:00:00.000Z',
    visibleText: null,
    majorType: 'MAJOR_TYPE_OPUS',
    majorTitle: null,
    reservationTitle: null,
    additionalGoodsHeadText: null,
    additionalUpowerLotteryTitle: null,
    primaryIdentity: {
      kind: 'opus',
      stableId: '1203013317350653957',
      canonicalUrl: 'https://www.bilibili.com/opus/1203013317350653957'
    },
    responseVisible: true,
    accessState: 'public',
    isPinned: false,
    publicMetrics: { comments: 1, forwards: 0, likes: 2 },
    forwardedSource: null,
    forwardedSourceState: 'not_forward',
    pageNumber: 2,
    positionOnPage: 11,
    card: {
      outerAuthor: '安州牧',
      publishedVisibleText: '05月16日',
      visibleText: '安州牧 05月16日 非常荣幸收到邀请，感谢大家。',
      links: [],
      mediaRefs: [],
      kind: 'opus',
      blockedPlaceholder: false,
      reservation: false,
      forwarded: false
    },
    ...overrides
  };
}

describe('Bilibili dynamic DOM/response cross-check', () => {
  test('accepts a public Opus card when response text is unavailable at the redaction boundary', () => {
    const result = bilibiliDynamicCardEvidenceCheck(opusItem({ majorTitle: '[truncated: depth limit]' }));
    expect(result).toMatchObject({
      authorMatch: true,
      publicationMatch: true,
      textMatch: false,
      accessStateMatch: true,
      cardEvidenceMatch: true
    });
  });

  test('does not turn a structural mismatch into a DOM-only fallback', () => {
    const result = bilibiliDynamicCardEvidenceCheck(opusItem({
      card: { ...opusItem().card, kind: 'other' }
    }));
    expect(result.cardEvidenceMatch).toBe(false);
  });
});
