import type { ExtensionWorkArtifactReference } from './extension-work-queue';
import { OfficialSourceOperationStore, type OfficialSourceOperationSummary } from './official-source-operation-store';
import { ZhihuOfficialArtifactStore } from './zhihu-official-artifacts';
import {
  ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY,
  ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY,
  ZHIHU_OFFICIAL_SEARCH_CAPABILITY,
  parseZhihuOfficialResponse,
  type ZhihuOfficialCollectorServiceRequest
} from './zhihu-official-contract';
import {
  clearPersistedZhihuOfficialAccessSecret,
  persistZhihuOfficialAccessSecret,
  validateZhihuOfficialAccessSecret
} from './zhihu-official-config';

const PROVIDER_ORIGIN = 'https://developer.zhihu.com';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

type FetchImplementation = typeof globalThis.fetch;

export type ZhihuOfficialCredentialSource = 'none' | 'environment' | 'console_session' | 'persisted_file';

export interface ZhihuOfficialCredentialStatus {
  provider: 'zhihu_open_platform';
  runtimeState: 'ready' | 'credential_required';
  credentialLocation: 'gateway_only';
  configurationMode: ZhihuOfficialCredentialSource;
  restartPersistence: 'environment_only' | 'gateway_process_only' | 'persisted_file';
}

export interface ZhihuOfficialApiProviderOptions {
  accessSecret: string | null;
  artifacts: ZhihuOfficialArtifactStore;
  operations: OfficialSourceOperationStore;
  credentialSource?: ZhihuOfficialCredentialSource;
  /** When set, Console-configured secrets are persisted under this state directory. */
  persistence?: { stateDirectory: string };
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  timeoutMs?: number;
}

/** Fixed-contract server-to-server provider. It has no browser dependencies. */
export class ZhihuOfficialApiProvider {
  #accessSecret: string | null;
  #credentialSource: ZhihuOfficialCredentialSource;
  readonly #artifacts: ZhihuOfficialArtifactStore;
  readonly #operations: OfficialSourceOperationStore;
  readonly #fetch: FetchImplementation;
  readonly #now: () => Date;
  readonly #timeoutMs: number;
  readonly #persistence: { stateDirectory: string } | null;

