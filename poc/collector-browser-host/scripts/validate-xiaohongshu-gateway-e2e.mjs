import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { BrowserHostClient } from '../dist/client.js';
import { approveExactExtensionPermission } from '../../collector-extension/scripts/native-permission-harness.mjs';

const pocRoot = resolve(import.meta.dirname, '..', '..');
const endpointPath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'host', 'endpoint.json');
const extensionSourceDirectory = resolve(pocRoot, 'collector-extension');
const gatewayDirectory = resolve(pocRoot, 'collector-gateway');
const profileId = 'xiaohongshu_validation';
const exploreUrl = 'https://www.xiaohongshu.com/explore';
// The composed live run keeps one exact page lease across search, same-
// document detail, comments and bounded replies.  Keep this equal to the
// validation adoption contract's finite five-minute upper bound so a retained
// review page can be reused without falling back to a second browser page.
const validationLeaseDurationMs = 300_000;
const validateCommentRecon = process.argv.includes('--comment-recon');
const validateReplyRecon = process.argv.includes('--reply-recon');
const validatePublicReplies = process.argv.includes('--replies');
const validateAccountNotes = process.argv.includes('--account-notes');
const suppliedProfileUrl = process.env.COLLECTOR_XIAOHONGSHU_PROFILE_URL?.trim() || null;
// A supplied short-lived profile URL is its own live canary.  Do not spend
// platform actions on the unrelated search/detail chain before exercising the
// single-navigation account capability; that would both waste a real run and
// make the profile-link evidence harder to attribute.
const directAccountCanary = validateAccountNotes && Boolean(suppliedProfileUrl);
const requestedDepthDetails = parseBoundedDepthDetails(process.env.COLLECTOR_XIAOHONGSHU_MAX_DETAILS);
const requestedCommentScrolls = parseBoundedCommentScrolls(process.env.COLLECTOR_XIAOHONGSHU_COMMENTS_SCROLLS);
const includeReplyThreads = process.env.COLLECTOR_XIAOHONGSHU_INCLUDE_REPLIES === '1';
const requestedReplyThreads = parseBoundedReplyThreads(
  includeReplyThreads ? process.env.COLLECTOR_XIAOHONGSHU_REPLY_THREADS : undefined
);
const standaloneReplyThreads = parseBoundedReplyThreads(
  process.env.COLLECTOR_XIAOHONGSHU_STANDALONE_REPLY_THREADS
);
if (requestedCommentScrolls > 0 && requestedDepthDetails < 1) {
  throw new Error('xiaohongshu_comments_require_maximum_details');
}
if (includeReplyThreads && (requestedCommentScrolls < 1 || requestedDepthDetails < 1)) {
  throw new Error('xiaohongshu_replies_require_comments_and_maximum_details');
}
const replyCanaryQuery = '奉劝各位咖啡爱好者选好一点的咖啡豆';
const query = process.env.COLLECTOR_XIAOHONGSHU_CANARY_QUERY ??
  (validatePublicReplies || validateAccountNotes ? replyCanaryQuery : '咖啡豆');
const validatePublicComments = process.argv.includes('--comments') || validateReplyRecon || validatePublicReplies;
const validateExistingPublicComments = process.argv.includes('--comments-existing');
const validateNoteDetail = validateCommentRecon || validatePublicComments ||
  (validateAccountNotes && !directAccountCanary) ||
  process.argv.includes('--note-detail');
const timeline = [];
let client = null;
let gateway = null;
let stateDirectory = null;
let acquired = null;
let released = false;

