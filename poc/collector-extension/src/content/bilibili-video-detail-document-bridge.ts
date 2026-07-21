import { BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE } from '../shared/bilibili-video-detail-document-bridge';

// No DOM is read here. This one-shot document-start handshake lets the
// background worker receive Chrome's sender.documentId before it asks the
// isolated-world projector for any bounded public detail fields.
void chrome.runtime.sendMessage({ type: BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE }).catch(() => undefined);
