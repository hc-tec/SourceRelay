import type { BilibiliAccountProfileHostRunner } from './bilibili-account-profile-host-runner';
import { bilibiliAccountProfileInput } from './bilibili-account-profile-contract';
import type { BilibiliAccountVideoInventoryHostRunner } from './bilibili-account-video-inventory-host-runner';
import { bilibiliAccountVideoInventoryInput } from './bilibili-account-video-inventory-contract';
import type { BilibiliAccountVideoPaginationHostRunner } from './bilibili-account-video-pagination-host-runner';
import { bilibiliAccountVideoPaginationInput } from './bilibili-account-video-pagination-contract';
import { bilibiliCollectionSeriesInput } from './bilibili-collection-series-contract';
import type { BilibiliCollectionSeriesHostRunner } from './bilibili-collection-series-host-runner';
import { bilibiliDanmakuInput } from './bilibili-danmaku-contract';
import type { BilibiliDanmakuHostRunner } from './bilibili-danmaku-host-runner';
import { bilibiliDynamicInput } from './bilibili-dynamic-contract';
import type { BilibiliDynamicHostRunner } from './bilibili-dynamic-host-runner';
import { BILIBILI_DYNAMIC_TWO_PAGE_LIMIT } from './bilibili-dynamic-two-page-plan';
import type { BilibiliNativeSearchBatchHostRunner } from './bilibili-native-search-batch-host-runner';
import { bilibiliNativeSearchBatchInput } from './bilibili-native-search-batch-contract';
import type { BilibiliNativeSearchHostRunner } from './bilibili-native-search-host-runner';
import { bilibiliNativeSearchInput } from './bilibili-native-search-contract';
import { bilibiliSeriesDetailInput } from './bilibili-series-detail-contract';
import type { BilibiliSeriesDetailHostRunner } from './bilibili-series-detail-host-runner';
import { bilibiliTranscriptInput } from './bilibili-transcript-contract';
import type { BilibiliTranscriptHostRunner } from './bilibili-transcript-host-runner';
import { bilibiliVideoDetailInput } from './bilibili-video-detail-contract';
import type { BilibiliVideoDetailHostRunner } from './bilibili-video-detail-host-runner';
import { bilibiliVideoDiscussionInput } from './bilibili-video-discussion-contract';
import type { BilibiliVideoDiscussionHostRunner } from './bilibili-video-discussion-host-runner';
import {
  COLLECTOR_SERVICE_SCHEMA_VERSION,
  collectorServiceResult,
  type CollectorServiceRequest,
  type CollectorServiceResult
} from './collector-service-contract';
import type { BrowserProfileRegistry } from './profiles';

/**
 * The service facade deliberately accepts only registered collection intents.
 * It does not provide a generic browser, selector, script, URL, or Network
 * execution API to callers.
 */
export interface CollectorServiceDependencies {
  profileRegistry: Pick<BrowserProfileRegistry, 'get' | 'list'>;
  accountProfileRunner: Pick<BilibiliAccountProfileHostRunner, 'run'>;
  accountVideoInventoryRunner: Pick<BilibiliAccountVideoInventoryHostRunner, 'run'>;
  accountVideoPaginationRunner: Pick<BilibiliAccountVideoPaginationHostRunner, 'run'>;
  collectionSeriesRunner: Pick<BilibiliCollectionSeriesHostRunner, 'run'>;
  seriesDetailRunner: Pick<BilibiliSeriesDetailHostRunner, 'run'>;
  nativeSearchRunner: Pick<BilibiliNativeSearchHostRunner, 'run'>;
  nativeSearchBatchRunner: Pick<BilibiliNativeSearchBatchHostRunner, 'run'>;
  videoDetailRunner: Pick<BilibiliVideoDetailHostRunner, 'run'>;
  discussionRunner: Pick<BilibiliVideoDiscussionHostRunner, 'run'>;
  transcriptRunner: Pick<BilibiliTranscriptHostRunner, 'run'>;
  danmakuRunner: Pick<BilibiliDanmakuHostRunner, 'run'>;
  dynamicRunner: Pick<BilibiliDynamicHostRunner, 'run'>;
}

