import type {
  BilibiliNativeSearchBatchWorkItem,
  BilibiliNativeSearchBatchWorkResult
} from '@intelligence/collector-contracts';
import { ExtensionWorkNativeSearchBatchArtifactStore } from './extension-work-native-search-batch-artifacts';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';

/** Persist the direct two-page projection without importing legacy Host batch artifacts. */
export async function recordBilibiliNativeSearchBatchExtensionWork(input: {
  item: BilibiliNativeSearchBatchWorkItem;
  result: BilibiliNativeSearchBatchWorkResult;
  artifacts: ExtensionWorkNativeSearchBatchArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const summary = await input.artifacts.record({ item: input.item, result: input.result });
  return {
    artifactId: summary.artifactId,
    retrievalPath: `/v1/collect/artifacts/bilibili.native_search_batch/${summary.artifactId}`,
    summary: structuredClone(summary) as unknown as Record<string, unknown>
  };
}