try {
  const port = await availableLoopbackPort();
  const gatewayOrigin = `http://127.0.0.1:${port}`;
  stateDirectory = await mkdtemp(resolve(tmpdir(), 'collector-xiaohongshu-gateway-e2e-'));
  gateway = startGateway(port, stateDirectory);
  await waitForGateway(gatewayOrigin);
  record('gateway_started', { originRole: 'ephemeral_loopback' });

  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-gateway-e2e');
  const profile = profileFrom(await snapshot());
  if (!profile.running || profile.leasedPages !== 0) throw new Error('xiaohongshu_gateway_e2e_profile_not_ready');
  if (validateExistingPublicComments) {
    await validateCommentsOnExistingOverlay(gatewayOrigin);
    process.exitCode = 0;
  } else {

  const runId = randomUUID();
  const retainedPublicPage = profile.pages?.filter((page) =>
    page.state === 'retained_for_review' && page.platform === 'xiaohongshu' &&
    (page.pageRole === 'public_search' || page.pageRole === 'public_profile')
  ) ?? [];
  if (retainedPublicPage.length === 1) {
    // A previous real run intentionally leaves its final page visible for
    // review. Adopt that exact page instead of asking the pool for a second
    // page (which would correctly fail at maximumManagedPages=1). Adoption is
    // local lifecycle bookkeeping; the single baseline Explore navigation
    // below remains the only validation navigation.
    acquired = await client.command({
      type: 'adopt_xiaohongshu_validation_public_page',
      request: {
        schemaVersion: 1,
        profileId,
        taskId: 'xiaohongshu-gateway-e2e',
        runId,
        leaseDurationMs: validationLeaseDurationMs
      }
    });
  } else {
    acquired = await client.command({
      type: 'acquire_page',
      request: {
        profileId,
        taskId: 'xiaohongshu-gateway-e2e',
        runId,
        platform: 'xiaohongshu',
        pageRole: 'public_search',
        targetUrl: exploreUrl,
        maximumManagedPages: 1,
        leaseDurationMs: validationLeaseDurationMs
      }
    });
  }
  record('page_acquired', {
    pageAlias: acquired.page.pageAlias,
    selection: acquired.selection,
    reusedRetainedPage: retainedPublicPage.length === 1
  });
  await client.command({
    type: 'navigate_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      actionId: `xiaohongshu-gateway-e2e-explore-baseline-${runId}`,
      url: exploreUrl,
      waitUntil: 'domcontentloaded',
      timeoutMs: 25_000
    }
  }, { timeoutMs: 30_000 });
  record('baseline_navigation_completed', { validationNavigations: 1 });
  const baseline = await waitForStableDocument(15_000);
  const beforeVisual = await capture(baseline, runId);
  record('baseline_visible', { visualEvidenceId: beforeVisual.evidenceId });

  const pairing = await createPairing(gatewayOrigin);
  let permissionApproval = approveExactExtensionPermission(
    extensionSourceDirectory,
    '127.0.0.1',
    '127.0.0.1',
    8,
    { allowAbsence: true }
  );
  let control;
  try {
    control = await client.command({
      type: 'run_validation_extension_control',
      request: {
        schemaVersion: 1,
        profileId,
        loopbackOrigin: gatewayOrigin,
        identityFingerprint: pairing.identityFingerprint,
        pairingSessionId: pairing.pairingSessionId,
        pairingCode: pairing.pairingCode,
        selection: 'pair_only'
      }
    }, { timeoutMs: 35_000 });
    await permissionApproval;
  } finally {
    await permissionApproval.catch(() => undefined);
    permissionApproval = null;
  }
  if (control.connectionState !== 'online' || control.discussionSelection !== 'not_requested' ||
    control.controlTargetDisposed !== true) {
    throw new Error('xiaohongshu_gateway_e2e_pairing_postcondition_unmet');
  }
  record('extension_paired', {
    browserBindingId: control.browserBindingId,
    controlTargetDisposed: true,
    platformSelectionPerformed: false
  });

  const token = await issueClientToken(gatewayOrigin);
  let reportedOperation;
  let reportedArtifact;
  let commentRecon = null;
  let replyRecon = null;
  let profileEntryRecon = null;
  if (directAccountCanary) {
    const accountMaximumScrolls = 20;
    const accountDispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
      method: 'POST', headers: serviceHeaders(token), body: JSON.stringify({ schemaVersion: 2,
        browserBindingId: control.browserBindingId, platform: 'xiaohongshu',
        capability: 'xiaohongshu.account.public_notes.v1',
        executionTarget: 'ephemeral_public_profile_url',
        input: { maximumScrolls: accountMaximumScrolls, profileUrl: suppliedProfileUrl } })
    }, 201);
    const accountOperationId = accountDispatch.result?.operationId;
    if (!uuid(accountOperationId)) throw new Error('xiaohongshu_account_notes_e2e_operation_missing');
    record('account_notes_operation_dispatched', {
      operationId: accountOperationId,
      maximumScrolls: accountMaximumScrolls,
      executionTarget: 'ephemeral_public_profile_url',
      validationMode: 'direct_profile_link_only'
    });
    const accountOperation = await waitForOperation(gatewayOrigin, token, accountOperationId, 150_000);
    const accountCompleted = accountOperation.state === 'completed' && accountOperation.terminalReason === 'profile_notes_ready';
    const accountBudgetPartial = accountOperation.state === 'stopped' &&
      accountOperation.terminalReason === 'profile_notes_budget_exhausted';
    if ((!accountCompleted && !accountBudgetPartial) ||
      !uuid(accountOperation.artifact?.artifactId) ||
      typeof accountOperation.artifact?.retrievalPath !== 'string') {
      throw new Error(accountOperation.errorCode ?? 'xiaohongshu_account_notes_e2e_operation_not_completed');
    }
    const accountArtifactPayload = await apiJson(
      `${gatewayOrigin}${accountOperation.artifact.retrievalPath}`,
      { headers: { authorization: `Bearer ${token}` } },
      200
    );
    assertAccountNotesArtifact(
      accountArtifactPayload.artifact, accountOperationId, true, accountMaximumScrolls
    );
    reportedOperation = accountOperation;
    reportedArtifact = accountArtifactPayload.artifact;
    record('account_notes_artifact_retrieved', {
      itemCount: reportedArtifact.summary.itemCount,
      networkMatchedPayloadCount: reportedArtifact.result.projection.matchedPayloadCount,
      networkBodyBytesRead: reportedArtifact.result.projection.bodyBytesRead,
      semanticActionCount: reportedArtifact.result.semanticAction.attemptCount,
      completedScrolls: reportedArtifact.result.scroll.completedCount,
      rawPayloadStored: false,
      responseUrlsStored: false,
      validationMode: 'direct_profile_link_only'
    });
  } else {
  const dispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
    method: 'POST',
    headers: serviceHeaders(token),
    body: JSON.stringify({
      schemaVersion: 2,
      browserBindingId: control.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: requestedDepthDetails > 0 ? {
        query,
        maximumDetails: requestedDepthDetails,
        ...(requestedCommentScrolls > 0 ? { comments: {
          maximumScrolls: requestedCommentScrolls,
          ...(includeReplyThreads ? { replies: { maximumThreads: requestedReplyThreads } } : {})
        } } : {})
      } : { query }
    })
  }, 201);
  const operationId = dispatch.result?.operationId;
  if (!uuid(operationId)) throw new Error('xiaohongshu_gateway_e2e_operation_missing');
  record('operation_dispatched', { operationId });

  const operation = await waitForOperation(
    gatewayOrigin,
    token,
    operationId,
    requestedDepthDetails > 1 ? 240_000 : 90_000
  );
  const expectedSearchTerminalReason = requestedDepthDetails > 0 ? 'search_depth_ready' : 'search_ready';
  if (operation.state !== 'completed' || operation.terminalReason !== expectedSearchTerminalReason ||
      !uuid(operation.artifact?.artifactId) || typeof operation.artifact?.retrievalPath !== 'string') {
    record('operation_stopped', {
      state: operation.state,
      terminalReason: operation.terminalReason,
      errorCode: operation.errorCode,
      artifactId: operation.artifact?.artifactId ?? null
    });
    if (typeof operation.artifact?.retrievalPath === 'string') {
      const stoppedArtifact = await apiJson(`${gatewayOrigin}${operation.artifact.retrievalPath}`, {
        headers: { authorization: `Bearer ${token}` }
      }, 200).catch(() => null);
      record('stopped_artifact_diagnostics', {
        detailActions: stoppedArtifact?.artifact?.result?.detailActions ?? null,
        detailCount: Array.isArray(stoppedArtifact?.artifact?.result?.projection?.details)
          ? stoppedArtifact.artifact.result.projection.details.length : null
      });
    }
    throw new Error(operation.errorCode ?? 'xiaohongshu_gateway_e2e_operation_not_completed');
  }
  record('operation_completed', {
    operationId,
    terminalReason: operation.terminalReason,
    artifactId: operation.artifact.artifactId
  });

  const artifactPayload = await apiJson(`${gatewayOrigin}${operation.artifact.retrievalPath}`, {
    headers: { authorization: `Bearer ${token}` }
  }, 200);
  const artifact = artifactPayload.artifact;
  assertArtifact(artifact, operationId);
  record('artifact_retrieved', {
    itemCount: artifact.summary.itemCount,
    detailCount: Array.isArray(artifact.result?.projection?.details)
      ? artifact.result.projection.details.length : 0,
    publicTextCount: Array.isArray(artifact.result?.projection?.details)
      ? artifact.result.projection.details.filter((detail) => typeof detail?.publicText === 'string' && detail.publicText.length > 0).length
      : 0,
    commentCount: Array.isArray(artifact.result?.projection?.details)
      ? artifact.result.projection.details.reduce((total, detail) =>
        total + (Array.isArray(detail?.comments?.comments) ? detail.comments.comments.length : 0), 0)
      : 0,
    replyThreadCount: Array.isArray(artifact.result?.projection?.details)
      ? artifact.result.projection.details.filter((detail) =>
        replyThreadsFromDetail(detail).length > 0).length
      : 0,
    queryDigest: artifact.queryDigest,
    rawPayloadStored: false,
    responseUrlsStored: false
  });

  reportedOperation = operation;
  reportedArtifact = artifact;
  if (validateNoteDetail) {
    const detailResultRank = 1;
    record('note_detail_target_selected', {
      resultRank: detailResultRank,
      selectionPolicy: 'fixed_first_rendered_result'
    });
    const detailDispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
      method: 'POST',
      headers: serviceHeaders(token),
      body: JSON.stringify({
        schemaVersion: 2,
        browserBindingId: control.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.note.public_detail.v1',
        executionTarget: 'existing_public_search_tab',
        input: { resultRank: detailResultRank }
      })
    }, 201);
    const detailOperationId = detailDispatch.result?.operationId;
    if (!uuid(detailOperationId)) throw new Error('xiaohongshu_note_detail_e2e_operation_missing');
    record('note_detail_operation_dispatched', { operationId: detailOperationId, resultRank: detailResultRank });
    const detailOperation = await waitForOperation(gatewayOrigin, token, detailOperationId, 90_000);
    if (detailOperation.state !== 'completed' || detailOperation.terminalReason !== 'note_detail_ready' ||
      !uuid(detailOperation.artifact?.artifactId) || typeof detailOperation.artifact?.retrievalPath !== 'string') {
      throw new Error(detailOperation.errorCode ?? 'xiaohongshu_note_detail_e2e_operation_not_completed');
    }
    const detailArtifactPayload = await apiJson(`${gatewayOrigin}${detailOperation.artifact.retrievalPath}`, {
      headers: { authorization: `Bearer ${token}` }
    }, 200);
    record('note_detail_artifact_diagnostics', {
      state: detailArtifactPayload.artifact?.result?.state ?? null,
      terminalReason: detailArtifactPayload.artifact?.result?.terminalReason ?? null,
      publicSurface: detailArtifactPayload.artifact?.result?.page?.publicSurface ?? null,
      captureMode: detailArtifactPayload.artifact?.result?.projection?.captureMode ?? null,
      publicTextLength: detailArtifactPayload.artifact?.result?.projection?.publicText?.length ?? 0,
      semanticActionCount: detailArtifactPayload.artifact?.result?.semanticAction?.attemptCount ?? null,
      debuggerDetached: detailArtifactPayload.artifact?.provenance?.debuggerDetached ?? null
    });
    assertNoteDetailArtifact(detailArtifactPayload.artifact, detailOperationId);
    reportedOperation = detailOperation;
    reportedArtifact = detailArtifactPayload.artifact;
    record('note_detail_artifact_retrieved', {
      captureMode: reportedArtifact.summary.captureMode,
      publicTextLength: reportedArtifact.result.projection.publicText.length,
      rawPayloadStored: false,
      responseUrlsStored: false
    });
    if (validateAccountNotes && !directAccountCanary) {
      if (!suppliedProfileUrl) {
        const detailPage = await leasedPage();
        profileEntryRecon = await client.command({
          type: 'recon_xiaohongshu_public_profile_entry',
          request: {
            schemaVersion: 1,
            profileId,
            pageAlias: acquired.page.pageAlias,
            pageLeaseId: acquired.lease.pageLeaseId,
            runId,
            expectedRecordVersion: detailPage.recordVersion,
            expectedDocumentGeneration: detailPage.documentGeneration,
            actionId: randomUUID(),
            timeoutMs: 25_000
          }
        }, { timeoutMs: 30_000 });
        record('public_profile_entry_recon_completed', {
          state: profileEntryRecon.state,
          semanticAction: profileEntryRecon.semanticAction,
          beforeSurface: profileEntryRecon.before.publicSurface,
          authorTargetMode: profileEntryRecon.before.authorTarget?.targetMode ?? null,
          finalSurface: profileEntryRecon.after?.publicSurface ?? null,
          networkResponseCount: profileEntryRecon.network.responses.length
        });
        if (profileEntryRecon.state !== 'completed') {
          throw new Error('xiaohongshu_account_notes_profile_entry_prerequisite_unmet');
        }
      }
      const accountExecutionTarget = suppliedProfileUrl
        ? 'ephemeral_public_profile_url' : 'existing_public_profile_tab';
      const accountMaximumScrolls = suppliedProfileUrl ? 20 : 3;
      const accountDispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
        method: 'POST', headers: serviceHeaders(token), body: JSON.stringify({ schemaVersion: 2,
          browserBindingId: control.browserBindingId, platform: 'xiaohongshu',
          capability: 'xiaohongshu.account.public_notes.v1', executionTarget: accountExecutionTarget,
          input: suppliedProfileUrl
            ? { maximumScrolls: accountMaximumScrolls, profileUrl: suppliedProfileUrl }
            : { maximumScrolls: accountMaximumScrolls } })
      }, 201);
      const accountOperationId = accountDispatch.result?.operationId;
      if (!uuid(accountOperationId)) throw new Error('xiaohongshu_account_notes_e2e_operation_missing');
      record('account_notes_operation_dispatched', {
        operationId: accountOperationId, maximumScrolls: accountMaximumScrolls, executionTarget: accountExecutionTarget
      });
      const accountOperation = await waitForOperation(gatewayOrigin, token, accountOperationId, 90_000);
      const accountCompleted = accountOperation.state === 'completed' && accountOperation.terminalReason === 'profile_notes_ready';
      const accountBudgetPartial = accountOperation.state === 'stopped' &&
        accountOperation.terminalReason === 'profile_notes_budget_exhausted';
      if ((!accountCompleted && !accountBudgetPartial) ||
        !uuid(accountOperation.artifact?.artifactId) ||
        typeof accountOperation.artifact?.retrievalPath !== 'string') {
        throw new Error(accountOperation.errorCode ?? 'xiaohongshu_account_notes_e2e_operation_not_completed');
      }
      const accountArtifactPayload = await apiJson(
        `${gatewayOrigin}${accountOperation.artifact.retrievalPath}`,
        { headers: { authorization: `Bearer ${token}` } },
        200
      );
      assertAccountNotesArtifact(
        accountArtifactPayload.artifact, accountOperationId, Boolean(suppliedProfileUrl), accountMaximumScrolls
      );
      reportedOperation = accountOperation;
      reportedArtifact = accountArtifactPayload.artifact;
      record('account_notes_artifact_retrieved', {
        itemCount: reportedArtifact.summary.itemCount,
        networkMatchedPayloadCount: reportedArtifact.result.projection.matchedPayloadCount,
        networkBodyBytesRead: reportedArtifact.result.projection.bodyBytesRead,
        semanticActionCount: reportedArtifact.result.semanticAction.attemptCount,
        completedScrolls: reportedArtifact.result.scroll.completedCount,
        rawPayloadStored: false,
        responseUrlsStored: false
      });
    } else if (validatePublicComments) {
      const commentsDispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
        method: 'POST', headers: serviceHeaders(token), body: JSON.stringify({ schemaVersion: 2,
          browserBindingId: control.browserBindingId, platform: 'xiaohongshu',
          capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
          input: { maximumScrolls: 3 } })
      }, 201);
      const commentsOperationId = commentsDispatch.result?.operationId;
      if (!uuid(commentsOperationId)) throw new Error('xiaohongshu_note_comments_e2e_operation_missing');
      record('note_comments_operation_dispatched', { operationId: commentsOperationId, maximumScrolls: 3 });
      const commentsOperation = await waitForOperation(gatewayOrigin, token, commentsOperationId, 90_000);
      if (commentsOperation.state !== 'completed' || commentsOperation.terminalReason !== 'note_comments_ready' ||
        !uuid(commentsOperation.artifact?.artifactId) || typeof commentsOperation.artifact?.retrievalPath !== 'string') {
        throw new Error(commentsOperation.errorCode ?? 'xiaohongshu_note_comments_e2e_operation_not_completed');
      }
      const commentsArtifactPayload = await apiJson(`${gatewayOrigin}${commentsOperation.artifact.retrievalPath}`,
        { headers: { authorization: `Bearer ${token}` } }, 200);
      record('note_comments_artifact_diagnostics', noteCommentsDiagnostics(commentsArtifactPayload.artifact));
      assertNoteCommentsArtifact(commentsArtifactPayload.artifact, commentsOperationId);
      reportedOperation = commentsOperation;
      reportedArtifact = commentsArtifactPayload.artifact;
      record('note_comments_artifact_retrieved', { captureMode: reportedArtifact.summary.captureMode,
        commentCount: reportedArtifact.summary.commentCount,
        networkMatchedPayloadCount: reportedArtifact.result.projection.network.matchedPayloadCount,
        networkBodyBytesRead: reportedArtifact.result.projection.network.bodyBytesRead,
        networkCursorObserved: reportedArtifact.result.projection.network.cursorObserved,
        rawPayloadStored: false, responseUrlsStored: false });
      if (validatePublicReplies) {
        const repliesDispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
          method: 'POST', headers: serviceHeaders(token), body: JSON.stringify({ schemaVersion: 2,
            browserBindingId: control.browserBindingId, platform: 'xiaohongshu',
            capability: 'xiaohongshu.note.public_comment_replies.v1',
            executionTarget: 'existing_public_note_overlay', input: { maximumThreads: standaloneReplyThreads } })
        }, 201);
        const repliesOperationId = repliesDispatch.result?.operationId;
        if (!uuid(repliesOperationId)) throw new Error('xiaohongshu_note_replies_e2e_operation_missing');
        record('note_replies_operation_dispatched', {
          operationId: repliesOperationId,
          maximumThreads: standaloneReplyThreads
        });
        const repliesOperation = await waitForOperation(
          gatewayOrigin,
          token,
          repliesOperationId,
          standaloneReplyThreads > 1 ? 150_000 : 90_000
        );
        if ((repliesOperation.state !== 'completed' && repliesOperation.state !== 'stopped') ||
          (repliesOperation.state === 'completed' && repliesOperation.terminalReason !== 'comment_replies_ready') ||
          (repliesOperation.state === 'stopped' &&
            (standaloneReplyThreads === 1 || repliesOperation.terminalReason !== 'postcondition_unmet')) ||
          !uuid(repliesOperation.artifact?.artifactId) ||
          typeof repliesOperation.artifact?.retrievalPath !== 'string') {
          throw new Error(repliesOperation.errorCode ?? 'xiaohongshu_note_replies_e2e_operation_not_completed');
        }
        const repliesArtifactPayload = await apiJson(
          `${gatewayOrigin}${repliesOperation.artifact.retrievalPath}`,
          { headers: { authorization: `Bearer ${token}` } },
          200
        );
        record('note_replies_artifact_diagnostics', noteRepliesDiagnostics(repliesArtifactPayload.artifact));
        assertNoteRepliesArtifact(repliesArtifactPayload.artifact, repliesOperationId, standaloneReplyThreads);
        reportedOperation = repliesOperation;
        reportedArtifact = repliesArtifactPayload.artifact;
        record('note_replies_artifact_retrieved', {
          captureMode: reportedArtifact.summary.captureMode,
          replyCount: reportedArtifact.summary.replyCount,
          networkMatchedPayloadCount: reportedArtifact.result.projection.network.matchedPayloadCount,
          networkBodyBytesRead: reportedArtifact.result.projection.network.bodyBytesRead,
          networkCursorObserved: reportedArtifact.result.projection.network.cursorObserved,
          actionTriggeredResponseCount: reportedArtifact.result.projection.network.actionTriggeredResponseCount,
          rawPayloadStored: false,
          responseUrlsStored: false
        });
      } else if (validateReplyRecon) {
        const replyPage = await leasedPage();
        replyRecon = await client.command({ type: 'recon_xiaohongshu_note_comments', request: {
          schemaVersion: 1, profileId, pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId, runId,
          expectedRecordVersion: replyPage.recordVersion,
          expectedDocumentGeneration: replyPage.documentGeneration,
          actionId: randomUUID(), action: 'expand_first_reply_thread', timeoutMs: 25_000
        } }, { timeoutMs: 30_000 });
        record('comment_replies_recon_completed', { state: replyRecon.state,
          semanticAction: replyRecon.semanticAction, replyTarget: replyRecon.before.replyTarget?.label ?? null,
          replyTargetVisibleAfter: replyRecon.after?.replyTargetVisible ?? null,
          networkResponseCount: replyRecon.network.responses.length,
          projectedCommentCount: replyRecon.network.comments.length });
        if (replyRecon.state !== 'completed') throw new Error('xiaohongshu_comment_replies_recon_incomplete');
      }
    } else if (validateCommentRecon) {
      const detailPage = await leasedPage();
      commentRecon = await client.command({
        type: 'recon_xiaohongshu_note_comments',
        request: {
          schemaVersion: 1,
          profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          runId,
          expectedRecordVersion: detailPage.recordVersion,
          expectedDocumentGeneration: detailPage.documentGeneration,
          actionId: randomUUID(),
          action: 'scroll_comment_panel',
          timeoutMs: 25_000
        }
      }, { timeoutMs: 30_000 });
      record('note_comments_recon_completed', {
        state: commentRecon.state,
        semanticActionAttempted: commentRecon.semanticAction.attempted,
        renderedCommentCountBefore: commentRecon.before.renderedCommentCount,
        renderedCommentCountAfter: commentRecon.after?.renderedCommentCount ?? null,
        responseCount: commentRecon.network.responses.length,
        projectedCommentCount: commentRecon.network.comments.length
      });
      if (commentRecon.state !== 'completed') throw new Error('xiaohongshu_note_comments_recon_incomplete');
    }
  }
  }

  const after = await leasedPage();
  const afterVisual = await capture(after, runId);
  record('visual_postcondition', { visualEvidenceId: afterVisual.evidenceId });
  const persistedQueryCopies = await countTextInGatewayMetadataFiles(stateDirectory, query);
  if (persistedQueryCopies !== 0) throw new Error('xiaohongshu_gateway_e2e_query_persisted');
  const retained = await release('retained_for_review');
  if (retained.state !== 'retained_for_review') throw new Error('xiaohongshu_gateway_e2e_page_not_retained');

  writeJson({
    ok: true,
    runId,
    gatewayPath: 'user_browser_api_to_signed_queue_to_production_extension',
    validatedCapability: validateAccountNotes ? 'xiaohongshu.account.public_notes.v1' :
      validatePublicReplies ? 'xiaohongshu.note.public_comment_replies.v1' :
      validateReplyRecon ? 'xiaohongshu.note.public_comment_replies.recon' :
      validatePublicComments ? 'xiaohongshu.note.public_comments.v1' :
      validateCommentRecon ? 'xiaohongshu.note.comments.recon' :
      validateNoteDetail ? 'xiaohongshu.note.public_detail.v1' : 'xiaohongshu.search.public_notes.v1',
    validationOutcome: reportedOperation.terminalReason === 'profile_notes_budget_exhausted'
      ? 'partial_budget' : reportedOperation.state === 'stopped'
        ? 'partial_postcondition' : 'completed',
    productPlatformNavigations: reportedArtifact.result.navigation.attemptCount,
    validationBaselineNavigations: 1,
    semanticActions: reportedArtifact.result.semanticAction.attemptCount,
    automaticPlatformRetries: 0,
    operation: {
      operationId: reportedOperation.operationId,
      state: reportedOperation.state,
      terminalReason: reportedOperation.terminalReason,
      artifactId: reportedOperation.artifact.artifactId
    },
    artifact: {
      captureMode: reportedArtifact.summary.captureMode ?? 'search_projection',
      itemCount: reportedArtifact.summary.itemCount ?? null,
      detailCount: Array.isArray(reportedArtifact.result.projection?.details)
        ? reportedArtifact.result.projection.details.length : 0,
      publicTextCount: Array.isArray(reportedArtifact.result.projection?.details)
        ? reportedArtifact.result.projection.details.filter((detail) => typeof detail?.publicText === 'string' && detail.publicText.length > 0).length
        : 0,
      queryDigest: reportedArtifact.queryDigest ?? null,
      commentCount: Array.isArray(reportedArtifact.result.projection?.details)
        ? reportedArtifact.result.projection.details.reduce((total, detail) =>
          total + (Array.isArray(detail?.comments?.comments) ? detail.comments.comments.length : 0), 0)
        : reportedArtifact.summary.commentCount ?? null,
      replyCount: reportedArtifact.summary.replyCount ?? null,
      networkMatchedPayloadCount: reportedArtifact.result.projection?.network?.matchedPayloadCount ?? null,
      networkBodyBytesRead: reportedArtifact.result.projection?.network?.bodyBytesRead ?? null,
      networkCursorObserved: reportedArtifact.result.projection?.network?.cursorObserved ?? null,
      actionTriggeredResponseCount:
        reportedArtifact.result.projection?.network?.actionTriggeredResponseCount ?? null,
      rawPayloadStored: reportedArtifact.provenance.rawPayloadStored,
      responseUrlsStored: reportedArtifact.provenance.responseUrlsStored,
      debuggerDetached: reportedArtifact.provenance.debuggerDetached
    },
    persistedQueryCopies,
    commentRecon: commentRecon ? {
      scrollTopBefore: commentRecon.before.scrollContainer?.scrollTop ?? null,
      scrollTopAfter: commentRecon.after?.scrollTop ?? null,
      renderedCommentCountBefore: commentRecon.before.renderedCommentCount,
      renderedCommentCountAfter: commentRecon.after?.renderedCommentCount ?? null,
      responseBodiesRead: commentRecon.network.responseBodiesRead,
      temporaryBodyBytesRead: commentRecon.network.temporaryBodyBytesRead,
      responses: commentRecon.network.responses,
      projectedCommentCount: commentRecon.network.comments.length
    } : null,
    replyRecon: replyRecon ? {
      replyTarget: replyRecon.before.replyTarget?.label ?? null,
      semanticAction: replyRecon.semanticAction,
      replyTargetVisibleAfter: replyRecon.after?.replyTargetVisible ?? null,
      responseBodiesRead: replyRecon.network.responseBodiesRead,
      temporaryBodyBytesRead: replyRecon.network.temporaryBodyBytesRead,
      responses: replyRecon.network.responses,
      projectedCommentCount: replyRecon.network.comments.length
    } : null,
    profileEntryRecon: profileEntryRecon ? {
      beforeSurface: profileEntryRecon.before.publicSurface,
      authorTargetMode: profileEntryRecon.before.authorTarget?.targetMode ?? null,
      semanticAction: profileEntryRecon.semanticAction,
      finalSurface: profileEntryRecon.after?.publicSurface ?? null,
      networkResponseCount: profileEntryRecon.network.responses.length
    } : null,
    visualEvidence: { before: beforeVisual, after: afterVisual },
    finalPageState: retained.state,
    timeline
  });
  }
} catch (error) {
  await retainIfLeased().catch(() => undefined);
  writeJson({ ok: false, error: safeErrorCode(error), timeline });
  process.exitCode = 1;
} finally {
  client?.close();
  if (gateway) await stopGateway(gateway);
  if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true });
}

