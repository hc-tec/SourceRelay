import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  CollectionResult,
  xiaohongshuAccountPublicNotes,
  xiaohongshuNotePublicCommentReplies,
  xiaohongshuNotePublicComments,
  xiaohongshuNotePublicDetail,
  xiaohongshuPublicNotesSearch
} from '@intelligence/collector-client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BUILD_FINGERPRINT = /^[a-f0-9]{64}$/;
const EXPECTED_CASES = new Map([
  ['xiaohongshu.public-notes-search', 'xiaohongshu.search.public_notes.v1'],
  ['xiaohongshu.note-public-detail', 'xiaohongshu.note.public_detail.v1'],
  ['xiaohongshu.note-public-comments', 'xiaohongshu.note.public_comments.v1'],
  ['xiaohongshu.note-public-comment-replies', 'xiaohongshu.note.public_comment_replies.v1'],
  ['xiaohongshu.account-public-notes', 'xiaohongshu.account.public_notes.v1']
]);

export async function readXiaohongshuReconciliationManifest(path) {
  const text = await readFile(path, 'utf8');
  if (text.includes('\uFEFF')) throw new Error('xiaohongshu_reconciliation_manifest_bom_forbidden');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('xiaohongshu_reconciliation_manifest_json_invalid');
  }
  return validateManifest(value);
}

export function buildXiaohongshuReconciliationRequest(evidence, { browserBindingId, query }) {
  const common = { clientRequestId: evidence.clientRequestId, browserBindingId };
  switch (evidence.caseId) {
    case 'xiaohongshu.public-notes-search':
      if (sha256(query) !== evidence.inputEvidence.querySha256) {
        throw new Error('xiaohongshu_reconciliation_query_digest_mismatch');
      }
      return xiaohongshuPublicNotesSearch({
        ...common,
        query,
        maximumDetails: evidence.inputEvidence.maximumDetails
      });
    case 'xiaohongshu.note-public-detail':
      return xiaohongshuNotePublicDetail({
        ...common,
        executionTarget: evidence.inputEvidence.executionTarget,
        resultRank: evidence.inputEvidence.resultRank
      });
    case 'xiaohongshu.note-public-comments':
      return xiaohongshuNotePublicComments({
        ...common,
        maximumScrolls: evidence.inputEvidence.maximumScrolls
      });
    case 'xiaohongshu.note-public-comment-replies':
      return xiaohongshuNotePublicCommentReplies({
        ...common,
        maximumThreads: evidence.inputEvidence.maximumThreads
      });
    case 'xiaohongshu.account-public-notes':
      return xiaohongshuAccountPublicNotes({
        ...common,
        executionTarget: evidence.inputEvidence.executionTarget,
        maximumScrolls: evidence.inputEvidence.maximumScrolls
      });
    default:
      throw new Error('xiaohongshu_reconciliation_case_unknown');
  }
}

export async function reconcileXiaohongshuCase(client, evidence, request) {
  const result = await client.collectAndWaitModel(request, {
    timeoutMs: 15_000,
    initialDelayMs: 0,
    maxDelayMs: 1_000
  });
  return await verifyXiaohongshuCase(client, evidence, result, 'idempotent_collect');
}

