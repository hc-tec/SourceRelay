import type {
  BrowserProfilePagePoolSummary,
  PagePoolSnapshot
} from '@intelligence/collector-contracts';
import type { BrowserProfileRecord } from '../../collector-extension/src/shared/control-plane';

export interface CollectorBrowserProfileSummary {
  schemaVersion: 1;
  profile: BrowserProfileRecord;
  running: boolean;
  host: {
    hostInstanceId: string;
    hostProcessId: number;
    controllerGeneration: string | null;
    snapshotRevision: number;
    capturedAt: string;
  } | null;
  runtime: BrowserProfilePagePoolSummary | null;
}

export function profileSummary(
  profile: BrowserProfileRecord,
  snapshot: PagePoolSnapshot | null
): CollectorBrowserProfileSummary {
  const runtime = snapshot?.profiles.find((candidate) => candidate.profileId === profile.profileId) ?? null;
  return {
    schemaVersion: 1,
    profile: structuredClone(profile),
    running: runtime?.running ?? false,
    host: snapshot ? {
      hostInstanceId: snapshot.hostInstanceId,
      hostProcessId: snapshot.hostProcessId,
      controllerGeneration: snapshot.controllerGeneration,
      snapshotRevision: snapshot.snapshotRevision,
      capturedAt: snapshot.capturedAt
    } : null,
    runtime: runtime ? structuredClone(runtime) : null
  };
}
