import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BilibiliVideoDiscussionUserSelectedTabWorkItem,
  BilibiliVideoDiscussionUserSelectedTabWorkResult
} from '@intelligence/collector-contracts';
import { BilibiliAccountProfileArtifactStore } from '../../src/bilibili-account-profile-artifacts.js';
import { BilibiliAccountVideoInventoryArtifactStore } from '../../src/bilibili-account-video-inventory-artifacts.js';
import { BilibiliNativeSearchArtifactStore } from '../../src/bilibili-native-search-artifacts.js';
import { BilibiliVideoDetailArtifactStore } from '../../src/bilibili-video-detail-artifacts.js';
import { BrowserBindingSafetyRegistry } from '../../src/browser-binding-safety.js';
import { CollectorServiceAuditLog } from '../../src/collector-service-audit.js';
import {
  CollectorServiceClientRegistry,
  collectorServiceClientCreateInput
} from '../../src/collector-service-clients.js';
import { CollectorServiceIdempotencyLedger } from '../../src/collector-service-idempotency.js';
import { ExtensionWorkNativeSearchBatchArtifactStore } from '../../src/extension-work-native-search-batch-artifacts.js';
import { ExtensionWorkPassiveArtifactStore } from '../../src/extension-work-passive-artifacts.js';
import { ExtensionWorkQueue } from '../../src/extension-work-queue.js';
import type { LoadedGatewayIdentity } from '../../src/identity.js';
import { OperationalLog } from '../../src/operational-log.js';
import { PairingBroker } from '../../src/pairing.js';
import {
  handleUserBrowserCollectorServiceRoute,
  type UserBrowserCollectorServiceRouteContext
} from '../../src/user-browser-collector-service-routes.js';
import {
  handleUserBrowserGatewayAdminRoute,
  type UserBrowserGatewayAdminRouteContext
} from '../../src/user-browser-gateway-admin-routes.js';
import { XiaohongshuAccountPublicNotesArtifactStore } from '../../src/xiaohongshu-account-public-notes-artifacts.js';
import { XiaohongshuNotePublicCommentsArtifactStore } from '../../src/xiaohongshu-note-public-comments-artifacts.js';
import { XiaohongshuReplyArtifactStore } from '../../src/xiaohongshu-note-public-comment-replies-artifacts.js';
import { XiaohongshuNotePublicDetailArtifactStore } from '../../src/xiaohongshu-note-public-detail-artifacts.js';
import { XiaohongshuPublicNotesArtifactStore } from '../../src/xiaohongshu-public-notes-artifacts.js';

type RouteContext = UserBrowserCollectorServiceRouteContext & UserBrowserGatewayAdminRouteContext;

export interface UserBrowserServiceRouteHarness {
  origin: string;
  token: string;
  stateDirectory: string;
  context: RouteContext;
  createOnlineBinding(): Promise<string>;
  recordDiscussionArtifact(): Promise<{ artifactId: string; operationId: string }>;
  close(): Promise<void>;
}

export async function createUserBrowserServiceRouteHarness(): Promise<UserBrowserServiceRouteHarness> {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-service-route-'));
  const identity = testIdentity();
  const operationalLog = await OperationalLog.create(stateDirectory);
  const pairingBroker = await PairingBroker.create(identity, stateDirectory);
  const browserBindingSafety = await BrowserBindingSafetyRegistry.create(stateDirectory);
  const workQueue = await ExtensionWorkQueue.create(identity, stateDirectory);
  const collectorServiceClients = await CollectorServiceClientRegistry.create(stateDirectory);
  const collectorServiceAudit = await CollectorServiceAuditLog.create(stateDirectory);
  const collectorServiceIdempotency = await CollectorServiceIdempotencyLedger.create(stateDirectory);
  const context: RouteContext = {
    identity,
    operationalLog,
    pairingBroker,
    browserBindingSafety,
    workQueue,
    collectorServiceClients,
    collectorServiceAudit,
    collectorServiceIdempotency,
    videoDetailArtifacts: await BilibiliVideoDetailArtifactStore.create(stateDirectory),
    nativeSearchArtifacts: await BilibiliNativeSearchArtifactStore.create(stateDirectory),
    nativeSearchBatchDirectArtifacts: await ExtensionWorkNativeSearchBatchArtifactStore.create(stateDirectory),
    accountProfileArtifacts: await BilibiliAccountProfileArtifactStore.create(stateDirectory),
    accountVideoInventoryArtifacts: await BilibiliAccountVideoInventoryArtifactStore.create(stateDirectory),
    passiveDirectArtifacts: await ExtensionWorkPassiveArtifactStore.create(stateDirectory),
    xiaohongshuPublicNotesArtifacts: await XiaohongshuPublicNotesArtifactStore.create(stateDirectory),
    xiaohongshuAccountPublicNotesArtifacts:
      await XiaohongshuAccountPublicNotesArtifactStore.create(stateDirectory),
    xiaohongshuNotePublicDetailArtifacts:
      await XiaohongshuNotePublicDetailArtifactStore.create(stateDirectory),
    xiaohongshuNotePublicCommentsArtifacts:
      await XiaohongshuNotePublicCommentsArtifactStore.create(stateDirectory),
    xiaohongshuReplyArtifacts: await XiaohongshuReplyArtifactStore.create(stateDirectory)
  };
  const issued = await collectorServiceClients.issue(collectorServiceClientCreateInput({
    label: 'Route contract test',
    scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read']
  }));
  const server = routeServer(context);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('route_test_server_address_missing');

  return {
    origin: `http://127.0.0.1:${address.port}`,
    token: issued.token,
    stateDirectory,
    context,
    createOnlineBinding: async () => await createOnlineBinding(pairingBroker),
    recordDiscussionArtifact: async () => await recordDiscussionArtifact(context.passiveDirectArtifacts),
    close: async () => {
      await closeServer(server);
      await rm(stateDirectory, { recursive: true, force: true });
    }
  };
}

