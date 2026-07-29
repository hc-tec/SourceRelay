import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  EXTENSION_WORK_PROTOCOL_VERSION,
  EXTENSION_WORK_SCHEMA_VERSION,
  bilibiliAccountProfileIdFromUrl,
  bilibiliNativeSearchUrl,
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliPassiveVideoWorkUrl,
  canonicalBilibiliVideoWorkUrl,
  extensionWorkSigningPayload,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  normaliseBilibiliNativeSearchRoute,
  canonicalXiaohongshuPublicProfileUrl,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET,
  XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET,
  XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET,
  type ExtensionWorkCapability,
  type ExtensionWorkExecutionTarget,
  type ExtensionWorkItem,
  type ExtensionWorkResult,
  type ExtensionWorkState,
  type ExtensionWorkTerminalReason,
  type XiaohongshuProfileScrollCount,
  type UnsignedExtensionWorkItem
} from '@intelligence/collector-contracts';
import type { LoadedGatewayIdentity } from './identity';

const WORK_ITEM_TTL_MS = 60_000;
const MAX_RETAINED_OPERATIONS = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,100}$/;

export interface ExtensionWorkArtifactReference {
  artifactId: string;
  retrievalPath: string;
  summary: Record<string, unknown>;
}

export interface ExtensionWorkOperationSummary {
  schemaVersion: 1;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili' | 'xiaohongshu';
  capability: ExtensionWorkCapability;
  executionTarget: ExtensionWorkExecutionTarget;
  state: ExtensionWorkState;
  queuedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  terminalReason: ExtensionWorkTerminalReason | null;
  artifact: ExtensionWorkArtifactReference | null;
}

interface StoredOperation {
  schemaVersion: 1;
  item: StoredExtensionWorkItem;
  state: ExtensionWorkState;
  queuedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  terminalReason: ExtensionWorkTerminalReason | null;
  artifact: ExtensionWorkArtifactReference | null;
}

export interface EnqueueBilibiliVideoDetailWorkInput {
  browserBindingId: string;
  canonicalVideoUrl: string;
}

export interface EnqueueBilibiliNativeSearchWorkInput {
  browserBindingId: string;
  query: string;
}

export interface EnqueueBilibiliNativeSearchBatchWorkInput {
  browserBindingId: string;
  query: string;
}

export interface EnqueueBilibiliAccountProfileWorkInput {
  browserBindingId: string;
  canonicalProfileUrl: string;
}

export interface EnqueueBilibiliAccountInventoryWorkInput {
  browserBindingId: string;
  canonicalProfileUrl: string;
}

export interface EnqueueBilibiliAccountInventoryUserSelectedTabWorkInput {
  browserBindingId: string;
  canonicalProfileUrl: string;
}

export interface EnqueueBilibiliDiscussionUserSelectedTabWorkInput {
  browserBindingId: string;
  canonicalVideoUrl: string;
}

export interface EnqueueBilibiliDynamicWorkInput {
  browserBindingId: string;
  canonicalProfileUrl: string;
}

export interface EnqueueBilibiliCollectionSeriesOverviewWorkInput {
  browserBindingId: string;
  canonicalProfileUrl: string;
}

export interface EnqueueBilibiliCollectionSeriesDetailWorkInput {
  browserBindingId: string;
  canonicalProfileUrl: string;
  stableSeriesId: string;
  listType: 'series' | 'season';
}

export interface EnqueueBilibiliDanmakuWorkInput {
  browserBindingId: string;
  canonicalVideoUrl: string;
}

export interface EnqueueXiaohongshuPublicNotesSearchWorkInput {
  browserBindingId: string;
  query: string;
  maximumDetails?: number;
  comments?: { maximumScrolls: 1 | 2 | 3 };
}

export interface EnqueueXiaohongshuAccountPublicNotesWorkInput {
  browserBindingId: string;
  maximumScrolls: XiaohongshuProfileScrollCount;
  profileUrl?: string;
}

export interface EnqueueXiaohongshuNotePublicDetailWorkInput {
  browserBindingId: string;
  resultRank: number;
}
export interface EnqueueXiaohongshuNotePublicCommentsWorkInput {
  browserBindingId: string;
  maximumScrolls: 1 | 2 | 3;
}
export interface EnqueueXiaohongshuNotePublicCommentRepliesWorkInput { browserBindingId: string; maximumThreads: 1; }

/**
 * Queued and claimed operations retain their signed envelope because it is
 * needed for one-time delivery. After they become terminal, native-search
 * input is redacted to a digest so historic local operation state cannot be
 * used to recover a user's search phrase.
 */
type StoredExtensionWorkItem =
  | ExtensionWorkItem
  | RedactedBilibiliNativeSearchWorkItem
  | RedactedBilibiliNativeSearchBatchWorkItem
  | RedactedXiaohongshuPublicNotesSearchWorkItem
  | RedactedXiaohongshuAccountPublicNotesWorkItem;

interface RedactedXiaohongshuPublicNotesSearchWorkItem {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.search.public_notes.v1';
  executionTarget: 'existing_public_explore_tab';
  issuedAt: string;
  expiresAt: string;
  input: { queryDigest: string };
  budget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET |
    typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET |
    typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET;
}

interface RedactedXiaohongshuAccountPublicNotesWorkItem {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.account.public_notes.v1';
  executionTarget: 'ephemeral_public_profile_url';
  issuedAt: string;
  expiresAt: string;
  input: { maximumScrolls: XiaohongshuProfileScrollCount };
  budget: typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET;
}

