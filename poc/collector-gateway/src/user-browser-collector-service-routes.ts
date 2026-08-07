import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CollectorServiceAuditAction,
  CollectorServiceAuditLog,
  CollectorServiceAuditOutcome
} from './collector-service-audit';
import type { CollectorServiceClientRegistry } from './collector-service-clients';
import type {
  CollectorServiceIdempotencyLedger,
  CollectorServiceIdempotencyRecord
} from './collector-service-idempotency';
import { canonicalJson, sha256Hex } from './canonical-json';
import { readCollectorOperation } from './collector-operation-reader';
import { reconcileExpiredExtensionWork, type ExtensionWorkRouteContext } from './extension-work-routes';
import { readJsonBody, safeErrorCode, sendJson } from './gateway-http';
import {
  USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
  userBrowserCollectorServiceRequestInput
} from './user-browser-collector-service-contract';
import { userBrowserCollectorServiceOpenApiDocument } from './user-browser-collector-service-openapi';
import {
  authoriseUserBrowserServiceRequest,
  recordUserBrowserServiceAudit,
  sendUserBrowserServiceAccessDenied,
  type UserBrowserServicePrincipal
} from './user-browser-collector-service-access';
import {
  dispatchUserBrowserCapability,
  type UserBrowserCapabilityDispatchContext
} from './user-browser-capability-registry';
import {
  userBrowserCapabilityCatalogContract,
  userBrowserServiceCompatibility
} from './user-browser-service-compatibility';
import { collectorCoreReleaseManifest } from '@intelligence/collector-contracts';
import type { OfficialSourceOperationStore } from './official-source-operation-store';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface UserBrowserCollectorServiceRouteContext extends UserBrowserCapabilityDispatchContext {
  collectorServiceClients: CollectorServiceClientRegistry;
  collectorServiceAudit: CollectorServiceAuditLog;
  collectorServiceIdempotency: CollectorServiceIdempotencyLedger;
  officialSourceOperations: OfficialSourceOperationStore;
}

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
  if (request.method === 'GET' && url.pathname === '/v2/release') {
    const origin = context.identity.publicIdentity.loopbackOrigin;
    sendJson(response, 200, {
      ...collectorCoreReleaseManifest(),
      compatibility: userBrowserServiceCompatibility(origin)
    });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v2/capabilities') {
    sendJson(
      response,
      200,
      userBrowserCapabilityCatalogContract(
        context.identity.publicIdentity.loopbackOrigin,
        context.zhihuOfficialApiProvider.configured()
      )
    );
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v2/collector-service/browser-bindings') {
    const access = await authoriseUserBrowserServiceRequest(request, context, 'browser-bindings:read');
    if (!access.granted) {
      await audit(context, null, 'browser_bindings_read', null, null, 'denied', access.errorCode);
      sendUserBrowserServiceAccessDenied(response, access);
      return true;
    }
    const bindings = context.pairingBroker.listBrowserBindings();
    await audit(context, access.principal, 'browser_bindings_read', null, null, 'completed', null);
    sendJson(response, 200, { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, bindings });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v2/collect') {
    const access = await authoriseUserBrowserServiceRequest(request, context, 'collect:execute');
    if (!access.granted) {
      await audit(context, null, 'collect', null, null, 'denied', access.errorCode);
      sendUserBrowserServiceAccessDenied(response, access);
      return true;
    }
    const startedAt = Date.now();
    let collection: ReturnType<typeof userBrowserCollectorServiceRequestInput>;
    let reservation: { created: boolean; record: CollectorServiceIdempotencyRecord };
    try {
      collection = userBrowserCollectorServiceRequestInput(await readJsonBody(request));
      reservation = await context.collectorServiceIdempotency.reserve(
        collection.clientRequestId,
        collectionRequestSha256(collection)
      );
    } catch (error) {
      const code = safeErrorCode(error);
      await context.operationalLog.record({
        level: 'warn',
        eventType: 'collector.operation.queue_rejected',
        requestId: context.requestId ?? null,
        operationId: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: 'failed',
        errorCode: code,
        details: { phase: 'request_or_idempotency_validation' }
      });
      await audit(context, access.principal, 'collect', null, null, 'failed', code);
      sendJson(response, operationStatus(code), {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        ok: false,
        error: code
      });
      return true;
    }

    if (!reservation.created) {
      await sendIdempotentReplay(response, context, access.principal, collection, reservation.record, startedAt);
      return true;
    }

    const operationId = reservation.record.operationId;
    let operation: Awaited<ReturnType<typeof dispatchUserBrowserCapability>>;
    try {
      operation = await dispatchUserBrowserCapability(context, collection, operationId);
    } catch (error) {
      const code = safeErrorCode(error);
      const status = operationStatus(code);
      try {
        await context.collectorServiceIdempotency.reject(collection.clientRequestId, operationId, code, status);
      } catch {
        // A failed ledger transition must never permit replay. The persisted
        // reservation remains outcome-unknown and the original error is kept.
      }
      await context.operationalLog.record({
        level: 'warn',
        eventType: 'collector.operation.queue_rejected',
        requestId: context.requestId ?? null,
        operationId,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: 'failed',
        errorCode: code,
        details: { phase: 'dispatch' }
      });
      await audit(context, access.principal, 'collect', null, operationId, 'failed', code);
      sendJson(response, status, {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        ok: false,
        error: code,
        clientRequestId: collection.clientRequestId,
        operationId
      });
      return true;
    }

    try {
      await context.collectorServiceIdempotency.accept(collection.clientRequestId, operationId);
    } catch (error) {
      await context.operationalLog.record({
        level: 'warn',
        eventType: 'collector.operation.idempotency_accept_deferred',
        requestId: context.requestId ?? null,
        operationId,
        capability: collection.capability,
        durationMs: Math.max(0, Date.now() - startedAt),
        outcome: 'failed',
        errorCode: safeErrorCode(error),
        details: { phase: 'idempotency_accept' }
      });
    }
    await context.operationalLog.record({
      eventType: operation.state === 'completed'
        ? 'collector.operation.completed_inline'
        : 'collector.operation.queued',
      requestId: context.requestId ?? null,
      operationId,
      capability: collection.capability,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: operation.state === 'completed' ? 'completed' : 'started',
      details: {
        executionTarget: operation.executionTarget,
        executionProvider: operation.executionTarget === 'official_api' ? 'official_api' : 'browser_extension',
        idempotentReplay: false
      }
    });
    await audit(
      context,
      access.principal,
      'collect',
      collection.capability,
      operationId,
      outcomeForState(operation.state),
      null
    );
    sendJson(response, 201, {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      clientRequestId: collection.clientRequestId,
      idempotentReplay: false,
      result: operation
    });
    return true;
  }

  const operation = url.pathname.match(new RegExp(`^/v2/collect/operations/(${UUID})$`, 'i'));
  if (request.method === 'GET' && operation) {
    const access = await authoriseUserBrowserServiceRequest(request, context, 'operations:read');
    if (!access.granted) {
      await audit(context, null, 'operation_read', null, operation[1]!, 'denied', access.errorCode);
      sendUserBrowserServiceAccessDenied(response, access);
      return true;
    }
    await reconcileExpiredExtensionWork(context);
    const result = await readCollectorOperation(context, operation[1]!);
    if (!result) {
      await audit(context, access.principal, 'operation_read', null, operation[1]!, 'not_found', 'extension_work_not_found');
      sendJson(response, 404, { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, ok: false, error: 'extension_work_not_found' });
      return true;
    }
    await audit(
      context,
      access.principal,
      'operation_read',
      result.capability,
      result.operationId,
      outcomeForState(result.state),
      result.errorCode
    );
    sendJson(response, 200, { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, result });
    return true;
  }
  return false;
}