async function validateCommentsOnExistingOverlay(gatewayOrigin) {
  const pairing = await createPairing(gatewayOrigin);
  let permissionApproval = approveExactExtensionPermission(extensionSourceDirectory, '127.0.0.1', '127.0.0.1', 8,
    { allowAbsence: true });
  let control;
  try {
    control = await client.command({ type: 'run_validation_extension_control', request: { schemaVersion: 1,
      profileId, loopbackOrigin: gatewayOrigin, identityFingerprint: pairing.identityFingerprint,
      pairingSessionId: pairing.pairingSessionId, pairingCode: pairing.pairingCode, selection: 'pair_only' }
    }, { timeoutMs: 35_000 });
    await permissionApproval;
  } finally { await permissionApproval.catch(() => undefined); permissionApproval = null; }
  if (control.connectionState !== 'online' || control.controlTargetDisposed !== true) {
    throw new Error('xiaohongshu_comments_existing_pairing_postcondition_unmet');
  }
  record('extension_paired', { browserBindingId: control.browserBindingId, platformSelectionPerformed: false });
  const token = await issueClientToken(gatewayOrigin);
  const dispatch = await apiJson(`${gatewayOrigin}/v2/collect`, { method: 'POST', headers: serviceHeaders(token),
    body: JSON.stringify({ schemaVersion: 2, browserBindingId: control.browserBindingId, platform: 'xiaohongshu',
      capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
      input: { maximumScrolls: 3 } }) }, 201);
  const operationId = dispatch.result?.operationId;
  if (!uuid(operationId)) throw new Error('xiaohongshu_note_comments_e2e_operation_missing');
  record('note_comments_operation_dispatched', { operationId, maximumScrolls: 3 });
  const operation = await waitForOperation(gatewayOrigin, token, operationId, 90_000);
  if (operation.state !== 'completed' || operation.terminalReason !== 'note_comments_ready' ||
    !uuid(operation.artifact?.artifactId) || typeof operation.artifact?.retrievalPath !== 'string') {
    throw new Error(operation.errorCode ?? 'xiaohongshu_note_comments_e2e_operation_not_completed');
  }
  const payload = await apiJson(`${gatewayOrigin}${operation.artifact.retrievalPath}`,
    { headers: { authorization: `Bearer ${token}` } }, 200);
  record('note_comments_artifact_diagnostics', noteCommentsDiagnostics(payload.artifact));
  assertNoteCommentsArtifact(payload.artifact, operationId);
  record('note_comments_artifact_retrieved', { captureMode: payload.artifact.summary.captureMode,
    commentCount: payload.artifact.summary.commentCount,
    networkMatchedPayloadCount: payload.artifact.result.projection.network.matchedPayloadCount,
    networkBodyBytesRead: payload.artifact.result.projection.network.bodyBytesRead,
    networkCursorObserved: payload.artifact.result.projection.network.cursorObserved,
    rawPayloadStored: false, responseUrlsStored: false });
  writeJson({ ok: true, runId: randomUUID(), gatewayPath: 'user_browser_api_to_signed_queue_to_production_extension',
    validatedCapability: 'xiaohongshu.note.public_comments.v1', productPlatformNavigations: 0,
    validationBaselineNavigations: 0, semanticActions: payload.artifact.result.semanticAction.attemptCount,
    automaticPlatformRetries: 0, operation: { operationId, state: operation.state,
      terminalReason: operation.terminalReason, artifactId: operation.artifact.artifactId },
    artifact: { captureMode: payload.artifact.summary.captureMode, commentCount: payload.artifact.summary.commentCount,
      networkMatchedPayloadCount: payload.artifact.result.projection.network.matchedPayloadCount,
      networkBodyBytesRead: payload.artifact.result.projection.network.bodyBytesRead,
      networkCursorObserved: payload.artifact.result.projection.network.cursorObserved,
      rawPayloadStored: payload.artifact.provenance.rawPayloadStored,
      responseUrlsStored: payload.artifact.provenance.responseUrlsStored,
      debuggerDetached: payload.artifact.provenance.debuggerDetached }, finalPageState: 'existing_overlay_retained', timeline });
}

