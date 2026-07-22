/**
 * Fixed document-start readiness signal for a Bilibili account home page.
 * It carries no account text, URL, DOM or authentication data; Chrome adds
 * the exact tab/document identity to the background message sender.
 */
export const BILIBILI_ACCOUNT_PROFILE_DOCUMENT_READY_MESSAGE =
  'collector_bilibili_account_profile_document_ready' as const;

export function isBilibiliAccountProfileDocumentReadyMessage(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' &&
    (value as { type?: unknown }).type === BILIBILI_ACCOUNT_PROFILE_DOCUMENT_READY_MESSAGE);
}
