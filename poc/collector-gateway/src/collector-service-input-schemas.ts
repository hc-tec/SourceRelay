import type { CollectorServiceCapability } from './collector-service-contract';
import {
  BILIBILI_NATIVE_SEARCH_MAX_PAGE,
  BILIBILI_NATIVE_SEARCH_QUERY_MAX_LENGTH,
  BILIBILI_NATIVE_SEARCH_RESULT_TYPES,
  BILIBILI_NATIVE_SEARCH_SORTS,
  BILIBILI_VIDEO_DISCUSSION_MAX_SEMANTIC_ACTIONS
} from '@intelligence/collector-contracts';
import { BILIBILI_ACCOUNT_VIDEO_PAGINATION_MAX_PAGES } from './bilibili-account-video-pagination-contract';
import { BILIBILI_DYNAMIC_TWO_PAGE_LIMIT } from './bilibili-dynamic-two-page-plan';
import { BILIBILI_NATIVE_SEARCH_BATCH_MAX_PAGES } from './bilibili-native-search-batch-contract';
import { BILIBILI_SERIES_MAX_PAGES } from './bilibili-series-detail-contract';

/**
 * JSON Schema 2020-12 fragments published to native Local Collector Service
 * consumers.  They describe only capability input, never a browser URL,
 * selector, script, Network route, Profile path, or credential surface.
 */
export type CollectorServiceInputJsonSchema = Readonly<Record<string, unknown>>;

export const COLLECTOR_SERVICE_INPUT_SCHEMA_REVISION = 1 as const;

const BILIBILI_PROFILE_URL = {
  type: 'string',
  format: 'uri',
  pattern: '^https://space\\.bilibili\\.com/[1-9][0-9]*/?$',
  description: 'Canonical public Bilibili profile URL without query or fragment.'
} as const;

const BILIBILI_VIDEO_URL = {
  type: 'string',
  format: 'uri',
  pattern: '^https://www\\.bilibili\\.com/video/BV[0-9A-Za-z]{10}/?$',
  description: 'Canonical public Bilibili BV video URL without query or fragment.'
} as const;

const SEARCH_RESULT_TYPE = {
  type: 'string',
  enum: BILIBILI_NATIVE_SEARCH_RESULT_TYPES,
  default: 'comprehensive'
} as const;

const SEARCH_SORT = {
  type: 'string',
  enum: BILIBILI_NATIVE_SEARCH_SORTS,
  default: 'relevance',
  description: 'comprehensive currently permits relevance only; newest requires resultType=video.'
} as const;

const SEARCH_QUERY = {
  type: 'string',
  minLength: 1,
  maxLength: BILIBILI_NATIVE_SEARCH_QUERY_MAX_LENGTH,
  description: 'A non-empty human query. It is never copied into service audit records.'
} as const;

export const COLLECTOR_SERVICE_INPUT_SCHEMAS: Readonly<
  Record<CollectorServiceCapability, CollectorServiceInputJsonSchema>
> = {
  'bilibili.native_search': {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: SEARCH_QUERY,
      resultType: SEARCH_RESULT_TYPE,
      sort: SEARCH_SORT,
      page: { type: 'integer', minimum: 1, maximum: BILIBILI_NATIVE_SEARCH_MAX_PAGE, default: 1 }
    }
  },
  'bilibili.native_search_batch': {
    type: 'object',
    additionalProperties: false,
    required: ['query', 'pages'],
    properties: {
      query: SEARCH_QUERY,
      resultType: SEARCH_RESULT_TYPE,
      sort: SEARCH_SORT,
      pages: {
        type: 'array',
        minItems: 1,
        maxItems: BILIBILI_NATIVE_SEARCH_BATCH_MAX_PAGES,
        uniqueItems: true,
        items: { type: 'integer', minimum: 1, maximum: BILIBILI_NATIVE_SEARCH_MAX_PAGE }
      }
    }
  },
  'bilibili.account_profile': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalProfileUrl'],
    properties: { canonicalProfileUrl: BILIBILI_PROFILE_URL }
  },
  'bilibili.account_inventory': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalProfileUrl'],
    properties: { canonicalProfileUrl: BILIBILI_PROFILE_URL }
  },
  'bilibili.account_inventory.pagination': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalProfileUrl', 'maxPages'],
    properties: {
      canonicalProfileUrl: BILIBILI_PROFILE_URL,
      maxPages: { type: 'integer', minimum: 1, maximum: BILIBILI_ACCOUNT_VIDEO_PAGINATION_MAX_PAGES }
    }
  },
  'bilibili.video_detail': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalVideoUrl'],
    properties: { canonicalVideoUrl: BILIBILI_VIDEO_URL }
  },
  'bilibili.transcript': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalVideoUrl'],
    properties: { canonicalVideoUrl: BILIBILI_VIDEO_URL }
  },
  'bilibili.discussion': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalVideoUrl'],
    properties: {
      canonicalVideoUrl: BILIBILI_VIDEO_URL,
      actions: {
        type: 'array',
        minItems: 0,
        maxItems: BILIBILI_VIDEO_DISCUSSION_MAX_SEMANTIC_ACTIONS,
        uniqueItems: true,
        description: 'Ordered bounded interaction plan. Dependency order is enforced by the Gateway.',
        items: {
          type: 'string',
          enum: [
            'select_latest_comments',
            'expand_first_thread',
            'reveal_second_thread',
            'reveal_first_thread_pagination',
            'expand_second_thread',
            'reveal_second_thread_pagination',
            'next_first_thread_page',
            'next_second_thread_page'
          ]
        },
        default: []
      }
    }
  },
  'bilibili.danmaku': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalVideoUrl'],
    properties: { canonicalVideoUrl: BILIBILI_VIDEO_URL }
  },
  'bilibili.dynamic': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalProfileUrl'],
    properties: {
      canonicalProfileUrl: BILIBILI_PROFILE_URL
    },
    description: `The service fixes dynamic collection to its registered ${BILIBILI_DYNAMIC_TWO_PAGE_LIMIT}-page budget; callers cannot override it.`
  },
  'bilibili.collection_series.overview': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalProfileUrl'],
    properties: { canonicalProfileUrl: BILIBILI_PROFILE_URL }
  },
  'bilibili.collection_series.detail': {
    type: 'object',
    additionalProperties: false,
    required: ['canonicalProfileUrl', 'stableSeriesId'],
    properties: {
      canonicalProfileUrl: BILIBILI_PROFILE_URL,
      stableSeriesId: {
        type: 'string',
        pattern: '^[1-9][0-9]*$',
        description: 'Public stable series or season ID discovered from the registered overview capability.'
      },
      listType: { type: 'string', enum: ['series', 'season'], default: 'series' },
      maxPages: {
        type: 'integer',
        minimum: 1,
        maximum: BILIBILI_SERIES_MAX_PAGES,
        default: BILIBILI_SERIES_MAX_PAGES
      }
    }
  }
};

export function collectorServiceInputSchema(capability: CollectorServiceCapability): CollectorServiceInputJsonSchema {
  return structuredClone(COLLECTOR_SERVICE_INPUT_SCHEMAS[capability]);
}
