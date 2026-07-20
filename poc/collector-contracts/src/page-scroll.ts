/**
 * A deliberately narrow browser-input contract.  It is not a generic input
 * surface: the Browser Host chooses the pointer position and supports one
 * bounded, downward wheel gesture only.
 */
export const PAGE_SCROLL_RESULT_SCHEMA_VERSION = 1 as const;

export interface ScrollPageRequest {
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  deltaY: number;
  timeoutMs: number;
}

export interface PageScrollPosition {
  scrollX: number;
  scrollY: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface PageScrollResult {
  schemaVersion: typeof PAGE_SCROLL_RESULT_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  recordVersion: number;
  documentGeneration: number;
  routeGeneration: number;
  completedAt: string;
  before: PageScrollPosition;
  after: PageScrollPosition;
}
