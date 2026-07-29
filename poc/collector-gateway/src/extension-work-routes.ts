import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliVideoWorkUrl,
  isExtensionWorkResultForItem,
  isBilibiliNativeSearchBatchWorkItem,
  isBilibiliNativeSearchBatchWorkResult,
  isBilibiliVideoDiscussionUserSelectedTabWorkItem,
  isBilibiliVideoDiscussionUserSelectedTabWorkResult,
  isExtensionWorkResult,
  isBilibiliPassiveExtensionWorkItem,
  isBilibiliPassiveExtensionWorkResult,
  isXiaohongshuPublicNotesSearchWorkItem,
  isXiaohongshuPublicNotesSearchWorkResult,
  isXiaohongshuAccountPublicNotesWorkItem,
  isXiaohongshuAccountPublicNotesWorkResult,
  isXiaohongshuNotePublicDetailWorkItem,
  isXiaohongshuNotePublicDetailWorkResult,
  isXiaohongshuNotePublicCommentsWorkItem,
  isXiaohongshuNotePublicCommentsWorkResult,
  isXiaohongshuNotePublicCommentRepliesWorkItem,
  isXiaohongshuNotePublicCommentRepliesWorkResult,
  type XiaohongshuProfileScrollCount,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import type { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import type { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import type { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import type { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import type { BrowserBindingSafetyRegistry } from './browser-binding-safety';
import { recordBilibiliAccountInventoryExtensionWork } from './extension-work-bilibili-account-inventory';
import { recordBilibiliAccountProfileExtensionWork } from './extension-work-bilibili-account-profile';
import { recordBilibiliNativeSearchExtensionWork } from './extension-work-bilibili-native-search';
import { recordBilibiliNativeSearchBatchExtensionWork } from './extension-work-bilibili-native-search-batch';
import { recordBilibiliDiscussionUserSelectedTabExtensionWork } from './extension-work-bilibili-discussion-user-selected-tab';
import { recordBilibiliVideoDetailExtensionWork } from './extension-work-bilibili-video-detail';
import { recordBilibiliPassiveExtensionWork } from './extension-work-bilibili-passive';
import { recordXiaohongshuPublicNotesExtensionWork } from './extension-work-xiaohongshu-public-notes';
import { recordXiaohongshuAccountPublicNotesExtensionWork } from './extension-work-xiaohongshu-account-public-notes';
import { recordXiaohongshuNotePublicDetailExtensionWork } from './extension-work-xiaohongshu-note-public-detail';
import { recordXiaohongshuNotePublicCommentsExtensionWork } from './extension-work-xiaohongshu-note-public-comments';
import { recordXiaohongshuReplyWork } from './extension-work-xiaohongshu-note-public-comment-replies';
import type { ExtensionWorkPassiveArtifactStore } from './extension-work-passive-artifacts';
import type { ExtensionWorkNativeSearchBatchArtifactStore } from './extension-work-native-search-batch-artifacts';
import type { XiaohongshuPublicNotesArtifactStore } from './xiaohongshu-public-notes-artifacts';
import type { XiaohongshuAccountPublicNotesArtifactStore } from './xiaohongshu-account-public-notes-artifacts';
import type { XiaohongshuNotePublicDetailArtifactStore } from './xiaohongshu-note-public-detail-artifacts';
import type { XiaohongshuNotePublicCommentsArtifactStore } from './xiaohongshu-note-public-comments-artifacts';
import type { XiaohongshuReplyArtifactStore } from './xiaohongshu-note-public-comment-replies-artifacts';
import type { ExtensionWorkArtifactReference, ExtensionWorkQueue } from './extension-work-queue';
import { readJsonBody, readJsonBodyWithRaw, requireSameOrigin, safeErrorCode, sendJson } from './gateway-http';
import type { LoadedGatewayIdentity } from './identity';
import type { PairingBroker } from './pairing';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const EXTENSION_ID = /^[a-p]{32}$/;
const WORK_NEXT_PATH = '/v1/extension/work-items/next';
const WORK_RESULT_PATH = '/v1/extension/work-items/result';
const EXTENSION_CORS_HEADERS = [
  'content-type',
  'authorization',
  'x-collector-extension-id',
  'x-collector-extension-instance-id',
  'x-collector-timestamp',
  'x-collector-nonce',
  'x-collector-body-sha256'
].join(', ');

export interface ExtensionWorkRouteContext {
  identity: LoadedGatewayIdentity;
  pairingBroker: PairingBroker;
  workQueue: ExtensionWorkQueue;
  browserBindingSafety: BrowserBindingSafetyRegistry;
  videoDetailArtifacts: BilibiliVideoDetailArtifactStore;
  nativeSearchArtifacts: BilibiliNativeSearchArtifactStore;
  nativeSearchBatchDirectArtifacts: ExtensionWorkNativeSearchBatchArtifactStore;
  accountProfileArtifacts: BilibiliAccountProfileArtifactStore;
  accountVideoInventoryArtifacts: BilibiliAccountVideoInventoryArtifactStore;
  passiveDirectArtifacts: ExtensionWorkPassiveArtifactStore;
  xiaohongshuPublicNotesArtifacts: XiaohongshuPublicNotesArtifactStore;
  xiaohongshuAccountPublicNotesArtifacts: XiaohongshuAccountPublicNotesArtifactStore;
  xiaohongshuNotePublicDetailArtifacts: XiaohongshuNotePublicDetailArtifactStore;
  xiaohongshuNotePublicCommentsArtifacts: XiaohongshuNotePublicCommentsArtifactStore;
  xiaohongshuReplyArtifacts: XiaohongshuReplyArtifactStore;
}

/**
 * This route family has two deliberately separate callers:
 *
 * - an authenticated installed extension can only claim the next signed work
 *   item and submit its fixed result;
 * - the same-origin Gateway Console can enqueue/read one registered work
 *   item or explicitly unlock a risk-stopped binding.
 *
 * Neither caller gets a general browser-control surface.
 */
export async function handleExtensionWorkRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: ExtensionWorkRouteContext
): Promise<boolean> {
  if (request.method === 'OPTIONS' && isExtensionWorkEndpoint(url.pathname)) {
    const origin = extensionOrigin(request.headers.origin);
    if (!origin) {
      sendJson(response, 403, { schemaVersion: 1, ok: false, error: 'extension_origin_required' });
      return true;
    }
    setExtensionCors(response, origin);
    response.statusCode = 204;
    response.setHeader('cache-control', 'no-store');
    response.end();
    return true;
  }
  if (request.method === 'POST' && url.pathname === WORK_NEXT_PATH) {
    await handleExtensionWorkNext(request, response, context);
    return true;
  }
  if (request.method === 'POST' && url.pathname === WORK_RESULT_PATH) {
    await handleExtensionWorkResult(request, response, context);
    return true;
  }

  const dispatch = url.pathname.match(new RegExp(`^/v1/browser-bindings/(${UUID})/work-items$`, 'i'));
  if (request.method === 'POST' && dispatch) {
    if (!requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin)) return true;
    try {
      const input = consoleDispatchInput(await readJsonBody(request));
      const operation = input.capability === 'bilibili.video_detail'
        ? await enqueueBilibiliVideoDetailWork(context, dispatch[1]!, input.canonicalVideoUrl)
        : input.capability === 'bilibili.native_search'
          ? await enqueueBilibiliNativeSearchWork(context, dispatch[1]!, input.query)
          : input.capability === 'bilibili.account_profile'
            ? await enqueueBilibiliAccountProfileWork(context, dispatch[1]!, input.canonicalProfileUrl)
            : await enqueueBilibiliAccountInventoryWork(context, dispatch[1]!, input.canonicalProfileUrl);
      sendJson(response, 201, { schemaVersion: 1, operation });
    } catch (error) {
      sendJson(response, workOperationStatus(error), { schemaVersion: 1, ok: false, error: safeErrorCode(error) });
    }
    return true;
  }

  const operation = url.pathname.match(new RegExp(
    `^/v1/browser-bindings/(${UUID})/work-items/(${UUID})$`,
    'i'
  ));
  if (request.method === 'GET' && operation) {
    if (!requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin)) return true;
    await reconcileExpiredExtensionWork(context);
    const record = await context.workQueue.get(operation[2]!);
    if (!record || record.browserBindingId !== operation[1]!) {
      sendJson(response, 404, { schemaVersion: 1, ok: false, error: 'extension_work_not_found' });
      return true;
    }
    sendJson(response, 200, { schemaVersion: 1, operation: record });
    return true;
  }

  const safety = url.pathname.match(new RegExp(`^/v1/browser-bindings/(${UUID})/safety$`, 'i'));
  if (request.method === 'GET' && safety) {
    if (!requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin)) return true;
    const binding = context.pairingBroker.getBrowserBinding(safety[1]!);
    sendJson(response, 200, {
      schemaVersion: 1,
      safety: context.browserBindingSafety.get(binding.browserBindingId, 'bilibili')
    });
    return true;
  }

  const unlock = url.pathname.match(new RegExp(`^/v1/browser-bindings/(${UUID})/safety/unlock$`, 'i'));
  if (request.method === 'POST' && unlock) {
    if (!requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin)) return true;
    try {
      const binding = context.pairingBroker.getBrowserBinding(unlock[1]!);
      unlockInput(await readJsonBody(request));
      sendJson(response, 200, {
        schemaVersion: 1,
        safety: await context.browserBindingSafety.unlock(binding.browserBindingId, 'bilibili')
      });
    } catch (error) {
      sendJson(response, workOperationStatus(error), { schemaVersion: 1, ok: false, error: safeErrorCode(error) });
    }
    return true;
  }
  return false;
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliVideoDetailWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalVideoUrl: string
) {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, 'bilibili');
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
  return await context.workQueue.enqueueBilibiliVideoDetail({
    browserBindingId: binding.browserBindingId,
    canonicalVideoUrl
  });
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliNativeSearchWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  query: string
) {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, 'bilibili');
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
  return await context.workQueue.enqueueBilibiliNativeSearch({
    browserBindingId: binding.browserBindingId,
    query
  });
}

