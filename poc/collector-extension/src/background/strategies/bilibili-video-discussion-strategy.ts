import {
  BILIBILI_DISCUSSION_STRATEGY_ID,
  type BridgeJsonValue,
  type StrategyObserverBindingRequest
} from '@intelligence/collector-contracts';
import { canonicalBilibiliVideoUrl } from '../../shared/bilibili-video-url';
import {
  BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE,
  isBilibiliVideoDetailDocumentReadyMessage
} from '../../shared/bilibili-video-detail-document-bridge';
import { DISCUSSION_OBSERVER_BINDING_STORAGE_PREFIX } from '../strategy-binding-state';
import {
  captureBilibiliVideoDiscussionDom,
  type BilibiliVideoDiscussionDomSnapshot
} from './bilibili-video-discussion-dom-projection';
import { createDomOnlyDocumentObserver } from './dom-only-document-observer';

type DiscussionBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_DISCUSSION_STRATEGY_ID;
}>;

const observer = createDomOnlyDocumentObserver<DiscussionBinding, BilibiliVideoDiscussionDomSnapshot>({
  strategyId: BILIBILI_DISCUSSION_STRATEGY_ID,
  errorPrefix: 'video_discussion_strategy',
  storageKeyPrefix: DISCUSSION_OBSERVER_BINDING_STORAGE_PREFIX,
  contentScriptIdPrefix: 'collector-video-discussion-',
  contentScriptMatches: ['https://www.bilibili.com/video/*'],
  contentScriptJs: 'bilibili-video-detail-document-bridge.js',
  requiredOrigins: ['https://www.bilibili.com/*'],
  documentReadyMessage: BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE,
  isDocumentReadyMessage: isBilibiliVideoDetailDocumentReadyMessage,
  canonicalTargetUrl: (binding) => binding.target.canonicalUrl,
  canonicalObservedUrl: (value) => canonicalBilibiliVideoUrl(value, 'observed_document'),
  capture: ({ tabId, documentId }) => captureBilibiliVideoDiscussionDom(tabId, documentId),
  minimumDocumentSettleMs: 2_000,
  isReady: (dom, binding) =>
    dom.risk.verificationRequired ||
    dom.risk.rateLimited ||
    dom.risk.sourceUnavailable ||
    (dom.bvid === binding.target.bvid && dom.commentHostPresent),
  toPayload: ({ documentId, binding, dom }) => ({
    schemaVersion: 1,
    strategyId: BILIBILI_DISCUSSION_STRATEGY_ID,
    bvid: binding.target.bvid,
    documentId,
    dom
  }) as unknown as BridgeJsonValue
});

export const initialiseBilibiliVideoDiscussionDocumentBridge = observer.initialiseDocumentBridge;
export const bindBilibiliVideoDiscussionObserver = observer.bind;
export const readBilibiliVideoDiscussionObservation = observer.read;
export const diagnoseBilibiliVideoDiscussionObserver = observer.diagnose;
export const cleanupExpiredBilibiliVideoDiscussionObserverBindings = observer.cleanupExpiredBindings;
