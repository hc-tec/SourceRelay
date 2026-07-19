import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CollectionBrowserManager } from './browser-manager';
import { managedExtensionRuntimeDiagnostics } from './managed-extension-runtime';
import { AccountSafetyRegistry, accountSafetyUnlockInput } from './account-safety';
import { loadGatewayConfig } from './config';
import { consoleHtml, consoleScript, consoleStyles } from './console-assets';
import {
  DetailCapabilityValidationRegistry,
  detailCapabilityValidationInput
} from './detail-validations';
import { GatewayEvidenceRegistry, gatewayEvidenceSubmission } from './evidence';
import { loadGatewayIdentity } from './identity';
import { PairingBroker, type PairingClaimInput } from './pairing';
import { BrowserProfileRegistry, createBrowserProfileInput } from './profiles';
import {
  SourceReconnaissanceRegistry,
  sourceReconnaissanceInput
} from './source-reconnaissance';
import { bilibiliInteractionReconnaissanceInput } from './interaction-reconnaissance';
import { InteractionReconnaissanceRegistry } from './interaction-reconnaissance-registry';
import { bilibiliAccountArchiveInput } from './bilibili-account-archive';
import { BilibiliAccountArchiveArtifactStore } from './bilibili-account-archive-artifacts';
import { bilibiliAccountProfileInput } from './bilibili-account-profile';
import { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import { bilibiliCollectionSeriesInput } from './bilibili-collection-series';
import { BilibiliCollectionSeriesArtifactStore } from './bilibili-collection-series-artifacts';
import {
  TranscriptArtifactRegistry,
  bilibiliTranscriptValidationInput
} from './transcript-artifacts';
import { GatewayTaskQueue, bilibiliDetailTaskInput, scoutTaskInput } from './tasks';
import {
  CapabilityValidationRegistry,
  capabilityValidationInput,
  capabilityValidationReviewInput
} from './validations';
import type {
  GatewayPreflightSubmission,
  GatewayStageReceipt
} from '../../collector-extension/src/shared/control-plane';

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_EVIDENCE_BODY_BYTES = 256 * 1024;
const extensionOriginPattern = /^chrome-extension:\/\/[a-p]{32}$/;

function securityHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('cross-origin-resource-policy', 'same-site');
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, 'application/json; charset=utf-8', `${JSON.stringify(value)}\n`);
}

function allowExtensionCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !extensionOriginPattern.test(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader(
    'access-control-allow-headers',
    'content-type, x-collector-extension-id, x-collector-extension-instance, x-collector-timestamp, x-collector-nonce, x-collector-body-sha256, x-collector-authorization'
  );
  response.setHeader('access-control-max-age', '300');
  response.setHeader('vary', 'origin');
  return true;
}

// Chromium may omit Origin on an extension service worker's same-scheme GET
// even though its custom authentication headers still trigger a protected
// CORS preflight for web pages. Pairing claims and OPTIONS remain
// origin-required; an already-paired request may omit Origin, but if one is
// present it must still be the exact chrome-extension origin.
function allowAuthenticatedExtensionRequest(
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  return request.headers.origin === undefined || allowExtensionCors(request, response);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requireConsoleOrigin(request: IncomingMessage, response: ServerResponse, origin: string): boolean {
  if (request.headers.origin === origin) return true;
  sendJson(response, 403, { error: 'console_origin_required' });
  return false;
}

async function readTextBody(
  request: IncomingMessage,
  maximumBytes = MAX_REQUEST_BODY_BYTES
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const text = await readTextBody(request);
  return text ? JSON.parse(text) as unknown : {};
}

function preflightSubmission(value: unknown): GatewayPreflightSubmission {
  if (!value || typeof value !== 'object') throw new Error('preflight_submission_invalid');
  const candidate = value as Partial<GatewayPreflightSubmission>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.taskId !== 'string' ||
    !candidate.plan ||
    candidate.plan.schemaVersion !== 1 ||
    candidate.plan.taskId !== candidate.taskId
  ) {
    throw new Error('preflight_submission_invalid');
  }
  return candidate as GatewayPreflightSubmission;
}

