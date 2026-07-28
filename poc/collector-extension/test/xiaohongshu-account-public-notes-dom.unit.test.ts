import { describe, expect, test } from 'vitest';
import { mergeProfileNotesProjection } from '../src/background/extension-work-xiaohongshu-account-public-notes.js';
import type { XiaohongshuManagedProfileNotesProjectionResult } from '@intelligence/collector-contracts';

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

describe('Xiaohongshu profile note projection merge', () => {
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
