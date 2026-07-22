import type { PageScrollPosition } from './page-scroll.js';
import type { PageVisualEvidence } from './page-visual-evidence.js';

/**
 * This is intentionally a single source-specific browser action, not a
 * generic click protocol. It only advances the visible Bilibili account-video
 * paginator by one adjacent page; the Host owns all selector, hover, bounds
 * and Network semantics.
 */
export const BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION = 2 as const;
export const BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_TARGET_PAGE = 2 as const;
export const BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MIN_ACTIVE_PAGE = 1 as const;
export const BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE = 20 as const;
export const BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_NETWORK_OBSERVATIONS = 3 as const;

export interface BilibiliAccountVideoPageClickRequest {
  schemaVersion: typeof BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  /** The active page observed by the Gateway immediately before this click. */
  expectedActivePage: number;
  /** Must equal `expectedActivePage + 1`; arbitrary page jumps are rejected. */
  targetPage: number;
  timeoutMs: number;
}

export interface BilibiliAccountVideoPageClickBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Metadata only: no URL query, header, request body, or response body. */
export interface BilibiliAccountVideoPageClickNetworkObservation {
  method: 'GET';
  origin: 'https://api.bilibili.com';
  path: '/x/space/wbi/arc/search';
  status: number;
  receivedAt: string;
}

export interface BilibiliAccountVideoPageClickResult {
  schemaVersion: typeof BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  recordVersion: number;
  documentGeneration: number;
  routeGeneration: number;
  completedAt: string;
  clickAttempted: true;
  scrollToControl: {
    attempted: boolean;
    before: PageScrollPosition;
    after: PageScrollPosition;
  };
  before: {
    activePage: number;
    targetPage: number;
    targetBounds: BilibiliAccountVideoPageClickBounds;
    pointerHitTarget: true;
    pointerHoveredTarget: true;
    visualEvidence: PageVisualEvidence;
  };
  after: {
    activePage: number | null;
    renderedCardCount: number;
    scroll: PageScrollPosition;
    neutralPointer: {
      x: number;
      y: number;
      targetKind: 'non_media_non_interactive';
    };
    visualEvidence: PageVisualEvidence;
  };
  network: {
    observations: BilibiliAccountVideoPageClickNetworkObservation[];
  };
}
