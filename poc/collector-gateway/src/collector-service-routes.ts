import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  readCollectorServiceArtifact,
  type CollectorServiceArtifactDependencies
} from './collector-service-artifacts';
import {
  CollectorServiceAuditLog,
  collectorServiceProfileIdDigest,
  type CollectorServiceAuditAction,
  type CollectorServiceAuditOutcome
} from './collector-service-audit';
import {
  collectorServiceClientCreateInput,
  type CollectorServiceClientRegistry,
  type CollectorServiceClientScope
} from './collector-service-clients';
import {
  collectorServiceProfiles,
  dispatchCollectorServiceRequest,
  type CollectorServiceDependencies
} from './collector-service';
import {
  collectorServiceCapabilities,
  collectorServiceRequestInput,
  isCollectorServiceCapability,
  type CollectorServiceCapability,
  type CollectorServiceRequest,
  type CollectorServiceResult
} from './collector-service-contract';
import { collectorServiceOpenApiDocument } from './collector-service-openapi';
import type { LoadedGatewayIdentity } from './identity';
import { readJsonBody, requireSameOrigin, safeErrorCode, sendJson } from './gateway-http';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/**
 * The only surface that external local applications can use.  This context
 * intentionally contains runner and artifact dependencies, but the route
 * contract never accepts arbitrary browser control primitives.
 */
export interface CollectorServiceRouteContext extends CollectorServiceDependencies, CollectorServiceArtifactDependencies {
  identity: LoadedGatewayIdentity;
  collectorServiceClients: CollectorServiceClientRegistry;
  collectorServiceAudit: CollectorServiceAuditLog;
}

export async function handleCollectorServiceRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: CollectorServiceRouteContext
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/openapi.json') {
    sendJson(response, 200, collectorServiceOpenApiDocument(context.identity.publicIdentity.loopbackOrigin));
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
    sendJson(response, 200, {
      schemaVersion: 1,
      capabilities: collectorServiceCapabilities()
    });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/collector-service/audit') {
    if (!sameOrigin(request, response, context)) return true;
    sendJson(response, 200, { schemaVersion: 1, events: context.collectorServiceAudit.list() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/collector-service/clients') {
    if (!sameOrigin(request, response, context)) return true;
    sendJson(response, 200, { schemaVersion: 1, clients: context.collectorServiceClients.list() });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/v1/collector-service/clients') {
    if (!sameOrigin(request, response, context)) return true;
    const issued = await context.collectorServiceClients.issue(
      collectorServiceClientCreateInput(await readJsonBody(request))
    );
    sendJson(response, 201, { schemaVersion: 1, client: issued.client, token: issued.token });
    return true;
  }
  const clientRevoke = url.pathname.match(
    new RegExp(`^/v1/collector-service/clients/(${UUID})/revoke$`, 'i')
  );
  if (request.method === 'POST' && clientRevoke) {
    if (!sameOrigin(request, response, context)) return true;
    await readJsonBody(request);
    const client = await context.collectorServiceClients.revoke(clientRevoke[1]!);
    sendJson(response, 200, { schemaVersion: 1, client });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/collector-service/profiles') {
    const access = await collectorServiceAccess(request, context, 'profiles:read');
    if (!access.granted) {
      await recordCollectorServiceAudit(context, null, 'profiles_read', {
        outcome: 'denied',
        errorCode: access.errorCode
      });
      sendCollectorServiceAccessDenied(response, access);
      return true;
    }
    let profiles;
    try {
      profiles = collectorServiceProfiles(context.profileRegistry);
    } catch (error) {
      await recordCollectorServiceAudit(context, access.principal, 'profiles_read', {
        outcome: 'failed',
        errorCode: safeErrorCode(error)
      });
      throw error;
    }
    await recordCollectorServiceAudit(context, access.principal, 'profiles_read', {
      outcome: 'completed',
      errorCode: null
    });
    sendJson(response, 200, { schemaVersion: 1, profiles });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/v1/collect') {
    const access = await collectorServiceAccess(request, context, 'collect:execute');
    if (!access.granted) {
      await recordCollectorServiceAudit(context, null, 'collect', {
        outcome: 'denied',
        errorCode: access.errorCode
      });
      sendCollectorServiceAccessDenied(response, access);
      return true;
    }
    let collectorRequest: CollectorServiceRequest | null = null;
    let result: CollectorServiceResult;
    try {
      collectorRequest = collectorServiceRequestInput(await readJsonBody(request));
      result = await dispatchCollectorServiceRequest(collectorRequest, context);
    } catch (error) {
      await recordCollectorServiceAudit(context, access.principal, 'collect', {
        capability: collectorRequest?.capability ?? null,
        profileId: collectorRequest?.profileId ?? null,
        outcome: 'failed',
        errorCode: safeErrorCode(error)
      });
      throw error;
    }
    await recordCollectorServiceAudit(context, access.principal, 'collect', {
      capability: collectorRequest.capability,
      profileId: collectorRequest.profileId,
      operationId: result.operationId,
      operationKind: result.operationKind,
      outcome: result.state,
      errorCode: result.errorCode
    });
    sendJson(response, 201, { schemaVersion: 1, result });
    return true;
  }
  const artifactMatch = url.pathname.match(
    new RegExp(`^/v1/collect/artifacts/([a-z0-9._-]{1,120})/(${UUID})$`, 'i')
  );
  if (request.method === 'GET' && artifactMatch) {
    const access = await collectorServiceAccess(request, context, 'artifacts:read');
    if (!access.granted) {
      await recordCollectorServiceAudit(context, null, 'artifact_read', {
        outcome: 'denied',
        errorCode: access.errorCode
      });
      sendCollectorServiceAccessDenied(response, access);
      return true;
    }
    const capability = artifactMatch[1]!;
    const artifactId = artifactMatch[2]!;
    if (!isCollectorServiceCapability(capability)) {
      await recordCollectorServiceAudit(context, access.principal, 'artifact_read', {
        artifactId,
        outcome: 'not_found',
        errorCode: 'collector_service_capability_not_found'
      });
      sendJson(response, 404, { schemaVersion: 1, ok: false, error: 'collector_service_capability_not_found' });
      return true;
    }
    let artifact: unknown | null;
    try {
      artifact = await readCollectorServiceArtifact(capability, artifactId, context);
    } catch (error) {
      await recordCollectorServiceAudit(context, access.principal, 'artifact_read', {
        capability,
        artifactId,
        outcome: 'failed',
        errorCode: safeErrorCode(error)
      });
      throw error;
    }
    if (!artifact) {
      await recordCollectorServiceAudit(context, access.principal, 'artifact_read', {
        capability,
        artifactId,
        outcome: 'not_found',
        errorCode: 'collector_service_artifact_not_found'
      });
      sendJson(response, 404, { schemaVersion: 1, ok: false, error: 'collector_service_artifact_not_found' });
      return true;
    }
    await recordCollectorServiceAudit(context, access.principal, 'artifact_read', {
      capability,
      artifactId,
      outcome: 'completed',
      errorCode: null
    });
    sendJson(response, 200, { schemaVersion: 1, capability, artifact });
    return true;
  }
  return false;
}

