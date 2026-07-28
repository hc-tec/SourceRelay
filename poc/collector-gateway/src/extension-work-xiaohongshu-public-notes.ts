import type {
  XiaohongshuPublicNotesSearchWorkItem,
  XiaohongshuPublicNotesSearchWorkResult
} from '@intelligence/collector-contracts';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';
import type { XiaohongshuPublicNotesArtifactStore } from './xiaohongshu-public-notes-artifacts';

export async function recordXiaohongshuPublicNotesExtensionWork(input: {
  item: XiaohongshuPublicNotesSearchWorkItem;
  result: XiaohongshuPublicNotesSearchWorkResult;
  artifacts: XiaohongshuPublicNotesArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const summary = await input.artifacts.record({ item: input.item, result: input.result });
  return {
    artifactId: summary.artifactId,
    retrievalPath: `/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/${summary.artifactId}`,
    summary: structuredClone(summary) as unknown as Record<string, unknown>
  };
}
