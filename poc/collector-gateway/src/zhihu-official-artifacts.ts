import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from './canonical-json';
import {
  ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY,
  ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY,
  ZHIHU_OFFICIAL_SEARCH_CAPABILITY,
  type ZhihuOfficialCapability,
  type ZhihuOfficialCollectorServiceRequest,
  type ZhihuOfficialSuccessfulResponse
} from './zhihu-official-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export interface ZhihuOfficialArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: ZhihuOfficialCapability;
  state: 'completed';
  capturedAt: string;
  itemCount: number;
  requestDigest: string;
  responseSha256: string;
  sha256: string;
}

export interface ZhihuOfficialArtifactView {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: ZhihuOfficialCapability;
  state: 'completed';
  capturedAt: string;
  provenance: {
    environment: 'zhihu_official_open_platform';
    executionTarget: 'official_api';
    providerOrigin: 'https://developer.zhihu.com';
    apiPath:
      | '/api/v1/content/zhihu_search'
      | '/api/v1/content/hot_list'
      | '/api/v1/content/global_search';
    authentication: 'gateway_local_access_secret';
    browserUsed: false;
    responseMode: 'official_json';
    rawResponseStored: true;
  };
  request: {
    queryDigest?: string;
    count?: number;
    limit?: number;
    searchDatabase?: 'all' | 'realtime' | 'static';
    site?: string;
    publishedAfter?: string;
  };
  response: ZhihuOfficialSuccessfulResponse;
  summary: ZhihuOfficialArtifactSummary;
}

