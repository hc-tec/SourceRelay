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
    for(const input of [{maximumThreads:0},{maximumThreads:2},{maximumThreads:1,commentId:'x'},
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
});
