import type {
  BilibiliAccountVideoPageClickRequest,
  BilibiliAccountVideoPageClickResult
} from './bilibili-account-video-pagination.js';

/**
 * The detail paginator deliberately shares the audited browser-input wire
 * shape.  The pageRole discriminator prevents it from being sent to the
 * account-inventory path while keeping one trusted-input implementation.
 */
export type BilibiliCollectionSeriesPageClickRequest =
  Omit<BilibiliAccountVideoPageClickRequest, 'pageRole'> & { pageRole: 'series_detail' };
export type BilibiliCollectionSeriesPageClickResult = BilibiliAccountVideoPageClickResult;
export const BILIBILI_COLLECTION_SERIES_PAGE_CLICK_SCHEMA_VERSION = 2 as const;
