import { BILIBILI_NATIVE_SEARCH_DOCUMENT_READY_MESSAGE } from '../shared/bilibili-native-search-document-bridge';

// No DOM or search phrase is read here. This one-shot document-start signal
// lets the worker bind its later fixed DOM projection to Chrome's document ID.
void chrome.runtime.sendMessage({ type: BILIBILI_NATIVE_SEARCH_DOCUMENT_READY_MESSAGE }).catch(() => undefined);