interface RedactedBilibiliNativeSearchWorkItem {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.native_search';
  executionTarget: 'collector_work_tab';
  issuedAt: string;
  expiresAt: string;
  input: {
    queryDigest: string;
    resultType: 'comprehensive';
    sort: 'relevance';
    page: 1;
  };
  budget: {
    maximumPlatformNavigations: 1;
    maximumSemanticActions: 0;
    maximumResponseObservations: 0;
    maximumPayloadBytes: 98_304;
  };
}

interface RedactedBilibiliNativeSearchBatchWorkItem {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.native_search_batch';
  executionTarget: 'collector_work_tab';
  issuedAt: string;
  expiresAt: string;
  input: {
    queryDigest: string;
    resultType: 'comprehensive';
    sort: 'relevance';
    pages: [1, 2];
  };
  budget: {
    maximumPlatformNavigations: 2;
    maximumSemanticActions: 0;
    maximumResponseObservations: 0;
    maximumPayloadBytes: 57_344;
  };
}

/**
 * A restart-safe, at-most-once work ledger.  It does not requeue an item
 * after a Gateway restart, expiry, or extension claim; a later platform
 * navigation would otherwise be indistinguishable from an unsafe replay.
 */
export class ExtensionWorkQueue {
  readonly #identity: LoadedGatewayIdentity;
  readonly #statePath: string;
  #operations: StoredOperation[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(identity: LoadedGatewayIdentity, stateDirectory: string) {
    this.#identity = identity;
    this.#statePath = resolve(stateDirectory, 'extension-work-operations.json');
  }

  static async create(
    identity: LoadedGatewayIdentity,
    stateDirectory: string,
    now = new Date()
  ): Promise<ExtensionWorkQueue> {
    const queue = new ExtensionWorkQueue(identity, stateDirectory);
    await mkdir(stateDirectory, { recursive: true });
    let changed = false;
    try {
      const parsed = JSON.parse(await readFile(queue.#statePath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) queue.#operations = parsed.filter(isStoredOperation);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // A claimed work item may already have performed its one navigation when
    // the Gateway disappears.  Never deliver it again after restart.
    for (const operation of queue.#operations) {
      if (operation.state === 'queued' || operation.state === 'claimed') {
        operation.state = 'stopped';
        operation.completedAt = now.toISOString();
        operation.errorCode = 'gateway_restarted_before_completion';
        operation.terminalReason = 'gateway_restarted_before_completion';
        operation.artifact = null;
        operation.item = redactTerminalWorkItem(operation.item);
        changed = true;
      }
    }
    if (queue.#trim()) changed = true;
    if (changed) await queue.#save();
    return queue;
  }

  async enqueueBilibiliVideoDetail(
    input: EnqueueBilibiliVideoDetailWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    if (this.#operations.some((operation) =>
      operation.item.browserBindingId === input.browserBindingId &&
      (operation.state === 'queued' || operation.state === 'claimed')
    )) throw new Error('extension_work_binding_busy');

    const canonicalVideoUrl = canonicalBilibiliVideoWorkUrl(input.canonicalVideoUrl);
    if (!canonicalVideoUrl) throw new Error('bilibili_video_detail_input_invalid');
    const bvid = canonicalVideoUrl.match(/\/video\/(BV[0-9A-Za-z]{10})$/)?.[1];
    if (!bvid) throw new Error('bilibili_video_detail_input_invalid');
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      executionTarget: 'collector_work_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: { canonicalVideoUrl, bvid },
      budget: {
        maximumPlatformNavigations: 1,
        maximumSemanticActions: 0,
        maximumResponseObservations: 0,
        maximumPayloadBytes: 98_304
      }
    };
    const item: ExtensionWorkItem = {
      ...unsigned,
      gatewaySignature: this.#identity.signPayload(extensionWorkSigningPayload(unsigned))
    };
    const operation: StoredOperation = {
      schemaVersion: 1,
      item,
      state: 'queued',
      queuedAt: issuedAt,
      claimedAt: null,
      completedAt: null,
      errorCode: null,
      terminalReason: null,
      artifact: null
    };
    this.#operations.push(operation);
    this.#trim();
    await this.#save();
    return summary(operation);
  }

  async enqueueBilibiliNativeSearch(
    input: EnqueueBilibiliNativeSearchWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const route = normaliseBilibiliNativeSearchRoute({
      query: input.query,
      resultType: 'comprehensive',
      sort: 'relevance',
      page: 1
    });
    if (!route || route.resultType !== 'comprehensive' || route.sort !== 'relevance' || route.page !== 1) {
      throw new Error('bilibili_native_search_input_invalid');
    }
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    if (this.#operations.some((operation) =>
      operation.item.browserBindingId === input.browserBindingId &&
      (operation.state === 'queued' || operation.state === 'claimed')
    )) throw new Error('extension_work_binding_busy');

    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: {
        query: route.query,
        canonicalSearchUrl: bilibiliNativeSearchUrl(route),
        resultType: 'comprehensive',
        sort: 'relevance',
        page: 1
      },
      budget: {
        maximumPlatformNavigations: 1,
        maximumSemanticActions: 0,
        maximumResponseObservations: 0,
        maximumPayloadBytes: 98_304
      }
    };
    const item: ExtensionWorkItem = {
      ...unsigned,
      gatewaySignature: this.#identity.signPayload(extensionWorkSigningPayload(unsigned))
    };
    const operation: StoredOperation = {
      schemaVersion: 1,
      item,
      state: 'queued',
      queuedAt: issuedAt,
      claimedAt: null,
      completedAt: null,
      errorCode: null,
      terminalReason: null,
      artifact: null
    };
    this.#operations.push(operation);
    this.#trim();
    await this.#save();
    return summary(operation);
  }

  async enqueueBilibiliNativeSearchBatch(
    input: EnqueueBilibiliNativeSearchBatchWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const pageOne = normaliseBilibiliNativeSearchRoute({
      query: input.query,
      resultType: 'comprehensive',
      sort: 'relevance',
      page: 1
    });
    const pageTwo = pageOne ? normaliseBilibiliNativeSearchRoute({ ...pageOne, page: 2 }) : null;
    if (!pageOne || !pageTwo || pageOne.resultType !== 'comprehensive' || pageOne.sort !== 'relevance' ||
      pageOne.page !== 1 || pageTwo.page !== 2
    ) throw new Error('bilibili_native_search_batch_input_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: {
        query: pageOne.query,
        resultType: 'comprehensive',
        sort: 'relevance',
        targets: [
          { page: 1, canonicalSearchUrl: bilibiliNativeSearchUrl(pageOne) },
          { page: 2, canonicalSearchUrl: bilibiliNativeSearchUrl(pageTwo) }
        ]
      },
      budget: {
        maximumPlatformNavigations: 2,
        maximumSemanticActions: 0,
        maximumResponseObservations: 0,
        maximumPayloadBytes: 57_344
      }
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  async enqueueBilibiliAccountProfile(
    input: EnqueueBilibiliAccountProfileWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(input.canonicalProfileUrl, 'strict_input');
    const stableAccountId = canonicalProfileUrl ? bilibiliAccountProfileIdFromUrl(canonicalProfileUrl) : null;
    if (!canonicalProfileUrl || !stableAccountId) throw new Error('bilibili_account_profile_input_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);

    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_profile',
      executionTarget: 'collector_work_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: { canonicalProfileUrl, stableAccountId },
      budget: fixedDirectWorkBudget()
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  async enqueueBilibiliAccountInventory(
    input: EnqueueBilibiliAccountInventoryWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(input.canonicalProfileUrl, 'strict_input');
    const stableAccountId = canonicalProfileUrl ? bilibiliAccountProfileIdFromUrl(canonicalProfileUrl) : null;
    if (!canonicalProfileUrl || !stableAccountId) throw new Error('bilibili_account_inventory_input_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);

    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'collector_work_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: {
        canonicalProfileUrl,
        canonicalInventoryUrl: `${canonicalProfileUrl}/upload/video`,
        stableAccountId
      },
      budget: fixedDirectWorkBudget()
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  /**
   * The Gateway derives the same strict inventory identity as the direct
   * work-tab path, but signs a zero-navigation observation for a tab that the
   * extension user has selected locally. No caller can name a tab or URL
   * variant, and the Gateway never receives browser tab/document identifiers.
   */
  async enqueueBilibiliAccountInventoryUserSelectedTab(
    input: EnqueueBilibiliAccountInventoryUserSelectedTabWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(input.canonicalProfileUrl, 'strict_input');
    const stableAccountId = canonicalProfileUrl ? bilibiliAccountProfileIdFromUrl(canonicalProfileUrl) : null;
    if (!canonicalProfileUrl || !stableAccountId) throw new Error('bilibili_account_inventory_input_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'user_selected_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: {
        canonicalProfileUrl,
        canonicalInventoryUrl: `${canonicalProfileUrl}/upload/video`,
        stableAccountId
      },
      budget: userSelectedTabObservationBudget()
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  /**
   * The caller names one canonical public video only. The extension is solely
   * responsible for creating and consuming its popup-selected tab/document
   * lease; no browser identifier, selector or page action crosses this API.
   */
  async enqueueBilibiliDiscussionUserSelectedTab(
    input: EnqueueBilibiliDiscussionUserSelectedTabWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const canonicalVideoUrl = canonicalBilibiliPassiveVideoWorkUrl(input.canonicalVideoUrl);
    const bvid = canonicalVideoUrl?.match(/\/video\/(BV[0-9A-Za-z]{10})$/)?.[1] ?? null;
    if (!canonicalVideoUrl || !bvid) throw new Error('bilibili_discussion_input_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: { canonicalVideoUrl, bvid },
      budget: userSelectedTabObservationBudget()
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  async enqueueBilibiliDynamic(
    input: EnqueueBilibiliDynamicWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    const identity = await this.#normaliseAccountWork(input.browserBindingId, input.canonicalProfileUrl, 'bilibili_dynamic_input_invalid', now);
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.dynamic',
      executionTarget: 'collector_work_tab',
      issuedAt: identity.issuedAt,
      expiresAt: identity.expiresAt,
      input: {
        canonicalProfileUrl: identity.canonicalProfileUrl,
        canonicalDynamicUrl: `${identity.canonicalProfileUrl}/dynamic`,
        stableAccountId: identity.stableAccountId
      },
      budget: fixedDirectWorkBudget()
    };
    return await this.#enqueueSigned(unsigned, identity.issuedAt);
  }

  async enqueueBilibiliCollectionSeriesOverview(
    input: EnqueueBilibiliCollectionSeriesOverviewWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    const identity = await this.#normaliseAccountWork(input.browserBindingId, input.canonicalProfileUrl, 'bilibili_collection_series_overview_input_invalid', now);
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.collection_series.overview',
      executionTarget: 'collector_work_tab',
      issuedAt: identity.issuedAt,
      expiresAt: identity.expiresAt,
      input: {
        canonicalProfileUrl: identity.canonicalProfileUrl,
        canonicalOverviewUrl: `${identity.canonicalProfileUrl}/lists`,
        stableAccountId: identity.stableAccountId
      },
      budget: collectionSeriesOverviewWorkBudget()
    };
    return await this.#enqueueSigned(unsigned, identity.issuedAt);
  }

  async enqueueBilibiliCollectionSeriesDetail(
    input: EnqueueBilibiliCollectionSeriesDetailWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    const identity = await this.#normaliseAccountWork(input.browserBindingId, input.canonicalProfileUrl, 'bilibili_collection_series_detail_input_invalid', now);
    if (!isPositiveNumericId(input.stableSeriesId) || (input.listType !== 'series' && input.listType !== 'season')) {
      throw new Error('bilibili_collection_series_detail_input_invalid');
    }
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.collection_series.detail',
      executionTarget: 'collector_work_tab',
      issuedAt: identity.issuedAt,
      expiresAt: identity.expiresAt,
      input: {
        canonicalProfileUrl: identity.canonicalProfileUrl,
        canonicalDetailUrl: `${identity.canonicalProfileUrl}/lists/${input.stableSeriesId}?type=${input.listType}`,
        stableAccountId: identity.stableAccountId,
        stableSeriesId: input.stableSeriesId,
        listType: input.listType,
        pageBudget: 1
      },
      budget: fixedDirectWorkBudget()
    };
    return await this.#enqueueSigned(unsigned, identity.issuedAt);
  }

  async enqueueBilibiliDanmaku(
    input: EnqueueBilibiliDanmakuWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId)) throw new Error('extension_work_binding_invalid');
    const canonicalVideoUrl = canonicalBilibiliPassiveVideoWorkUrl(input.canonicalVideoUrl);
    const bvid = canonicalVideoUrl?.match(/\/video\/(BV[0-9A-Za-z]{10})$/)?.[1] ?? null;
    if (!canonicalVideoUrl || !bvid) throw new Error('bilibili_danmaku_input_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.danmaku',
      executionTarget: 'collector_work_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: { canonicalVideoUrl, bvid },
      budget: fixedDirectWorkBudget()
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  async enqueueXiaohongshuPublicNotesSearch(
    input: EnqueueXiaohongshuPublicNotesSearchWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId) || !isXiaohongshuQuery(input.query) ||
      (input.maximumDetails !== undefined && (!Number.isSafeInteger(input.maximumDetails) ||
        input.maximumDetails < 0 || input.maximumDetails > XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS)) ||
      (input.comments !== undefined && (input.maximumDetails === undefined || input.maximumDetails < 1 ||
        !Number.isSafeInteger(input.comments.maximumScrolls) || input.comments.maximumScrolls < 1 ||
        input.comments.maximumScrolls > 3))) {
      throw new Error('xiaohongshu_public_notes_search_input_invalid');
    }
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: {
        query: input.query,
        ...(input.maximumDetails === undefined ? {} : { maximumDetails: input.maximumDetails }),
        ...(input.comments === undefined ? {} : { comments: input.comments })
      },
      budget: input.maximumDetails && input.maximumDetails > 0
        ? input.comments
          ? XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET
          : XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET
        : XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  async enqueueXiaohongshuAccountPublicNotes(
    input: EnqueueXiaohongshuAccountPublicNotesWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId) || !Number.isSafeInteger(input.maximumScrolls) ||
      input.maximumScrolls < 1 || input.maximumScrolls > 20) {
      throw new Error('xiaohongshu_account_public_notes_input_invalid');
    }
    const profileUrl = input.profileUrl === undefined
      ? null
      : canonicalXiaohongshuPublicProfileUrl(input.profileUrl);
    if (input.profileUrl !== undefined && !profileUrl) {
      throw new Error('xiaohongshu_account_public_profile_url_invalid');
    }
    if (input.profileUrl === undefined && input.maximumScrolls > 3) {
      throw new Error('xiaohongshu_account_public_notes_input_invalid');
    }
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    if (profileUrl) {
      const unsigned: UnsignedExtensionWorkItem = {
        schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
        protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
        workId: randomUUID(),
        operationId: randomUUID(),
        browserBindingId: input.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.account.public_notes.v1',
        executionTarget: 'ephemeral_public_profile_url',
        issuedAt,
        expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
        input: { maximumScrolls: input.maximumScrolls, profileUrl },
        budget: XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET
      };
      return await this.#enqueueSigned(unsigned, issuedAt);
    }
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.account.public_notes.v1',
      executionTarget: 'existing_public_profile_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: { maximumScrolls: input.maximumScrolls },
      budget: XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  async enqueueXiaohongshuNotePublicDetail(
    input: EnqueueXiaohongshuNotePublicDetailWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId) || !Number.isSafeInteger(input.resultRank) ||
      input.resultRank < 1 || input.resultRank > 20) {
      throw new Error('xiaohongshu_note_public_detail_input_invalid');
    }
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(),
      operationId: randomUUID(),
      browserBindingId: input.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.note.public_detail.v1',
      executionTarget: 'existing_public_search_tab',
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: { resultRank: input.resultRank },
      budget: XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }

  async enqueueXiaohongshuNotePublicComments(
    input: EnqueueXiaohongshuNotePublicCommentsWorkInput,
    now = new Date()
  ): Promise<ExtensionWorkOperationSummary> {
    if (!isUuid(input.browserBindingId) ||
      (input.maximumScrolls !== 1 && input.maximumScrolls !== 2 && input.maximumScrolls !== 3)) {
      throw new Error('xiaohongshu_note_public_comments_input_invalid');
    }
    const expired = this.#expire(now); if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(input.browserBindingId);
    const issuedAt = now.toISOString();
    const unsigned: UnsignedExtensionWorkItem = {
      schemaVersion: EXTENSION_WORK_SCHEMA_VERSION, protocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
      workId: randomUUID(), operationId: randomUUID(), browserBindingId: input.browserBindingId,
      platform: 'xiaohongshu', capability: 'xiaohongshu.note.public_comments.v1',
      executionTarget: 'existing_public_note_overlay', issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString(),
      input: { maximumScrolls: input.maximumScrolls }, budget: XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET
    };
    return await this.#enqueueSigned(unsigned, issuedAt);
  }
  async enqueueXiaohongshuNotePublicCommentReplies(input: EnqueueXiaohongshuNotePublicCommentRepliesWorkInput,
    now=new Date()):Promise<ExtensionWorkOperationSummary>{
    if(!isUuid(input.browserBindingId)||input.maximumThreads!==1)throw new Error('xiaohongshu_note_public_comment_replies_input_invalid');
    const expired=this.#expire(now);if(expired.length>0)await this.#save();this.#assertBindingIdle(input.browserBindingId);
    const issuedAt=now.toISOString();const unsigned:UnsignedExtensionWorkItem={schemaVersion:EXTENSION_WORK_SCHEMA_VERSION,
      protocolVersion:EXTENSION_WORK_PROTOCOL_VERSION,workId:randomUUID(),operationId:randomUUID(),
      browserBindingId:input.browserBindingId,platform:'xiaohongshu',capability:'xiaohongshu.note.public_comment_replies.v1',
      executionTarget:'existing_public_note_overlay',issuedAt,expiresAt:new Date(now.getTime()+WORK_ITEM_TTL_MS).toISOString(),
      input:{maximumThreads:1},budget:XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET};return await this.#enqueueSigned(unsigned,issuedAt);}

  /** Claiming is the irreversible delivery point.  There is no lease renewal. */
  async claimNext(
    browserBindingId: string,
    now = new Date(),
    allowedPlatforms: readonly ExtensionWorkItem['platform'][] = ['bilibili', 'xiaohongshu']
  ): Promise<ExtensionWorkItem | null> {
    if (!isUuid(browserBindingId)) throw new Error('extension_work_binding_invalid');
    if (allowedPlatforms.some((platform) => platform !== 'bilibili' && platform !== 'xiaohongshu')) {
      throw new Error('extension_work_platform_filter_invalid');
    }
    const expired = this.#expire(now);
    const operation = this.#operations.find((candidate) =>
      candidate.item.browserBindingId === browserBindingId && candidate.state === 'queued' &&
      allowedPlatforms.includes(candidate.item.platform)
    );
    if (!operation) {
      if (expired.length > 0) await this.#save();
      return null;
    }
    if (!isExtensionWorkItem(operation.item)) throw new Error('extension_work_state_invalid');
    operation.state = 'claimed';
    operation.claimedAt = now.toISOString();
    await this.#save();
    return structuredClone(operation.item);
  }

  async complete(
    browserBindingId: string,
    result: ExtensionWorkResult,
    artifact: ExtensionWorkArtifactReference | null
  ): Promise<ExtensionWorkOperationSummary> {
    const operation = this.#operations.find((candidate) => candidate.item.workId === result.workId);
    if (!operation || operation.item.browserBindingId !== browserBindingId) {
      throw new Error('extension_work_not_claimed');
    }
    if (!isExtensionWorkItem(operation.item) || !isExtensionWorkResultForItem(result, operation.item)) {
      throw new Error('extension_work_result_invalid');
    }
    if (operation.state !== 'claimed') {
      if (isTerminalState(operation.state)) return summary(operation);
      throw new Error('extension_work_not_claimed');
    }
    if (result.state === 'completed' && !artifact) throw new Error('extension_work_artifact_required');
    operation.state = result.state;
    operation.completedAt = result.completedAt;
    operation.errorCode = result.errorCode;
    operation.terminalReason = result.terminalReason;
    operation.artifact = artifact ? cloneArtifact(artifact) : null;
    operation.item = redactTerminalWorkItem(operation.item);
    this.#trim();
    await this.#save();
    return summary(operation);
  }

  claimedItem(browserBindingId: string, workId: string): ExtensionWorkItem {
    if (!isUuid(browserBindingId) || !isUuid(workId)) throw new Error('extension_work_not_claimed');
    const operation = this.#operations.find((candidate) => candidate.item.workId === workId);
    if (!operation || operation.item.browserBindingId !== browserBindingId || operation.state !== 'claimed' ||
      !isExtensionWorkItem(operation.item)
    ) {
      throw new Error('extension_work_not_claimed');
    }
    return structuredClone(operation.item);
  }

  async get(operationId: string, now = new Date()): Promise<ExtensionWorkOperationSummary | null> {
    if (!isUuid(operationId)) throw new Error('extension_work_operation_invalid');
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    const operation = this.#operations.find((candidate) => candidate.item.operationId === operationId);
    return operation ? summary(operation) : null;
  }

  async expire(now = new Date()): Promise<ExtensionWorkOperationSummary[]> {
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    return expired.map(summary);
  }

  #assertBindingIdle(browserBindingId: string): void {
    if (this.#operations.some((operation) =>
      operation.item.browserBindingId === browserBindingId &&
      (operation.state === 'queued' || operation.state === 'claimed')
    )) throw new Error('extension_work_binding_busy');
  }

  async #normaliseAccountWork(
    browserBindingId: string,
    rawProfileUrl: string,
    errorCode: string,
    now: Date
  ): Promise<{ canonicalProfileUrl: string; stableAccountId: string; issuedAt: string; expiresAt: string }> {
    if (!isUuid(browserBindingId)) throw new Error('extension_work_binding_invalid');
    const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(rawProfileUrl, 'strict_input');
    const stableAccountId = canonicalProfileUrl ? bilibiliAccountProfileIdFromUrl(canonicalProfileUrl) : null;
    if (!canonicalProfileUrl || !stableAccountId) throw new Error(errorCode);
    const expired = this.#expire(now);
    if (expired.length > 0) await this.#save();
    this.#assertBindingIdle(browserBindingId);
    const issuedAt = now.toISOString();
    return {
      canonicalProfileUrl,
      stableAccountId,
      issuedAt,
      expiresAt: new Date(now.getTime() + WORK_ITEM_TTL_MS).toISOString()
    };
  }

  async #enqueueSigned(
    unsigned: UnsignedExtensionWorkItem,
    issuedAt: string
  ): Promise<ExtensionWorkOperationSummary> {
    const item: ExtensionWorkItem = {
      ...unsigned,
      gatewaySignature: this.#identity.signPayload(extensionWorkSigningPayload(unsigned))
    } as ExtensionWorkItem;
    const operation: StoredOperation = {
      schemaVersion: 1,
      item,
      state: 'queued',
      queuedAt: issuedAt,
      claimedAt: null,
      completedAt: null,
      errorCode: null,
      terminalReason: null,
      artifact: null
    };
    this.#operations.push(operation);
    this.#trim();
    await this.#save();
    return summary(operation);
  }

  #expire(now: Date): StoredOperation[] {
    const expired: StoredOperation[] = [];
    for (const operation of this.#operations) {
      if (!isActiveState(operation.state) || Date.parse(operation.item.expiresAt) > now.getTime()) continue;
      operation.state = 'stopped';
      operation.completedAt = now.toISOString();
      operation.errorCode = 'extension_work_expired';
      operation.terminalReason = 'run_deadline_exceeded';
      operation.artifact = null;
      operation.item = redactTerminalWorkItem(operation.item);
      expired.push(operation);
    }
    return expired;
  }

  #trim(): boolean {
    if (this.#operations.length <= MAX_RETAINED_OPERATIONS) return false;
    const active = this.#operations.filter((operation) => isActiveState(operation.state));
    const terminal = this.#operations.filter((operation) => !isActiveState(operation.state))
      .sort((left, right) => Date.parse(right.completedAt ?? right.queuedAt) - Date.parse(left.completedAt ?? left.queuedAt));
    this.#operations = [...active, ...terminal].slice(0, MAX_RETAINED_OPERATIONS);
    return true;
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.#operations, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.#statePath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function summary(operation: StoredOperation): ExtensionWorkOperationSummary {
  return {
    schemaVersion: 1,
    operationId: operation.item.operationId,
    browserBindingId: operation.item.browserBindingId,
    platform: operation.item.platform,
    capability: operation.item.capability,
    executionTarget: operation.item.executionTarget,
    state: operation.state,
    queuedAt: operation.queuedAt,
    claimedAt: operation.claimedAt,
    completedAt: operation.completedAt,
    errorCode: operation.errorCode,
    terminalReason: operation.terminalReason,
    artifact: operation.artifact ? cloneArtifact(operation.artifact) : null
  };
}

