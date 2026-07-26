export const PAGE_VISUAL_EVIDENCE_SCHEMA_VERSION = 1 as const;

export interface CapturePageVisualEvidenceRequest {
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  expectedRecordVersion: number;
  runId: string;
}

/**
 * Read-only visual inspection for a page deliberately retained for a person
 * to review. This is intentionally narrower than a lease: it cannot navigate,
 * interact, bind an observer, or disclose page URL/DOM/network state.
 */
export interface CaptureRetainedPageVisualEvidenceRequest {
  profileId: string;
  pageAlias: string;
  expectedRecordVersion: number;
}

export interface PageVisualEvidence {
  schemaVersion: typeof PAGE_VISUAL_EVIDENCE_SCHEMA_VERSION;
  evidenceId: string;
  pageAlias: string;
  documentGeneration: number;
  routeGeneration: number;
  capturedAt: string;
  viewport: {
    cssWidth: number;
    cssHeight: number;
    devicePixelRatio: number;
    scrollX: number;
    scrollY: number;
  };
  screenshot: {
    fileName: string;
    byteLength: number;
    sha256: string;
  };
}