/** Shared by the scoped upper-application service route; pages are fixed by the signed capability. */
export async function enqueueBilibiliNativeSearchBatchWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  query: string
) {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, 'bilibili');
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
  return await context.workQueue.enqueueBilibiliNativeSearchBatch({
    browserBindingId: binding.browserBindingId,
    query
  });
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliAccountProfileWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalProfileUrl: string
) {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, 'bilibili');
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
  return await context.workQueue.enqueueBilibiliAccountProfile({
    browserBindingId: binding.browserBindingId,
    canonicalProfileUrl
  });
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliAccountInventoryWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalProfileUrl: string
) {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, 'bilibili');
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
  return await context.workQueue.enqueueBilibiliAccountInventory({
    browserBindingId: binding.browserBindingId,
    canonicalProfileUrl
  });
}

/**
 * Dispatch a zero-navigation observation only after an extension-popup user
 * has locally selected a matching inventory document. The Gateway receives no
 * tab ID or document ID and cannot choose or reopen a browser tab.
 */
export async function enqueueBilibiliAccountInventoryUserSelectedTabWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalProfileUrl: string
) {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, 'bilibili');
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
  return await context.workQueue.enqueueBilibiliAccountInventoryUserSelectedTab({
    browserBindingId: binding.browserBindingId,
    canonicalProfileUrl
  });
}