async function createPairing(origin) {
  const payload = await apiJson(`${origin}/v1/browser-bindings/pairing-sessions`, {
    method: 'POST',
    headers: sameOriginHeaders(origin),
    body: '{}'
  }, 201);
  const pairing = payload.pairing;
  if (!pairing || !/^[a-f0-9]{64}$/.test(pairing.identityFingerprint) ||
    !uuid(pairing.pairingSessionId) || !/^\d{8}$/.test(pairing.pairingCode)) {
    throw new Error('xiaohongshu_gateway_e2e_pairing_session_invalid');
  }
  return pairing;
}

async function issueClientToken(origin) {
  const payload = await apiJson(`${origin}/v2/collector-service/clients`, {
    method: 'POST',
    headers: sameOriginHeaders(origin),
    body: JSON.stringify({
      label: 'xiaohongshu-live-gateway-canary',
      scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read']
    })
  }, 201);
  if (typeof payload.token !== 'string' || !/^cst_[A-Za-z0-9_-]{43}$/.test(payload.token)) {
    throw new Error('xiaohongshu_gateway_e2e_client_token_invalid');
  }
  return payload.token;
}

async function waitForOperation(origin, token, operationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await apiJson(`${origin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${token}` }
    }, 200);
    const operation = payload.result;
    if (operation?.state === 'completed' || operation?.state === 'stopped' || operation?.state === 'expired') {
      return operation;
    }
    await delay(500);
  }
  throw new Error('xiaohongshu_gateway_e2e_operation_timeout');
}

