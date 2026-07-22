/**
 * Fixed document-start signal for a Bilibili first-party search document.
 * It carries no query, DOM value or page URL; Chrome provides the exact
 * document identity to the background worker through the message sender.
 */
export const BILIBILI_NATIVE_SEARCH_DOCUMENT_READY_MESSAGE =
  'collector_bilibili_native_search_document_ready' as const;

export function isBilibiliNativeSearchDocumentReadyMessage(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' &&
    (value as { type?: unknown }).type === BILIBILI_NATIVE_SEARCH_DOCUMENT_READY_MESSAGE);
}
