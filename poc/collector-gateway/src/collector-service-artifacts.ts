import type { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import type { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import type { BilibiliAccountVideoPaginationArtifactStore } from './bilibili-account-video-pagination-artifacts';
import type { BilibiliCollectionSeriesArtifactStore } from './bilibili-collection-series-artifacts';
import type { BilibiliDanmakuArtifactStore } from './bilibili-danmaku-artifacts';
import type { BilibiliDynamicArtifactStore } from './bilibili-dynamic-artifacts';
import type { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import type { BilibiliNativeSearchBatchArtifactStore } from './bilibili-native-search-batch-artifacts';
import type { BilibiliSeriesDetailArtifactStore } from './bilibili-series-detail-artifacts';
import type { BilibiliTranscriptArtifactStore } from './bilibili-transcript-artifacts';
import type { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import type { BilibiliVideoDiscussionArtifactStore } from './bilibili-video-discussion-artifacts';
import {
  isCollectorServiceArtifactId,
  type CollectorServiceCapability
} from './collector-service-contract';

/**
 * Artifact retrieval stays capability-bound.  An API caller never gets a
 * filesystem path or an arbitrary file-read primitive.
 */
export interface CollectorServiceArtifactDependencies {
  accountProfileArtifacts: Pick<BilibiliAccountProfileArtifactStore, 'get'>;
  accountVideoInventoryArtifacts: Pick<BilibiliAccountVideoInventoryArtifactStore, 'get'>;
  accountVideoPaginationArtifacts: Pick<BilibiliAccountVideoPaginationArtifactStore, 'get'>;
  collectionSeriesArtifacts: Pick<BilibiliCollectionSeriesArtifactStore, 'get'>;
  seriesDetailArtifacts: Pick<BilibiliSeriesDetailArtifactStore, 'get'>;
  nativeSearchArtifacts: Pick<BilibiliNativeSearchArtifactStore, 'get'>;
  nativeSearchBatchArtifacts: Pick<BilibiliNativeSearchBatchArtifactStore, 'get'>;
  videoDetailArtifacts: Pick<BilibiliVideoDetailArtifactStore, 'get'>;
  discussionArtifacts: Pick<BilibiliVideoDiscussionArtifactStore, 'get'>;
  transcriptArtifacts: Pick<BilibiliTranscriptArtifactStore, 'get'>;
  danmakuArtifacts: Pick<BilibiliDanmakuArtifactStore, 'get'>;
  dynamicArtifacts: Pick<BilibiliDynamicArtifactStore, 'get'>;
}

export async function readCollectorServiceArtifact(
  capability: CollectorServiceCapability,
  artifactId: string,
  dependencies: CollectorServiceArtifactDependencies
): Promise<unknown | null> {
  if (!isCollectorServiceArtifactId(artifactId)) throw new Error('collector_service_artifact_invalid');
  switch (capability) {
    case 'bilibili.native_search':
      return await dependencies.nativeSearchArtifacts.get(artifactId);
    case 'bilibili.native_search_batch':
      return await dependencies.nativeSearchBatchArtifacts.get(artifactId);
    case 'bilibili.account_profile':
      return await dependencies.accountProfileArtifacts.get(artifactId);
    case 'bilibili.account_inventory':
      return await dependencies.accountVideoInventoryArtifacts.get(artifactId);
    case 'bilibili.account_inventory.pagination':
      return await dependencies.accountVideoPaginationArtifacts.get(artifactId);
    case 'bilibili.video_detail':
      return await dependencies.videoDetailArtifacts.get(artifactId);
    case 'bilibili.transcript':
      return await dependencies.transcriptArtifacts.get(artifactId);
    case 'bilibili.discussion':
      return await dependencies.discussionArtifacts.get(artifactId);
    case 'bilibili.danmaku':
      return await dependencies.danmakuArtifacts.get(artifactId);
    case 'bilibili.dynamic':
      return await dependencies.dynamicArtifacts.get(artifactId);
    case 'bilibili.collection_series.overview':
      return await dependencies.collectionSeriesArtifacts.get(artifactId);
    case 'bilibili.collection_series.detail':
      return await dependencies.seriesDetailArtifacts.get(artifactId);
  }
}
