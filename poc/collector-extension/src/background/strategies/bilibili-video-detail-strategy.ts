import {
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  type BridgeJsonValue,
  type StrategyObserverBindingRequest
} from '@intelligence/collector-contracts';
import { canonicalBilibiliVideoUrl } from '../../shared/bilibili-video-url';
import {
  BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE,
  isBilibiliVideoDetailDocumentReadyMessage
} from '../../shared/bilibili-video-detail-document-bridge';
import { VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX } from '../strategy-binding-state';
import {
  captureBilibiliVideoDetailDom,
  type BilibiliVideoDetailDomSnapshot
} from './bilibili-video-detail-dom-projection';
import { createDomOnlyDocumentObserver } from './dom-only-document-observer';

type VideoDetailBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_VIDEO_DETAIL_STRATEGY_ID;
}>;

const observer = createDomOnlyDocumentObserver<VideoDetailBinding, BilibiliVideoDetailDomSnapshot>({
  strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  errorPrefix: 'video_detail_strategy',
  storageKeyPrefix: VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX,
  contentScriptIdPrefix: 'collector-video-detail-',
  contentScriptMatches: ['https://www.bilibili.com/video/*'],
  contentScriptJs: 'bilibili-video-detail-document-bridge.js',
  requiredOrigins: ['https://www.bilibili.com/*'],
  documentReadyMessage: BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE,
  isDocumentReadyMessage: isBilibiliVideoDetailDocumentReadyMessage,
  canonicalTargetUrl: (binding) => binding.target.canonicalUrl,
  canonicalObservedUrl: (value) => canonicalBilibiliVideoUrl(value, 'observed_document'),
  capture: ({ tabId, documentId }) => captureBilibiliVideoDetailDom(tabId, documentId),
  // The observed desktop page can replace its first same-target document a
  // little after DOMContentLoaded.  Three seconds is a source-specific first
  // screen stability window, not an interaction delay or a retry budget.
  minimumDocumentSettleMs: 3_000,
  isReady: (dom, binding) =>
    dom.risk.verificationRequired ||
    dom.risk.rateLimited ||
    dom.risk.sourceUnavailable ||
    (dom.bvid === binding.target.bvid && dom.titleVisible && dom.playerVisible &&
      Boolean(dom.title)),
  toPayload: ({ documentId, binding, dom }) => ({
    schemaVersion: 1,
    strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
    bvid: binding.target.bvid,
    documentId,
    dom
  }) as unknown as BridgeJsonValue
});

export const initialiseBilibiliVideoDetailDocumentBridge = observer.initialiseDocumentBridge;
export const bindBilibiliVideoDetailObserver = observer.bind;
export const readBilibiliVideoDetailObservation = observer.read;
export const diagnoseBilibiliVideoDetailObserver = observer.diagnose;
export const cleanupExpiredBilibiliVideoDetailObserverBindings = observer.cleanupExpiredBindings;