function isStoredOperation(value: unknown): value is StoredOperation {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isStoredExtensionWorkItem(value.item) ||
    !isWorkState(value.state) || !isTimestamp(value.queuedAt) ||
    !(value.claimedAt === null || isTimestamp(value.claimedAt)) ||
    !(value.completedAt === null || isTimestamp(value.completedAt)) ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_ERROR_CODE.test(value.errorCode))) ||
    !(value.terminalReason === null || isTerminalReason(value.terminalReason)) ||
    !(value.artifact === null || isArtifact(value.artifact))
  ) return false;
  return isActiveState(value.state)
    ? isExtensionWorkItem(value.item) && value.completedAt === null && value.terminalReason === null && value.artifact === null
    : value.completedAt !== null && value.terminalReason !== null;
}

function isStoredExtensionWorkItem(value: unknown): value is StoredExtensionWorkItem {
  return isExtensionWorkItem(value) || isRedactedBilibiliNativeSearchWorkItem(value) ||
    isRedactedBilibiliNativeSearchBatchWorkItem(value) || isRedactedXiaohongshuPublicNotesSearchWorkItem(value) ||
    isRedactedXiaohongshuAccountPublicNotesWorkItem(value);
}

function isRedactedXiaohongshuPublicNotesSearchWorkItem(
  value: unknown
): value is RedactedXiaohongshuPublicNotesSearchWorkItem {
  return isRecord(value) && hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget'
  ]) && value.schemaVersion === EXTENSION_WORK_SCHEMA_VERSION &&
    value.protocolVersion === EXTENSION_WORK_PROTOCOL_VERSION && isUuid(value.workId) && isUuid(value.operationId) &&
    isUuid(value.browserBindingId) && value.platform === 'xiaohongshu' &&
    value.capability === 'xiaohongshu.search.public_notes.v1' &&
    value.executionTarget === 'existing_public_explore_tab' && isTimestamp(value.issuedAt) &&
    isTimestamp(value.expiresAt) && Date.parse(value.expiresAt) > Date.parse(value.issuedAt) &&
    isRecord(value.input) && hasExactKeys(value.input, ['queryDigest']) &&
    /^[a-f0-9]{64}$/.test(stringValue((value.input as Record<string, unknown>).queryDigest)) &&
    (JSON.stringify(value.budget) === JSON.stringify(XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET) ||
      JSON.stringify(value.budget) === JSON.stringify(XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET));
}

