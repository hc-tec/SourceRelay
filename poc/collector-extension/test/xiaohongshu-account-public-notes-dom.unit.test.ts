import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanupXiaohongshuAccountPublicNotesExtensionWorkObserver,
  classifyXiaohongshuProfileProbeRisk,
  mergeProfileNotesProjection,
  selectXiaohongshuProfileTabId
} from '../src/background/extension-work-xiaohongshu-account-public-notes.js';
import {
  selectXiaohongshuPublicAuthorTargetCandidate,
  xiaohongshuProfileEntryPublicSurface,
  type XiaohongshuPublicAuthorTargetCandidate
} from '../src/background/xiaohongshu-public-author-target.js';
import type { XiaohongshuManagedProfileNotesProjectionResult } from '@intelligence/collector-contracts';

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome });
});

const networkProjection: XiaohongshuManagedProfileNotesProjectionResult = {
  schemaVersion: 2,
  type: 'xiaohongshu_managed_profile_notes_projection',
  pageAlias: 'profile-work',
  runId: 'profile-work',
  matchedPayloadCount: 2,
  bodyBytesRead: 4096,
  rawPayloadStored: false,
  responseUrlsStored: false,
  items: [{
    rank: 1,
    noteId: 'network-note',
    title: 'Network title',
    contentType: 'image',
    authorId: 'author-1',
    authorNickname: 'Network author',
    likedCountText: '12'
  }]
};

const authorCandidate = (
  overrides: Partial<XiaohongshuPublicAuthorTargetCandidate> = {}
): XiaohongshuPublicAuthorTargetCandidate => ({
  source: 'search_card',
  x: 120,
  y: 160,
  width: 40,
  height: 40,
  targetMode: 'same_tab',
  pointerHitTarget: true,
  containsAvatar: true,
  alignedWithOverlayHeader: false,
  insideCommentRegion: false,
  insideStateChangingControl: false,
  order: 0,
  ...overrides
});

describe('Xiaohongshu profile note projection merge', () => {
  test('admits the same-document public note route as a profile-discovery source', () => {
    expect(xiaohongshuProfileEntryPublicSurface('https://www.xiaohongshu.com/explore')).toBe('explore');
    expect(xiaohongshuProfileEntryPublicSurface('https://www.xiaohongshu.com/search_result?keyword=public'))
      .toBe('search');
    expect(xiaohongshuProfileEntryPublicSurface('https://www.xiaohongshu.com/explore/public-note?xsec_source=pc_search'))
      .toBe('public_note_detail');
    expect(xiaohongshuProfileEntryPublicSurface('https://www.xiaohongshu.com/user/profile/public-author'))
      .toBeNull();
  });

  test('prefers the visible overlay header author over background search-card authors', () => {
    const overlayAuthor = authorCandidate({
      source: 'note_overlay', y: 72, alignedWithOverlayHeader: true, order: 1
    });
    expect(selectXiaohongshuPublicAuthorTargetCandidate({
      overlayPresent: true,
      candidates: [authorCandidate(), overlayAuthor]
    })).toEqual(overlayAuthor);
  });

  test('never selects a comment or reply author as the note author', () => {
    const commentAuthor = authorCandidate({
      source: 'note_overlay', y: 140, alignedWithOverlayHeader: true, insideCommentRegion: true
    });
    expect(selectXiaohongshuPublicAuthorTargetCandidate({
      overlayPresent: true,
      candidates: [commentAuthor]
    })).toBeNull();
  });

  test('falls back to a visible search-card author only when no overlay exists', () => {
    const cardAuthor = authorCandidate();
    expect(selectXiaohongshuPublicAuthorTargetCandidate({
      overlayPresent: false,
      candidates: [cardAuthor]
    })).toEqual(cardAuthor);
  });

  test('rejects obstructed, malformed, or state-changing author targets', () => {
    for (const candidate of [
      authorCandidate({ pointerHitTarget: false }),
      authorCandidate({ width: 0 }),
      authorCandidate({ insideStateChangingControl: true }),
      authorCandidate({ source: 'note_overlay', alignedWithOverlayHeader: false })
    ]) expect(selectXiaohongshuPublicAuthorTargetCandidate({
      overlayPresent: candidate.source === 'note_overlay',
      candidates: [candidate]
    })).toBeNull();
  });

  test('keeps an ephemeral navigation bound to its own profile tab when another profile is open', () => {
    expect(selectXiaohongshuProfileTabId([11, 22], 22)).toBe(22);
    expect(selectXiaohongshuProfileTabId([11, 22], 33)).toBeNull();
    expect(selectXiaohongshuProfileTabId([11], null)).toBe(11);
    expect(selectXiaohongshuProfileTabId([11, 22], null)).toBeNull();
  });

  test('does not classify a populated profile as unavailable because a card contains an error phrase', () => {
    expect(classifyXiaohongshuProfileProbeRisk({
      pathname: '/user/profile/public-id', title: '公开主页', visibleText: '某条笔记：加载失败',
      renderedCardCount: 4, itemCount: 4
    }).sourceUnavailable).toBe(false);
    expect(classifyXiaohongshuProfileProbeRisk({
      pathname: '/user/profile/public-id', title: '公开主页', visibleText: '加载失败',
      renderedCardCount: 0, itemCount: 0
    }).sourceUnavailable).toBe(true);
  });

  test('crash recovery removes only the exact work-derived document-start observer', async () => {
    const unregisterContentScripts = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { scripting: { unregisterContentScripts } } as unknown as typeof chrome
    });

    await cleanupXiaohongshuAccountPublicNotesExtensionWorkObserver(
      '11111111-1111-4111-8111-111111111111'
    );
    await cleanupXiaohongshuAccountPublicNotesExtensionWorkObserver('not-a-work-id');

    expect(unregisterContentScripts).toHaveBeenCalledTimes(1);
    expect(unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['collector-xhs-profile-11111111111141118111111111111111']
    });
  });

  test('keeps Network data first and appends visible DOM cards without duplicate identities', () => {
    const result = mergeProfileNotesProjection(networkProjection, [
      {
        rank: 1,
        noteId: 'network-note',
        title: 'DOM title should not replace Network title',
        contentType: 'video',
        authorId: '',
        authorNickname: 'DOM author',
        likedCountText: '99'
      },
      {
        rank: 2,
        noteId: 'dom-only-note',
        title: 'DOM only title',
        contentType: 'video',
        authorId: '',
        authorNickname: 'DOM only author',
        likedCountText: '3'
      }
    ]);

    expect(result.items).toEqual([
      {
        rank: 1,
        noteId: 'network-note',
        title: 'Network title',
        contentType: 'image',
        authorId: 'author-1',
        authorNickname: 'Network author',
        likedCountText: '12'
      },
      {
        rank: 2,
        noteId: 'dom-only-note',
        title: 'DOM only title',
        contentType: 'video',
        authorId: '',
        authorNickname: 'DOM only author',
        likedCountText: '3'
      }
    ]);
  });

  test('preserves bounded Network accounting and storage safety flags', () => {
    const result = mergeProfileNotesProjection(networkProjection, []);
    expect(result).toMatchObject({
      matchedPayloadCount: 2,
      bodyBytesRead: 4096,
      rawPayloadStored: false,
      responseUrlsStored: false
    });
    expect(result).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('responseUrl');
  });
});
