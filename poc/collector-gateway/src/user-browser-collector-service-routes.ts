import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CollectorServiceAuditAction,
  CollectorServiceAuditLog,
  CollectorServiceAuditOutcome
} from './collector-service-audit';
import type {
  CollectorServiceClientRegistry,
  CollectorServiceClientScope
} from './collector-service-clients';
import {
  enqueueBilibiliVideoDetailWork,
  reconcileExpiredExtensionWork,
  type ExtensionWorkRouteContext
} from './extension-work-routes';
import { readJsonBody, safeErrorCode, sendJson } from './gateway-http';
import {
  USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
  userBrowserCollectorServiceRequestInput
} from './user-browser-collector-service-contract';
import { userBrowserCollectorServiceOpenApiDocument } from './user-browser-collector-service-openapi';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface UserBrowserCollectorServiceRouteContext extends ExtensionWorkRouteContext {
  collectorServiceClients: CollectorServiceClientRegistry;
  collectorServiceAudit: CollectorServiceAuditLog;
}

type ServicePrincipal =
  | { kind: 'console'; clientId: null }
  | { kind: 'client'; clientId: string };

type ServiceAccess =
  | { granted: true; principal: ServicePrincipal }
  | { granted: false; status: 401 | 403; errorCode: string };

/**
 * The production local-service surface for user-owned browser bindings.  It
 * intentionally has a different `/v2` contract from the legacy `/v1/collect`
 * Profile/Browser Host test lane: no profile ID or fallback can enter here.
 */
export async function handleUserBrowserCollectorServiceRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: UserBrowserCollectorServiceRouteContext
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v2/openapi.json') {
    sendJson(response, 200, userBrowserCollectorServiceOpenApiDocument(context.identity.publicIdentity.loopbackOrigin));
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v2/collector-service/browser-bindings') {
    const access = await serviceAccess(request, context, 'browser-bindings:read');
    if (!access.granted) {
      await audit(context, null, 'browser_bindings_read', null, null, 'denied', access.errorCode);
      sendDenied(response, access);
      return true;
    }
    const bindings = context.pairingBroker.listBrowserBindings();
    await audit(context, access.principal, 'browser_bindings_read', null, null, 'completed', null);
    sendJson(response, 200, { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, bindings });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v2/collect') {
    const access = await serviceAccess(request, context, 'collect:execute');
    if (!access.granted) {
      await audit(context, null, 'collect', null, null, 'denied', access.errorCode);
      sendDenied(response, access);
      return true;
    }
    let operationId: string | null = null;
    try {
      const collection = userBrowserCollectorServiceRequestInput(await readJsonBody(request));
      const operation = await enqueueBilibiliVideoDetailWork(
        context,
        collection.browserBindingId,
        collection.input.canonicalVideoUrl
      );
      operationId = operation.operationId;
      await audit(context, access.principal, 'collect', collection.capability, operationId, 'queued', null);
      sendJson(response, 201, {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        result: operation
      });
    } catch (error) {
      const code = safeErrorCode(error);
      await audit(context, access.principal, 'collect', 'bilibili.video_detail', operationId, 'failed', code);
      sendJson(response, operationStatus(code), { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, ok: false, error: code });
    }
    return true;
  }

  const operation = url.pathname.match(new RegExp(`^/v2/collect/operations/(${UUID})$`, 'i'));
  if (request.method === 'GET' && operation) {
    const access = await serviceAccess(request, context, 'operations:read');
    if (!access.granted) {
      await audit(context, null, 'operation_read', null, operation[1]!, 'denied', access.errorCode);
      sendDenied(response, access);
      return true;
    }
    await reconcileExpiredExtensionWork(context);
    const result = await context.workQueue.get(operation[1]!);
    if (!result) {
      await audit(context, access.principal, 'operation_read', null, operation[1]!, 'not_found', 'extension_work_not_found');
      sendJson(response, 404, { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, ok: false, error: 'extension_work_not_found' });
      return true;
    }
    await audit(context, access.principal, 'operation_read', result.capability, result.operationId, outcomeForState(result.state), result.errorCode);
    sendJson(response, 200, { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, result });
    return true;
  }
  return false;
}

async function serviceAccess(
  request: IncomingMessage,
  context: UserBrowserCollectorServiceRouteContext,
  requiredScope: CollectorServiceClientScope
): Promise<ServiceAccess> {
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

function sendDenied(response: ServerResponse, access: Extract<ServiceAccess, { granted: false }>): void {
  sendJson(response, access.status, { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, ok: false, error: access.errorCode });
}

async function audit(
  context: UserBrowserCollectorServiceRouteContext,
  principal: ServicePrincipal | null,
  action: CollectorServiceAuditAction,
  capability: 'bilibili.video_detail' | null,
  operationId: string | null,
  outcome: CollectorServiceAuditOutcome,
  errorCode: string | null
): Promise<void> {
  await context.collectorServiceAudit.record({
    actor: principal?.kind === 'client'
      ? { kind: 'client', clientId: principal.clientId }
      : principal?.kind === 'console'
        ? { kind: 'console', clientId: null }
        : { kind: 'unidentified', clientId: null },
    action,
    capability,
    profileIdDigest: null,
    artifactId: null,
    operationId,
    operationKind: operationId ? 'run' : null,
    outcome,
    errorCode
  });
}

function operationStatus(errorCode: string): 400 | 409 {
  return errorCode === 'browser_binding_offline' || errorCode.startsWith('browser_binding_safety_') ||
    errorCode.startsWith('extension_work_binding_')
    ? 409
    : 400;
}

function outcomeForState(state: 'queued' | 'claimed' | 'completed' | 'partial' | 'stopped' | 'failed'): CollectorServiceAuditOutcome {
  if (state === 'queued' || state === 'claimed') return 'queued';
  if (state === 'completed') return 'completed';
  if (state === 'partial') return 'partial';
  return 'failed';
}