function isRedactedXiaohongshuAccountPublicNotesWorkItem(
  value: unknown
): value is RedactedXiaohongshuAccountPublicNotesWorkItem {
  return isRecord(value) && hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget'
  ]) && value.schemaVersion === EXTENSION_WORK_SCHEMA_VERSION &&
    value.protocolVersion === EXTENSION_WORK_PROTOCOL_VERSION && isUuid(value.workId) && isUuid(value.operationId) &&
    isUuid(value.browserBindingId) && value.platform === 'xiaohongshu' &&
    value.capability === 'xiaohongshu.account.public_notes.v1' &&
    value.executionTarget === 'ephemeral_public_profile_url' && isTimestamp(value.issuedAt) &&
    isTimestamp(value.expiresAt) && Date.parse(value.expiresAt) > Date.parse(value.issuedAt) &&
    isRecord(value.input) && hasExactKeys(value.input, ['maximumScrolls']) &&
    typeof value.input.maximumScrolls === 'number' && Number.isSafeInteger(value.input.maximumScrolls) &&
    value.input.maximumScrolls >= 1 && value.input.maximumScrolls <= 20 &&
    JSON.stringify(value.budget) === JSON.stringify(XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET);
}

function isRedactedBilibiliNativeSearchWorkItem(value: unknown): value is RedactedBilibiliNativeSearchWorkItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget'
  ]) || value.schemaVersion !== EXTENSION_WORK_SCHEMA_VERSION ||
    value.protocolVersion !== EXTENSION_WORK_PROTOCOL_VERSION || !isUuid(value.workId) ||
    !isUuid(value.operationId) || !isUuid(value.browserBindingId) || value.platform !== 'bilibili' ||
    value.capability !== 'bilibili.native_search' || value.executionTarget !== 'collector_work_tab' ||
    !isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || !isRecord(value.input) ||
    !hasExactKeys(value.input, ['queryDigest', 'resultType', 'sort', 'page']) ||
    !/^[a-f0-9]{64}$/.test(stringValue(value.input.queryDigest)) ||
    value.input.resultType !== 'comprehensive' || value.input.sort !== 'relevance' || value.input.page !== 1 ||
    !isFixedDirectWorkBudget(value.budget)
  ) return false;
  return true;
}