/**
 * Queue a fixed zero-navigation comments projection only after the extension
 * popup has locally selected the matching already-visible discussion document.
 * The Gateway never receives, stores, or selects browser tab/document IDs.
 */
export async function enqueueBilibiliDiscussionUserSelectedTabWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalVideoUrl: string
) {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, 'bilibili');
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
  return await context.workQueue.enqueueBilibiliDiscussionUserSelectedTab({
    browserBindingId: binding.browserBindingId,
    canonicalVideoUrl
  });
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliDynamicWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalProfileUrl: string
) {
  await assertBindingCanAcceptWork(context, browserBindingId);
  return await context.workQueue.enqueueBilibiliDynamic({ browserBindingId, canonicalProfileUrl });
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliCollectionSeriesOverviewWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalProfileUrl: string
) {
  await assertBindingCanAcceptWork(context, browserBindingId);
  return await context.workQueue.enqueueBilibiliCollectionSeriesOverview({ browserBindingId, canonicalProfileUrl });
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliCollectionSeriesDetailWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalProfileUrl: string,
  stableSeriesId: string,
  listType: 'series' | 'season'
) {
  await assertBindingCanAcceptWork(context, browserBindingId);
  return await context.workQueue.enqueueBilibiliCollectionSeriesDetail({
    browserBindingId, canonicalProfileUrl, stableSeriesId, listType
  });
}

