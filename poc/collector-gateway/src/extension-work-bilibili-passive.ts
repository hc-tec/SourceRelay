import type {
  BilibiliPassiveExtensionWorkItem,
  BilibiliPassiveExtensionWorkResult
} from '@intelligence/collector-contracts';
import {
  ExtensionWorkPassiveArtifactStore,
  type PassiveDirectCapability
} from './extension-work-passive-artifacts';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';

/** Persist a direct passive DOM run without importing any legacy Host model. */
export async function recordBilibiliPassiveExtensionWork(input: {
  item: BilibiliPassiveExtensionWorkItem;
  result: BilibiliPassiveExtensionWorkResult;
  artifacts: ExtensionWorkPassiveArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  if (input.item.capability !== input.result.capability) {
    throw new Error('extension_work_passive_artifact_capability_mismatch');
  }
  const summary = await input.artifacts.record({ item: input.item, result: input.result });
  return {
    artifactId: summary.artifactId,
    retrievalPath: `/v1/collect/artifacts/${input.item.capability}/${summary.artifactId}`,
    summary: structuredClone(summary) as unknown as Record<string, unknown>
  };
}

export function isPassiveDirectCapability(value: string): value is PassiveDirectCapability {
  return value === 'bilibili.dynamic' || value === 'bilibili.collection_series.overview' ||
    value === 'bilibili.collection_series.detail' || value === 'bilibili.danmaku';
}
