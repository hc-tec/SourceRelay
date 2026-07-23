import type {
  BilibiliNativeSearchItem,
  BilibiliNativeSearchProjection
} from './bilibili-native-search-contract';

export interface BilibiliNativeSearchPageProjection {
  page: number;
  projection: BilibiliNativeSearchProjection;
}

export interface BilibiliNativeSearchPaginationMerge {
  pages: number[];
  capturedPages: number;
  uniqueItems: BilibiliNativeSearchItem[];
  duplicateBvids: string[];
  duplicateCount: number;
  unresolvedCardCount: number;
  partial: boolean;
}

/**
 * Merges independently captured, bounded search pages without pretending that
 * a page number implies uniqueness. Bilibili can return an overlapping window
 * while new results are being published, so page-level artifacts must be
 * deduplicated by the stable BVID before a batch is handed to an analyst.
 */
export function mergeBilibiliNativeSearchPages(
  pages: readonly BilibiliNativeSearchPageProjection[]
): BilibiliNativeSearchPaginationMerge {
  const ordered = [...pages].sort((left, right) => left.page - right.page);
  const seen = new Set<string>();
  const duplicateSet = new Set<string>();
  const uniqueItems: BilibiliNativeSearchItem[] = [];
  let duplicateCount = 0;
  let unresolvedCardCount = 0;
  for (const entry of ordered) {
    unresolvedCardCount += entry.projection.unresolvedCardCount;
    for (const item of entry.projection.items) {
      if (seen.has(item.bvid)) {
        duplicateSet.add(item.bvid);
        duplicateCount += 1;
        continue;
      }
      seen.add(item.bvid);
      uniqueItems.push(structuredClone(item));
    }
  }
  return {
    pages: ordered.map((entry) => entry.page),
    capturedPages: ordered.length,
    uniqueItems,
    duplicateBvids: [...duplicateSet],
    duplicateCount,
    unresolvedCardCount,
    partial: duplicateCount > 0 || unresolvedCardCount > 0
  };
}
