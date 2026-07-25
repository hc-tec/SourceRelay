import type {
  BilibiliCollectionSeriesPageClickRequest,
  BilibiliCollectionSeriesPageClickResult
} from '@intelligence/collector-contracts';
import {
  executeTrustedBilibiliAccountVideoPageClick,
  validateTrustedBilibiliAccountVideoPageClickRequest
} from './trusted-bilibili-account-video-page-click.js';
import type { ManagedPageRecord } from './page-record.js';

/** Dedicated semantic entry point for a collection/series detail paginator. */
export function validateTrustedBilibiliSeriesPageClickRequest(
  request: BilibiliCollectionSeriesPageClickRequest
): void {
  validateTrustedBilibiliAccountVideoPageClickRequest(request);
  if (request.pageRole !== 'series_detail') throw new Error('bilibili_series_page_click_role_invalid');
}

export async function executeTrustedBilibiliSeriesPageClick(input: {
  record: ManagedPageRecord;
  request: BilibiliCollectionSeriesPageClickRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<BilibiliCollectionSeriesPageClickResult> {
  validateTrustedBilibiliSeriesPageClickRequest(input.request);
  return await executeTrustedBilibiliAccountVideoPageClick(input);
}
