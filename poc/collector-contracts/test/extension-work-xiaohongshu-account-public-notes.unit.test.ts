import { describe, expect, test } from 'vitest';
import {
  extensionWorkSigningPayload,
  extensionWorkTargetUrl,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  type XiaohongshuAccountPublicNotesWorkItem
} from '../src/index.js';

const item: XiaohongshuAccountPublicNotesWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.account.public_notes.v1',
  executionTarget: 'existing_public_profile_tab',
  issuedAt: '2026-07-28T08:00:00.000Z',
  expiresAt: '2026-07-28T08:01:00.000Z',
  input: { maximumScrolls: 2 },
  budget: {
    maximumPlatformNavigations: 0,
    maximumPageReloads: 0,
    maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 3,
    maximumNetworkResponseBodies: 8,
    maximumProjectedItems: 40,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

const completedResult = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: item.workId,
  operationId: item.operationId,
  browserBindingId: item.browserBindingId,
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.account.public_notes.v1',
  executionTarget: 'existing_public_profile_tab',
  state: 'completed',
  errorCode: null,
  terminalReason: 'profile_notes_ready',
  completedAt: '2026-07-28T08:00:30.000Z',
  navigation: { attempted: false, attemptCount: 0 },
  semanticAction: { attempted: true, attemptCount: 2 },
  scroll: { requestedCount: 2, completedCount: 2 },
  page: { publicSurface: 'public_profile', renderedCardCount: 1 },
  projection: {
    schemaVersion: 2,
    type: 'xiaohongshu_managed_profile_notes_projection',
    pageAlias: item.workId,
    runId: item.workId,
    matchedPayloadCount: 1,
    bodyBytesRead: 1024,
    rawPayloadStored: false,
    responseUrlsStored: false,
    items: [{
      rank: 1,
      noteId: 'note-1',
      title: '公开笔记',
      contentType: 'normal',
      authorId: 'author-1',
      authorNickname: '公开作者',
      likedCountText: '10'
    }]
  },
  rawPayloadStored: false,
  responseUrlsStored: false,
  debuggerDetached: true
} as const;

describe('signed Xiaohongshu account public-notes work contract', () => {
  test('admits only a fixed existing-profile target and its 1-3 scroll budget', () => {
    expect(isExtensionWorkItem(item)).toBe(true);
    expect(() => extensionWorkTargetUrl(item)).toThrow('extension_work_target_navigation_forbidden');
    expect(extensionWorkSigningPayload(item)).not.toContain('gatewaySignature');
    for (const maximumScrolls of [0, 4, 1.5]) {
      expect(isExtensionWorkItem({ ...item, input: { maximumScrolls } })).toBe(false);
    }
  });

  test('rejects caller-controlled identity and browser-control carriers', () => {
    for (const extra of [
      { url: 'https://www.xiaohongshu.com/user/profile/secret' },
      { accountId: 'secret' },
      { tabId: 11 },
      { selector: '.note-item' },
      { coordinate: { x: 1, y: 2 } },
      { script: 'scrollBy(0, 1000)' },
      { debuggerCommand: 'Runtime.evaluate' }
    ]) expect(isExtensionWorkItem({ ...item, input: { ...item.input, ...extra } })).toBe(false);
  });

  test('distinguishes attempted and completed scrolls while treating maximumScrolls as an upper bound', () => {
    expect(isExtensionWorkResultForItem(completedResult, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...completedResult,
      semanticAction: { attempted: true, attemptCount: 2 },
      scroll: { requestedCount: 2, completedCount: 1 }
    }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...completedResult,
      state: 'stopped',
      errorCode: 'debugger_input_failed',
      terminalReason: 'debugger_input_failed',
      semanticAction: { attempted: true, attemptCount: 1 },
      scroll: { requestedCount: 2, completedCount: 0 },
      page: null,
      projection: null
    }, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...completedResult,
      semanticAction: { attempted: true, attemptCount: 1 },
      scroll: { requestedCount: 2, completedCount: 1 }
    }, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...completedResult,
      semanticAction: { attempted: false, attemptCount: 0 },
      scroll: { requestedCount: 2, completedCount: 0 }
    }, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...completedResult,
      state: 'stopped',
      errorCode: 'xiaohongshu_profile_notes_budget_exhausted',
      terminalReason: 'profile_notes_budget_exhausted',
      semanticAction: { attempted: true, attemptCount: 2 },
      scroll: { requestedCount: 2, completedCount: 2 }
    }, item)).toBe(true);
  });

  test('admits a one-time validated profile link without making it an artifact field', () => {
    const linkItem: XiaohongshuAccountPublicNotesWorkItem = {
      ...item,
      executionTarget: 'ephemeral_public_profile_url',
      input: {
        maximumScrolls: 20,
        profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123?expires=short'
      },
      budget: {
        maximumPlatformNavigations: 1,
        maximumPageReloads: 0,
        maximumPageInitiatedNewDocuments: 0,
        maximumSemanticActions: 20,
        maximumNetworkResponseBodies: 8,
        maximumProjectedItems: 200,
        maximumRawPayloadBytesStored: 0
      }
    };
    expect(isExtensionWorkItem(linkItem)).toBe(true);
    expect(isExtensionWorkItem({ ...linkItem, input: { ...linkItem.input, maximumScrolls: 21 } })).toBe(false);
    expect(extensionWorkSigningPayload(linkItem)).toContain('profileUrl');
    expect(extensionWorkSigningPayload(linkItem)).not.toContain('gatewaySignature');
    expect(isExtensionWorkItem({
      ...linkItem,
      input: { ...linkItem.input, profileUrl: 'https://www.xiaohongshu.com/explore' }
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...linkItem,
      executionTarget: 'existing_public_profile_tab'
    })).toBe(false);
  });
});
