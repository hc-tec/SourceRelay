import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';

/** OpenAPI components owned by the fixed-contract Zhihu official provider. */
export const ZHIHU_OFFICIAL_OPENAPI_SCHEMAS = {
  OfficialSourceCapability: {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion', 'capability', 'platform', 'title', 'inputMode', 'executionTarget',
      'executionProvider', 'dispatchState', 'runtimeState', 'captureMode', 'credentialLocation',
      'browserBindingRequired', 'maximumItems'
    ],
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      capability: {
        type: 'string',
        enum: [
          'zhihu.search.public_content.v1', 'zhihu.hot_list.public_content.v1',
          'web.search.global.zhihu_provider.v1'
        ]
      },
      platform: { type: 'string', enum: ['zhihu', 'web'] },
      title: { type: 'string' },
      inputMode: {
        type: 'string',
        enum: ['query_and_count', 'fixed_limit', 'query_count_and_bounded_filters']
      },
      executionTarget: { type: 'string', const: 'official_api' },
      executionProvider: { type: 'string', const: 'zhihu_open_platform' },
      dispatchState: { type: 'string', const: 'direct_ready' },
      runtimeState: { type: 'string', enum: ['ready', 'credential_required'] },
      captureMode: { type: 'string', const: 'official_json_api' },
      credentialLocation: { type: 'string', const: 'gateway_only' },
      browserBindingRequired: { type: 'boolean', const: false },
      maximumItems: { type: 'integer', enum: [10, 20, 30] }
    }
  },
  ZhihuOfficialSearchCollectRequest: officialRequestSchema(
    'zhihu',
    'zhihu.search.public_content.v1',
    {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 100 },
        count: { type: 'integer', minimum: 1, maximum: 10, default: 10 }
      }
    }
  ),
  ZhihuOfficialHotListCollectRequest: officialRequestSchema(
    'zhihu',
    'zhihu.hot_list.public_content.v1',
    {
      type: 'object',
      additionalProperties: false,
      properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 30 } }
    }
  ),
  ZhihuOfficialGlobalSearchCollectRequest: officialRequestSchema(
    'web',
    'web.search.global.zhihu_provider.v1',
    {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 100 },
        count: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
        searchDatabase: { type: 'string', enum: ['all', 'realtime', 'static'], default: 'all' },
        site: {
          type: 'string',
          minLength: 1,
          maxLength: 253,
          pattern: '^[A-Za-z0-9.-]+$',
          description: 'Optional non-Zhihu hostname. Zhihu content must use zhihu.search.public_content.v1.'
        },
        publishedAfter: { type: 'string', format: 'date-time' }
      }
    }
  )
} as const;

function officialRequestSchema(
  platform: 'zhihu' | 'web',
  capability:
    | 'zhihu.search.public_content.v1'
    | 'zhihu.hot_list.public_content.v1'
    | 'web.search.global.zhihu_provider.v1',
  input: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'clientRequestId', 'platform', 'capability', 'executionTarget', 'input'],
    properties: {
      schemaVersion: { type: 'integer', const: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION },
      clientRequestId: { type: 'string', format: 'uuid' },
      platform: { type: 'string', const: platform },
      capability: { type: 'string', const: capability },
      executionTarget: { type: 'string', const: 'official_api' },
      input
    }
  };
}