/** Shared by the Console and the scoped upper-application service route. */
export async function enqueueBilibiliDanmakuWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  canonicalVideoUrl: string
) {
  await assertBindingCanAcceptWork(context, browserBindingId);
  return await context.workQueue.enqueueBilibiliDanmaku({ browserBindingId, canonicalVideoUrl });
}

export async function enqueueXiaohongshuPublicNotesSearchWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  query: string,
  maximumDetails?: number,
  comments?: { maximumScrolls: 1 | 2 | 3; replies?: { maximumThreads: 1 | 2 | 3 } }
) {
  await assertBindingCanAcceptWork(context, browserBindingId, 'xiaohongshu');
  return await context.workQueue.enqueueXiaohongshuPublicNotesSearch({
    browserBindingId, query, maximumDetails, comments
  });
}

export async function enqueueXiaohongshuAccountPublicNotesWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  maximumScrolls: XiaohongshuProfileScrollCount,
  profileUrl?: string
) {
  await assertBindingCanAcceptWork(context, browserBindingId, 'xiaohongshu');
  return await context.workQueue.enqueueXiaohongshuAccountPublicNotes({ browserBindingId, maximumScrolls, profileUrl });
}

export async function enqueueXiaohongshuNotePublicDetailWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  resultRank: number
) {
  await assertBindingCanAcceptWork(context, browserBindingId, 'xiaohongshu');
  return await context.workQueue.enqueueXiaohongshuNotePublicDetail({ browserBindingId, resultRank });
}
export async function enqueueXiaohongshuNotePublicCommentsWork(
  context: ExtensionWorkRouteContext, browserBindingId: string, maximumScrolls: 1 | 2 | 3
) {
  await assertBindingCanAcceptWork(context, browserBindingId, 'xiaohongshu');
  return await context.workQueue.enqueueXiaohongshuNotePublicComments({ browserBindingId, maximumScrolls });
}
export async function enqueueXiaohongshuReplyWork(context:ExtensionWorkRouteContext,browserBindingId:string,maximumThreads:1|2|3){
  await assertBindingCanAcceptWork(context,browserBindingId,'xiaohongshu');return await context.workQueue.enqueueXiaohongshuNotePublicCommentReplies({browserBindingId,maximumThreads});}