  constructor(options: ZhihuOfficialApiProviderOptions) {
    this.#accessSecret = options.accessSecret;
    this.#credentialSource = options.credentialSource ?? (options.accessSecret === null ? 'none' : 'environment');
    this.#persistence = options.persistence ?? null;
    this.#artifacts = options.artifacts;
    this.#operations = options.operations;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 60_000) {
      throw new Error('zhihu_official_api_timeout_invalid');
    }
  }

  configured(): boolean {
    return this.#accessSecret !== null;
  }

  credentialStatus(): ZhihuOfficialCredentialStatus {
    return {
      provider: 'zhihu_open_platform',
      runtimeState: this.#accessSecret === null ? 'credential_required' : 'ready',
      credentialLocation: 'gateway_only',
      configurationMode: this.#credentialSource,
      restartPersistence: this.#credentialSource === 'environment'
        ? 'environment_only'
        : this.#credentialSource === 'persisted_file'
          ? 'persisted_file'
          : 'gateway_process_only'
    };
  }

  /**
   * Configure the provider from the Gateway Console. When a persistence
   * directory is configured the secret is written to a private local file
   * first, so a Gateway restart keeps the credential (environment variables
   * are never read or written here).
   */
  async configureForCurrentProcess(accessSecret: unknown): Promise<ZhihuOfficialCredentialStatus> {
    const secret = validateZhihuOfficialAccessSecret(accessSecret);
    if (this.#persistence) {
      await persistZhihuOfficialAccessSecret(this.#persistence.stateDirectory, secret);
    }
    this.#accessSecret = secret;
    this.#credentialSource = this.#persistence ? 'persisted_file' : 'console_session';
    return this.credentialStatus();
  }

  /** Clear the active credential and any locally persisted copy. */
  async clearCredential(): Promise<ZhihuOfficialCredentialStatus> {
    if (this.#persistence) {
      await clearPersistedZhihuOfficialAccessSecret(this.#persistence.stateDirectory);
    }
    this.#accessSecret = null;
    this.#credentialSource = 'none';
    return this.credentialStatus();
  }

  async collect(
    request: ZhihuOfficialCollectorServiceRequest,
    operationId: string
  ): Promise<OfficialSourceOperationSummary> {
    const accessSecret = this.#accessSecret;
    if (!accessSecret) throw new Error('zhihu_official_api_credential_required');
    const startedAt = this.#now().toISOString();
    const url = officialUrl(request);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessSecret}`,
          'content-type': 'application/json',
          'x-request-timestamp': String(Math.floor(this.#now().getTime() / 1_000))
        }
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new Error('zhihu_official_api_timeout');
      }
      throw new Error('zhihu_official_api_source_unavailable');
    } finally {
      clearTimeout(deadline);
    }
    if (new URL(response.url || url).origin !== PROVIDER_ORIGIN) {
      throw new Error('zhihu_official_api_response_origin_invalid');
    }
    if (!response.ok) throw new Error(httpError(response.status));
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') throw new Error('zhihu_official_api_response_media_type_invalid');
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
      throw new Error('zhihu_official_api_response_too_large');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('zhihu_official_api_response_too_large');
    let value: unknown;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes(accessSecret)) {
        throw new Error('zhihu_official_api_response_contains_credential');
      }
      value = JSON.parse(text);
    } catch (error) {
      if (error instanceof Error && error.message === 'zhihu_official_api_response_contains_credential') {
        throw error;
      }
      throw new Error('zhihu_official_api_response_invalid');
    }
    const parsed = parseZhihuOfficialResponse(request.capability, value, maximumItems(request));
    const completedAt = this.#now().toISOString();
    const summary = await this.#artifacts.record({ operationId, request, response: parsed, capturedAt: completedAt });
    const artifact: ExtensionWorkArtifactReference = {
      artifactId: summary.artifactId,
      retrievalPath: `/v1/collect/artifacts/${request.capability}/${summary.artifactId}`,
      summary: structuredClone(summary) as unknown as Record<string, unknown>
    };
    return await this.#operations.record({
      operationId,
      platform: request.platform,
      capability: request.capability,
      startedAt,
      completedAt,
      artifact
    });
  }
}

function officialUrl(request: ZhihuOfficialCollectorServiceRequest): string {
  const url = new URL(apiPath(request), PROVIDER_ORIGIN);
  if (request.capability === ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY) {
    url.searchParams.set('Limit', String(request.input.limit));
    return url.href;
  }
  url.searchParams.set('Query', request.input.query);
  url.searchParams.set('Count', String(request.input.count));
  if (request.capability === ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY) {
    url.searchParams.set('SearchDB', request.input.searchDatabase);
    const filter = officialFilter(request.input);
    if (filter) url.searchParams.set('Filter', filter);
  }
  return url.href;
}

function officialFilter(input: Extract<
  ZhihuOfficialCollectorServiceRequest,
  { capability: typeof ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY }
>['input']): string | null {
  const expressions: string[] = [];
  if (input.site) expressions.push(`host=="${input.site}"`);
  if (input.publishedAfter) {
    expressions.push(`publish_time>=${Math.floor(Date.parse(input.publishedAfter) / 1_000)}`);
  }
  return expressions.length > 0 ? expressions.join(' AND ') : null;
}

function apiPath(request: ZhihuOfficialCollectorServiceRequest): string {
  if (request.capability === ZHIHU_OFFICIAL_SEARCH_CAPABILITY) return '/api/v1/content/zhihu_search';
  if (request.capability === ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY) return '/api/v1/content/hot_list';
  return '/api/v1/content/global_search';
}

function maximumItems(request: ZhihuOfficialCollectorServiceRequest): number {
  return request.capability === ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY
    ? request.input.limit
    : request.input.count;
}

function httpError(status: number): string {
  if (status === 401 || status === 403) return 'zhihu_official_api_authentication_failed';
  if (status === 429) return 'zhihu_official_api_rate_limited';
  if (status >= 500) return 'zhihu_official_api_server_error';
  return 'zhihu_official_api_http_error';
}
