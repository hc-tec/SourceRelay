import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BrowserHostClient } from '../dist/client.js';

const pocRoot = resolve(import.meta.dirname, '..', '..');
const endpointPath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'host', 'endpoint.json');
const profileId = 'xiaohongshu_validation';
const timeline = [];
let client = null;
let acquired = null;
let released = false;

try {
  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-note-overlay-recon');
  const profile = profileFrom(await snapshot());
  if (!profile.running || profile.leasedPages !== 0) throw new Error('xiaohongshu_note_overlay_profile_not_ready');
  const runId = randomUUID();
  acquired = await client.command({
    type: 'adopt_xiaohongshu_validation_public_page',
    request: {
      schemaVersion: 1,
      profileId,
      taskId: 'xiaohongshu-note-overlay-recon',
      runId,
      leaseDurationMs: 60_000
    }
  });
  record('page_acquired', { pageAlias: acquired.page.pageAlias, selection: acquired.selection });
  const result = await client.command({
    type: 'recon_xiaohongshu_note_overlay',
    request: {
      schemaVersion: 1,
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      runId,
      expectedRecordVersion: acquired.page.recordVersion,
      expectedDocumentGeneration: acquired.page.documentGeneration,
      actionId: randomUUID(),
      timeoutMs: 25_000
    }
  }, { timeoutMs: 30_000 });
  record('recon_completed', {
    state: result.state,
    semanticActionAttempted: result.semanticAction.attempted,
    detailTargetMode: result.before.detailTarget?.targetMode ?? null,
    overlayVisible: result.after?.overlayVisible ?? false,
    sameDocument: result.after?.sameDocument ?? false,
    authorTargetMode: result.after?.authorTarget?.targetMode ?? null,
    networkResponses: result.network.responses.length
  });
  const retained = await release('retained_for_review');
  process.stdout.write(`${JSON.stringify({
    ok: result.state === 'completed',
    runId,
    objective: 'prove_same_document_note_detail_overlay_and_inspect_author_target',
    result,
    automaticRetries: 0,
    finalPageState: retained.state,
    timeline
  })}\n`);
  if (result.state !== 'completed') process.exitCode = 2;
} catch (error) {
  await retainIfLeased().catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ ok: false, error: safeErrorCode(error), timeline })}\n`);
  process.exitCode = 1;
} finally {
  client?.close();
}

async function retainIfLeased() {
  if (!client || !acquired || released) return;
  const page = profileFrom(await snapshot()).pages.find((candidate) => candidate.pageAlias === acquired.page.pageAlias);
  if (page?.activeLease?.pageLeaseId === acquired.lease.pageLeaseId) await release('retained_for_review');
}

async function release(disposition) {
  const result = await client.command({
    type: 'release_page',
    request: { profileId, pageAlias: acquired.page.pageAlias, pageLeaseId: acquired.lease.pageLeaseId, disposition }
  });
  released = true;
  return result;
}

async function snapshot() {
  const result = await client.command({ type: 'get_snapshot' });
  if (!result || result.schemaVersion !== 1 || !Array.isArray(result.profiles)) {
    throw new Error('xiaohongshu_note_overlay_snapshot_invalid');
  }
  return result;
}

function profileFrom(snapshotValue) {
  const profile = snapshotValue.profiles.find((candidate) => candidate.profileId === profileId);
  if (!profile) throw new Error('xiaohongshu_note_overlay_profile_missing');
  return profile;
}

function record(phase, fact) {
  timeline.push({ at: new Date().toISOString(), phase, fact });
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_note_overlay_recon_failed';
}