async function audit(
  context: UserBrowserCollectorServiceRouteContext,
  principal: UserBrowserServicePrincipal | null,
  action: CollectorServiceAuditAction,
  capability: import('./user-browser-collector-service-contract').UserBrowserCollectorServiceRequest['capability'] | null,
  operationId: string | null,
  outcome: CollectorServiceAuditOutcome,
  errorCode: string | null
): Promise<void> {
  await recordUserBrowserServiceAudit(context, principal, action, {
    capability,
    artifactId: null,
    operationId,
    operationKind: operationId ? 'run' : null,
    outcome,
    errorCode
  });
}

function operationStatus(errorCode: string): 400 | 409 | 429 | 502 | 503 | 504 {
  if (errorCode === 'zhihu_official_api_rate_limited' || errorCode === 'zhihu_official_api_quota_exhausted') {
    return 429;
  }
  if (errorCode === 'zhihu_official_api_timeout') return 504;
  if (errorCode === 'zhihu_official_api_source_unavailable') return 503;
  if (errorCode === 'zhihu_official_api_server_error' ||
    errorCode === 'zhihu_official_api_response_invalid' ||
    errorCode === 'zhihu_official_api_response_media_type_invalid' ||
    errorCode === 'zhihu_official_api_response_origin_invalid' ||
    errorCode === 'zhihu_official_api_response_contains_credential' ||
    errorCode === 'zhihu_official_api_response_too_large' ||
    errorCode === 'zhihu_official_api_http_error') return 502;
  return errorCode === 'collector_service_idempotency_conflict' ||
    errorCode === 'collector_service_idempotency_outcome_unknown' ||
    errorCode === 'collector_service_idempotency_operation_unavailable' ||
    errorCode === 'browser_binding_offline' || errorCode.startsWith('browser_binding_safety_') ||
    errorCode.startsWith('extension_work_binding_') ||
    errorCode === 'zhihu_official_api_credential_required' ||
    errorCode === 'zhihu_official_api_authentication_failed'
    ? 409
    : 400;
}

