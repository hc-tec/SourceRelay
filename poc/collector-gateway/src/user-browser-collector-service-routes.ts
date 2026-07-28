import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CollectorServiceAuditAction,
  CollectorServiceAuditLog,
  CollectorServiceAuditOutcome
} from './collector-service-audit';
import type { CollectorServiceClientRegistry } from './collector-service-clients';
import {
  enqueueBilibiliAccountInventoryWork,
  enqueueBilibiliAccountInventoryUserSelectedTabWork,
  enqueueBilibiliAccountProfileWork,
  enqueueBilibiliCollectionSeriesDetailWork,
  enqueueBilibiliCollectionSeriesOverviewWork,
  enqueueBilibiliDanmakuWork,
  enqueueBilibiliDiscussionUserSelectedTabWork,
  enqueueBilibiliDynamicWork,
  enqueueBilibiliNativeSearchBatchWork,
  enqueueBilibiliNativeSearchWork,
  enqueueBilibiliVideoDetailWork,
  enqueueXiaohongshuPublicNotesSearchWork,
  enqueueXiaohongshuAccountPublicNotesWork,
  enqueueXiaohongshuNotePublicDetailWork,
  reconcileExpiredExtensionWork,
  type ExtensionWorkRouteContext
} from './extension-work-routes';
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
import { listUserBrowserCapabilities } from './user-browser-capabilities';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export interface UserBrowserCollectorServiceRouteContext extends ExtensionWorkRouteContext {
  collectorServiceClients: CollectorServiceClientRegistry;
  collectorServiceAudit: CollectorServiceAuditLog;
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
  if (request.method === 'GET' && url.pathname === '/v2/capabilities') {
    sendJson(response, 200, {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      capabilities: listUserBrowserCapabilities()
    });
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
    let operationId: string | null = null;
    try {
      const collection = userBrowserCollectorServiceRequestInput(await readJsonBody(request));
      const operation = collection.capability === 'xiaohongshu.note.public_detail.v1'
        ? await enqueueXiaohongshuNotePublicDetailWork(
          context,
          collection.browserBindingId,
          collection.input.resultRank
        )
        : collection.capability === 'xiaohongshu.account.public_notes.v1'
        ? await enqueueXiaohongshuAccountPublicNotesWork(
          context,
          collection.browserBindingId,
          collection.input.maximumScrolls
        )
        : collection.capability === 'xiaohongshu.search.public_notes.v1'
        ? await enqueueXiaohongshuPublicNotesSearchWork(
          context,
          collection.browserBindingId,
          collection.input.query
        )
        : collection.capability === 'bilibili.video_detail'
        ? await enqueueBilibiliVideoDetailWork(
          context,
          collection.browserBindingId,
          collection.input.canonicalVideoUrl
        )
        : collection.capability === 'bilibili.native_search'
          ? await enqueueBilibiliNativeSearchWork(
            context,
            collection.browserBindingId,
            collection.input.query
          )
          : collection.capability === 'bilibili.native_search_batch'
            ? await enqueueBilibiliNativeSearchBatchWork(
              context,
              collection.browserBindingId,
              collection.input.query
            )
          : collection.capability === 'bilibili.account_profile'
            ? await enqueueBilibiliAccountProfileWork(
              context,
              collection.browserBindingId,
              collection.input.canonicalProfileUrl
            )
            : collection.capability === 'bilibili.account_inventory'
              ? collection.executionTarget === 'user_selected_tab'
                ? await enqueueBilibiliAccountInventoryUserSelectedTabWork(
                  context,
                  collection.browserBindingId,
                  collection.input.canonicalProfileUrl
                )
                : await enqueueBilibiliAccountInventoryWork(
                  context,
                  collection.browserBindingId,
                  collection.input.canonicalProfileUrl
                )
              : collection.capability === 'bilibili.discussion'
                  ? await enqueueBilibiliDiscussionUserSelectedTabWork(
                    context,
                    collection.browserBindingId,
                    collection.input.canonicalVideoUrl
                  )
                  : collection.capability === 'bilibili.dynamic'
                    ? await enqueueBilibiliDynamicWork(
                  context,
                  collection.browserBindingId,
                  collection.input.canonicalProfileUrl
                )
                    : collection.capability === 'bilibili.collection_series.overview'
                      ? await enqueueBilibiliCollectionSeriesOverviewWork(
                        context,
                        collection.browserBindingId,
                        collection.input.canonicalProfileUrl
                      )
                      : collection.capability === 'bilibili.collection_series.detail'
                        ? await enqueueBilibiliCollectionSeriesDetailWork(
                          context,
                          collection.browserBindingId,
                          collection.input.canonicalProfileUrl,
                          collection.input.stableSeriesId,
                          collection.input.listType
                        )
                        : await enqueueBilibiliDanmakuWork(
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
      await audit(context, access.principal, 'collect', null, operationId, 'failed', code);
      sendJson(response, operationStatus(code), { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION, ok: false, error: code });
    }
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
    const result = await context.workQueue.get(operation[1]!);
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
  capability:
    | 'bilibili.video_detail'
    | 'bilibili.native_search'
    | 'bilibili.native_search_batch'
    | 'bilibili.account_profile'
    | 'bilibili.account_inventory'
    | 'bilibili.discussion'
    | 'bilibili.dynamic'
    | 'bilibili.collection_series.overview'
    | 'bilibili.collection_series.detail'
    | 'bilibili.danmaku'
    | 'xiaohongshu.search.public_notes.v1'
    | 'xiaohongshu.account.public_notes.v1'
    | 'xiaohongshu.note.public_detail.v1'
    | null,
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
