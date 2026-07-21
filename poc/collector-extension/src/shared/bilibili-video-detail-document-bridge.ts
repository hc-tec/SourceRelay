/**
 * A fixed source-specific handshake. The content script sends no page data;
 * Chrome supplies tab/document identity through the message sender, allowing
 * the worker to bind the later DOM projection to one exact document.
 */
export const BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE =
  'collector_bilibili_video_detail_document_ready' as const;

export interface BilibiliVideoDetailDocumentReadyMessage {
  type: typeof BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE;
}

export function isBilibiliVideoDetailDocumentReadyMessage(
  value: unknown
): value is BilibiliVideoDetailDocumentReadyMessage {
  return Boolean(value && typeof value === 'object' &&
    (value as { type?: unknown }).type === BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE);
}
