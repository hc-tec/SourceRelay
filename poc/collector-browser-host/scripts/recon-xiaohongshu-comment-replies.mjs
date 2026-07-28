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
  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-comment-replies-recon');
  const profile = profileFrom(await snapshot());
  if (!profile.running || profile.leasedPages !== 0) throw new Error('xiaohongshu_comment_replies_profile_not_ready');
  const runId = randomUUID();
  acquired = await client.command({ type: 'adopt_xiaohongshu_validation_public_page', request: {
    schemaVersion: 1, profileId, taskId: 'xiaohongshu-comment-replies-recon', runId, leaseDurationMs: 60_000
  } });
  record('page_acquired', { pageAlias: acquired.page.pageAlias, selection: acquired.selection });
  const result = await client.command({ type: 'recon_xiaohongshu_note_comments', request: {
    schemaVersion: 1, profileId, pageAlias: acquired.page.pageAlias, pageLeaseId: acquired.lease.pageLeaseId,
    runId, expectedRecordVersion: acquired.page.recordVersion,
    expectedDocumentGeneration: acquired.page.documentGeneration, actionId: randomUUID(),
    action: 'expand_first_reply_thread', timeoutMs: 25_000
  } }, { timeoutMs: 30_000 });
  record('reply_recon_completed', { state: result.state, semanticAction: result.semanticAction,
    replyTarget: result.before.replyTarget?.label ?? null, replyTargetVisibleAfter: result.after?.replyTargetVisible ?? null,
    networkResponseCount: result.network.responses.length, projectedCommentCount: result.network.comments.length });
  const retained = await release('retained_for_review');
  process.stdout.write(`${JSON.stringify({ ok: result.state === 'completed', runId,
    objective: 'expand_first_visible_public_reply_thread_and_observe_network', result,
    automaticPlatformRetries: 0, finalPageState: retained.state, timeline })}\n`);
  if (result.state !== 'completed') process.exitCode = 2;
} catch (error) {
  await retainIfLeased().catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ ok: false, error: safeErrorCode(error), timeline })}\n`);
  process.exitCode = 1;
} finally { client?.close(); }

async function snapshot() { return await client.command({ type: 'get_snapshot' }); }
function profileFrom(snapshotValue) {
  const profile = snapshotValue.profiles?.find((candidate) => candidate.profileId === profileId);
  if (!profile) throw new Error('xiaohongshu_comment_replies_profile_missing');
  return profile;
}
async function retainIfLeased() {
  if (!client || !acquired || released) return;
  const page = profileFrom(await snapshot()).pages.find((candidate) => candidate.pageAlias === acquired.page.pageAlias);
  if (page?.activeLease?.pageLeaseId === acquired.lease.pageLeaseId) await release('retained_for_review');
}
async function release(disposition) {
  const result = await client.command({ type: 'release_page', request: {
    profileId, pageAlias: acquired.page.pageAlias, pageLeaseId: acquired.lease.pageLeaseId, disposition
  } });
  released = true; return result;
}
function record(phase, fact) { timeline.push({ at: new Date().toISOString(), phase, fact }); }
function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_comment_replies_recon_failed';
}
