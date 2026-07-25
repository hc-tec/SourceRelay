import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountSafetyRegistry } from './account-safety';
import { accountSafetyUnlockInput } from './account-safety';
import type { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import { bilibiliAccountProfileInput } from './bilibili-account-profile-contract';
import type { BilibiliAccountProfileHostRunner } from './bilibili-account-profile-host-runner';
import type { BilibiliAccountVideoDetailMaterializationArtifactStore } from './bilibili-account-video-detail-materialization-artifacts';
import type { BilibiliAccountVideoDetailMaterializationHostRunner } from './bilibili-account-video-detail-materialization-host-runner';
import type { BilibiliAccountVideoPageTwoArtifactStore } from './bilibili-account-video-page-two-artifacts';
import type { BilibiliAccountVideoPageTwoHostRunner } from './bilibili-account-video-page-two-host-runner';
import type { BilibiliAccountVideoPaginationArtifactStore } from './bilibili-account-video-pagination-artifacts';
import type { BilibiliAccountVideoPaginationHostRunner } from './bilibili-account-video-pagination-host-runner';
import type { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import type { BilibiliAccountVideoInventoryHostRunner } from './bilibili-account-video-inventory-host-runner';
import type { BilibiliDynamicArtifactStore } from './bilibili-dynamic-artifacts';
import type { BilibiliDynamicHostRunner } from './bilibili-dynamic-host-runner';
import type { BilibiliCollectionSeriesArtifactStore } from './bilibili-collection-series-artifacts';
import type { BilibiliCollectionSeriesHostRunner } from './bilibili-collection-series-host-runner';
import { bilibiliCollectionSeriesInput } from './bilibili-collection-series-contract';
import type { BilibiliSeriesDetailArtifactStore } from './bilibili-series-detail-artifacts';
import type { BilibiliSeriesDetailHostRunner } from './bilibili-series-detail-host-runner';
import { bilibiliSeriesDetailInput } from './bilibili-series-detail-contract';
import type { BilibiliDanmakuArtifactStore } from './bilibili-danmaku-artifacts';
import type { BilibiliDanmakuHostRunner } from './bilibili-danmaku-host-runner';
import type { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import { bilibiliNativeSearchInput } from './bilibili-native-search-contract';
import type { BilibiliNativeSearchHostRunner } from './bilibili-native-search-host-runner';
import type { BilibiliNativeSearchBatchArtifactStore } from './bilibili-native-search-batch-artifacts';
import {
  bilibiliNativeSearchBatchCoverageInput,
  computeBilibiliNativeSearchBatchCoverage
} from './bilibili-native-search-batch-coverage';
import type { BilibiliNativeSearchBatchCoverageArtifactStore } from './bilibili-native-search-batch-coverage-artifacts';
import { reviewBilibiliNativeSearchBatchCoverage } from './bilibili-native-search-batch-review';
import type { BilibiliNativeSearchBatchHostRunner } from './bilibili-native-search-batch-host-runner';
import type { BilibiliNativeSearchBatchCheckpointStore } from './bilibili-native-search-batch-checkpoints';
import {
  bilibiliNativeSearchBatchCheckpointResolveInput,
  bilibiliNativeSearchBatchInput
} from './bilibili-native-search-batch-contract';
import type { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import type { BilibiliVideoDetailHostRunner } from './bilibili-video-detail-host-runner';
import type { BilibiliVideoDiscussionArtifactStore } from './bilibili-video-discussion-artifacts';
import type { BilibiliVideoDiscussionHostRunner } from './bilibili-video-discussion-host-runner';
import type { BilibiliTranscriptArtifactStore } from './bilibili-transcript-artifacts';
import { bilibiliTranscriptInput } from './bilibili-transcript-contract';
import { bilibiliDanmakuInput } from './bilibili-danmaku-contract';
import { bilibiliVideoDiscussionInput } from './bilibili-video-discussion-contract';
import type { BilibiliTranscriptHostRunner } from './bilibili-transcript-host-runner';
import {
  handleBrowserBindingRoute,
  type BrowserBindingRouteContext
} from './browser-binding-routes';
import type { CollectionBrowserManager } from './browser-manager';
import {
  handleCollectorServiceRoute,
  type CollectorServiceRouteContext
} from './collector-service-routes';
import type { BrowserProfileRegistry } from './profiles';
import { createBrowserProfileInput } from './profiles';
import { consoleHtml, consoleScript, consoleStyles } from './console-assets';
import { readJsonBody, requireSameOrigin, send, sendJson } from './gateway-http';

const PROFILE_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface GatewayRouteContext extends CollectorServiceRouteContext, BrowserBindingRouteContext {
  browserManager: CollectionBrowserManager;
  profileRegistry: BrowserProfileRegistry;
  accountSafety: AccountSafetyRegistry;
  accountProfileArtifacts: BilibiliAccountProfileArtifactStore;
  accountProfileRunner: BilibiliAccountProfileHostRunner;
  accountVideoDetailMaterializationArtifacts: BilibiliAccountVideoDetailMaterializationArtifactStore;
  accountVideoDetailMaterializationRunner: BilibiliAccountVideoDetailMaterializationHostRunner;
  accountVideoPageTwoArtifacts: BilibiliAccountVideoPageTwoArtifactStore;
  accountVideoPageTwoRunner: BilibiliAccountVideoPageTwoHostRunner;
  accountVideoPaginationArtifacts: BilibiliAccountVideoPaginationArtifactStore;
  accountVideoPaginationRunner: BilibiliAccountVideoPaginationHostRunner;
  accountVideoInventoryArtifacts: BilibiliAccountVideoInventoryArtifactStore;
  accountVideoInventoryRunner: BilibiliAccountVideoInventoryHostRunner;
  dynamicArtifacts: BilibiliDynamicArtifactStore;
  dynamicRunner: BilibiliDynamicHostRunner;
  collectionSeriesArtifacts: BilibiliCollectionSeriesArtifactStore;
  collectionSeriesRunner: BilibiliCollectionSeriesHostRunner;
  seriesDetailArtifacts: BilibiliSeriesDetailArtifactStore;
  seriesDetailRunner: BilibiliSeriesDetailHostRunner;
  nativeSearchArtifacts: BilibiliNativeSearchArtifactStore;
  nativeSearchRunner: BilibiliNativeSearchHostRunner;
  nativeSearchBatchArtifacts: BilibiliNativeSearchBatchArtifactStore;
  nativeSearchBatchCoverageArtifacts: BilibiliNativeSearchBatchCoverageArtifactStore;
  nativeSearchBatchCheckpoints: BilibiliNativeSearchBatchCheckpointStore;
  nativeSearchBatchRunner: BilibiliNativeSearchBatchHostRunner;
  videoDetailArtifacts: BilibiliVideoDetailArtifactStore;
  videoDetailRunner: BilibiliVideoDetailHostRunner;
  discussionArtifacts: BilibiliVideoDiscussionArtifactStore;
  discussionRunner: BilibiliVideoDiscussionHostRunner;
  transcriptArtifacts: BilibiliTranscriptArtifactStore;
  transcriptRunner: BilibiliTranscriptHostRunner;
  danmakuArtifacts: BilibiliDanmakuArtifactStore;
  danmakuRunner: BilibiliDanmakuHostRunner;
}

export async function handleGatewayRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: GatewayRouteContext
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/') {
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    send(response, 200, 'text/html; charset=utf-8', consoleHtml);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/style.css') {
    send(response, 200, 'text/css; charset=utf-8', consoleStyles);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/app.js') {
    send(response, 200, 'text/javascript; charset=utf-8', consoleScript);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/status') {
    const snapshot = await context.browserManager.snapshotIfRunning();
    sendJson(response, 200, {
      schemaVersion: 1,
      identity: context.identity.publicIdentity,
      browserHost: snapshot ? {
        state: 'running',
        hostInstanceId: snapshot.hostInstanceId,
        hostProcessId: snapshot.hostProcessId,
        snapshotRevision: snapshot.snapshotRevision,
        profileCount: snapshot.profiles.filter((profile) => profile.running).length
      } : { state: 'stopped' },
      browserBindingCount: context.pairingBroker.pairedExtensionCount
    });
    return true;
  }
  if (await handleBrowserBindingRoute(request, response, url, context)) return true;
  if (await handleCollectorServiceRoute(request, response, url, context)) return true;
  if (request.method === 'GET' && url.pathname === '/v1/browser-host/snapshot') {
    const snapshot = await context.browserManager.snapshotIfRunning();
    sendJson(response, 200, { schemaVersion: 1, snapshot });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/v1/browser-host/exit') {
    if (!sameOrigin(request, response, context)) return true;
    await readJsonBody(request);
    await context.browserManager.exitBrowserHost();
    sendJson(response, 200, { schemaVersion: 1, ok: true, state: 'stopped' });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/profiles') {
    sendJson(response, 200, { schemaVersion: 1, profiles: await context.browserManager.list() });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/v1/profiles') {
    if (!sameOrigin(request, response, context)) return true;
    const profile = await context.profileRegistry.createProfile(createBrowserProfileInput(await readJsonBody(request)));
    const summary = (await context.browserManager.list()).find((candidate) =>
      candidate.profile.profileId === profile.profileId
    );
    sendJson(response, 201, { schemaVersion: 1, profile: summary });
    return true;
  }

  const lifecycle = url.pathname.match(new RegExp(`^/v1/profiles/(${PROFILE_ID})/browser/(launch|close)$`, 'i'));
  if (request.method === 'POST' && lifecycle) {
    if (!sameOrigin(request, response, context)) return true;
    await readJsonBody(request);
    const profileId = lifecycle[1]!;
    const profile = lifecycle[2] === 'launch'
      ? await context.browserManager.launch(profileId)
      : await context.browserManager.close(profileId);
    sendJson(response, 200, { schemaVersion: 1, profile });
    return true;
  }

  const quarantinedPage = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/browser/pages/(page-[1-9][0-9]*)/close-quarantined$`, 'i')
  );
  if (request.method === 'POST' && quarantinedPage) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Number.isSafeInteger((body as { recordVersion?: unknown }).recordVersion) ||
      (body as { recordVersion: number }).recordVersion < 1
    ) throw new Error('close_quarantined_page_input_invalid');
    const page = await context.browserManager.closeQuarantinedPage({
      profileId: quarantinedPage[1]!,
      pageAlias: quarantinedPage[2]!,
      recordVersion: (body as { recordVersion: number }).recordVersion
    });
    sendJson(response, 200, { schemaVersion: 1, page });
    return true;
  }

  const safety = url.pathname.match(new RegExp(`^/v1/profiles/(${PROFILE_ID})/account-safety(?:/(pause|unlock))?$`, 'i'));
  if (safety && request.method === 'GET' && !safety[2]) {
    const profile = context.profileRegistry.get(safety[1]!);
    sendJson(response, 200, {
      schemaVersion: 1,
      accountSafety: context.accountSafety.get(profile.profileId, profile.platform)
    });
    return true;
  }
  if (safety && request.method === 'POST' && safety[2]) {
    if (!sameOrigin(request, response, context)) return true;
    const profile = context.profileRegistry.get(safety[1]!);
    const body = await readJsonBody(request);
    const accountSafety = safety[2] === 'pause'
      ? await context.accountSafety.pause(profile.profileId, profile.platform)
      : await context.accountSafety.unlock(profile.profileId, profile.platform, accountSafetyUnlockInput(body));
    sendJson(response, 200, { schemaVersion: 1, accountSafety });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/dynamic-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.dynamicArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-collection-series-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.collectionSeriesArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/account-profile-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.accountProfileArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-native-search-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.nativeSearchArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-native-search-batch-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.nativeSearchBatchArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-native-search-batch-coverage-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.nativeSearchBatchCoverageArtifacts.list() });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/v1/bilibili-native-search-batch-coverage-artifacts') {
    if (!sameOrigin(request, response, context)) return true;
    const input = bilibiliNativeSearchBatchCoverageInput(await readJsonBody(request));
    const attemptedViews = [];
    for (const artifactId of input.attemptedArtifactIds) {
      const artifact = await context.nativeSearchBatchArtifacts.get(artifactId);
      if (!artifact) throw new Error('bilibili_native_search_batch_artifact_not_found');
      attemptedViews.push(artifact);
    }
    const attemptedById = new Map(attemptedViews.map((artifact) => [artifact.summary.artifactId, artifact]));
    const sampleViews = input.artifactIds.map((artifactId) => attemptedById.get(artifactId)!);
    const computation = computeBilibiliNativeSearchBatchCoverage(sampleViews, undefined, attemptedViews);
    const artifact = await context.nativeSearchBatchCoverageArtifacts.record(computation);
    sendJson(response, 201, { schemaVersion: 1, artifact });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-native-search-batch-checkpoints') {
    sendJson(response, 200, { schemaVersion: 1, checkpoints: context.nativeSearchBatchCheckpoints.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/account-video-inventory-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.accountVideoInventoryArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/account-video-page-two-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.accountVideoPageTwoArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/account-video-pagination-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.accountVideoPaginationArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/account-video-detail-materialization-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.accountVideoDetailMaterializationArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/video-detail-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.videoDetailArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-video-discussion-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.discussionArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-transcript-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.transcriptArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-danmaku-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.danmakuArtifacts.list() });
    return true;
  }
  const dynamicRun = url.pathname.match(new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/dynamic/two-page$`, 'i'));
  if (request.method === 'POST' && dynamicRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as { canonicalProfileUrl?: unknown }).canonicalProfileUrl !== 'string'
    ) throw new Error('bilibili_dynamic_run_input_invalid');
    const result = await context.dynamicRunner.run({
      profileId: dynamicRun[1]!,
      canonicalProfileUrl: (body as { canonicalProfileUrl: string }).canonicalProfileUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        artifact: result.artifact
      }
    });
    return true;
  }
  const collectionSeriesRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/collection-series/overview$`, 'i')
  );
  if (request.method === 'POST' && collectionSeriesRun) {
    if (!sameOrigin(request, response, context)) return true;
    const input = bilibiliCollectionSeriesInput(await readJsonBody(request));
    const result = await context.collectionSeriesRunner.run({
      profileId: collectionSeriesRun[1]!,
      canonicalProfileUrl: input.canonicalProfileUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const seriesDetailRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/collection-series/detail$`, 'i')
  );
  if (request.method === 'POST' && seriesDetailRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    const detail = bilibiliSeriesDetailInput(body);
    const result = await context.seriesDetailRunner.run({
      profileId: seriesDetailRun[1]!,
      ...detail
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/bilibili-series-detail-artifacts') {
    if (!sameOrigin(request, response, context)) return true;
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.seriesDetailArtifacts.list() });
    return true;
  }
  const seriesDetailArtifact = url.pathname.match(
    new RegExp(`^/v1/bilibili-series-detail-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && seriesDetailArtifact) {
    if (!sameOrigin(request, response, context)) return true;
    const artifact = await context.seriesDetailArtifacts.get(seriesDetailArtifact[1]!);
    if (!artifact) {
      sendJson(response, 404, { schemaVersion: 1, ok: false, error: 'artifact_not_found' });
      return true;
    }
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const nativeSearchRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/search/native$`, 'i')
  );
  if (request.method === 'POST' && nativeSearchRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    const search = bilibiliNativeSearchInput(body);
    const result = await context.nativeSearchRunner.run({
      profileId: nativeSearchRun[1]!,
      ...search
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const nativeSearchBatchRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/search/native/batch$`, 'i')
  );
  if (request.method === 'POST' && nativeSearchBatchRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = bilibiliNativeSearchBatchInput({
      ...(await readJsonBody(request) as Record<string, unknown>),
      profileId: nativeSearchBatchRun[1]!
    });
    const result = await context.nativeSearchBatchRunner.run(body);
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        batchId: result.run.batchId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const nativeSearchBatchResume = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/search/native/batch/resume$`, 'i')
  );
  if (request.method === 'POST' && nativeSearchBatchResume) {
    if (!sameOrigin(request, response, context)) return true;
    const result = await context.nativeSearchBatchRunner.resume({
      ...(await readJsonBody(request) as Record<string, unknown>),
      profileId: nativeSearchBatchResume[1]!
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        batchId: result.run.batchId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const nativeSearchBatchResolve = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/search/native/batch/resolve$`, 'i')
  );
  if (request.method === 'POST' && nativeSearchBatchResolve) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    const input = bilibiliNativeSearchBatchCheckpointResolveInput({
      ...(body as Record<string, unknown>),
      profileId: nativeSearchBatchResolve[1]!
    });
    const checkpoint = await context.nativeSearchBatchCheckpoints.resolveUnknown(input);
    sendJson(response, 200, { schemaVersion: 1, checkpoint });
    return true;
  }
  const accountProfileRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/account/profile$`, 'i')
  );
  if (request.method === 'POST' && accountProfileRun) {
    if (!sameOrigin(request, response, context)) return true;
    const profileInput = bilibiliAccountProfileInput(await readJsonBody(request));
    const result = await context.accountProfileRunner.run({
      profileId: accountProfileRun[1]!,
      canonicalProfileUrl: profileInput.canonicalProfileUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const accountVideoInventoryRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/account/video-inventory$`, 'i')
  );
  if (request.method === 'POST' && accountVideoInventoryRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as { canonicalProfileUrl?: unknown }).canonicalProfileUrl !== 'string'
    ) throw new Error('bilibili_account_video_inventory_run_input_invalid');
    const result = await context.accountVideoInventoryRunner.run({
      profileId: accountVideoInventoryRun[1]!,
      canonicalProfileUrl: (body as { canonicalProfileUrl: string }).canonicalProfileUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        artifact: result.artifact
      }
    });
    return true;
  }
  const accountVideoPageTwoRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/account/video-inventory/page-two$`, 'i')
  );
  if (request.method === 'POST' && accountVideoPageTwoRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as { canonicalProfileUrl?: unknown }).canonicalProfileUrl !== 'string'
    ) throw new Error('bilibili_account_video_page_two_run_input_invalid');
    const result = await context.accountVideoPageTwoRunner.run({
      profileId: accountVideoPageTwoRun[1]!,
      canonicalProfileUrl: (body as { canonicalProfileUrl: string }).canonicalProfileUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        artifact: result.artifact
      }
    });
    return true;
  }
  const accountVideoPaginationRun = url.pathname.match(
    new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/account/video-inventory/pagination$`, 'i')
  );
  if (request.method === 'POST' && accountVideoPaginationRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      typeof (body as { canonicalProfileUrl?: unknown }).canonicalProfileUrl !== 'string' ||
      typeof (body as { maxPages?: unknown }).maxPages !== 'number'
    ) throw new Error('bilibili_account_video_pagination_run_input_invalid');
    const result = await context.accountVideoPaginationRunner.run({
      profileId: accountVideoPaginationRun[1]!,
      canonicalProfileUrl: (body as { canonicalProfileUrl: string }).canonicalProfileUrl,
      maxPages: (body as { maxPages: number }).maxPages
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const accountVideoDetailMaterializationRun = url.pathname.match(new RegExp(
    `^/v1/profiles/(${PROFILE_ID})/bilibili/account/video-inventory/pagination-artifacts/(${PROFILE_ID})/materialize-details$`,
    'i'
  ));
  if (request.method === 'POST' && accountVideoDetailMaterializationRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(body, 'bvids')
    ) throw new Error('bilibili_account_video_detail_materialization_input_invalid');
    const result = await context.accountVideoDetailMaterializationRunner.run({
      profileId: accountVideoDetailMaterializationRun[1]!,
      sourceArtifactId: accountVideoDetailMaterializationRun[2]!,
      bvids: (body as { bvids: string[] }).bvids
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const videoDetailRun = url.pathname.match(new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/video/detail$`, 'i'));
  if (request.method === 'POST' && videoDetailRun) {
    if (!sameOrigin(request, response, context)) return true;
    const body = await readJsonBody(request);
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as { canonicalVideoUrl?: unknown }).canonicalVideoUrl !== 'string'
    ) throw new Error('bilibili_video_detail_run_input_invalid');
    const result = await context.videoDetailRunner.run({
      profileId: videoDetailRun[1]!,
      canonicalVideoUrl: (body as { canonicalVideoUrl: string }).canonicalVideoUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        artifact: result.artifact
      }
    });
    return true;
  }
  const discussionRun = url.pathname.match(new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/video/discussion$`, 'i'));
  if (request.method === 'POST' && discussionRun) {
    if (!sameOrigin(request, response, context)) return true;
    const discussion = bilibiliVideoDiscussionInput(await readJsonBody(request));
    const result = await context.discussionRunner.run({
      profileId: discussionRun[1]!,
      canonicalVideoUrl: discussion.canonicalVideoUrl,
      actions: discussion.actions
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const transcriptRun = url.pathname.match(new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/video/transcript$`, 'i'));
  if (request.method === 'POST' && transcriptRun) {
    if (!sameOrigin(request, response, context)) return true;
    const transcript = bilibiliTranscriptInput(await readJsonBody(request));
    const result = await context.transcriptRunner.run({
      profileId: transcriptRun[1]!,
      canonicalVideoUrl: transcript.canonicalVideoUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const danmakuRun = url.pathname.match(new RegExp(`^/v1/profiles/(${PROFILE_ID})/bilibili/video/danmaku$`, 'i'));
  if (request.method === 'POST' && danmakuRun) {
    if (!sameOrigin(request, response, context)) return true;
    const danmaku = bilibiliDanmakuInput(await readJsonBody(request));
    const result = await context.danmakuRunner.run({
      profileId: danmakuRun[1]!,
      canonicalVideoUrl: danmaku.canonicalVideoUrl
    });
    sendJson(response, 201, {
      schemaVersion: 1,
      result: {
        runId: result.run.runId,
        state: result.run.state,
        errorCode: result.run.errorCode,
        terminalReason: result.run.coverage.terminalReason,
        coverage: result.run.coverage,
        artifact: result.artifact
      }
    });
    return true;
  }
  const dynamicArtifact = url.pathname.match(new RegExp(`^/v1/dynamic-artifacts/(${PROFILE_ID})$`, 'i'));
  if (request.method === 'GET' && dynamicArtifact) {
    const artifact = await context.dynamicArtifacts.get(dynamicArtifact[1]!);
    if (!artifact) throw new Error('bilibili_dynamic_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const collectionSeriesArtifact = url.pathname.match(
    new RegExp(`^/v1/bilibili-collection-series-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && collectionSeriesArtifact) {
    const artifact = await context.collectionSeriesArtifacts.get(collectionSeriesArtifact[1]!);
    if (!artifact) throw new Error('bilibili_collection_series_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const nativeSearchArtifact = url.pathname.match(
    new RegExp(`^/v1/bilibili-native-search-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && nativeSearchArtifact) {
    const artifact = await context.nativeSearchArtifacts.get(nativeSearchArtifact[1]!);
    if (!artifact) throw new Error('bilibili_native_search_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const nativeSearchBatchArtifact = url.pathname.match(
    new RegExp(`^/v1/bilibili-native-search-batch-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && nativeSearchBatchArtifact) {
    const artifact = await context.nativeSearchBatchArtifacts.get(nativeSearchBatchArtifact[1]!);
    if (!artifact) throw new Error('bilibili_native_search_batch_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const nativeSearchBatchCoverageArtifact = url.pathname.match(
    new RegExp(`^/v1/bilibili-native-search-batch-coverage-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && nativeSearchBatchCoverageArtifact) {
    const artifact = await context.nativeSearchBatchCoverageArtifacts.get(nativeSearchBatchCoverageArtifact[1]!);
    if (!artifact) throw new Error('bilibili_native_search_batch_coverage_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const nativeSearchBatchCoverageReview = url.pathname.match(
    new RegExp(`^/v1/bilibili-native-search-batch-coverage-artifacts/(${PROFILE_ID})/review$`, 'i')
  );
  if (request.method === 'GET' && nativeSearchBatchCoverageReview) {
    const artifact = await context.nativeSearchBatchCoverageArtifacts.get(nativeSearchBatchCoverageReview[1]!);
    if (!artifact) throw new Error('bilibili_native_search_batch_coverage_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, review: reviewBilibiliNativeSearchBatchCoverage(artifact) });
    return true;
  }
  const accountProfileArtifact = url.pathname.match(
    new RegExp(`^/v1/account-profile-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && accountProfileArtifact) {
    const artifact = await context.accountProfileArtifacts.get(accountProfileArtifact[1]!);
    if (!artifact) throw new Error('bilibili_account_profile_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const accountVideoInventoryArtifact = url.pathname.match(
    new RegExp(`^/v1/account-video-inventory-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && accountVideoInventoryArtifact) {
    const artifact = await context.accountVideoInventoryArtifacts.get(accountVideoInventoryArtifact[1]!);
    if (!artifact) throw new Error('bilibili_account_video_inventory_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const accountVideoPageTwoArtifact = url.pathname.match(
    new RegExp(`^/v1/account-video-page-two-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && accountVideoPageTwoArtifact) {
    const artifact = await context.accountVideoPageTwoArtifacts.get(accountVideoPageTwoArtifact[1]!);
    if (!artifact) throw new Error('bilibili_account_video_page_two_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const accountVideoPaginationArtifact = url.pathname.match(
    new RegExp(`^/v1/account-video-pagination-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && accountVideoPaginationArtifact) {
    const artifact = await context.accountVideoPaginationArtifacts.get(accountVideoPaginationArtifact[1]!);
    if (!artifact) throw new Error('bilibili_account_video_pagination_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const accountVideoDetailMaterializationArtifact = url.pathname.match(
    new RegExp(`^/v1/account-video-detail-materialization-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && accountVideoDetailMaterializationArtifact) {
    const artifact = await context.accountVideoDetailMaterializationArtifacts.get(accountVideoDetailMaterializationArtifact[1]!);
    if (!artifact) throw new Error('bilibili_account_video_detail_materialization_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const videoDetailArtifact = url.pathname.match(new RegExp(`^/v1/video-detail-artifacts/(${PROFILE_ID})$`, 'i'));
  if (request.method === 'GET' && videoDetailArtifact) {
    const artifact = await context.videoDetailArtifacts.get(videoDetailArtifact[1]!);
    if (!artifact) throw new Error('bilibili_video_detail_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const discussionArtifact = url.pathname.match(
    new RegExp(`^/v1/bilibili-video-discussion-artifacts/(${PROFILE_ID})$`, 'i')
  );
  if (request.method === 'GET' && discussionArtifact) {
    const artifact = await context.discussionArtifacts.get(discussionArtifact[1]!);
    if (!artifact) throw new Error('bilibili_video_discussion_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const transcriptArtifact = url.pathname.match(new RegExp(`^/v1/bilibili-transcript-artifacts/(${PROFILE_ID})$`, 'i'));
  if (request.method === 'GET' && transcriptArtifact) {
    const artifact = await context.transcriptArtifacts.get(transcriptArtifact[1]!);
    if (!artifact) throw new Error('bilibili_transcript_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  const danmakuArtifact = url.pathname.match(new RegExp(`^/v1/bilibili-danmaku-artifacts/(${PROFILE_ID})$`, 'i'));
  if (request.method === 'GET' && danmakuArtifact) {
    const artifact = await context.danmakuArtifacts.get(danmakuArtifact[1]!);
    if (!artifact) throw new Error('bilibili_danmaku_artifact_not_found');
    sendJson(response, 200, { schemaVersion: 1, artifact });
    return true;
  }
  return false;
}

function sameOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  context: GatewayRouteContext
): boolean {
  return requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin);
}
