import { BILIBILI_ACCOUNT_VIDEO_INVENTORY_DOCUMENT_READY_MESSAGE } from '../shared/bilibili-account-video-inventory-document-bridge';

// No page values are read here. The background worker receives Chrome's
// sender.documentId and later requests a fixed, bounded DOM projection.
void chrome.runtime.sendMessage({ type: BILIBILI_ACCOUNT_VIDEO_INVENTORY_DOCUMENT_READY_MESSAGE }).catch(() => undefined);