function assertArtifact(artifact, operationId) {
  if (!artifact || artifact.operationId !== operationId ||
    artifact.capability !== 'xiaohongshu.search.public_notes.v1' || artifact.state !== 'completed' ||
    !/^[a-f0-9]{64}$/.test(artifact.queryDigest) || artifact.summary?.queryDigest !== artifact.queryDigest ||
    artifact.summary?.itemCount < 1 || artifact.result?.projection?.items?.length < 1 ||
    artifact.result?.navigation?.attempted !== false || artifact.result.navigation.attemptCount !== 0 ||
    artifact.result?.semanticAction?.attempted !== true || artifact.result.semanticAction.attemptCount !== 1 ||
    artifact.provenance?.rawPayloadStored !== false || artifact.provenance?.responseUrlsStored !== false ||
    artifact.provenance?.debuggerDetached !== true) {
    throw new Error('xiaohongshu_gateway_e2e_artifact_invalid');
  }
  if (requestedDepthDetails > 0) {
    const depth = artifact.result?.detailActions;
    if (artifact.result?.terminalReason !== 'search_depth_ready' ||
      depth?.requestedCount !== requestedDepthDetails || depth.attemptedCount !== requestedDepthDetails ||
      depth.completedCount !== requestedDepthDetails || depth.stoppedReason !== null ||
      !Array.isArray(artifact.result?.projection?.details) ||
      artifact.result.projection.details.length < requestedDepthDetails) {
      throw new Error('xiaohongshu_gateway_e2e_depth_artifact_invalid');
    }
    if (requestedCommentScrolls > 0) {
      const detailsWithComments = artifact.result.projection.details.filter((detail) =>
        detail && detail.comments && Array.isArray(detail.comments.comments) && detail.comments.comments.length > 0
      ).length;
      if (detailsWithComments < requestedDepthDetails) {
        throw new Error('xiaohongshu_gateway_e2e_comments_depth_artifact_invalid');
      }
    }
    if (includeReplyThreads) {
      const detailsWithReplies = artifact.result.projection.details.filter((detail) =>
        detail && replyThreadsFromDetail(detail).length >= 1 &&
        replyThreadsFromDetail(detail).length <= requestedReplyThreads &&
        replyThreadsFromDetail(detail).every((thread) =>
          Array.isArray(thread.replies) && thread.replies.length > 0 &&
          ['network_projection', 'dom_fallback', 'hybrid'].includes(thread.captureMode))
      ).length;
      if (detailsWithReplies < requestedDepthDetails) {
        throw new Error('xiaohongshu_gateway_e2e_replies_depth_artifact_invalid');
      }
    }
  }
  const serialized = JSON.stringify(artifact);
  if (/"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId)"\s*:/i.test(serialized)) {
    throw new Error('xiaohongshu_gateway_e2e_artifact_forbidden_material');
  }
}

