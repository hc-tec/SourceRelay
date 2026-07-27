import type {
  BilibiliVideoDiscussionUserSelectedTabWorkItem,
  BilibiliVideoDiscussionUserSelectedTabWorkResult
} from '@intelligence/collector-contracts';
import { ExtensionWorkPassiveArtifactStore } from './extension-work-passive-artifacts';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';

/**
 * Persist the zero-navigation comments projection in the direct-only artifact
 * lane. It deliberately has no dependency on the legacy discussion runner,
 * Browser Host, Profile, Playwright, or response-body storage.
 */
export async function recordBilibiliDiscussionUserSelectedTabExtensionWork(input: {
  item: BilibiliVideoDiscussionUserSelectedTabWorkItem;
  result: BilibiliVideoDiscussionUserSelectedTabWorkResult;
  artifacts: ExtensionWorkPassiveArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const summary = await input.artifacts.record({ item: input.item, result: input.result });
  return {
    artifactId: summary.artifactId,
    retrievalPath: `/v1/collect/artifacts/bilibili.discussion/${summary.artifactId}`,
    summary: structuredClone(summary) as unknown as Record<string, unknown>
  };
}
