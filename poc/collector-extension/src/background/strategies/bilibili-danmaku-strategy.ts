import {
  BILIBILI_DANMAKU_STRATEGY_ID,
  type BridgeJsonValue,
  type StrategyObserverBindingRequest
} from '@intelligence/collector-contracts';
import { canonicalBilibiliVideoUrl } from '../../shared/bilibili-video-url';
import {
  BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE,
  isBilibiliVideoDetailDocumentReadyMessage
} from '../../shared/bilibili-video-detail-document-bridge';
import { DANMAKU_OBSERVER_BINDING_STORAGE_PREFIX } from '../strategy-binding-state';
import { captureBilibiliDanmakuDom } from './bilibili-danmaku-dom-projection';
import { createDomOnlyDocumentObserver } from './dom-only-document-observer';
import type { BilibiliDanmakuDomSnapshot } from '../../shared/bilibili-danmaku-capture';

type DanmakuBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_DANMAKU_STRATEGY_ID;
}>;

const observer = createDomOnlyDocumentObserver<DanmakuBinding, BilibiliDanmakuDomSnapshot>({
  strategyId: BILIBILI_DANMAKU_STRATEGY_ID,
  errorPrefix: 'bilibili_danmaku_strategy',
  storageKeyPrefix: DANMAKU_OBSERVER_BINDING_STORAGE_PREFIX,
  contentScriptIdPrefix: 'collector-bilibili-danmaku-',
  contentScriptMatches: ['https://www.bilibili.com/video/*'],
  contentScriptJs: 'bilibili-video-detail-document-bridge.js',
  requiredOrigins: ['https://www.bilibili.com/*'],
  documentReadyMessage: BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE,
  isDocumentReadyMessage: isBilibiliVideoDetailDocumentReadyMessage,
  canonicalTargetUrl: (binding) => binding.target.canonicalUrl,
  canonicalObservedUrl: (value) => canonicalBilibiliVideoUrl(value, 'observed_document'),
  capture: ({ tabId, documentId }) => captureBilibiliDanmakuDom(tabId, documentId),
  minimumDocumentSettleMs: 2_000,
  isReady: (dom, binding) =>
    dom.risk.verificationRequired ||
    dom.risk.rateLimited ||
    dom.risk.sourceUnavailable ||
    (dom.bvid === binding.target.bvid && dom.playerVisible),
  toPayload: ({ documentId, binding, dom }) => ({
    schemaVersion: 1,
    strategyId: BILIBILI_DANMAKU_STRATEGY_ID,
    bvid: binding.target.bvid,
    documentId,
    dom
  }) as unknown as BridgeJsonValue
});

export const initialiseBilibiliDanmakuDocumentBridge = observer.initialiseDocumentBridge;
export const bindBilibiliDanmakuObserver = observer.bind;
export const readBilibiliDanmakuObservation = observer.read;
export const diagnoseBilibiliDanmakuObserver = observer.diagnose;
export const cleanupExpiredBilibiliDanmakuObserverBindings = observer.cleanupExpiredBindings;
