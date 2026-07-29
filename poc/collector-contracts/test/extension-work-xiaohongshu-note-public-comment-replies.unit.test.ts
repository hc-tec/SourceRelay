import { describe, expect, test } from 'vitest';
import { extensionWorkTargetUrl, isExtensionWorkItem, isExtensionWorkResultForItem,
  type XiaohongshuNotePublicCommentRepliesWorkItem } from '../src/index.js';
const item: XiaohongshuNotePublicCommentRepliesWorkItem = { schemaVersion:1,protocolVersion:1,
  workId:'11111111-1111-4111-8111-111111111111',operationId:'22222222-2222-4222-8222-222222222222',
  browserBindingId:'33333333-3333-4333-8333-333333333333',platform:'xiaohongshu',
  capability:'xiaohongshu.note.public_comment_replies.v1',executionTarget:'existing_public_note_overlay',
  issuedAt:'2026-07-28T12:00:00.000Z',expiresAt:'2026-07-28T12:01:00.000Z',input:{maximumThreads:1},
  budget:{maximumPlatformNavigations:0,maximumPageReloads:0,maximumPageInitiatedNewDocuments:0,
    maximumSemanticActions:1,maximumNetworkResponseBodies:8,maximumProjectedItems:40,maximumRawPayloadBytesStored:0},
  gatewaySignature:'a'.repeat(64) };
const comment=(rank:number,source:'network'|'dom')=>({rank,commentId:`comment-${rank}`,publicText:`公开回复 ${rank}`,
  authorNickname:`作者 ${rank}`,likedCountText:'',createdAtText:'',locationText:'',source});