function assertNoteDetailArtifact(artifact, operationId) {
  if (!artifact || artifact.summary?.operationId !== operationId ||
    artifact.summary?.capability !== 'xiaohongshu.note.public_detail.v1' ||
    artifact.result?.state !== 'completed' || artifact.result?.terminalReason !== 'note_detail_ready' ||
    artifact.result?.navigation?.attempted !== false || artifact.result.navigation.attemptCount !== 0 ||
    artifact.result?.semanticAction?.attempted !== true || artifact.result.semanticAction.attemptCount !== 1 ||
    artifact.result?.page?.publicSurface !== 'note_detail_overlay' ||
    typeof artifact.result?.projection?.publicText !== 'string' ||
    artifact.result.projection.publicText.trim().length < 1 ||
    !['network_projection', 'dom_fallback'].includes(artifact.result.projection.captureMode) ||
    artifact.provenance?.rawPayloadStored !== false || artifact.provenance?.responseUrlsStored !== false ||
    artifact.provenance?.debuggerDetached !== true) {
    throw new Error('xiaohongshu_note_detail_e2e_artifact_invalid');
  }
  const serialized = JSON.stringify(artifact);
  if (/"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|selector|script)"\s*:/i
    .test(serialized)) {
    throw new Error('xiaohongshu_note_detail_e2e_artifact_forbidden_material');
  }
}

