import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import type { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import type { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import type { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import type { ExtensionWorkNativeSearchBatchArtifactStore } from './extension-work-native-search-batch-artifacts';
import { ExtensionWorkPassiveArtifactStore } from './extension-work-passive-artifacts';
import { collectorServiceClientCreateInput, type CollectorServiceClientRegistry } from './collector-service-clients';
import type { XiaohongshuPublicNotesArtifactStore } from './xiaohongshu-public-notes-artifacts';
import type { XiaohongshuAccountPublicNotesArtifactStore } from './xiaohongshu-account-public-notes-artifacts';
import type { XiaohongshuNotePublicDetailArtifactStore } from './xiaohongshu-note-public-detail-artifacts';
import type { XiaohongshuNotePublicCommentsArtifactStore } from './xiaohongshu-note-public-comments-artifacts';
import type { XiaohongshuReplyArtifactStore } from './xiaohongshu-note-public-comment-replies-artifacts';
import type { CollectorServiceAuditLog } from './collector-service-audit';
import { readJsonBody, requireSameOrigin, sendJson } from './gateway-http';
import type { LoadedGatewayIdentity } from './identity';
import {
  isUserBrowserArtifactCapability,
  readUserBrowserArtifact
} from './user-browser-artifact-reader-registry';
import {
  authoriseUserBrowserServiceRequest,
  recordUserBrowserServiceAudit,
  sendUserBrowserServiceAccessDenied
} from './user-browser-collector-service-access';
import type { OperationalLog } from './operational-log';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const DIRECT_ARTIFACT = new RegExp(`^/v1/collect/artifacts/([^/]+)/(${UUID})$`, 'i');

export interface UserBrowserGatewayAdminRouteContext {
  identity: LoadedGatewayIdentity;
  operationalLog: OperationalLog;
  requestId?: string;
  collectorServiceClients: CollectorServiceClientRegistry;
  collectorServiceAudit: CollectorServiceAuditLog;
  videoDetailArtifacts: BilibiliVideoDetailArtifactStore;
  nativeSearchArtifacts: BilibiliNativeSearchArtifactStore;
  nativeSearchBatchDirectArtifacts: ExtensionWorkNativeSearchBatchArtifactStore;
  accountProfileArtifacts: BilibiliAccountProfileArtifactStore;
  accountVideoInventoryArtifacts: BilibiliAccountVideoInventoryArtifactStore;
  passiveDirectArtifacts: ExtensionWorkPassiveArtifactStore;
  xiaohongshuPublicNotesArtifacts: XiaohongshuPublicNotesArtifactStore;
  xiaohongshuAccountPublicNotesArtifacts: XiaohongshuAccountPublicNotesArtifactStore;
  xiaohongshuNotePublicDetailArtifacts: XiaohongshuNotePublicDetailArtifactStore;
  xiaohongshuNotePublicCommentsArtifacts: XiaohongshuNotePublicCommentsArtifactStore;
  xiaohongshuReplyArtifacts: XiaohongshuReplyArtifactStore;
}

/**
 * Console administration and artifact retrieval for the direct deployment.
 * This module intentionally does not depend on the legacy Collector Service
 * route context, because that context carries Profile and Browser Host runners.
 */
export async function handleUserBrowserGatewayAdminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: UserBrowserGatewayAdminRouteContext
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v2/observability/logs') {
    if (!sameOrigin(request, response, context)) return true;
    const limitValue = Number(url.searchParams.get('limit') ?? '100');
    const limit = Number.isSafeInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 500) : 100;
    const level = url.searchParams.get('level');
    const eventType = url.searchParams.get('eventType') ?? undefined;
    const operationId = url.searchParams.get('operationId') ?? undefined;
    const events = context.operationalLog.list({
      limit,
      level: level === 'debug' || level === 'info' || level === 'warn' || level === 'error' ? level : undefined,
      eventType,
      operationId
    });
    sendJson(response, 200, { schemaVersion: 1, events });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v2/collector-service/clients') {
    if (!sameOrigin(request, response, context)) return true;
    sendJson(response, 200, { schemaVersion: 2, clients: context.collectorServiceClients.list() });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/v2/collector-service/clients') {
    if (!sameOrigin(request, response, context)) return true;
    const input = userBrowserClientCreateInput(await readJsonBody(request));
    const issued = await context.collectorServiceClients.issue(input);
    sendJson(response, 201, { schemaVersion: 2, client: issued.client, token: issued.token });
    return true;
  }
  const revoke = url.pathname.match(new RegExp(`^/v2/collector-service/clients/(${UUID})/revoke$`, 'i'));
  if (request.method === 'POST' && revoke) {
    if (!sameOrigin(request, response, context)) return true;
    await readJsonBody(request);
    const client = await context.collectorServiceClients.revoke(revoke[1]!);
    sendJson(response, 200, { schemaVersion: 2, client });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v2/collector-service/audit') {
    if (!sameOrigin(request, response, context)) return true;
    sendJson(response, 200, { schemaVersion: 2, events: context.collectorServiceAudit.list() });
    return true;
  }

  const artifact = url.pathname.match(DIRECT_ARTIFACT);
  if (request.method === 'GET' && artifact && isUserBrowserArtifactCapability(artifact[1]!)) {
    const access = await authoriseUserBrowserServiceRequest(request, context, 'artifacts:read');
    const capability = artifact[1]!;
    const artifactId = artifact[2]!;
    if (!access.granted) {
      await recordUserBrowserServiceAudit(context, null, 'artifact_read', {
        capability,
        artifactId,
        operationId: null,
        operationKind: null,
        outcome: 'denied',
        errorCode: access.errorCode
      });
      sendUserBrowserServiceAccessDenied(response, access);
      return true;
    }
    const view = await readUserBrowserArtifact(context, capability, artifactId);
    if (!view) {
      await recordUserBrowserServiceAudit(context, access.principal, 'artifact_read', {
        capability,
        artifactId,
        operationId: null,
        operationKind: null,
        outcome: 'not_found',
        errorCode: 'collector_service_artifact_not_found'
      });
      sendJson(response, 404, { schemaVersion: 2, ok: false, error: 'collector_service_artifact_not_found' });
      return true;
    }
    await recordUserBrowserServiceAudit(context, access.principal, 'artifact_read', {
      capability,
      artifactId,
      operationId: null,
      operationKind: null,
      outcome: 'completed',
      errorCode: null
    });
    sendJson(response, 200, { schemaVersion: 2, capability, artifact: view });
    return true;
  }
  return false;
}

function userBrowserClientCreateInput(value: unknown) {
  const input = collectorServiceClientCreateInput(value);
  if (input.scopes.includes('profiles:read')) {
    throw new Error('user_browser_collector_service_scope_not_available');
  }
  return input;
}

function sameOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  context: UserBrowserGatewayAdminRouteContext
): boolean {
  return requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin);
}
