/**
 * Fixed document-start readiness signal for the Bilibili account video list.
 * It carries no DOM, URL, query or account values; Chrome supplies the exact
 * document identity to the background worker through the message sender.
 */
export const BILIBILI_ACCOUNT_VIDEO_INVENTORY_DOCUMENT_READY_MESSAGE =
  'collector_bilibili_account_video_inventory_document_ready' as const;

export function isBilibiliAccountVideoInventoryDocumentReadyMessage(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' &&
    (value as { type?: unknown }).type === BILIBILI_ACCOUNT_VIDEO_INVENTORY_DOCUMENT_READY_MESSAGE);
}