async function handleExtensionWorkNext(
  request: IncomingMessage,
  response: ServerResponse,
  context: ExtensionWorkRouteContext
): Promise<void> {
  const origin = extensionOrigin(request.headers.origin);
  if (!origin) {
    sendJson(response, 403, { schemaVersion: 1, ok: false, error: 'extension_origin_required' });
    return;
  }
  setExtensionCors(response, origin);
  try {
    const authorised = await authoriseExtensionRequest(request, context, WORK_NEXT_PATH, '');
    await reconcileExpiredExtensionWork(context);
    const safetyRecords = [
      context.browserBindingSafety.get(authorised.browserBindingId, 'bilibili'),
      context.browserBindingSafety.get(authorised.browserBindingId, 'xiaohongshu')
    ];
    if (safetyRecords.some((safety) => safety.state === 'running')) {
      sendJson(response, 200, { schemaVersion: 1, workItem: null });
      return;
    }
    const allowedPlatforms = safetyRecords
      .filter((safety) => safety.state === 'ready')
      .map((safety) => safety.platform);
    const item = await context.workQueue.claimNext(authorised.browserBindingId, new Date(), allowedPlatforms);
    if (!item) {
      sendJson(response, 200, { schemaVersion: 1, workItem: null });
      return;
    }
    await context.browserBindingSafety.begin(authorised.browserBindingId, item.platform, item.operationId);
    if (item.executionTarget === 'collector_work_tab') {
      await context.browserBindingSafety.recordNavigationIntent(authorised.browserBindingId, item.platform, item.operationId);
    }
    sendJson(response, 200, { schemaVersion: 1, workItem: item });
  } catch (error) {
    sendJson(response, extensionWorkStatus(error), { schemaVersion: 1, ok: false, error: safeErrorCode(error) });
  }
}

async function handleExtensionWorkResult(
  request: IncomingMessage,
  response: ServerResponse,
  context: ExtensionWorkRouteContext
): Promise<void> {
  const origin = extensionOrigin(request.headers.origin);
  if (!origin) {
    sendJson(response, 403, { schemaVersion: 1, ok: false, error: 'extension_origin_required' });
    return;
  }
  setExtensionCors(response, origin);
  try {
    const body = await readJsonBodyWithRaw(request);
    const authorised = await authoriseExtensionRequest(request, context, WORK_RESULT_PATH, body.raw);
    if (!isExtensionWorkResult(body.value)) throw new Error('extension_work_result_invalid');
    const result = body.value as ExtensionWorkResult;
    const item = context.workQueue.claimedItem(authorised.browserBindingId, result.workId);
    // Validate the target-specific signed envelope before an artifact writer
    // can persist any projection. In particular, a work-tab result can never
    // be relabelled as a user-selected-tab observation (or vice versa).
    if (!isExtensionWorkResultForItem(result, item)) throw new Error('extension_work_result_invalid');
    let artifact: ExtensionWorkArtifactReference;
    if (item.capability === 'bilibili.video_detail' && result.capability === 'bilibili.video_detail') {
      artifact = await recordBilibiliVideoDetailExtensionWork({
        item,
        result,
        artifacts: context.videoDetailArtifacts
      });
    } else if (item.capability === 'bilibili.native_search' && result.capability === 'bilibili.native_search') {
      artifact = await recordBilibiliNativeSearchExtensionWork({
        item,
        result,
        artifacts: context.nativeSearchArtifacts
      });
    } else if (isBilibiliNativeSearchBatchWorkItem(item) && isBilibiliNativeSearchBatchWorkResult(result)) {
      artifact = await recordBilibiliNativeSearchBatchExtensionWork({
        item,
        result,
        artifacts: context.nativeSearchBatchDirectArtifacts
      });
    } else if (item.capability === 'bilibili.account_profile' && result.capability === 'bilibili.account_profile') {
      artifact = await recordBilibiliAccountProfileExtensionWork({
        item,
        result,
        artifacts: context.accountProfileArtifacts
      });
    } else if (item.capability === 'bilibili.account_inventory' && result.capability === 'bilibili.account_inventory') {
      artifact = await recordBilibiliAccountInventoryExtensionWork({
        item,
        result,
        artifacts: context.accountVideoInventoryArtifacts
      });
    } else if (isBilibiliVideoDiscussionUserSelectedTabWorkItem(item) &&
      isBilibiliVideoDiscussionUserSelectedTabWorkResult(result)
    ) {
      artifact = await recordBilibiliDiscussionUserSelectedTabExtensionWork({
        item,
        result,
        artifacts: context.passiveDirectArtifacts
      });
    } else if (isBilibiliPassiveExtensionWorkItem(item) && isBilibiliPassiveExtensionWorkResult(result)) {
      artifact = await recordBilibiliPassiveExtensionWork({
        item,
        result,
        artifacts: context.passiveDirectArtifacts
      });
    } else if (isXiaohongshuPublicNotesSearchWorkItem(item) &&
      isXiaohongshuPublicNotesSearchWorkResult(result)) {
      artifact = await recordXiaohongshuPublicNotesExtensionWork({
        item,
        result,
        artifacts: context.xiaohongshuPublicNotesArtifacts
      });
    } else if (isXiaohongshuAccountPublicNotesWorkItem(item) &&
      isXiaohongshuAccountPublicNotesWorkResult(result)) {
      artifact = await recordXiaohongshuAccountPublicNotesExtensionWork({
        item,
        result,
        artifacts: context.xiaohongshuAccountPublicNotesArtifacts
      });
    } else if (isXiaohongshuNotePublicDetailWorkItem(item) &&
      isXiaohongshuNotePublicDetailWorkResult(result)) {
      artifact = await recordXiaohongshuNotePublicDetailExtensionWork({
        item,
        result,
        artifacts: context.xiaohongshuNotePublicDetailArtifacts
      });
    } else if (isXiaohongshuNotePublicCommentsWorkItem(item) &&
      isXiaohongshuNotePublicCommentsWorkResult(result)) {
      artifact = await recordXiaohongshuNotePublicCommentsExtensionWork({
        item, result, artifacts: context.xiaohongshuNotePublicCommentsArtifacts
      });
    } else if (isXiaohongshuNotePublicCommentRepliesWorkItem(item) &&
      isXiaohongshuNotePublicCommentRepliesWorkResult(result)) {
      artifact = await recordXiaohongshuReplyWork({ item, result, artifacts: context.xiaohongshuReplyArtifacts });
    } else {
      throw new Error('extension_work_result_capability_mismatch');
    }
    const operation = await context.workQueue.complete(authorised.browserBindingId, result, artifact);
    await context.browserBindingSafety.finish(
      authorised.browserBindingId,
      item.platform,
      result.operationId,
      result
    );
    sendJson(response, 200, { schemaVersion: 1, operation });
  } catch (error) {
    sendJson(response, extensionWorkStatus(error), { schemaVersion: 1, ok: false, error: safeErrorCode(error) });
  }
}