function routeServer(context: RouteContext): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', context.identity.publicIdentity.loopbackOrigin);
      if (await handleUserBrowserCollectorServiceRoute(request, response, url, context)) return;
      if (await handleUserBrowserGatewayAdminRoute(request, response, url, context)) return;
      response.statusCode = 404;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: false, error: 'route_not_found' }));
    } catch (error) {
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'route_test_failed'
      }));
    }
  });
}

async function createOnlineBinding(pairingBroker: PairingBroker): Promise<string> {
  const now = Date.now();
  const extensionId = extensionIdFromIndex(pairingBroker.pairedExtensionCount);
  const extensionInstanceId = randomUUID();
  const session = pairingBroker.createSession(now);
  const claim = await pairingBroker.claim({
    schemaVersion: 1,
    pairingSessionId: session.pairingSessionId,
    pairingCode: session.pairingCode,
    extensionId,
    extensionInstanceId,
    extensionChallenge: randomBytes(32).toString('base64url')
  }, now + 1);
  const timestamp = String(now + 2);
  const nonce = randomBytes(32).toString('base64url');
  const bodySha256 = createHash('sha256').update('').digest('hex');
  const pathname = '/v1/extension/browser-binding';
  const payload = ['GET', pathname, timestamp, nonce, bodySha256].join('\n');
  await pairingBroker.authoriseRequest({
    origin: `chrome-extension://${extensionId}`,
    extensionId,
    extensionInstanceId,
    timestamp,
    nonce,
    bodySha256,
    authorization: createHmac('sha256', claim.pairingAuthorization).update(payload).digest('base64url'),
    method: 'GET',
    pathname,
    body: ''
  }, now + 2);
  return claim.browserBindingId;
}

function extensionIdFromIndex(index: number): string {
  const alphabet = 'abcdefghijklmnop';
  const character = alphabet[index % alphabet.length]!;
  return character.repeat(32);
}

async function recordDiscussionArtifact(
  store: ExtensionWorkPassiveArtifactStore
): Promise<{ artifactId: string; operationId: string }> {
  const operationId = randomUUID();
  const item: BilibiliVideoDiscussionUserSelectedTabWorkItem = {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: randomUUID(),
    operationId,
    browserBindingId: randomUUID(),
    platform: 'bilibili',
    capability: 'bilibili.discussion',
    executionTarget: 'collector_work_tab',
    issuedAt: '2026-08-03T00:00:00.000Z',
    expiresAt: '2026-08-03T00:01:00.000Z',
    input: {
      canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
      bvid: 'BV1qZSLBYEpa'
    },
    budget: {
      maximumPlatformNavigations: 1,
      maximumSemanticActions: 1,
      maximumResponseObservations: 0,
      maximumPayloadBytes: 98_304
    },
    gatewaySignature: 'a'.repeat(86)
  };
  const result: BilibiliVideoDiscussionUserSelectedTabWorkResult = {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.discussion',
    executionTarget: 'collector_work_tab',
    state: 'completed',
    errorCode: null,
    terminalReason: 'discussion_ready',
    completedAt: '2026-08-03T00:00:20.000Z',
    navigation: { attempted: true, attemptCount: 1 },
    workTabAcquisition: 'created',
    workTabDisposition: 'idle_reusable',
    observation: {
      bvid: item.input.bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentContentState: 'ready',
      rootCommentTexts: ['公开评论与中文边界'],
      sortControls: { hotVisible: true, latestVisible: true, latestState: 'inactive' },
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }
  };
  const summary = await store.record({ item, result });
  return { artifactId: summary.artifactId, operationId };
}

function testIdentity(): LoadedGatewayIdentity {
  return {
    publicIdentity: {
      schemaVersion: 1,
      protocolVersion: 1,
      gatewayInstanceId: randomUUID(),
      displayName: 'Route Contract Gateway',
      loopbackOrigin: 'http://127.0.0.1:43127',
      signingPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      identityFingerprint: 'c'.repeat(64)
    },
    signPayload: () => 'd'.repeat(86)
  } as LoadedGatewayIdentity;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}
