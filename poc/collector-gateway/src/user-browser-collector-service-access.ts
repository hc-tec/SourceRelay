import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CollectorServiceAuditAction,
  CollectorServiceAuditLog,
  CollectorServiceAuditOutcome
} from './collector-service-audit';
import type { CollectorServiceCapability } from './collector-service-contract';
import type {
  CollectorServiceClientRegistry,
  CollectorServiceClientScope
} from './collector-service-clients';
import { safeErrorCode, sendJson } from './gateway-http';
import type { LoadedGatewayIdentity } from './identity';

export interface UserBrowserServiceAccessContext {
  identity: LoadedGatewayIdentity;
  collectorServiceClients: CollectorServiceClientRegistry;
}

export type UserBrowserServicePrincipal =
  | { kind: 'console'; clientId: null }
  | { kind: 'client'; clientId: string };

export type UserBrowserServiceAccess =
  | { granted: true; principal: UserBrowserServicePrincipal }
  | { granted: false; status: 401 | 403; errorCode: string };

export interface UserBrowserServiceAuditContext {
  collectorServiceAudit: CollectorServiceAuditLog;
}

export async function authoriseUserBrowserServiceRequest(
  request: IncomingMessage,
  context: UserBrowserServiceAccessContext,
  requiredScope: CollectorServiceClientScope
): Promise<UserBrowserServiceAccess> {
  const expectedOrigin = context.identity.publicIdentity.loopbackOrigin;
  if (
    request.headers['sec-fetch-site'] === 'same-origin' &&
    (request.headers.origin === undefined || request.headers.origin === expectedOrigin)
  ) return { granted: true, principal: { kind: 'console', clientId: null } };
  if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined) {
    return { granted: false, status: 403, errorCode: 'console_origin_rejected' };
  }
  try {
    const client = await context.collectorServiceClients.authorise(request.headers.authorization, requiredScope);
    return { granted: true, principal: { kind: 'client', clientId: client.clientId } };
  } catch (error) {
    const code = safeErrorCode(error);
    return {
      granted: false,
      status: code === 'collector_service_client_scope_denied' ? 403 : 401,
      errorCode: code
    };
  }
}

export function sendUserBrowserServiceAccessDenied(
  response: ServerResponse,
  access: Extract<UserBrowserServiceAccess, { granted: false }>,
  schemaVersion = 2
): void {
  sendJson(response, access.status, { schemaVersion, ok: false, error: access.errorCode });
}

export async function recordUserBrowserServiceAudit(
  context: UserBrowserServiceAuditContext,
  principal: UserBrowserServicePrincipal | null,
  action: CollectorServiceAuditAction,
  details: {
    capability: CollectorServiceCapability | null;
    artifactId: string | null;
    operationId: string | null;
    operationKind: 'run' | 'batch' | null;
    outcome: CollectorServiceAuditOutcome;
    errorCode: string | null;
  }
): Promise<void> {
  await context.collectorServiceAudit.record({
    actor: principal?.kind === 'client'
      ? { kind: 'client', clientId: principal.clientId }
      : principal?.kind === 'console'
        ? { kind: 'console', clientId: null }
        : { kind: 'unidentified', clientId: null },
    action,
    capability: details.capability,
    profileIdDigest: null,
    artifactId: details.artifactId,
    operationId: details.operationId,
    operationKind: details.operationKind,
    outcome: details.outcome,
    errorCode: details.errorCode
  });
}
