import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from './user-browser-collector-service-contract';

/** Machine-readable production contract; it deliberately omits the legacy Profile lane. */
export function userBrowserCollectorServiceOpenApiDocument(loopbackOrigin: string): Record<string, unknown> {
  const origin = validLoopbackOrigin(loopbackOrigin);
  return {
    openapi: '3.1.0',
    info: {
      title: 'Local Collector Service — User-Owned Browser Mode',
      version: '2.0.0-experimental',
      description: 'Loopback-only registered-capability API for a paired user-owned browser extension. It is not a generic browser-control API.'
    },
    servers: [{ url: origin }],
    paths: {
      '/v2/collector-service/browser-bindings': {
        get: {
          operationId: 'listUserBrowserBindings',
          security: [{ CollectorServiceToken: [] }],
          'x-collector-required-scope': 'browser-bindings:read',
          responses: { '200': jsonResponse({ $ref: '#/components/schemas/BrowserBindingCatalog' }) }
        }
      },
      '/v2/collect': {
        post: {
          operationId: 'queueUserBrowserCollection',
          summary: 'Queue one registered capability for a paired user-owned browser binding.',
          security: [{ CollectorServiceToken: [] }],
          'x-collector-required-scope': 'collect:execute',
          'x-collector-browser-control': 'not_exposed',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserBrowserCollectRequest' } } }
          },
          responses: {
            '201': jsonResponse({ $ref: '#/components/schemas/QueuedOperationResponse' }),
            '400': errorResponse(),
            '401': errorResponse(),
            '403': errorResponse(),
            '409': errorResponse()
          }
        }
      },
      '/v2/collect/operations/{operationId}': {
        get: {
          operationId: 'getUserBrowserCollectionOperation',
          security: [{ CollectorServiceToken: [] }],
          'x-collector-required-scope': 'operations:read',
          parameters: [{
            name: 'operationId', in: 'path', required: true,
            schema: { type: 'string', format: 'uuid' }
          }],
          responses: { '200': jsonResponse({ $ref: '#/components/schemas/QueuedOperationResponse' }), '404': errorResponse() }
        }
      }
    },
    components: {
      securitySchemes: {
        CollectorServiceToken: {
          type: 'http', scheme: 'bearer', bearerFormat: 'cst',
          description: 'Revocable local-service token. It is not a platform credential.'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'ok', 'error'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            ok: { type: 'boolean', const: false },
            error: { type: 'string' }
          }
        },
        BrowserBindingCatalog: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'bindings'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            bindings: { type: 'array', items: { $ref: '#/components/schemas/BrowserBinding' } }
          }
        },
        BrowserBinding: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'extensionId', 'state', 'pairedAt', 'lastSeenAt'],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            browserBindingId: { type: 'string', format: 'uuid' },
            extensionId: { type: 'string', pattern: '^[a-p]{32}$' },
            state: { type: 'string', enum: ['paired', 'online'] },
            pairedAt: { type: 'string', format: 'date-time' },
            lastSeenAt: { type: ['string', 'null'], format: 'date-time' }
          }
        },
        UserBrowserCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.video_detail' },
            executionTarget: { type: 'string', const: 'collector_work_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['canonicalVideoUrl'],
              properties: { canonicalVideoUrl: { type: 'string', format: 'uri' } }
            }
          }
        },
        QueuedOperationResponse: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'result'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            result: { $ref: '#/components/schemas/Operation' }
          }
        },
        Operation: {
          type: 'object', additionalProperties: false,
          required: [
            'schemaVersion', 'operationId', 'browserBindingId', 'platform', 'capability', 'executionTarget',
            'state', 'queuedAt', 'claimedAt', 'completedAt', 'errorCode', 'terminalReason', 'artifact'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            operationId: { type: 'string', format: 'uuid' },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.video_detail' },
            executionTarget: { type: 'string', const: 'collector_work_tab' },
            state: { type: 'string', enum: ['queued', 'claimed', 'completed', 'partial', 'stopped', 'failed'] },
            queuedAt: { type: 'string', format: 'date-time' },
            claimedAt: { type: ['string', 'null'], format: 'date-time' },
            completedAt: { type: ['string', 'null'], format: 'date-time' },
            errorCode: { type: ['string', 'null'] },
            terminalReason: { type: ['string', 'null'] },
            artifact: { type: ['object', 'null'] }
          }
        }
      }
    },
    'x-collector-excluded-surfaces': [
      'profile_id', 'profile_path', 'cookie', 'token', 'arbitrary_url', 'arbitrary_selector',
      'arbitrary_script', 'arbitrary_pointer_input', 'cdp', 'network_response_body'
    ]
  };
}

function jsonResponse(schema: Record<string, unknown>): Record<string, unknown> {
  return { description: 'Successful response.', content: { 'application/json': { schema } } };
}

function errorResponse(): Record<string, unknown> {
  return jsonResponse({ $ref: '#/components/schemas/ErrorResponse' });
}

function validLoopbackOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('user_browser_collector_openapi_origin_invalid');
  }
  return url.origin;
}
