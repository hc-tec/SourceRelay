import {
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  canonicalBilibiliNativeSearchUrl,
  type BridgeJsonValue,
  type StrategyObserverBindingRequest
} from '@intelligence/collector-contracts';
import {
  BILIBILI_NATIVE_SEARCH_DOCUMENT_READY_MESSAGE,
  isBilibiliNativeSearchDocumentReadyMessage
} from '../../shared/bilibili-native-search-document-bridge';
import { NATIVE_SEARCH_OBSERVER_BINDING_STORAGE_PREFIX } from '../strategy-binding-state';
import {
  captureBilibiliNativeSearchDom,
  type BilibiliNativeSearchDomSnapshot
} from './bilibili-native-search-dom-projection';
import { createDomOnlyDocumentObserver } from './dom-only-document-observer';

type NativeSearchBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_NATIVE_SEARCH_STRATEGY_ID;
}>;

const observer = createDomOnlyDocumentObserver<NativeSearchBinding, BilibiliNativeSearchDomSnapshot>({
  strategyId: BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  errorPrefix: 'native_search_strategy',
  storageKeyPrefix: NATIVE_SEARCH_OBSERVER_BINDING_STORAGE_PREFIX,
  contentScriptIdPrefix: 'collector-native-search-',
  contentScriptMatches: ['https://search.bilibili.com/*'],
  contentScriptJs: 'bilibili-native-search-document-bridge.js',
  requiredOrigins: ['https://search.bilibili.com/*'],
  documentReadyMessage: BILIBILI_NATIVE_SEARCH_DOCUMENT_READY_MESSAGE,
  isDocumentReadyMessage: isBilibiliNativeSearchDocumentReadyMessage,
  canonicalTargetUrl: (binding) => binding.target.canonicalUrl,
  canonicalObservedUrl: (value) => canonicalBilibiliNativeSearchUrl(value, 'observed_document'),
  capture: ({ tabId, documentId }) => captureBilibiliNativeSearchDom(tabId, documentId),
  isReady: (dom) =>
    dom.risk.verificationRequired ||
    dom.risk.rateLimited ||
    dom.risk.sourceUnavailable ||
    (dom.searchInputVisible && (dom.resultListVisible || dom.emptyStateVisible)),
  toPayload: ({ documentId, binding, dom }) => ({
    schemaVersion: 1,
    strategyId: BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
    documentId,
    dom
  }) as unknown as BridgeJsonValue
});

export const initialiseBilibiliNativeSearchDocumentBridge = observer.initialiseDocumentBridge;
export const bindBilibiliNativeSearchObserver = observer.bind;
export const readBilibiliNativeSearchObservation = observer.read;
export const diagnoseBilibiliNativeSearchObserver = observer.diagnose;
export const cleanupExpiredBilibiliNativeSearchObserverBindings = observer.cleanupExpiredBindings;