function assertNoteCommentsArtifact(artifact, operationId) {
  const actionCount = artifact?.result?.semanticAction?.attemptCount;
  if (!artifact || artifact.summary?.operationId !== operationId ||
    artifact.summary?.capability !== 'xiaohongshu.note.public_comments.v1' ||
    artifact.result?.state !== 'completed' || artifact.result?.terminalReason !== 'note_comments_ready' ||
    artifact.result?.navigation?.attempted !== false || artifact.result.navigation.attemptCount !== 0 ||
    !Number.isInteger(actionCount) || actionCount < 0 || actionCount > 3 ||
    artifact.result.semanticAction.attempted !== (actionCount > 0) ||
    artifact.result?.scroll?.requestedCount !== 3 || artifact.result.scroll.completedCount !== actionCount ||
    artifact.result?.page?.publicSurface !== 'note_detail_overlay' ||
    !Array.isArray(artifact.result?.projection?.comments) || artifact.result.projection.comments.length < 1 ||
    !['network_projection', 'dom_fallback', 'hybrid'].includes(artifact.result.projection.captureMode) ||
    artifact.provenance?.rawPayloadStored !== false || artifact.provenance?.responseUrlsStored !== false ||
    artifact.provenance?.debuggerDetached !== true) throw new Error('xiaohongshu_note_comments_e2e_artifact_invalid');
  if (/"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|selector|script|noteId|profileId)"\s*:/i
    .test(JSON.stringify(artifact))) throw new Error('xiaohongshu_note_comments_e2e_artifact_forbidden_material');
}

function assertNoteRepliesArtifact(artifact, operationId, expectedThreads = 1) {
  const actionCount = artifact?.result?.semanticAction?.attemptCount;
  const captureMode = artifact?.result?.projection?.captureMode;
  const actionTriggeredResponseCount = artifact?.result?.projection?.network?.actionTriggeredResponseCount;
  const completed = artifact?.result?.state === 'completed' && artifact?.result?.terminalReason === 'comment_replies_ready';
  const boundedPartial = expectedThreads > 1 && artifact?.result?.state === 'stopped' &&
    artifact?.result?.terminalReason === 'postcondition_unmet' && typeof artifact?.result?.errorCode === 'string';
  if (!artifact || artifact.summary?.operationId !== operationId ||
    artifact.summary?.capability !== 'xiaohongshu.note.public_comment_replies.v1' ||
    (!completed && !boundedPartial) ||
    artifact.result?.navigation?.attempted !== false || artifact.result.navigation.attemptCount !== 0 ||
    !Number.isInteger(actionCount) || actionCount < 0 || actionCount > expectedThreads ||
    artifact.result.semanticAction.attempted !== (actionCount > 0) ||
    (actionCount === 0 && !['network_projection', 'dom_fallback', 'hybrid'].includes(captureMode)) ||
    artifact.result?.thread?.requestedCount !== expectedThreads ||
    artifact.result.thread.completedCount < 1 || artifact.result.thread.completedCount > expectedThreads ||
    artifact.result?.page?.publicSurface !== 'note_detail_overlay' ||
    !Array.isArray(artifact.result?.projection?.replies) || artifact.result.projection.replies.length < 1 ||
    (expectedThreads > 1 && artifact.result.thread.completedCount > 1 &&
      (!Array.isArray(artifact.result?.projections) ||
        artifact.result.projections.length !== artifact.result.thread.completedCount)) ||
    !['network_projection', 'dom_fallback', 'hybrid'].includes(artifact.result.projection.captureMode) ||
    !Number.isInteger(actionTriggeredResponseCount) || actionTriggeredResponseCount < 0 ||
    actionTriggeredResponseCount > 8 || (actionCount === 0 && actionTriggeredResponseCount !== 0) ||
    artifact.provenance?.rawPayloadStored !== false || artifact.provenance?.responseUrlsStored !== false ||
    artifact.provenance?.debuggerDetached !== true) {
    throw new Error('xiaohongshu_note_replies_e2e_artifact_invalid');
  }
  if (/"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|selector|script|noteId|profileId)"\s*:/i
    .test(JSON.stringify(artifact))) {
    throw new Error('xiaohongshu_note_replies_e2e_artifact_forbidden_material');
  }
}

function assertAccountNotesArtifact(artifact, operationId, navigated, maximumScrolls) {
  const actionCount = artifact?.result?.semanticAction?.attemptCount;
  const completed = artifact?.result?.state === 'completed' && artifact?.result?.terminalReason === 'profile_notes_ready';
  const budgetPartial = artifact?.result?.state === 'stopped' &&
    artifact?.result?.terminalReason === 'profile_notes_budget_exhausted' &&
    artifact?.result?.errorCode === 'xiaohongshu_profile_notes_budget_exhausted';
  if (!artifact || artifact.summary?.operationId !== operationId ||
    artifact.summary?.capability !== 'xiaohongshu.account.public_notes.v1' ||
    (!completed && !budgetPartial) ||
    artifact.result?.navigation?.attempted !== navigated || artifact.result.navigation.attemptCount !== (navigated ? 1 : 0) ||
    !Number.isInteger(actionCount) || actionCount < 0 || actionCount > maximumScrolls ||
    artifact.result.semanticAction.attempted !== (actionCount > 0) ||
    artifact.result?.scroll?.requestedCount !== maximumScrolls || artifact.result.scroll.completedCount !== actionCount ||
    artifact.result?.page?.publicSurface !== 'public_profile' ||
    !Array.isArray(artifact.result?.projection?.items) || artifact.result.projection.items.length < 1 ||
    artifact.provenance?.rawPayloadStored !== false || artifact.provenance?.responseUrlsStored !== false ||
    artifact.provenance?.debuggerDetached !== true) {
    throw new Error('xiaohongshu_account_notes_e2e_artifact_invalid');
  }
  if (/"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|profileId|selector|script)"\s*:/i
    .test(JSON.stringify(artifact))) {
    throw new Error('xiaohongshu_account_notes_e2e_artifact_forbidden_material');
  }
}

