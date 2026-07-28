import type {
  XiaohongshuAccountPublicNotesWorkItem,
  XiaohongshuAccountPublicNotesWorkResult
} from '@intelligence/collector-contracts';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';
import type { XiaohongshuAccountPublicNotesArtifactStore } from './xiaohongshu-account-public-notes-artifacts';

export async function recordXiaohongshuAccountPublicNotesExtensionWork(input: {
  item: XiaohongshuAccountPublicNotesWorkItem;
  result: XiaohongshuAccountPublicNotesWorkResult;
  artifacts: XiaohongshuAccountPublicNotesArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const summary = await input.artifacts.record({ item: input.item, result: input.result });
  return {
    artifactId: summary.artifactId,
    retrievalPath: `/v1/collect/artifacts/xiaohongshu.account.public_notes.v1/${summary.artifactId}`,
    summary: structuredClone(summary) as unknown as Record<string, unknown>
  };
}