function isRedactedBilibiliNativeSearchBatchWorkItem(value: unknown): value is RedactedBilibiliNativeSearchBatchWorkItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget'
  ]) || value.schemaVersion !== EXTENSION_WORK_SCHEMA_VERSION ||
    value.protocolVersion !== EXTENSION_WORK_PROTOCOL_VERSION || !isUuid(value.workId) ||
    !isUuid(value.operationId) || !isUuid(value.browserBindingId) || value.platform !== 'bilibili' ||
    value.capability !== 'bilibili.native_search_batch' || value.executionTarget !== 'collector_work_tab' ||
    !isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || !isRecord(value.input) ||
    !hasExactKeys(value.input, ['queryDigest', 'resultType', 'sort', 'pages']) ||
    !/^[a-f0-9]{64}$/.test(stringValue(value.input.queryDigest)) ||
    value.input.resultType !== 'comprehensive' || value.input.sort !== 'relevance' ||
    !Array.isArray(value.input.pages) || value.input.pages.length !== 2 ||
    value.input.pages[0] !== 1 || value.input.pages[1] !== 2 || !isBatchDirectWorkBudget(value.budget)
  ) return false;
  return true;
}

function isArtifact(value: unknown): value is ExtensionWorkArtifactReference {
  return isRecord(value) && Object.keys(value).length === 3 && typeof value.artifactId === 'string' && isUuid(value.artifactId) &&
    typeof value.retrievalPath === 'string' && /^\/v1\/collect\/artifacts\/[a-z0-9._-]{1,120}\/[0-9a-f-]{36}$/i.test(value.retrievalPath) &&
    isRecord(value.summary);
}