export interface CollectorServiceProfileDescriptor {
  schemaVersion: typeof COLLECTOR_SERVICE_SCHEMA_VERSION;
  profileId: string;
  platform: 'bilibili';
  accountLabel: string;
}

export function collectorServiceProfiles(
  profileRegistry: Pick<BrowserProfileRegistry, 'list'>
): CollectorServiceProfileDescriptor[] {
  return profileRegistry.list()
    .filter((profile) =>
      profile.kind === 'collection' &&
      profile.account.category === 'user_managed' &&
      profile.platform === 'bilibili'
    )
    .map((profile) => ({
      schemaVersion: COLLECTOR_SERVICE_SCHEMA_VERSION,
      profileId: profile.profileId,
      platform: 'bilibili',
      accountLabel: profile.account.label
    }));
}

export async function dispatchCollectorServiceRequest(
  request: CollectorServiceRequest,
  dependencies: CollectorServiceDependencies
): Promise<CollectorServiceResult> {
  requireCompatibleCollectionProfile(request, dependencies);
  switch (request.capability) {
    case 'bilibili.native_search': {
      const input = bilibiliNativeSearchInput(request.input);
      return collectorServiceResult(request, await dependencies.nativeSearchRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.native_search_batch': {
      const input = bilibiliNativeSearchBatchInput({
        ...request.input,
        profileId: request.profileId
      });
      return collectorServiceResult(request, await dependencies.nativeSearchBatchRunner.run(input));
    }
    case 'bilibili.account_profile': {
      const input = bilibiliAccountProfileInput(request.input);
      return collectorServiceResult(request, await dependencies.accountProfileRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.account_inventory': {
      const input = bilibiliAccountVideoInventoryInput(request.input);
      return collectorServiceResult(request, await dependencies.accountVideoInventoryRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.account_inventory.pagination': {
      const input = bilibiliAccountVideoPaginationInput(request.input);
      return collectorServiceResult(request, await dependencies.accountVideoPaginationRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.video_detail': {
      const input = bilibiliVideoDetailInput(request.input);
      return collectorServiceResult(request, await dependencies.videoDetailRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.transcript': {
      const input = bilibiliTranscriptInput(request.input);
      return collectorServiceResult(request, await dependencies.transcriptRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.discussion': {
      const input = bilibiliVideoDiscussionInput(request.input);
      return collectorServiceResult(request, await dependencies.discussionRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.danmaku': {
      const input = bilibiliDanmakuInput(request.input);
      return collectorServiceResult(request, await dependencies.danmakuRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.dynamic': {
      const input = fixedTwoPageDynamicInput(request.input);
      return collectorServiceResult(request, await dependencies.dynamicRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.collection_series.overview': {
      const input = bilibiliCollectionSeriesInput(request.input);
      return collectorServiceResult(request, await dependencies.collectionSeriesRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
    case 'bilibili.collection_series.detail': {
      const input = bilibiliSeriesDetailInput(request.input);
      return collectorServiceResult(request, await dependencies.seriesDetailRunner.run({
        profileId: request.profileId,
        ...input
      }));
    }
  }
}

function requireCompatibleCollectionProfile(
  request: CollectorServiceRequest,
  dependencies: CollectorServiceDependencies
): void {
  const profile = dependencies.profileRegistry.get(request.profileId);
  if (profile.platform !== request.platform) throw new Error('collector_service_profile_platform_mismatch');
  if (profile.kind !== 'collection' || profile.account.category !== 'user_managed') {
    throw new Error('collector_service_collection_profile_required');
  }
}

function fixedTwoPageDynamicInput(input: Record<string, unknown>): { canonicalProfileUrl: string } {
  if (Object.keys(input).length !== 1 || typeof input.canonicalProfileUrl !== 'string') {
    throw new Error('bilibili_dynamic_input_invalid');
  }
  const normalized = bilibiliDynamicInput({
    canonicalProfileUrl: input.canonicalProfileUrl,
    maxPages: BILIBILI_DYNAMIC_TWO_PAGE_LIMIT
  });
  return { canonicalProfileUrl: normalized.canonicalProfileUrl };
}
