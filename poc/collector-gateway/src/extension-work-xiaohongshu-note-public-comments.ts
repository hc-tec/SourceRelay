import type { XiaohongshuNotePublicCommentsWorkItem, XiaohongshuNotePublicCommentsWorkResult } from '@intelligence/collector-contracts';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';
import type { XiaohongshuNotePublicCommentsArtifactStore } from './xiaohongshu-note-public-comments-artifacts';
export async function recordXiaohongshuNotePublicCommentsExtensionWork(input: {
  item: XiaohongshuNotePublicCommentsWorkItem; result: XiaohongshuNotePublicCommentsWorkResult;
  artifacts: XiaohongshuNotePublicCommentsArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const summary = await input.artifacts.record({ item: input.item, result: input.result });
  return { artifactId: summary.artifactId,
    retrievalPath: `/v1/collect/artifacts/xiaohongshu.note.public_comments.v1/${summary.artifactId}`,
    summary: structuredClone(summary) as unknown as Record<string, unknown> };
}
