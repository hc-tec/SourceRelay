export const PAGE_VISUAL_EVIDENCE_SCHEMA_VERSION = 1 as const;

export interface CapturePageVisualEvidenceRequest {
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  expectedRecordVersion: number;
  runId: string;
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
