import { setTimeout as delay } from 'node:timers/promises';
import type { TranscriptCapabilityValidationRunSnapshot } from '../../collector-extension/src/shared/protocol';

export function transcriptValidationSnapshot(
  value: unknown,
  runId: string,
  profileId: string,
  extensionVersion: string
): TranscriptCapabilityValidationRunSnapshot {
  if (!value || typeof value !== 'object') throw new Error('transcript_validation_extension_response_missing');
  const response = value as { ok?: unknown; validation?: unknown; error?: unknown };
  if (response.ok !== true) {
    const error = typeof response.error === 'string' && /^[a-z0-9_]{1,100}$/.test(response.error)
      ? response.error
      : 'transcript_validation_extension_rejected';
    throw new Error(error);
  }
  if (!response.validation || typeof response.validation !== 'object') {
    throw new Error('transcript_validation_extension_snapshot_missing');
  }
  const validation = response.validation as Partial<TranscriptCapabilityValidationRunSnapshot>;
  if (validation.schemaVersion !== 1) throw new Error('transcript_validation_extension_schema_mismatch');
  if (validation.collectorVersion !== extensionVersion) throw new Error('transcript_validation_extension_version_mismatch');
  if (validation.runId !== runId) throw new Error('transcript_validation_extension_run_mismatch');
  if (validation.profileId !== profileId) throw new Error('transcript_validation_extension_profile_mismatch');
  if (validation.platform !== 'bilibili') throw new Error('transcript_validation_extension_platform_mismatch');
  if (validation.accountCategory !== 'user_managed') throw new Error('transcript_validation_extension_account_mismatch');
  if (validation.evidenceObjective !== 'transcript_read') throw new Error('transcript_validation_extension_objective_mismatch');
  if (!Array.isArray(validation.captures) || validation.captures.length > 3) {
    throw new Error('transcript_validation_extension_captures_invalid');
  }
  if (
    !validation.safeguards ||
    validation.safeguards.admissionEligible !== false ||
    validation.safeguards.productionResponseRoutes !== 'unchanged_empty'
  ) throw new Error('transcript_validation_extension_safeguards_invalid');
  if (
    validation.state !== 'navigating' &&
    validation.state !== 'collecting' &&
    validation.state !== 'completed' &&
    validation.state !== 'inconclusive' &&
    validation.state !== 'failed'
  ) throw new Error('transcript_validation_extension_state_invalid');
  return validation as TranscriptCapabilityValidationRunSnapshot;
}

export async function runTranscriptValidationControlLoop(input: {
  runId: string;
  profileId: string;
  canonicalUrl: string;
  extensionVersion: string;
  sendMessage: (message: object) => Promise<unknown>;
  pollingDelayMs?: number;
  maximumPollAttempts?: number;
  recoveryAttempts?: number;
}): Promise<TranscriptCapabilityValidationRunSnapshot> {
  const pollingDelayMs = input.pollingDelayMs ?? 500;
  const maximumPollAttempts = input.maximumPollAttempts ?? 100;
  const recoveryAttempts = input.recoveryAttempts ?? 10;
  let snapshot: TranscriptCapabilityValidationRunSnapshot | null = null;
  try {
    snapshot = transcriptValidationSnapshot(await input.sendMessage({
      type: 'collector.startTranscriptCapabilityValidation',
      runId: input.runId,
      profileId: input.profileId,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      canonicalUrl: input.canonicalUrl
    }), input.runId, input.profileId, input.extensionVersion);
  } catch (startError) {
    // The platform-starting message is submitted at most once. Recovery is
    // restricted to local reads of the same run ID.
    for (let attempt = 0; attempt < recoveryAttempts && snapshot === null; attempt += 1) {
      await delay(pollingDelayMs);
      snapshot = await input.sendMessage({
        type: 'collector.getTranscriptCapabilityValidation',
        runId: input.runId
      }).then(
        (value) => transcriptValidationSnapshot(value, input.runId, input.profileId, input.extensionVersion),
        () => null
      ).catch(() => null);
    }
    if (!snapshot) throw startError;
  }
  for (let attempt = 0; attempt < maximumPollAttempts; attempt += 1) {
    if (snapshot.state === 'completed' || snapshot.state === 'inconclusive' || snapshot.state === 'failed') {
      return snapshot;
    }
    await delay(pollingDelayMs);
    snapshot = transcriptValidationSnapshot(await input.sendMessage({
      type: 'collector.getTranscriptCapabilityValidation',
      runId: input.runId
    }), input.runId, input.profileId, input.extensionVersion);
  }
  throw new Error('transcript_validation_gateway_wait_timed_out');
}