async function assertBindingCanAcceptWork(
  context: ExtensionWorkRouteContext,
  browserBindingId: string,
  platform: 'bilibili' | 'xiaohongshu' = 'bilibili'
): Promise<void> {
  await reconcileExpiredExtensionWork(context);
  const binding = context.pairingBroker.getBrowserBinding(browserBindingId);
  if (binding.state !== 'online') throw new Error('browser_binding_offline');
  const safety = context.browserBindingSafety.get(binding.browserBindingId, platform);
  if (safety.state === 'locked') throw new Error('browser_binding_safety_manual_unlock_required');
  if (safety.state === 'running') throw new Error('browser_binding_safety_operation_active');
}

async function authoriseExtensionRequest(
  request: IncomingMessage,
  context: ExtensionWorkRouteContext,
  pathname: string,
  body: string
) {
  return await context.pairingBroker.authoriseRequest({
    origin: header(request, 'origin'),
    extensionId: header(request, 'x-collector-extension-id'),
    extensionInstanceId: header(request, 'x-collector-extension-instance-id'),
    timestamp: header(request, 'x-collector-timestamp'),
    nonce: header(request, 'x-collector-nonce'),
    bodySha256: header(request, 'x-collector-body-sha256'),
    authorization: header(request, 'authorization'),
    method: request.method ?? 'POST',
    pathname,
    body
  });
}