function stageReceipt(value: unknown): GatewayStageReceipt {
  if (!value || typeof value !== 'object') throw new Error('task_stage_receipt_invalid');
  const candidate = value as Partial<GatewayStageReceipt>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.taskId !== 'string' ||
    typeof candidate.stageId !== 'string' ||
    (candidate.status !== 'accepted' && candidate.status !== 'blocked') ||
    typeof candidate.recordedAt !== 'string'
  ) {
    throw new Error('task_stage_receipt_invalid');
  }
  return candidate as GatewayStageReceipt;
}

function pairingClaim(value: unknown): PairingClaimInput {
  if (!value || typeof value !== 'object') throw new Error('pairing_claim_invalid');
  const candidate = value as Partial<PairingClaimInput>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.pairingSessionId !== 'string' || candidate.pairingSessionId.length > 100 ||
    typeof candidate.pairingCode !== 'string' || candidate.pairingCode.length > 20 ||
    typeof candidate.extensionId !== 'string' || candidate.extensionId.length > 64 ||
    typeof candidate.extensionInstanceId !== 'string' || candidate.extensionInstanceId.length > 100 ||
    typeof candidate.extensionChallenge !== 'string' || candidate.extensionChallenge.length > 100
  ) {
    throw new Error('pairing_claim_invalid');
  }
  return candidate as PairingClaimInput;
}

const config = loadGatewayConfig();
const identity = await loadGatewayIdentity(config);
const pairingBroker = await PairingBroker.create(identity, config.stateDirectory);
const profileRegistry = await BrowserProfileRegistry.create(config.profileDirectory, config.stateDirectory);
const accountSafetyRegistry = await AccountSafetyRegistry.create(config.stateDirectory);
const browserManager = new CollectionBrowserManager(config, profileRegistry, accountSafetyRegistry);
const validationRegistry = await CapabilityValidationRegistry.create(config.stateDirectory);
const detailValidationRegistry = await DetailCapabilityValidationRegistry.create(config.stateDirectory);
const sourceReconnaissanceRegistry = await SourceReconnaissanceRegistry.create(config.stateDirectory);
const interactionReconnaissanceRegistry = await InteractionReconnaissanceRegistry.create(config.stateDirectory);
const transcriptArtifactRegistry = await TranscriptArtifactRegistry.create(config.stateDirectory);
const accountArchiveArtifactStore = await BilibiliAccountArchiveArtifactStore.create(config.stateDirectory);
const accountProfileArtifactStore = await BilibiliAccountProfileArtifactStore.create(config.stateDirectory);
const collectionSeriesArtifactStore = await BilibiliCollectionSeriesArtifactStore.create(config.stateDirectory);
const evidenceRegistry = await GatewayEvidenceRegistry.create(config.stateDirectory);
const taskQueue = new GatewayTaskQueue(identity, evidenceRegistry, accountSafetyRegistry);
const expectedHost = `${config.host}:${config.port}`;

