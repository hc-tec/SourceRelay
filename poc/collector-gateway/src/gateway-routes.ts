import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountSafetyRegistry } from './account-safety';
import { accountSafetyUnlockInput } from './account-safety';
import type { BilibiliAccountVideoPageTwoArtifactStore } from './bilibili-account-video-page-two-artifacts';
import type { BilibiliAccountVideoPageTwoHostRunner } from './bilibili-account-video-page-two-host-runner';
import type { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import type { BilibiliAccountVideoInventoryHostRunner } from './bilibili-account-video-inventory-host-runner';
import type { BilibiliDynamicArtifactStore } from './bilibili-dynamic-artifacts';
import type { BilibiliDynamicHostRunner } from './bilibili-dynamic-host-runner';
import type { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import type { BilibiliVideoDetailHostRunner } from './bilibili-video-detail-host-runner';
import type { CollectionBrowserManager } from './browser-manager';
import type { LoadedGatewayIdentity } from './identity';
import type { BrowserProfileRegistry } from './profiles';
import { createBrowserProfileInput } from './profiles';
import { consoleHtml, consoleScript, consoleStyles } from './console-assets';
import { readJsonBody, requireSameOrigin, send, sendJson } from './gateway-http';

const PROFILE_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface GatewayRouteContext {
  identity: LoadedGatewayIdentity;
  browserManager: CollectionBrowserManager;
  profileRegistry: BrowserProfileRegistry;
  accountSafety: AccountSafetyRegistry;
  accountVideoPageTwoArtifacts: BilibiliAccountVideoPageTwoArtifactStore;
  accountVideoPageTwoRunner: BilibiliAccountVideoPageTwoHostRunner;
  accountVideoInventoryArtifacts: BilibiliAccountVideoInventoryArtifactStore;
  accountVideoInventoryRunner: BilibiliAccountVideoInventoryHostRunner;
  dynamicArtifacts: BilibiliDynamicArtifactStore;
  dynamicRunner: BilibiliDynamicHostRunner;
  videoDetailArtifacts: BilibiliVideoDetailArtifactStore;
  videoDetailRunner: BilibiliVideoDetailHostRunner;
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
      } : { state: 'stopped' }
    });
    return true;
  }
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
  if (request.method === 'GET' && url.pathname === '/v1/account-video-inventory-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.accountVideoInventoryArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/account-video-page-two-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.accountVideoPageTwoArtifacts.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/video-detail-artifacts') {
    sendJson(response, 200, { schemaVersion: 1, artifacts: context.videoDetailArtifacts.list() });
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
  const dynamicArtifact = url.pathname.match(new RegExp(`^/v1/dynamic-artifacts/(${PROFILE_ID})$`, 'i'));
  if (request.method === 'GET' && dynamicArtifact) {
    const artifact = await context.dynamicArtifacts.get(dynamicArtifact[1]!);
    if (!artifact) throw new Error('bilibili_dynamic_artifact_not_found');
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
  const videoDetailArtifact = url.pathname.match(new RegExp(`^/v1/video-detail-artifacts/(${PROFILE_ID})$`, 'i'));
  if (request.method === 'GET' && videoDetailArtifact) {
    const artifact = await context.videoDetailArtifacts.get(videoDetailArtifact[1]!);
    if (!artifact) throw new Error('bilibili_video_detail_artifact_not_found');
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
