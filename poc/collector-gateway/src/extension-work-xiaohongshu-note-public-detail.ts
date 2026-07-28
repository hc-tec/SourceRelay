import type {
  XiaohongshuNotePublicDetailWorkItem,
  XiaohongshuNotePublicDetailWorkResult
} from '@intelligence/collector-contracts';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';
import type { XiaohongshuNotePublicDetailArtifactStore } from './xiaohongshu-note-public-detail-artifacts';

export async function recordXiaohongshuNotePublicDetailExtensionWork(input: {
  item: XiaohongshuNotePublicDetailWorkItem;
  result: XiaohongshuNotePublicDetailWorkResult;
  artifacts: XiaohongshuNotePublicDetailArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const summary = await input.artifacts.record({ item: input.item, result: input.result });
  return {
    artifactId: summary.artifactId,
    retrievalPath: `/v1/collect/artifacts/xiaohongshu.note.public_detail.v1/${summary.artifactId}`,
    summary: structuredClone(summary) as unknown as Record<string, unknown>
  };
}