export class ZhihuOfficialArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, ZhihuOfficialArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'zhihu-official-artifacts');
    this.#indexPath = resolve(stateDirectory, 'zhihu-official-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<ZhihuOfficialArtifactStore> {
    const store = new ZhihuOfficialArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(value)) {
        for (const summary of value) {
          if (isSummary(summary)) store.#summaries.set(summary.artifactId, summary);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): ZhihuOfficialArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((value) => structuredClone(value))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(input: {
    operationId: string;
    request: ZhihuOfficialCollectorServiceRequest;
    response: ZhihuOfficialSuccessfulResponse;
    capturedAt: string;
  }): Promise<ZhihuOfficialArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.operationId);
    if (existing) {
      if (existing.capability !== input.request.capability) {
        throw new Error('zhihu_official_artifact_identity_conflict');
      }
      return existing;
    }
    if (!UUID_PATTERN.test(input.operationId) || !timestamp(input.capturedAt)) {
      throw new Error('zhihu_official_artifact_input_invalid');
    }
    const artifactId = randomUUID();
    const requestProjection = artifactRequest(input.request);
    const responseSha256 = sha256(canonicalJson(input.response));
    const draft = {
      schemaVersion: 1 as const,
      artifactId,
      operationId: input.operationId,
      capability: input.request.capability,
      state: 'completed' as const,
      capturedAt: input.capturedAt,
      provenance: {
        environment: 'zhihu_official_open_platform' as const,
        executionTarget: 'official_api' as const,
        providerOrigin: 'https://developer.zhihu.com' as const,
        apiPath: apiPath(input.request.capability),
        authentication: 'gateway_local_access_secret' as const,
        browserUsed: false as const,
        responseMode: 'official_json' as const,
        rawResponseStored: true as const
      },
      request: requestProjection,
      response: structuredClone(input.response)
    };
    const summary: ZhihuOfficialArtifactSummary = {
      schemaVersion: 1,
      artifactId,
      operationId: input.operationId,
      capability: input.request.capability,
      state: 'completed',
      capturedAt: input.capturedAt,
      itemCount: input.response.Data.Items.length,
      requestDigest: sha256(canonicalJson(requestProjection)),
      responseSha256,
      sha256: sha256(canonicalJson(draft))
    };
    const stored: ZhihuOfficialArtifactView = { ...draft, summary };
    if (!isStoredArtifact(stored)) throw new Error('zhihu_official_artifact_input_invalid');
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new Error('zhihu_official_artifact_payload_too_large');
    }
    await atomicWrite(resolve(this.#rootDirectory, `${artifactId}.json`), stored);
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<ZhihuOfficialArtifactView | null> {
    if (!UUID_PATTERN.test(artifactId)) throw new Error('zhihu_official_artifact_id_invalid');
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const value = JSON.parse(
      await readFile(resolve(this.#rootDirectory, `${artifactId}.json`), 'utf8')
    ) as unknown;
    if (!isStoredArtifact(value) || value.summary.artifactId !== artifactId) {
      throw new Error('zhihu_official_artifact_corrupt');
    }
    const { summary: storedSummary, ...draft } = value;
    if (sha256(canonicalJson(draft)) !== storedSummary.sha256 ||
      sha256(canonicalJson(value.response)) !== storedSummary.responseSha256) {
      throw new Error('zhihu_official_artifact_digest_mismatch');
    }
    return structuredClone(value);
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function artifactRequest(request: ZhihuOfficialCollectorServiceRequest): ZhihuOfficialArtifactView['request'] {
  if (request.capability === ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY) {
    return { limit: request.input.limit };
  }
  return {
    queryDigest: sha256(request.input.query),
    count: request.input.count,
    ...(request.capability === ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY
      ? {
          searchDatabase: request.input.searchDatabase,
          ...(request.input.site ? { site: request.input.site } : {}),
          ...(request.input.publishedAfter ? { publishedAfter: request.input.publishedAfter } : {})
        }
      : {})
  };
}

function apiPath(capability: ZhihuOfficialCapability): ZhihuOfficialArtifactView['provenance']['apiPath'] {
  if (capability === ZHIHU_OFFICIAL_SEARCH_CAPABILITY) return '/api/v1/content/zhihu_search';
  if (capability === ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY) return '/api/v1/content/hot_list';
  return '/api/v1/content/global_search';
}

function isStoredArtifact(value: unknown): value is ZhihuOfficialArtifactView {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'artifactId', 'operationId', 'capability', 'state', 'capturedAt',
    'provenance', 'request', 'response', 'summary'
  ]) || !isSummary(value.summary) || !record(value.provenance) || !record(value.request) ||
    !record(value.response)) return false;
  return value.schemaVersion === 1 && value.artifactId === value.summary.artifactId &&
    value.operationId === value.summary.operationId && value.capability === value.summary.capability &&
    value.state === 'completed' && value.capturedAt === value.summary.capturedAt &&
    value.provenance.environment === 'zhihu_official_open_platform' &&
    value.provenance.executionTarget === 'official_api' &&
    value.provenance.providerOrigin === 'https://developer.zhihu.com' &&
    value.provenance.apiPath === apiPath(value.capability) &&
    value.provenance.authentication === 'gateway_local_access_secret' &&
    value.provenance.browserUsed === false && value.provenance.responseMode === 'official_json' &&
    value.provenance.rawResponseStored === true &&
    !forbiddenMaterial(value.request) && !forbiddenMaterial(value.provenance);
}

function isSummary(value: unknown): value is ZhihuOfficialArtifactSummary {
  return record(value) && exactKeys(value, [
    'schemaVersion', 'artifactId', 'operationId', 'capability', 'state', 'capturedAt', 'itemCount',
    'requestDigest', 'responseSha256', 'sha256'
  ]) && value.schemaVersion === 1 && UUID_PATTERN.test(value.artifactId) &&
    UUID_PATTERN.test(value.operationId) && isCapability(value.capability) && value.state === 'completed' &&
    timestamp(value.capturedAt) && Number.isSafeInteger(value.itemCount) && value.itemCount >= 0 &&
    value.itemCount <= 30 && SHA256_PATTERN.test(value.requestDigest) &&
    SHA256_PATTERN.test(value.responseSha256) && SHA256_PATTERN.test(value.sha256);
}

function isCapability(value: unknown): value is ZhihuOfficialCapability {
  return value === ZHIHU_OFFICIAL_SEARCH_CAPABILITY || value === ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY ||
    value === ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY;
}

function forbiddenMaterial(value: unknown): boolean {
  return /"(?:authorization|accessSecret|secret|token|cookie|requestHeaders)"\s*:/i.test(JSON.stringify(value));
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