function cloneArtifact(value: ExtensionWorkArtifactReference): ExtensionWorkArtifactReference {
  return {
    artifactId: value.artifactId,
    retrievalPath: value.retrievalPath,
    summary: structuredClone(value.summary)
  };
}

function isWorkState(value: unknown): value is ExtensionWorkState {
  return value === 'queued' || value === 'claimed' || value === 'completed' ||
    value === 'partial' || value === 'stopped' || value === 'failed';
}

function isActiveState(value: ExtensionWorkState): value is 'queued' | 'claimed' {
  return value === 'queued' || value === 'claimed';
}

function isTerminalState(value: ExtensionWorkState): boolean {
  return !isActiveState(value);
}

function isTerminalReason(value: unknown): value is ExtensionWorkTerminalReason {
  return value === 'detail_ready' || value === 'search_ready' || value === 'search_empty' ||
    value === 'search_results_partial' || value === 'search_batch_ready' || value === 'search_batch_empty' ||
    value === 'search_batch_page_partial' || value === 'profile_ready' || value === 'inventory_ready' ||
    value === 'inventory_partial' || value === 'dynamic_ready' || value === 'dynamic_empty' ||
    value === 'dynamic_partial' || value === 'collection_series_overview_ready' ||
    value === 'collection_series_overview_empty' || value === 'collection_series_overview_partial' ||
    value === 'collection_series_detail_ready' || value === 'collection_series_detail_partial' ||
    value === 'danmaku_ready' || value === 'danmaku_partial' ||
    value === 'discussion_ready' || value === 'discussion_empty' || value === 'discussion_partial' ||
    value === 'verification_required' || value === 'rate_limited' ||
    value === 'source_unavailable' || value === 'dom_projection_failed' || value === 'document_context_changed' ||
    value === 'run_deadline_exceeded' || value === 'work_tab_closed' || value === 'work_tab_user_taken_over' ||
    value === 'work_tab_foreground_unavailable' ||
    value === 'navigation_outcome_unknown' || value === 'gateway_restarted_before_completion' ||
    value === 'user_selected_tab_required' || value === 'user_selected_tab_closed' ||
    value === 'user_selected_tab_document_changed' || value === 'user_selected_tab_target_mismatch' ||
    value === 'user_selected_tab_page_not_supported' || value === 'user_selected_tab_worker_interrupted' ||
    value === 'login_required' || value === 'search_ready' || value === 'search_depth_ready' ||
    value === 'search_depth_stopped' || value === 'existing_public_explore_tab_required' ||
    value === 'existing_public_explore_tab_ambiguous' || value === 'search_target_unavailable' ||
    value === 'query_not_echoed' || value === 'postcondition_unmet' || value === 'permission_required' ||
    value === 'profile_notes_ready' || value === 'profile_notes_budget_exhausted' ||
    value === 'existing_public_profile_tab_required' ||
    value === 'existing_public_profile_tab_ambiguous' ||
    value === 'profile_url_invalid' || value === 'profile_url_expired' ||
    value === 'profile_url_navigation_failed' || value === 'profile_url_context_changed' ||
    value === 'note_detail_ready' || value === 'existing_public_search_tab_required' ||
    value === 'existing_public_search_tab_ambiguous' || value === 'search_result_rank_unavailable' ||
    value === 'note_detail_target_new_tab' ||
    value === 'debugger_attach_failed' || value === 'debugger_input_failed' || value === 'debugger_detach_failed' ||
    value === 'extension_worker_interrupted';
}