async function verifyXiaohongshuCase(client, evidence, result, reconciliationMode) {
  if (!(result instanceof CollectionResult) || !result.succeeded || !result.artifact) {
    throw new Error('xiaohongshu_reconciliation_collection_result_invalid');
  }
  if (result.operation.operationId !== evidence.expectedOperationId ||
    result.operation.capability !== evidence.capability ||
    result.operation.state !== 'completed' ||
    result.operation.terminalReason !== evidence.expectedTerminalReason ||
    result.operation.errorCode !== null ||
    result.operation.artifact?.artifactId !== evidence.artifact.artifactId ||
    result.artifact.capability !== evidence.capability ||
    result.artifact.artifactId !== evidence.artifact.artifactId) {
    throw new Error('xiaohongshu_reconciliation_operation_identity_mismatch');
  }

  const metadata = await client.readArtifactMetadata(evidence.artifact.artifactId);
  if (metadata.artifactId !== evidence.artifact.artifactId ||
    metadata.operationId !== evidence.expectedOperationId ||
    metadata.capability !== evidence.capability ||
    metadata.byteLength !== evidence.artifact.byteLength ||
    metadata.sha256 !== evidence.artifact.sha256 ||
    metadata.terminalStatus !== 'completed' || metadata.available !== true ||
    metadata.deletionState !== 'retained') {
    throw new Error('xiaohongshu_reconciliation_artifact_metadata_mismatch');
  }
  const windows = await verifyArtifactWindows(client, evidence.artifact);
  return {
    caseId: evidence.caseId,
    capability: evidence.capability,
    reconciliationMode,
    collectionSubmitted: reconciliationMode === 'idempotent_collect',
    operationId: evidence.expectedOperationId,
    coreState: result.operation.state,
    terminalReason: result.operation.terminalReason,
    artifactId: evidence.artifact.artifactId,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    windowCount: windows,
    sameOperationIdentity: true,
    newPlatformActionExpected: false
  };
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function validateManifest(value) {
  if (!record(value) || value.schemaVersion !== 1 ||
    value.kind !== 'xiaohongshu_sdk_reconciliation_matrix' ||
    value.releaseVersion !== '0.7.17' || value.serviceSchemaVersion !== 3 ||
    value.livePlatformActionsExpected !== 0 || !SHA256.test(value.querySha256) ||
    !Array.isArray(value.cases) || value.cases.length !== EXPECTED_CASES.size) {
    throw new Error('xiaohongshu_reconciliation_manifest_invalid');
  }
  const ids = new Set();
  for (const evidence of value.cases) {
    if (!record(evidence) || EXPECTED_CASES.get(evidence.caseId) !== evidence.capability ||
      ids.has(evidence.caseId) ||
      evidence.reconciliationMode !== 'idempotent_collect' ||
      !UUID.test(evidence.clientRequestId) || evidence.provenanceGap !== undefined ||
      !UUID.test(evidence.expectedOperationId) ||
      typeof evidence.expectedTerminalReason !== 'string' ||
      !record(evidence.inputEvidence) || !record(evidence.artifact) ||
      !UUID.test(evidence.artifact.artifactId) ||
      !Number.isSafeInteger(evidence.artifact.byteLength) || evidence.artifact.byteLength < 1 ||
      !SHA256.test(evidence.artifact.sha256) ||
      !BUILD_FINGERPRINT.test(evidence.sourceBuildFingerprint)) {
      throw new Error('xiaohongshu_reconciliation_manifest_case_invalid');
    }
    ids.add(evidence.caseId);
  }
  if ([...EXPECTED_CASES.keys()].some((caseId) => !ids.has(caseId))) {
    throw new Error('xiaohongshu_reconciliation_manifest_case_missing');
  }
  const detached = structuredClone(value);
  return Object.freeze({ ...detached, cases: Object.freeze(detached.cases.map(Object.freeze)) });
}

async function verifyArtifactWindows(client, artifact) {
  const hash = createHash('sha256');
  let offset = 0;
  let windows = 0;
  while (offset < artifact.byteLength) {
    if (windows >= 2_048) throw new Error('xiaohongshu_reconciliation_artifact_window_limit_exceeded');
    const window = await client.readArtifactContentWindow(artifact.artifactId, {
      offset,
      maxBytes: 16_384
    });
    const bytes = Buffer.byteLength(window.text, 'utf8');
    if (window.byteLength !== artifact.byteLength || window.sha256 !== artifact.sha256 ||
      window.offset !== offset || window.endExclusive - offset !== bytes ||
      sha256(window.text) !== window.chunkSha256 ||
      window.nextOffset !== (window.truncated ? window.endExclusive : null)) {
      throw new Error('xiaohongshu_reconciliation_artifact_window_mismatch');
    }
    hash.update(window.text, 'utf8');
    windows += 1;
    offset = window.nextOffset ?? window.endExclusive;
  }
  if (offset !== artifact.byteLength || `sha256:${hash.digest('hex')}` !== artifact.sha256) {
    throw new Error('xiaohongshu_reconciliation_artifact_hash_mismatch');
  }
  return windows;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