function collectionRequestSha256(
  collection: ReturnType<typeof userBrowserCollectorServiceRequestInput>
): string {
  const { clientRequestId: _clientRequestId, ...canonicalRequest } = collection;
  return sha256Hex(canonicalJson(canonicalRequest));
}

async function sendIdempotentReplay(
  response: ServerResponse,
  context: UserBrowserCollectorServiceRouteContext,
  principal: UserBrowserServicePrincipal,
  collection: ReturnType<typeof userBrowserCollectorServiceRequestInput>,
  record: CollectorServiceIdempotencyRecord,
  startedAt: number
): Promise<void> {
  if (record.state === 'rejected') {
    await audit(context, principal, 'collect', collection.capability, record.operationId, 'failed', record.errorCode);
    sendJson(response, record.errorStatus ?? 409, {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      ok: false,
      error: record.errorCode ?? 'collector_service_idempotency_outcome_unknown',
      clientRequestId: collection.clientRequestId,
      operationId: record.operationId
    });
    return;
  }

  const operation = await readCollectorOperation(context, record.operationId);
  if (!operation) {
    const code = record.state === 'accepted'
      ? 'collector_service_idempotency_operation_unavailable'
      : 'collector_service_idempotency_outcome_unknown';
    await audit(context, principal, 'collect', collection.capability, record.operationId, 'failed', code);
    sendJson(response, 409, {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      ok: false,
      error: code,
      clientRequestId: collection.clientRequestId,
      operationId: record.operationId
    });
    return;
  }

  if (record.state === 'reserved') {
    await context.collectorServiceIdempotency.accept(collection.clientRequestId, record.operationId);
  }
  await context.operationalLog.record({
    eventType: 'collector.operation.idempotent_replay',
    requestId: context.requestId ?? null,
    operationId: operation.operationId,
    capability: operation.capability,
    durationMs: Math.max(0, Date.now() - startedAt),
    outcome: 'completed',
    details: { executionTarget: operation.executionTarget, idempotentReplay: true }
  });
  await audit(context, principal, 'collect', operation.capability, operation.operationId, outcomeForState(operation.state), operation.errorCode);
  sendJson(response, 200, {
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    clientRequestId: collection.clientRequestId,
    idempotentReplay: true,
    result: operation
  });
}

function outcomeForState(state: 'queued' | 'claimed' | 'completed' | 'partial' | 'stopped' | 'failed'): CollectorServiceAuditOutcome {
  if (state === 'queued' || state === 'claimed') return 'queued';
  if (state === 'completed') return 'completed';
  if (state === 'partial') return 'partial';
  return 'failed';
}
