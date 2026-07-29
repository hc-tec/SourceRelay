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
      '/v2/capabilities': {
        get: {
          operationId: 'listUserBrowserCapabilities',
          summary: 'List registered user-owned-browser capabilities and their dispatch or route-admission state.',
          responses: { '200': jsonResponse({ $ref: '#/components/schemas/UserBrowserCapabilityCatalog' }) }
        }
      },
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
      },
      '/v1/collect/artifacts/{capability}/{artifactId}': {
        get: {
          operationId: 'getUserBrowserCollectionArtifact',
          summary: 'Read a capability-bound local artifact without receiving a filesystem path.',
          security: [{ CollectorServiceToken: [] }],
          'x-collector-required-scope': 'artifacts:read',
          parameters: [
            {
              name: 'capability', in: 'path', required: true,
              schema: {
                type: 'string',
                enum: [
                  'bilibili.video_detail', 'bilibili.native_search', 'bilibili.native_search_batch',
                  'bilibili.account_profile', 'bilibili.account_inventory',
                  'bilibili.dynamic', 'bilibili.collection_series.overview',
                  'bilibili.collection_series.detail', 'bilibili.danmaku', 'bilibili.discussion'
                ]
              }
            },
            {
              name: 'artifactId', in: 'path', required: true,
              schema: { type: 'string', format: 'uuid' }
            }
          ],
          responses: {
            '200': jsonResponse({ $ref: '#/components/schemas/ArtifactResponse' }),
            '401': errorResponse(),
            '403': errorResponse(),
            '404': errorResponse()
          }
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
        UserBrowserCapabilityCatalog: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'capabilities'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            capabilities: { type: 'array', items: { $ref: '#/components/schemas/UserBrowserCapability' } }
          }
        },
        UserBrowserCapability: {
          oneOf: [
            { $ref: '#/components/schemas/BilibiliUserBrowserCapability' },
            { $ref: '#/components/schemas/XiaohongshuUserBrowserCapability' },
            { $ref: '#/components/schemas/XiaohongshuPublicNotesSearchCapability' },
            { $ref: '#/components/schemas/XiaohongshuAccountPublicNotesCapability' },
            { $ref: '#/components/schemas/XiaohongshuNotePublicDetailCapability' },
            { $ref: '#/components/schemas/XiaohongshuNotePublicCommentsCapability' },
            { $ref: '#/components/schemas/XiaohongshuReplyCapability' }
          ]
        },
        BilibiliUserBrowserCapability: {
          type: 'object', additionalProperties: false,
          required: [
            'schemaVersion', 'capability', 'platform', 'title', 'inputMode', 'dispatchState', 'captureMode',
            'legacyImplementationPresent', 'browserHostFallback'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            capability: {
              type: 'string',
              enum: [
                'bilibili.native_search', 'bilibili.native_search_batch', 'bilibili.account_profile',
                'bilibili.account_inventory', 'bilibili.account_inventory.pagination', 'bilibili.video_detail',
                'bilibili.transcript', 'bilibili.discussion', 'bilibili.danmaku', 'bilibili.dynamic',
                'bilibili.collection_series.overview', 'bilibili.collection_series.detail'
              ]
            },
            platform: { type: 'string', const: 'bilibili' },
            title: { type: 'string' },
            inputMode: { type: 'string' },
            dispatchState: {
              type: 'string',
              enum: [
                'direct_ready', 'direct_canary_pending', 'direct_gateway_dispatch_pending', 'direct_migration_required',
                'trusted_interaction_migration_required'
              ]
            },
            captureMode: { type: 'string' },
            legacyImplementationPresent: { type: 'boolean', const: true },
            browserHostFallback: { type: 'string', const: 'forbidden' }
          }
        },
        XiaohongshuUserBrowserCapability: {
          type: 'object', additionalProperties: false,
          required: [
            'schemaVersion', 'capability', 'platform', 'title', 'inputMode', 'executionTarget', 'dispatchState',
            'accountScopedSurfaces', 'captureMode', 'responseBodies', 'routeAdmission', 'budget', 'browserHostFallback'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            capability: { type: 'string', const: 'xiaohongshu.current_page.network_metadata' },
            platform: { type: 'string', const: 'xiaohongshu' },
            title: { type: 'string' },
            inputMode: { type: 'string', const: 'explicit_current_page_selection_no_caller_url' },
            executionTarget: { type: 'string', const: 'user_selected_tab' },
            accountScopedSurfaces: { type: 'string', const: 'forbidden' },
            dispatchState: { type: 'string', const: 'policy_ready_route_admission_required' },
            captureMode: { type: 'string', const: 'prearmed_same_document_network_metadata' },
            responseBodies: { type: 'string', const: 'not_read' },
            routeAdmission: { type: 'string', const: 'no_public_content_route_admitted' },
            budget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumNetworkMetadataObservations',
                'maximumRawPayloadBytes'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 0 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 0 },
                maximumNetworkResponseBodies: { type: 'integer', const: 0 },
                maximumNetworkMetadataObservations: { type: 'integer', const: 24 },
                maximumRawPayloadBytes: { type: 'integer', const: 0 }
              }
            },
            browserHostFallback: { type: 'string', const: 'forbidden' }
          }
        },
        XiaohongshuPublicNotesSearchCapability: {
          type: 'object', additionalProperties: false,
          required: [
            'schemaVersion', 'capability', 'platform', 'title', 'inputMode', 'executionTarget',
            'accountScopedSurfaces', 'dispatchState', 'managedValidationState', 'captureMode',
            'responseBodies', 'routeAdmission', 'budget', 'depthBudget', 'commentsDepthBudget', 'commentsRepliesDepthBudget', 'commentsRepliesMultiDepthBudget', 'browserHostFallback'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            capability: { type: 'string', const: 'xiaohongshu.search.public_notes.v1' },
            platform: { type: 'string', const: 'xiaohongshu' },
            title: { type: 'string' },
            inputMode: { type: 'string', const: 'query_only_no_caller_url' },
            executionTarget: { type: 'string', const: 'existing_public_explore_tab' },
            accountScopedSurfaces: { type: 'string', const: 'forbidden' },
            dispatchState: { type: 'string', const: 'direct_ready' },
            managedValidationState: { type: 'string', const: 'gateway_extension_real_e2e_passed' },
            captureMode: { type: 'string', const: 'current_document_main_world_public_projection' },
            responseBodies: { type: 'string', const: 'temporarily_read_projected_not_stored' },
            routeAdmission: { type: 'string', const: 'public_payload_shape_verified_no_url_dependency' },
            budget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 0 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 1 },
                maximumNetworkResponseBodies: { type: 'integer', const: 8 },
                maximumProjectedItems: { type: 'integer', const: 40 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            depthBudget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 0 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 41 },
                maximumNetworkResponseBodies: { type: 'integer', const: 8 },
                maximumProjectedItems: { type: 'integer', const: 40 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            commentsDepthBudget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 0 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 101 },
                maximumNetworkResponseBodies: { type: 'integer', const: 168 },
                maximumProjectedItems: { type: 'integer', const: 1640 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            commentsRepliesDepthBudget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 0 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 121 },
                maximumNetworkResponseBodies: { type: 'integer', const: 328 },
                maximumProjectedItems: { type: 'integer', const: 2440 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            commentsRepliesMultiDepthBudget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 0 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 161 },
                maximumNetworkResponseBodies: { type: 'integer', const: 648 },
                maximumProjectedItems: { type: 'integer', const: 4040 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            browserHostFallback: { type: 'string', const: 'forbidden' }
          }
        },
        XiaohongshuAccountPublicNotesCapability: {
          type: 'object', additionalProperties: false,
          required: [
            'schemaVersion', 'capability', 'platform', 'title', 'inputMode', 'executionTarget',
            'accountScopedSurfaces', 'dispatchState', 'managedValidationState', 'captureMode',
            'responseBodies', 'routeAdmission', 'budget', 'ephemeralProfileLinkBudget', 'browserHostFallback'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            capability: { type: 'string', const: 'xiaohongshu.account.public_notes.v1' },
            platform: { type: 'string', const: 'xiaohongshu' },
            title: { type: 'string' },
            inputMode: { type: 'string', const: 'scroll_budget_only_or_ephemeral_profile_url' },
            executionTarget: { type: 'string', enum: ['existing_public_profile_tab', 'ephemeral_public_profile_url'] },
            accountScopedSurfaces: { type: 'string', const: 'public_profile_only' },
            dispatchState: { type: 'string', const: 'direct_canary_pending' },
            managedValidationState: { type: 'string', const: 'implementation_ready_live_e2e_pending' },
            captureMode: { type: 'string', const: 'current_document_network_projection_plus_trusted_scroll' },
            responseBodies: { type: 'string', const: 'temporarily_read_projected_not_stored' },
            routeAdmission: { type: 'string', const: 'generic_public_note_card_projection_no_url_dependency' },
            budget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', enum: [0, 1] },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 3 },
                maximumNetworkResponseBodies: { type: 'integer', const: 8 },
                maximumProjectedItems: { type: 'integer', const: 40 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            ephemeralProfileLinkBudget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 1 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 20 },
                maximumNetworkResponseBodies: { type: 'integer', const: 8 },
                maximumProjectedItems: { type: 'integer', const: 200 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            browserHostFallback: { type: 'string', const: 'forbidden' }
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
        XiaohongshuNotePublicDetailCapability: {
          type: 'object', additionalProperties: false,
          required: [
            'schemaVersion', 'capability', 'platform', 'title', 'inputMode', 'executionTarget',
            'accountScopedSurfaces', 'dispatchState', 'managedValidationState', 'captureMode',
            'responseBodies', 'routeAdmission', 'budget', 'browserHostFallback'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            capability: { type: 'string', const: 'xiaohongshu.note.public_detail.v1' },
            platform: { type: 'string', const: 'xiaohongshu' },
            title: { type: 'string' },
            inputMode: { type: 'string', const: 'result_rank_only_no_caller_url' },
            executionTarget: { type: 'string', const: 'existing_public_search_tab' },
            accountScopedSurfaces: { type: 'string', const: 'forbidden' },
            dispatchState: { type: 'string', const: 'direct_ready' },
            managedValidationState: { type: 'string', const: 'gateway_extension_real_e2e_passed' },
            captureMode: { type: 'string', const: 'network_first_dom_fallback_same_document_overlay' },
            responseBodies: { type: 'string', const: 'temporarily_read_projected_not_stored' },
            routeAdmission: { type: 'string', const: 'public_detail_shape_only_no_url_dependency' },
            budget: {
              type: 'object', additionalProperties: false,
              required: [
                'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
                'maximumRawPayloadBytesStored'
              ],
              properties: {
                maximumPlatformNavigations: { type: 'integer', const: 0 },
                maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 },
                maximumSemanticActions: { type: 'integer', const: 1 },
                maximumNetworkResponseBodies: { type: 'integer', const: 4 },
                maximumProjectedItems: { type: 'integer', const: 1 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 }
              }
            },
            browserHostFallback: { type: 'string', const: 'forbidden' }
          }
        },
        XiaohongshuNotePublicCommentsCapability: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'capability', 'platform', 'title', 'inputMode', 'executionTarget',
            'accountScopedSurfaces', 'dispatchState', 'managedValidationState', 'captureMode', 'responseBodies',
            'routeAdmission', 'budget', 'browserHostFallback'],
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            capability: { type: 'string', const: 'xiaohongshu.note.public_comments.v1' },
            platform: { type: 'string', const: 'xiaohongshu' }, title: { type: 'string' },
            inputMode: { type: 'string', const: 'scroll_budget_only_no_caller_url' },
            executionTarget: { type: 'string', const: 'existing_public_note_overlay' },
            accountScopedSurfaces: { type: 'string', const: 'forbidden' },
            dispatchState: { type: 'string', const: 'direct_ready' },
            managedValidationState: { type: 'string', const: 'gateway_extension_real_e2e_passed' },
            captureMode: { type: 'string', const: 'network_first_dom_fallback_trusted_scroll' },
            responseBodies: { type: 'string', const: 'temporarily_read_projected_not_stored' },
            routeAdmission: { type: 'string', const: 'generic_public_comment_shape_no_url_dependency' },
            budget: { type: 'object', additionalProperties: false,
              required: ['maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
                'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems', 'maximumRawPayloadBytesStored'],
              properties: { maximumPlatformNavigations: { type: 'integer', const: 0 }, maximumPageReloads: { type: 'integer', const: 0 },
                maximumPageInitiatedNewDocuments: { type: 'integer', const: 0 }, maximumSemanticActions: { type: 'integer', const: 3 },
                maximumNetworkResponseBodies: { type: 'integer', const: 8 }, maximumProjectedItems: { type: 'integer', const: 80 },
                maximumRawPayloadBytesStored: { type: 'integer', const: 0 } } },
            browserHostFallback: { type: 'string', const: 'forbidden' }
          }
        },
        XiaohongshuReplyCapability:{type:'object',additionalProperties:false,required:['schemaVersion','capability','platform','title','inputMode','executionTarget','accountScopedSurfaces','dispatchState','managedValidationState','captureMode','responseBodies','routeAdmission','budget','multiThreadBudget','browserHostFallback'],properties:{schemaVersion:{type:'integer',const:1},capability:{type:'string',const:'xiaohongshu.note.public_comment_replies.v1'},platform:{type:'string',const:'xiaohongshu'},title:{type:'string'},inputMode:{type:'string',const:'bounded_thread_budget_only_no_caller_identity'},executionTarget:{type:'string',const:'existing_public_note_overlay'},accountScopedSurfaces:{type:'string',const:'forbidden'},dispatchState:{type:'string',const:'direct_ready'},managedValidationState:{type:'string',const:'gateway_extension_real_e2e_passed'},captureMode:{type:'string',const:'network_archive_first_dom_hierarchy_fallback_trusted_click'},responseBodies:{type:'string',const:'temporarily_read_projected_not_stored'},routeAdmission:{type:'string',const:'preloaded_public_reply_shape_no_url_dependency'},budget:{type:'object',additionalProperties:false,required:['maximumPlatformNavigations','maximumPageReloads','maximumPageInitiatedNewDocuments','maximumSemanticActions','maximumNetworkResponseBodies','maximumProjectedItems','maximumRawPayloadBytesStored'],properties:{maximumPlatformNavigations:{type:'integer',const:0},maximumPageReloads:{type:'integer',const:0},maximumPageInitiatedNewDocuments:{type:'integer',const:0},maximumSemanticActions:{type:'integer',const:1},maximumNetworkResponseBodies:{type:'integer',const:8},maximumProjectedItems:{type:'integer',const:40},maximumRawPayloadBytesStored:{type:'integer',const:0}}},multiThreadBudget:{type:'object',additionalProperties:false,required:['maximumPlatformNavigations','maximumPageReloads','maximumPageInitiatedNewDocuments','maximumSemanticActions','maximumNetworkResponseBodies','maximumProjectedItems','maximumRawPayloadBytesStored'],properties:{maximumPlatformNavigations:{type:'integer',const:0},maximumPageReloads:{type:'integer',const:0},maximumPageInitiatedNewDocuments:{type:'integer',const:0},maximumSemanticActions:{type:'integer',const:3},maximumNetworkResponseBodies:{type:'integer',const:24},maximumProjectedItems:{type:'integer',const:120},maximumRawPayloadBytesStored:{type:'integer',const:0}}},browserHostFallback:{type:'string',const:'forbidden'}}},
        UserBrowserCollectRequest: {
          oneOf: [
            { $ref: '#/components/schemas/UserBrowserVideoDetailCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserNativeSearchCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserNativeSearchBatchCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserAccountProfileCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserAccountInventoryCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserVideoDiscussionCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserDynamicCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserCollectionSeriesOverviewCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserCollectionSeriesDetailCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserDanmakuCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserXiaohongshuPublicNotesSearchCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserXiaohongshuAccountPublicNotesCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserXiaohongshuNotePublicDetailCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserXiaohongshuNotePublicCommentsCollectRequest' },
            { $ref: '#/components/schemas/UserBrowserXiaohongshuReplyCollectRequest' }
          ]
        },
        UserBrowserVideoDetailCollectRequest: {
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
        UserBrowserNativeSearchCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.native_search' },
            executionTarget: { type: 'string', const: 'collector_work_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['query'],
              properties: { query: { type: 'string', minLength: 1, maxLength: 160 } }
            }
          }
        },
        UserBrowserNativeSearchBatchCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.native_search_batch' },
            executionTarget: { type: 'string', const: 'collector_work_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['query'],
              properties: { query: { type: 'string', minLength: 1, maxLength: 160 } }
            }
          }
        },
        UserBrowserAccountProfileCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.account_profile' },
            executionTarget: { type: 'string', const: 'collector_work_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['canonicalProfileUrl'],
              properties: { canonicalProfileUrl: { type: 'string', format: 'uri' } }
            }
          }
        },
        UserBrowserAccountInventoryCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.account_inventory' },
            executionTarget: {
              type: 'string',
              enum: ['collector_work_tab', 'user_selected_tab'],
              description: 'user_selected_tab requires a short-lived selection made from the extension popup; callers cannot provide a tab, URL variant, selector, or script.'
            },
            input: {
              type: 'object', additionalProperties: false,
              required: ['canonicalProfileUrl'],
              properties: { canonicalProfileUrl: { type: 'string', format: 'uri' } }
            }
          }
        },
        UserBrowserVideoDiscussionCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          description: 'Requires a short-lived matching page/document selection made in the extension popup after the user manually makes comments visible. This API cannot name a tab, document, selector, script, or page action.',
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.discussion' },
            executionTarget: { type: 'string', const: 'user_selected_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['canonicalVideoUrl'],
              properties: { canonicalVideoUrl: { type: 'string', format: 'uri' } }
            }
          }
        },
        UserBrowserDynamicCollectRequest: profileCollectRequest('bilibili.dynamic'),
        UserBrowserCollectionSeriesOverviewCollectRequest: profileCollectRequest('bilibili.collection_series.overview'),
        UserBrowserCollectionSeriesDetailCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.collection_series.detail' },
            executionTarget: { type: 'string', enum: ['collector_work_tab', 'user_selected_tab'] },
            input: {
              type: 'object', additionalProperties: false,
              required: ['canonicalProfileUrl', 'stableSeriesId', 'listType'],
              properties: {
                canonicalProfileUrl: { type: 'string', format: 'uri' },
                stableSeriesId: { type: 'string', pattern: '^[1-9]\\d{0,19}$' },
                listType: { type: 'string', enum: ['series', 'season'] }
              }
            }
          }
        },
        UserBrowserDanmakuCollectRequest: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            capability: { type: 'string', const: 'bilibili.danmaku' },
            executionTarget: { type: 'string', const: 'collector_work_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['canonicalVideoUrl'],
              properties: { canonicalVideoUrl: { type: 'string', format: 'uri' } }
            }
          }
        },
        UserBrowserXiaohongshuPublicNotesSearchCollectRequest: {
          type: 'object', additionalProperties: false,
          description: 'Runs one fixed trusted in-page search in the unique existing public Explore tab. An optional maximumDetails (0–20) performs sequential same-document detail captures with a slow fixed delay and closes each overlay before the next rank. An optional comments.maximumScrolls (1–3) collects public comments while each requested detail overlay is open; comments.replies.maximumThreads (1–3) additionally expands up to the requested number of visible reply threads per detail, and is disabled unless comments is enabled. No URL, tab ID, selector, coordinate, script, debugger command, refresh, new tab, or Browser Host fallback can be supplied.',
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'xiaohongshu' },
            capability: { type: 'string', const: 'xiaohongshu.search.public_notes.v1' },
            executionTarget: { type: 'string', const: 'existing_public_explore_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['query'],
              properties: {
                query: { type: 'string', minLength: 1, maxLength: 80 },
                maximumDetails: { type: 'integer', minimum: 0, maximum: 20, default: 0 },
                comments: {
                  type: 'object', additionalProperties: false,
                  required: ['maximumScrolls'],
                  properties: {
                    maximumScrolls: { type: 'integer', enum: [1, 2, 3] },
                    replies: {
                      type: 'object', additionalProperties: false,
                      required: ['maximumThreads'],
                      properties: { maximumThreads: { type: 'integer', enum: [1, 2, 3] } }
                    }
                  }
                }
              }
            }
          }
        },
        UserBrowserXiaohongshuAccountPublicNotesCollectRequest: {
          type: 'object', additionalProperties: false,
          description: 'Collects public note cards from either a unique existing public profile tab or one user-supplied short-lived public profile link. A link is used once in the existing tab, never persisted in the artifact, and cannot cause refresh, retry, or a new tab.',
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'xiaohongshu' },
            capability: { type: 'string', const: 'xiaohongshu.account.public_notes.v1' },
            executionTarget: { type: 'string', enum: ['existing_public_profile_tab', 'ephemeral_public_profile_url'] },
            input: {
              type: 'object', additionalProperties: false,
              required: ['maximumScrolls'],
              properties: {
                maximumScrolls: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
                profileUrl: { type: 'string', minLength: 1, maxLength: 4096, format: 'uri' }
              },
              oneOf: [
                {
                  required: ['maximumScrolls'],
                  properties: { maximumScrolls: { type: 'integer', enum: [1, 2, 3] } },
                  not: { required: ['profileUrl'] }
                },
                {
                  required: ['maximumScrolls', 'profileUrl'],
                  properties: {
                    maximumScrolls: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] }
                  }
                }
              ]
            }
          }
        },
        UserBrowserXiaohongshuNotePublicDetailCollectRequest: {
          type: 'object', additionalProperties: false,
          description: 'Opens one ranked result from the unique existing public search tab in the proved same-document detail overlay. No URL, note ID, tab ID, selector, coordinate, script, refresh, or new tab can be supplied.',
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'xiaohongshu' },
            capability: { type: 'string', const: 'xiaohongshu.note.public_detail.v1' },
            executionTarget: { type: 'string', const: 'existing_public_search_tab' },
            input: {
              type: 'object', additionalProperties: false,
              required: ['resultRank'],
              properties: { resultRank: { type: 'integer', minimum: 1, maximum: 20 } }
            }
          }
        },
        UserBrowserXiaohongshuNotePublicCommentsCollectRequest: {
          type: 'object', additionalProperties: false,
          description: 'Collects public comments from the already-open same-document note overlay with bounded trusted scrolling. No URL, note ID, cursor, tab ID, selector, coordinate, script, refresh, or new tab can be supplied.',
          required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
          properties: { schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            browserBindingId: { type: 'string', format: 'uuid' }, platform: { type: 'string', const: 'xiaohongshu' },
            capability: { type: 'string', const: 'xiaohongshu.note.public_comments.v1' },
            executionTarget: { type: 'string', const: 'existing_public_note_overlay' },
            input: { type: 'object', additionalProperties: false, required: ['maximumScrolls'],
              properties: { maximumScrolls: { type: 'integer', enum: [1, 2, 3] } } } }
        },
        UserBrowserXiaohongshuReplyCollectRequest:{type:'object',additionalProperties:false,description:'Projects up to three public reply threads from the short-lived Network archive first; only when a requested thread is incomplete may it expand one visible public reply thread once in the unique existing note overlay. No URL, note or comment identity, selector, coordinate, script, route or cursor can be supplied.',required:['schemaVersion','browserBindingId','platform','capability','executionTarget','input'],properties:{schemaVersion:{type:'integer',const:USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION},browserBindingId:{type:'string',format:'uuid'},platform:{type:'string',const:'xiaohongshu'},capability:{type:'string',const:'xiaohongshu.note.public_comment_replies.v1'},executionTarget:{type:'string',const:'existing_public_note_overlay'},input:{type:'object',additionalProperties:false,required:['maximumThreads'],properties:{maximumThreads:{type:'integer',enum:[1,2,3]}}}}},
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
            platform: { type: 'string', enum: ['bilibili', 'xiaohongshu'] },
            capability: {
              type: 'string',
              enum: [
                'bilibili.video_detail', 'bilibili.native_search',
                'bilibili.account_profile', 'bilibili.account_inventory',
                'bilibili.dynamic', 'bilibili.collection_series.overview',
                'bilibili.collection_series.detail', 'bilibili.danmaku', 'bilibili.discussion',
                'xiaohongshu.search.public_notes.v1', 'xiaohongshu.account.public_notes.v1',
                'xiaohongshu.note.public_detail.v1', 'xiaohongshu.note.public_comments.v1',
                'xiaohongshu.note.public_comment_replies.v1'
              ]
            },
            executionTarget: {
              type: 'string',
              enum: ['collector_work_tab', 'user_selected_tab', 'existing_public_explore_tab',
                'existing_public_profile_tab', 'ephemeral_public_profile_url', 'existing_public_search_tab',
                'existing_public_note_overlay']
            },
            state: { type: 'string', enum: ['queued', 'claimed', 'completed', 'partial', 'stopped', 'failed'] },
            queuedAt: { type: 'string', format: 'date-time' },
            claimedAt: { type: ['string', 'null'], format: 'date-time' },
            completedAt: { type: ['string', 'null'], format: 'date-time' },
            errorCode: { type: ['string', 'null'] },
            terminalReason: { type: ['string', 'null'] },
            artifact: { type: ['object', 'null'] }
          }
        },
        ArtifactResponse: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'capability', 'artifact'],
          properties: {
            schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
            capability: {
              type: 'string',
              enum: [
                'bilibili.video_detail', 'bilibili.native_search',
                'bilibili.account_profile', 'bilibili.account_inventory',
                'bilibili.dynamic', 'bilibili.collection_series.overview',
                'bilibili.collection_series.detail', 'bilibili.danmaku', 'bilibili.discussion',
                'xiaohongshu.search.public_notes.v1', 'xiaohongshu.account.public_notes.v1',
                'xiaohongshu.note.public_detail.v1', 'xiaohongshu.note.public_comments.v1',
                'xiaohongshu.note.public_comment_replies.v1'
              ]
            },
            artifact: { type: 'object' }
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

function profileCollectRequest(capability: 'bilibili.dynamic' | 'bilibili.collection_series.overview'): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false,
    required: ['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'],
    properties: {
      schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
      browserBindingId: { type: 'string', format: 'uuid' },
      platform: { type: 'string', const: 'bilibili' },
      capability: { type: 'string', const: capability },
      executionTarget: { type: 'string', const: 'collector_work_tab' },
      input: {
        type: 'object', additionalProperties: false,
        required: ['canonicalProfileUrl'],
        properties: { canonicalProfileUrl: { type: 'string', format: 'uri' } }
      }
    }
  };
}

function validLoopbackOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('user_browser_collector_openapi_origin_invalid');
  }
  return url.origin;
}