type CollectorServicePrincipal =
  | { kind: 'console'; clientId: null }
  | { kind: 'client'; clientId: string; label: string; scopes: readonly CollectorServiceClientScope[] };

type CollectorServiceAccess =
  | { granted: true; principal: CollectorServicePrincipal }
  | { granted: false; status: 401 | 403; errorCode: string };

interface CollectorServiceAuditDetails {
  capability?: CollectorServiceCapability | null;
  profileId?: string | null;
  artifactId?: string | null;
  operationId?: string | null;
  operationKind?: 'run' | 'batch' | null;
  outcome: CollectorServiceAuditOutcome;
  errorCode: string | null;
}

function sameOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  context: CollectorServiceRouteContext
): boolean {
  return requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin);
}

async function collectorServiceAccess(
  request: IncomingMessage,
  context: CollectorServiceRouteContext,
  requiredScope: CollectorServiceClientScope
): Promise<CollectorServiceAccess> {
  const expectedOrigin = context.identity.publicIdentity.loopbackOrigin;
  if (request.headers.origin === expectedOrigin && request.headers['sec-fetch-site'] === 'same-origin') {
    return { granted: true, principal: { kind: 'console', clientId: null } };
  }
  if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined) {
    return { granted: false, status: 403, errorCode: 'console_origin_rejected' };
  }
  try {
    const client = await context.collectorServiceClients.authorise(request.headers.authorization, requiredScope);
    return {
      granted: true,
      principal: {
        kind: 'client',
        clientId: client.clientId,
        label: client.label,
        scopes: client.scopes
      }
    };
  } catch (error) {
    const code = safeErrorCode(error);
    return {
      granted: false,
      status: code === 'collector_service_client_scope_denied' ? 403 : 401,
      errorCode: code
    };
  }
}

function sendCollectorServiceAccessDenied(
  response: ServerResponse,
  access: Extract<CollectorServiceAccess, { granted: false }>
): void {
  sendJson(response, access.status, { schemaVersion: 1, ok: false, error: access.errorCode });
}

async function recordCollectorServiceAudit(
  context: CollectorServiceRouteContext,
  principal: CollectorServicePrincipal | null,
  action: CollectorServiceAuditAction,
  details: CollectorServiceAuditDetails
): Promise<void> {
  await context.collectorServiceAudit.record({
    actor: principal?.kind === 'client'
      ? { kind: 'client', clientId: principal.clientId }
      : principal?.kind === 'console'
        ? { kind: 'console', clientId: null }
        : { kind: 'unidentified', clientId: null },
    action,
    capability: details.capability ?? null,
    profileIdDigest: details.profileId ? collectorServiceProfileIdDigest(details.profileId) : null,
    artifactId: details.artifactId ?? null,
    operationId: details.operationId ?? null,
    operationKind: details.operationKind ?? null,
    outcome: details.outcome,
    errorCode: details.errorCode
  });
}