describe('signed Xiaohongshu public reply-thread contract',()=>{
  test('allows one fixed thread and no browser-control carriers',()=>{
    expect(isExtensionWorkItem(item)).toBe(true);
    expect(()=>extensionWorkTargetUrl(item)).toThrow('extension_work_target_navigation_forbidden');
    for(const input of [{maximumThreads:0},{maximumThreads:4},{maximumThreads:1,commentId:'x'},
      {maximumThreads:1,url:'https://x'},{maximumThreads:1,selector:'.reply'},{maximumThreads:1,script:'click()'}])
      expect(isExtensionWorkItem({...item,input})).toBe(false);
  });
  test('requires a completed expanded thread with at least one reply',()=>{
    const result={schemaVersion:1,protocolVersion:1,workId:item.workId,operationId:item.operationId,
      browserBindingId:item.browserBindingId,platform:'xiaohongshu',capability:item.capability,
      executionTarget:item.executionTarget,state:'completed',errorCode:null,terminalReason:'comment_replies_ready',
      completedAt:'2026-07-28T12:00:20.000Z',navigation:{attempted:false,attemptCount:0},
      semanticAction:{attempted:true,attemptCount:1},thread:{requestedCount:1,completedCount:1},
      page:{publicSurface:'note_detail_overlay',sameDocument:true},projection:{schemaVersion:1,captureMode:'hybrid',
        network:{matchedPayloadCount:1,bodyBytesRead:2368,cursorObserved:true,actionTriggeredResponseCount:0},
        expandedLabelText:'展开 3 条回复',parentComment:comment(1,'network'),replies:[comment(1,'dom')],
        rawPayloadStored:false,responseUrlsStored:false},rawPayloadStored:false,responseUrlsStored:false,debuggerDetached:true};
    expect(isExtensionWorkResultForItem(result,item)).toBe(true);
    expect(isExtensionWorkResultForItem({...result,projection:{...result.projection,replies:[]}},item)).toBe(false);
  });
  test('preserves an at-most-once attempted click whose postcondition was not met',()=>{
    const stopped={schemaVersion:1,protocolVersion:1,workId:item.workId,operationId:item.operationId,
      browserBindingId:item.browserBindingId,platform:'xiaohongshu',capability:item.capability,
      executionTarget:item.executionTarget,state:'stopped',errorCode:'xiaohongshu_comment_replies_postcondition_unmet',
      terminalReason:'postcondition_unmet',completedAt:'2026-07-28T12:00:20.000Z',
      navigation:{attempted:false,attemptCount:0},semanticAction:{attempted:true,attemptCount:1},
      thread:{requestedCount:1,completedCount:0},page:null,projection:null,
      rawPayloadStored:false,responseUrlsStored:false,debuggerDetached:true};
    expect(isExtensionWorkResultForItem(stopped,item)).toBe(true);
    expect(isExtensionWorkResultForItem({...stopped,thread:{requestedCount:1,completedCount:1}},item)).toBe(false);
    expect(isExtensionWorkResultForItem({...stopped,semanticAction:{attempted:false,attemptCount:0},
      thread:{requestedCount:1,completedCount:1}},item)).toBe(false);
  });
  test('accepts a completed Network-only thread without a page action',()=>{
    const networkOnly={schemaVersion:1,protocolVersion:1,workId:item.workId,operationId:item.operationId,
      browserBindingId:item.browserBindingId,platform:'xiaohongshu',capability:item.capability,
      executionTarget:item.executionTarget,state:'completed',errorCode:null,terminalReason:'comment_replies_ready',
      completedAt:'2026-07-28T12:00:20.000Z',navigation:{attempted:false,attemptCount:0},
      semanticAction:{attempted:false,attemptCount:0},thread:{requestedCount:1,completedCount:1},
      page:{publicSurface:'note_detail_overlay',sameDocument:true},projection:{schemaVersion:1,
        captureMode:'network_projection',network:{matchedPayloadCount:1,bodyBytesRead:8245,cursorObserved:true,
          actionTriggeredResponseCount:0},expandedLabelText:'network_archive',parentComment:comment(1,'network'),
        replies:[comment(1,'network')],rawPayloadStored:false,responseUrlsStored:false},
      rawPayloadStored:false,responseUrlsStored:false,debuggerDetached:true};
    expect(isExtensionWorkResultForItem(networkOnly,item)).toBe(true);
  });
  test('admits a bounded multi-thread request and requires one projection per completed thread',()=>{
    const multiItem = { ...item, input: { maximumThreads: 2 as const }, budget: {
      maximumPlatformNavigations: 0, maximumPageReloads: 0, maximumPageInitiatedNewDocuments: 0,
      maximumSemanticActions: 3, maximumNetworkResponseBodies: 24, maximumProjectedItems: 120,
      maximumRawPayloadBytesStored: 0
    } as const };
    expect(isExtensionWorkItem(multiItem)).toBe(true);
    const first = {
      schemaVersion: 1, captureMode: 'network_projection' as const,
      network: { matchedPayloadCount: 1, bodyBytesRead: 512, cursorObserved: true, actionTriggeredResponseCount: 0 },
      expandedLabelText: 'network_archive', parentComment: comment(1, 'network'), replies: [comment(1, 'network')],
      rawPayloadStored: false as const, responseUrlsStored: false as const
    };
    const second = { ...first, expandedLabelText: '展开 2 条回复' };
    const result = {
      schemaVersion: 1, protocolVersion: 1, workId: item.workId, operationId: item.operationId,
      browserBindingId: item.browserBindingId, platform: 'xiaohongshu' as const,
      capability: item.capability, executionTarget: item.executionTarget, state: 'completed' as const,
      errorCode: null, terminalReason: 'comment_replies_ready' as const, completedAt: '2026-07-28T12:00:20.000Z',
      navigation: { attempted: false as const, attemptCount: 0 as const },
      semanticAction: { attempted: true, attemptCount: 2 as const },
      thread: { requestedCount: 2 as const, completedCount: 2 as const },
      page: { publicSurface: 'note_detail_overlay' as const, sameDocument: true as const },
      projection: first, projections: [first, second], rawPayloadStored: false as const,
      responseUrlsStored: false as const, debuggerDetached: true
    };
    expect(isExtensionWorkResultForItem({ ...result, workId: multiItem.workId, operationId: multiItem.operationId }, multiItem)).toBe(true);
    expect(isExtensionWorkResultForItem({ ...result, projections: [first] }, multiItem)).toBe(false);
  });
});