function redactTerminalWorkItem(item: StoredExtensionWorkItem): StoredExtensionWorkItem {
  if (isExtensionWorkItem(item) && item.capability === 'xiaohongshu.account.public_notes.v1' &&
    item.executionTarget === 'ephemeral_public_profile_url') {
    return {
      schemaVersion: item.schemaVersion,
      protocolVersion: item.protocolVersion,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.account.public_notes.v1',
      executionTarget: 'ephemeral_public_profile_url',
      issuedAt: item.issuedAt,
      expiresAt: item.expiresAt,
      input: { maximumScrolls: item.input.maximumScrolls },
      budget: { ...XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET }
    };
  }
  if (isExtensionWorkItem(item) && item.capability === 'xiaohongshu.search.public_notes.v1') {
    return {
      schemaVersion: item.schemaVersion,
      protocolVersion: item.protocolVersion,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      issuedAt: item.issuedAt,
      expiresAt: item.expiresAt,
      input: { queryDigest: sha256(item.input.query) },
      budget: { ...item.budget }
    };
  }
  if (!isExtensionWorkItem(item) ||
    (item.capability !== 'bilibili.native_search' && item.capability !== 'bilibili.native_search_batch')
  ) return item;
  if (item.capability === 'bilibili.native_search_batch') {
    return {
      schemaVersion: item.schemaVersion,
      protocolVersion: item.protocolVersion,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      issuedAt: item.issuedAt,
      expiresAt: item.expiresAt,
      input: {
        queryDigest: sha256(item.input.query),
        resultType: 'comprehensive',
        sort: 'relevance',
        pages: [1, 2]
      },
      budget: { ...item.budget }
    };
  }
  return {
    schemaVersion: item.schemaVersion,
    protocolVersion: item.protocolVersion,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search',
    executionTarget: 'collector_work_tab',
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt,
    input: {
      queryDigest: sha256(item.input.query),
      resultType: item.input.resultType,
      sort: item.input.sort,
      page: item.input.page
    },
    budget: { ...item.budget }
  };
}

function isXiaohongshuQuery(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function fixedDirectWorkBudget(): {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
} {
  return {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  };
}

function userSelectedTabObservationBudget(): {
  maximumPlatformNavigations: 0;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
} {
  return {
    maximumPlatformNavigations: 0,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  };
}

function collectionSeriesOverviewWorkBudget(): {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 1;
  maximumPayloadBytes: 98_304;
} {
  return {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 1,
    maximumPayloadBytes: 98_304
  };
}

function isFixedDirectWorkBudget(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    'maximumPlatformNavigations', 'maximumSemanticActions', 'maximumResponseObservations', 'maximumPayloadBytes'
  ]) && value.maximumPlatformNavigations === 1 && value.maximumSemanticActions === 0 &&
    value.maximumResponseObservations === 0 && value.maximumPayloadBytes === 98_304;
}

function isBatchDirectWorkBudget(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    'maximumPlatformNavigations', 'maximumSemanticActions', 'maximumResponseObservations', 'maximumPayloadBytes'
  ]) && value.maximumPlatformNavigations === 2 && value.maximumSemanticActions === 0 &&
    value.maximumResponseObservations === 0 && value.maximumPayloadBytes === 57_344;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPositiveNumericId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) && value !== '0';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