export async function reconcileExpiredExtensionWork(context: ExtensionWorkRouteContext): Promise<void> {
  const expired = await context.workQueue.expire();
  for (const operation of expired) {
    await context.browserBindingSafety.expire(operation.browserBindingId, operation.platform, operation.operationId);
  }
}

function consoleDispatchInput(value: unknown):
  | { capability: 'bilibili.video_detail'; canonicalVideoUrl: string }
  | { capability: 'bilibili.native_search'; query: string }
  | { capability: 'bilibili.account_profile'; canonicalProfileUrl: string }
  | { capability: 'bilibili.account_inventory'; canonicalProfileUrl: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('extension_work_dispatch_input_invalid');
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 5 || candidate.schemaVersion !== 1 || candidate.platform !== 'bilibili' ||
    (candidate.capability !== 'bilibili.video_detail' && candidate.capability !== 'bilibili.native_search' &&
      candidate.capability !== 'bilibili.account_profile' && candidate.capability !== 'bilibili.account_inventory') ||
    candidate.executionTarget !== 'collector_work_tab' ||
    !candidate.input || typeof candidate.input !== 'object' || Array.isArray(candidate.input)
  ) throw new Error('extension_work_dispatch_input_invalid');
  const input = candidate.input as Record<string, unknown>;
  if (candidate.capability === 'bilibili.video_detail') {
    if (Object.keys(input).length !== 1 || typeof input.canonicalVideoUrl !== 'string') {
      throw new Error('extension_work_dispatch_input_invalid');
    }
    const canonicalVideoUrl = canonicalBilibiliVideoWorkUrl(input.canonicalVideoUrl);
    if (!canonicalVideoUrl) throw new Error('extension_work_dispatch_input_invalid');
    return { capability: 'bilibili.video_detail', canonicalVideoUrl };
  }
  if (candidate.capability === 'bilibili.native_search') {
    if (Object.keys(input).length !== 1 || typeof input.query !== 'string') {
      throw new Error('extension_work_dispatch_input_invalid');
    }
    return { capability: 'bilibili.native_search', query: input.query };
  }
  if (Object.keys(input).length !== 1 || typeof input.canonicalProfileUrl !== 'string') {
    throw new Error('extension_work_dispatch_input_invalid');
  }
  const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(input.canonicalProfileUrl, 'strict_input');
  if (!canonicalProfileUrl) throw new Error('extension_work_dispatch_input_invalid');
  return candidate.capability === 'bilibili.account_profile'
    ? { capability: 'bilibili.account_profile', canonicalProfileUrl }
    : { capability: 'bilibili.account_inventory', canonicalProfileUrl };
}

function unlockInput(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('browser_binding_safety_unlock_input_invalid');
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 1 || candidate.acknowledgement !== 'resume_user_owned_browser_collection') {
    throw new Error('browser_binding_safety_unlock_acknowledgement_required');
  }
}

function isExtensionWorkEndpoint(pathname: string): boolean {
  return pathname === WORK_NEXT_PATH || pathname === WORK_RESULT_PATH;
}

function extensionOrigin(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(value);
  return match && EXTENSION_ID.test(match[1]!) ? value : null;
}

function setExtensionCors(response: ServerResponse, origin: string): void {
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  response.setHeader('access-control-allow-headers', EXTENSION_CORS_HEADERS);
  response.setHeader('access-control-max-age', '300');
  response.setHeader('vary', 'Origin');
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function extensionWorkStatus(error: unknown): 400 | 401 | 409 {
  const code = safeErrorCode(error);
  if (code.startsWith('pairing_')) return 401;
  if (code.startsWith('browser_binding_safety_') || code === 'extension_work_not_claimed') return 409;
  return 400;
}

function workOperationStatus(error: unknown): 400 | 409 {
  const code = safeErrorCode(error);
  return code === 'browser_binding_offline' || code.startsWith('browser_binding_safety_') ||
    code.startsWith('extension_work_binding_')
    ? 409
    : 400;
}