function noteCommentsDiagnostics(artifact) {
  return {
    state: artifact?.result?.state ?? null,
    terminalReason: artifact?.result?.terminalReason ?? null,
    captureMode: artifact?.result?.projection?.captureMode ?? null,
    commentCount: artifact?.result?.projection?.comments?.length ?? 0,
    semanticActionAttempted: artifact?.result?.semanticAction?.attempted ?? null,
    semanticActionCount: artifact?.result?.semanticAction?.attemptCount ?? null,
    requestedScrolls: artifact?.result?.scroll?.requestedCount ?? null,
    completedScrolls: artifact?.result?.scroll?.completedCount ?? null,
    networkMatchedPayloadCount: artifact?.result?.projection?.network?.matchedPayloadCount ?? null,
    networkBodyBytesRead: artifact?.result?.projection?.network?.bodyBytesRead ?? null,
    networkCursorObserved: artifact?.result?.projection?.network?.cursorObserved ?? null,
    debuggerDetached: artifact?.provenance?.debuggerDetached ?? null
  };
}

function noteRepliesDiagnostics(artifact) {
  return {
    state: artifact?.result?.state ?? null,
    terminalReason: artifact?.result?.terminalReason ?? null,
    captureMode: artifact?.result?.projection?.captureMode ?? null,
    replyCount: artifact?.result?.projection?.replies?.length ?? 0,
    semanticActionAttempted: artifact?.result?.semanticAction?.attempted ?? null,
    semanticActionCount: artifact?.result?.semanticAction?.attemptCount ?? null,
    requestedThreads: artifact?.result?.thread?.requestedCount ?? null,
    completedThreads: artifact?.result?.thread?.completedCount ?? null,
    networkMatchedPayloadCount: artifact?.result?.projection?.network?.matchedPayloadCount ?? null,
    networkBodyBytesRead: artifact?.result?.projection?.network?.bodyBytesRead ?? null,
    networkCursorObserved: artifact?.result?.projection?.network?.cursorObserved ?? null,
    actionTriggeredResponseCount:
      artifact?.result?.projection?.network?.actionTriggeredResponseCount ?? null,
    debuggerDetached: artifact?.provenance?.debuggerDetached ?? null
  };
}

async function waitForStableDocument(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let generation = null;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const page = await leasedPage();
    if (page.documentGeneration > 0 && page.documentGeneration === generation && Date.now() - stableSince >= 3_000) {
      return page;
    }
    if (page.documentGeneration !== generation) {
      generation = page.documentGeneration;
      stableSince = Date.now();
    }
    await delay(250);
  }
  throw new Error('xiaohongshu_gateway_e2e_document_stability_timeout');
}

async function capture(page, runId) {
  return await client.command({
    type: 'capture_page_visual_evidence',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: page.recordVersion,
      runId
    }
  });
}

async function leasedPage() {
  const page = profileFrom(await snapshot()).pages.find((candidate) => candidate.pageAlias === acquired.page.pageAlias);
  if (!page || page.state !== 'leased' || page.activeLease?.pageLeaseId !== acquired.lease.pageLeaseId) {
    throw new Error('xiaohongshu_gateway_e2e_page_context_changed');
  }
  return page;
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
    throw new Error('xiaohongshu_gateway_e2e_snapshot_invalid');
  }
  return result;
}

function profileFrom(snapshotValue) {
  const profile = snapshotValue.profiles.find((candidate) => candidate.profileId === profileId);
  if (!profile) throw new Error('xiaohongshu_gateway_e2e_profile_missing');
  return profile;
}

async function countTextInGatewayMetadataFiles(directory, needle) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    // Public result titles may naturally contain the search phrase. The
    // persistence invariant applies to queue/audit metadata, while artifact
    // structure separately forbids a raw `query` field.
    if (entry.isFile() && (await readFile(path, 'utf8')).includes(needle)) count += 1;
  }
  return count;
}

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  if (!address || typeof address === 'string' || address.port < 1024) throw new Error('loopback_port_unavailable');
  return address.port;
}

function startGateway(port, directory) {
  return spawn(process.execPath, ['dist/user-browser-server.js'], {
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      COLLECTOR_GATEWAY_PORT: String(port),
      COLLECTOR_GATEWAY_STATE_DIR: directory
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function waitForGateway(origin) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/v1/status`);
      if (response.ok) return;
    } catch {
      // The local Gateway has not finished binding yet.
    }
    await delay(100);
  }
  throw new Error('xiaohongshu_gateway_e2e_gateway_start_timeout');
}

async function stopGateway(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const exited = await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => resolvePromise(false), 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise(true);
    });
  });
  if (!exited && child.exitCode === null) {
    // The Gateway is an ephemeral local child for this canary. A stuck
    // shutdown must not keep the validation process alive after the platform
    // action has already stopped; force only this exact child, then close its
    // pipes so Node cannot wait on orphaned stdio handles.
    child.kill('SIGKILL');
    await new Promise((resolvePromise) => {
      const timeout = setTimeout(resolvePromise, 1_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolvePromise();
      });
    });
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function apiJson(url, init, expectedStatus) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => null);
  if (response.status !== expectedStatus || !payload) {
    throw new Error(safeErrorCode(payload?.error ?? `http_${response.status}`));
  }
  return payload;
}

function sameOriginHeaders(origin) {
  return { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
}

function serviceHeaders(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function record(phase, fact) {
  timeline.push({ at: new Date().toISOString(), phase, fact });
}

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_gateway_e2e_failed';
}

function parseBoundedDepthDetails(value) {
  if (value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 20) {
    throw new Error('xiaohongshu_gateway_e2e_depth_details_invalid');
  }
  return parsed;
}

function parseBoundedCommentScrolls(value) {
  if (value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new Error('xiaohongshu_comments_scrolls_invalid');
  }
  return parsed;
}

function parseBoundedReplyThreads(value) {
  if (value === undefined || value === '') return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new Error('xiaohongshu_reply_threads_invalid');
  }
  return parsed;
}

function replyThreadsFromDetail(detail) {
  if (Array.isArray(detail?.replyThreads)) return detail.replyThreads;
  return detail?.replyThread ? [detail.replyThread] : [];
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