const server = createServer(async (request, response) => {
  try {
    if (request.socket.remoteAddress !== config.host || request.headers.host !== expectedHost) {
      sendJson(response, 403, { error: 'loopback_request_rejected' });
      return;
    }

    const url = new URL(request.url ?? '/', identity.publicIdentity.loopbackOrigin);
    if (request.method === 'GET' && url.pathname === '/') {
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      );
      send(response, 200, 'text/html; charset=utf-8', consoleHtml);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/style.css') {
      send(response, 200, 'text/css; charset=utf-8', consoleStyles);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      send(response, 200, 'text/javascript; charset=utf-8', consoleScript);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/status') {
      const profiles = await browserManager.list();
      sendJson(response, 200, {
        schemaVersion: 1,
        identity: identity.publicIdentity,
        pairedExtensionCount: pairingBroker.pairedExtensionCount,
        browserProfileCount: profiles.length,
        runningBrowserProfileCount: profiles.filter((profile) => profile.running).length
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/profiles') {
      sendJson(response, 200, { schemaVersion: 1, profiles: await browserManager.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/account-safety') {
      sendJson(response, 200, { schemaVersion: 1, records: accountSafetyRegistry.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/validations') {
      sendJson(response, 200, {
        schemaVersion: 1,
        validations: [...validationRegistry.list(), ...detailValidationRegistry.list()]
          .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/reconnaissance') {
      sendJson(response, 200, {
        schemaVersion: 1,
        runs: sourceReconnaissanceRegistry.list()
          .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/reconnaissance/interactions') {
      sendJson(response, 200, {
        schemaVersion: 1,
        runs: interactionReconnaissanceRegistry.list()
          .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/transcripts') {
      sendJson(response, 200, { schemaVersion: 1, artifacts: transcriptArtifactRegistry.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/account-archives') {
      sendJson(response, 200, { schemaVersion: 1, artifacts: accountArchiveArtifactStore.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/account-profile-artifacts') {
      sendJson(response, 200, { schemaVersion: 1, artifacts: accountProfileArtifactStore.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/collection-series-artifacts') {
      sendJson(response, 200, { schemaVersion: 1, artifacts: collectionSeriesArtifactStore.list() });
      return;
    }
    const collectionSeriesArtifactMatch = url.pathname.match(
      /^\/v1\/collection-series-artifacts\/([0-9a-f-]{36})$/i
    );
    if (request.method === 'GET' && collectionSeriesArtifactMatch) {
      const artifact = await collectionSeriesArtifactStore.get(collectionSeriesArtifactMatch[1]);
      if (!artifact) throw new Error('bilibili_collection_series_artifact_not_found');
      sendJson(response, 200, { schemaVersion: 1, artifact });
      return;
    }
    const accountProfileArtifactMatch = url.pathname.match(
      /^\/v1\/account-profile-artifacts\/([0-9a-f-]{36})$/i
    );
    if (request.method === 'GET' && accountProfileArtifactMatch) {
      const artifact = await accountProfileArtifactStore.get(accountProfileArtifactMatch[1]);
      if (!artifact) throw new Error('bilibili_account_profile_artifact_not_found');
      sendJson(response, 200, { schemaVersion: 1, artifact });
      return;
    }
    const accountArchiveArtifactMatch = url.pathname.match(
      /^\/v1\/account-archives\/([0-9a-f-]{36})$/i
    );
    if (request.method === 'GET' && accountArchiveArtifactMatch) {
      const artifact = await accountArchiveArtifactStore.get(accountArchiveArtifactMatch[1]);
      if (!artifact) throw new Error('bilibili_account_archive_artifact_not_found');
      sendJson(response, 200, { schemaVersion: 1, artifact });
      return;
    }
    const transcriptArtifactMatch = url.pathname.match(/^\/v1\/transcripts\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && transcriptArtifactMatch) {
      const artifact = await transcriptArtifactRegistry.get(transcriptArtifactMatch[1]);
      if (!artifact) throw new Error('transcript_artifact_not_found');
      sendJson(response, 200, { schemaVersion: 1, artifact });
      return;
    }
    const interactionReconnaissanceRecordMatch = url.pathname.match(
      /^\/v1\/reconnaissance\/interactions\/([0-9a-f-]{36})$/i
    );
    if (request.method === 'GET' && interactionReconnaissanceRecordMatch) {
      const run = interactionReconnaissanceRegistry.get(interactionReconnaissanceRecordMatch[1]);
      if (!run) throw new Error('interaction_reconnaissance_record_not_found');
      sendJson(response, 200, { schemaVersion: 1, run });
      return;
    }
    const validationReviewMatch = url.pathname.match(/^\/v1\/validations\/([0-9a-f-]{36})\/review$/i);
    if (request.method === 'POST' && validationReviewMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        validation: validationRegistry.has(validationReviewMatch[1])
          ? await validationRegistry.review(
              validationReviewMatch[1],
              capabilityValidationReviewInput(await readJsonBody(request))
            )
          : await detailValidationRegistry.review(
              validationReviewMatch[1],
              capabilityValidationReviewInput(await readJsonBody(request))
            )
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/profiles') {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const profile = await profileRegistry.createProfile(createBrowserProfileInput(await readJsonBody(request)));
      sendJson(response, 201, {
        schemaVersion: 1,
        profile: (await browserManager.list()).find((summary) => summary.profile.profileId === profile.profileId)
      });
      return;
    }
    const profileLaunchMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/launch$/i);
    if (request.method === 'POST' && profileLaunchMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, { schemaVersion: 1, profile: await browserManager.launch(profileLaunchMatch[1]) });
      return;
    }
    const profileSafetyPauseMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/account-safety\/pause$/i
    );
    if (request.method === 'POST' && profileSafetyPauseMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const profile = profileRegistry.get(profileSafetyPauseMatch[1]);
      await browserManager.close(profile.profileId);
      sendJson(response, 200, {
        schemaVersion: 1,
        accountSafety: await accountSafetyRegistry.pause(
          profile.profileId,
          profile.platform,
          'user_safety_pause'
        )
      });
      return;
    }
    const profileSafetyUnlockMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/account-safety\/unlock$/i
    );
    if (request.method === 'POST' && profileSafetyUnlockMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const profile = profileRegistry.get(profileSafetyUnlockMatch[1]);
      sendJson(response, 200, {
        schemaVersion: 1,
        accountSafety: await accountSafetyRegistry.unlock(
          profile.profileId,
          profile.platform,
          accountSafetyUnlockInput(await readJsonBody(request))
        )
      });
      return;
    }
    const profileLoginPageMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/login-page$/i);
    if (request.method === 'POST' && profileLoginPageMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        profile: await browserManager.openPlatformLoginPage(profileLoginPageMatch[1])
      });
      return;
    }
    const profileLoginStatusMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/login-status$/i);
    if (request.method === 'POST' && profileLoginStatusMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        loginStatus: await browserManager.inspectPlatformLoginStatus(profileLoginStatusMatch[1])
      });
      return;
    }
    const profileCloseMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/close$/i);
    if (request.method === 'POST' && profileCloseMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      await browserManager.close(profileCloseMatch[1]);
      sendJson(response, 200, {
        schemaVersion: 1,
        profile: (await browserManager.list()).find(
          (summary) => summary.profile.profileId === profileCloseMatch[1]
        )
      });
      return;
    }
    const profilePairMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/pair$/i);
    if (request.method === 'POST' && profilePairMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const session = pairingBroker.createSession();
      const profile = await browserManager.pairProfileWithGateway(profilePairMatch[1], {
        loopbackOrigin: identity.publicIdentity.loopbackOrigin,
        gatewayInstanceId: identity.publicIdentity.gatewayInstanceId,
        pairingSessionId: session.pairingSessionId,
        pairingCode: session.pairingCode
      });
      // The one-time pairing code and Session ID remain process-local. This
      // profile-level product route returns only the resulting runtime state.
      sendJson(response, 200, { schemaVersion: 1, profile });
      return;
    }
    const profilePermissionMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/strategy-permission$/i
    );
    if (request.method === 'POST' && profilePermissionMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        profile: await browserManager.requestStrategyPermission(profilePermissionMatch[1])
      });
      return;
    }
    const profilePollMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/poll$/i);
    if (request.method === 'POST' && profilePollMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        profile: await browserManager.pollGatewayTasks(profilePollMatch[1])
      });
      return;
    }
    const bilibiliValidationMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/validations\/bilibili$/i
    );
    if (request.method === 'POST' && bilibiliValidationMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = capabilityValidationInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAnonymousValidation(
        bilibiliValidationMatch[1],
        input.query,
        new Set(validationRegistry.list().map((validation) => validation.runId))
      );
      sendJson(response, 201, { schemaVersion: 1, validation: await validationRegistry.record(run) });
      return;
    }
    const bilibiliDetailValidationMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/validations\/bilibili-detail$/i
    );
    if (request.method === 'POST' && bilibiliDetailValidationMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = detailCapabilityValidationInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAnonymousDetailValidation(
        bilibiliDetailValidationMatch[1],
        input.canonicalUrl,
        new Set(detailValidationRegistry.list().map((validation) => validation.runId))
      );
      sendJson(response, 201, {
        schemaVersion: 1,
        validation: await detailValidationRegistry.record(run)
      });
      return;
    }
    const bilibiliDetailReconnaissanceMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/reconnaissance\/bilibili-detail$/i
    );
    if (request.method === 'POST' && bilibiliDetailReconnaissanceMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = sourceReconnaissanceInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAnonymousDetailReconnaissance(
        bilibiliDetailReconnaissanceMatch[1],
        input.canonicalUrl
      );
      sendJson(response, 201, {
        schemaVersion: 1,
        run: await sourceReconnaissanceRegistry.record(run)
      });
      return;
    }
    const bilibiliInteractionReconnaissanceMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/reconnaissance\/bilibili-interactions$/i
    );
    if (request.method === 'POST' && bilibiliInteractionReconnaissanceMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = bilibiliInteractionReconnaissanceInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAuthenticatedInteractionReconnaissance(
        bilibiliInteractionReconnaissanceMatch[1],
        input.canonicalUrl,
        input.actionScope,
        input.responseBodyMapping
      );
      sendJson(response, 201, {
        schemaVersion: 1,
        run: await interactionReconnaissanceRegistry.record(run)
      });
      return;
    }
    const bilibiliAccountArchiveReconnaissanceMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/reconnaissance\/bilibili-account-archive$/i
    );
    if (request.method === 'POST' && bilibiliAccountArchiveReconnaissanceMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = bilibiliAccountArchiveInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAuthenticatedAccountArchiveReconnaissance(
        bilibiliAccountArchiveReconnaissanceMatch[1],
        input
      );
      const artifact = await accountArchiveArtifactStore.record(run);
      sendJson(response, 201, {
        schemaVersion: 1,
        run: {
          runId: run.runId,
          state: run.state,
          errorCode: run.errorCode,
          coverage: run.coverage,
          accountStableId: run.account?.stableAccountId ?? null,
          admissionEligible: false
        },
        artifact
      });
      return;
    }
    const bilibiliAccountProfileReconnaissanceMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/reconnaissance\/bilibili-account-profile$/i
    );
    if (request.method === 'POST' && bilibiliAccountProfileReconnaissanceMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = bilibiliAccountProfileInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAuthenticatedAccountProfileReconnaissance(
        bilibiliAccountProfileReconnaissanceMatch[1],
        input
      );
      const artifact = await accountProfileArtifactStore.record(run);
      sendJson(response, 201, {
        schemaVersion: 1,
        run: {
          runId: run.runId,
          state: run.state,
          errorCode: run.errorCode,
          coverage: run.coverage,
          stableAccountId: run.snapshot?.stableAccountId ?? null,
          admissionEligible: false
        },
        artifact
      });
      return;
    }
    const bilibiliCollectionSeriesReconnaissanceMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/reconnaissance\/bilibili-collection-series-overview$/i
    );
    if (request.method === 'POST' && bilibiliCollectionSeriesReconnaissanceMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = bilibiliCollectionSeriesInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAuthenticatedCollectionSeriesReconnaissance(
        bilibiliCollectionSeriesReconnaissanceMatch[1],
        input
      );
      const artifact = await collectionSeriesArtifactStore.record(run);
      sendJson(response, 201, {
        schemaVersion: 1,
        run: {
          runId: run.runId,
          state: run.state,
          errorCode: run.errorCode,
          coverage: run.coverage,
          stableAccountId: run.overview?.stableAccountId ?? null,
          admissionEligible: false
        },
        artifact
      });
      return;
    }
    const bilibiliTranscriptValidationMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/validations\/bilibili-transcript$/i
    );
    if (request.method === 'POST' && bilibiliTranscriptValidationMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = bilibiliTranscriptValidationInput(await readJsonBody(request));
      const validation = await browserManager.runBilibiliAuthenticatedTranscriptValidation(
        bilibiliTranscriptValidationMatch[1],
        input.canonicalUrl
      );
      const hasPublicContent = validation.captures.some((capture) => capture.status === 'captured');
      const artifact = hasPublicContent ? await transcriptArtifactRegistry.record(validation) : null;
      sendJson(response, 201, {
        schemaVersion: 1,
        validation: {
          runId: validation.runId,
          state: validation.state,
          terminalStatus: validation.terminalStatus,
          errorCode: validation.errorCode,
          objectiveStatus: validation.interaction?.objective.status ?? 'unavailable',
          captureCount: validation.captures.length,
          admissionEligible: false
        },
        artifact
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/tasks') {
      sendJson(response, 200, { schemaVersion: 1, tasks: await taskQueue.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/evidence') {
      const taskId = url.searchParams.get('taskId') ?? undefined;
      if (taskId && !/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error('evidence_task_id_invalid');
      sendJson(response, 200, { schemaVersion: 1, batches: evidenceRegistry.list(taskId) });
      return;
    }
    const evidenceBatchMatch = url.pathname.match(/^\/v1\/evidence\/batches\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && evidenceBatchMatch) {
      const batch = evidenceRegistry.getBatch(evidenceBatchMatch[1]);
      if (!batch) throw new Error('evidence_batch_not_found');
      sendJson(response, 200, { schemaVersion: 1, batch });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/tasks') {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = scoutTaskInput(await readJsonBody(request));
      const bindings = profileRegistry.collectionBindings(input.platforms, input.profileIds);
      sendJson(response, 201, taskQueue.createScoutTask(input, bindings));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/tasks/detail') {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = bilibiliDetailTaskInput(await readJsonBody(request));
      const binding = profileRegistry.collectionBindings(
        ['bilibili'],
        { bilibili: input.profileId }
      ).bilibili;
      if (!binding) throw new Error('task_detail_profile_invalid');
      sendJson(response, 201, taskQueue.createBilibiliDetailTask(input, binding));
      return;
    }
    const approvalMatch = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/approve$/i);
    if (request.method === 'POST' && approvalMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, await taskQueue.approve(approvalMatch[1]));
      return;
    }
    const taskResumeMatch = url.pathname.match(
      /^\/v1\/tasks\/([0-9a-f-]{36})\/resume$/i
    );
    if (request.method === 'POST' && taskResumeMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, await taskQueue.resumeAfterUserConfirmation(taskResumeMatch[1]));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/pairing/sessions') {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 201, pairingBroker.createSession());
      return;
    }
    if (
      request.method === 'OPTIONS' &&
      (url.pathname === '/v1/pairing/claim' || url.pathname.startsWith('/v1/extension/'))
    ) {
      if (!allowExtensionCors(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      securityHeaders(response);
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/pairing/claim') {
      if (!allowExtensionCors(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const claim = pairingClaim(await readJsonBody(request));
      if (request.headers.origin !== `chrome-extension://${claim.extensionId}`) {
        sendJson(response, 403, { error: 'extension_origin_mismatch' });
        return;
      }
      sendJson(response, 200, await pairingBroker.claim(claim));
      return;
    }
    if (url.pathname === '/v1/extension/work' && request.method === 'GET') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body: ''
      });
      const work = await taskQueue.nextWork(extension.extensionInstanceId);
      if (!work) {
        securityHeaders(response);
        response.statusCode = 204;
        response.end();
        return;
      }
      sendJson(response, 200, work);
      return;
    }
    if (url.pathname === '/v1/extension/preflight' && request.method === 'POST') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const body = await readTextBody(request);
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body
      });
      sendJson(
        response,
        200,
        taskQueue.submitPreflight(preflightSubmission(JSON.parse(body) as unknown), extension.extensionInstanceId)
      );
      return;
    }
    if (url.pathname === '/v1/extension/stage-receipt' && request.method === 'POST') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const body = await readTextBody(request);
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body
      });
      sendJson(
        response,
        200,
        await taskQueue.submitStageReceipt(
          stageReceipt(JSON.parse(body) as unknown),
          extension.extensionInstanceId
        )
      );
      return;
    }
    if (url.pathname === '/v1/extension/evidence' && request.method === 'POST') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const body = await readTextBody(request, MAX_EVIDENCE_BODY_BYTES);
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body
      });
      sendJson(
        response,
        200,
        await taskQueue.submitEvidence(
          gatewayEvidenceSubmission(JSON.parse(body) as unknown),
          extension.extensionInstanceId
        )
      );
      return;
    }
    sendJson(response, 404, { error: 'route_not_found' });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'gateway_request_failed';
    const runtimeDiagnostics = managedExtensionRuntimeDiagnostics(error);
    const clientError =
      code.startsWith('pairing_') ||
      code.startsWith('request_') ||
      code.startsWith('task_') ||
      code.startsWith('profile_') ||
      code.startsWith('collector_extension_') ||
      code.startsWith('account_safety_') ||
      code.startsWith('validation_') ||
      code.startsWith('source_reconnaissance_') ||
      code.startsWith('interaction_reconnaissance_') ||
      code.startsWith('transcript_') ||
      code.startsWith('evidence_') ||
      code.startsWith('preflight_') ||
      code.endsWith('_invalid') ||
      code === 'one_or_more_capabilities_are_not_ready';
    sendJson(response, clientError ? 400 : 500, {
      error: clientError ? code : 'gateway_request_failed',
      ...(runtimeDiagnostics ? { diagnostics: runtimeDiagnostics } : {})
    });
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 50;

server.listen(config.port, config.host, () => {
  process.stdout.write(`Collector Gateway ready at ${identity.publicIdentity.loopbackOrigin}\n`);
  process.stdout.write(`Gateway identity ${identity.publicIdentity.identityFingerprint}\n`);
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([
    new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    browserManager.closeAll()
  ]);
}

process.on('SIGINT', () => void shutdown().catch(() => { process.exitCode = 1; }));
process.on('SIGTERM', () => void shutdown().catch(() => { process.exitCode = 1; }));
