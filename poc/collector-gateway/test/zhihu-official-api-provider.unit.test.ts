import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { OfficialSourceOperationStore } from '../src/official-source-operation-store.js';
import { ZhihuOfficialApiProvider } from '../src/zhihu-official-api-provider.js';
import { ZhihuOfficialArtifactStore } from '../src/zhihu-official-artifacts.js';
import type { ZhihuOfficialGlobalSearchCollectorServiceRequest } from '../src/zhihu-official-contract.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Zhihu official API provider', () => {
  test('supports Console session configuration without exposing the secret in status', async () => {
    const directory = await stateDirectory();
    const operations = await OfficialSourceOperationStore.create(directory);
    const artifacts = await ZhihuOfficialArtifactStore.create(directory);
    const provider = new ZhihuOfficialApiProvider({
      accessSecret: null,
      artifacts,
      operations
    });

    expect(provider.credentialStatus()).toMatchObject({
      runtimeState: 'credential_required',
      configurationMode: 'none',
      credentialLocation: 'gateway_only'
    });
    const configured = provider.configureForCurrentProcess('console-session-secret-123');
    expect(configured).toMatchObject({
      runtimeState: 'ready',
      configurationMode: 'console_session',
      restartPersistence: 'gateway_process_only'
    });
    expect(JSON.stringify(configured)).not.toContain('console-session-secret-123');
    expect(provider.configured()).toBe(true);

    const cleared = provider.clearCredential();
    expect(cleared).toMatchObject({ runtimeState: 'credential_required', configurationMode: 'none' });
    expect(provider.configured()).toBe(false);
  });

  test('rejects malformed Console session credentials before changing provider state', async () => {
    const directory = await stateDirectory();
    const operations = await OfficialSourceOperationStore.create(directory);
    const artifacts = await ZhihuOfficialArtifactStore.create(directory);
    const provider = new ZhihuOfficialApiProvider({
      accessSecret: 'environment-secret-123456',
      artifacts,
      operations
    });

    expect(() => provider.configureForCurrentProcess(' short '))
      .toThrow('zhihu_official_api_credential_invalid');
    expect(provider.credentialStatus()).toMatchObject({
      runtimeState: 'ready',
      configurationMode: 'environment'
    });
  });

  test('builds the fixed global-search request and persists a restart-safe raw-first Artifact', async () => {
    const directory = await stateDirectory();
    const operations = await OfficialSourceOperationStore.create(directory);
    const artifacts = await ZhihuOfficialArtifactStore.create(directory);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new ZhihuOfficialApiProvider({
      accessSecret: 'unit-test-secret',
      artifacts,
      operations,
      now: () => new Date('2026-08-04T10:00:00.000Z'),
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return jsonResponse(searchResponse());
      }
    });
    const request: ZhihuOfficialGlobalSearchCollectorServiceRequest = {
      schemaVersion: 3,
      clientRequestId: randomUUID(),
      platform: 'web',
      capability: 'web.search.global.zhihu_provider.v1',
      executionTarget: 'official_api',
      input: {
        query: 'private-query-sentinel',
        count: 1,
        searchDatabase: 'realtime',
        site: 'news.example.com',
        publishedAfter: '2026-08-01T00:00:00.000Z'
      }
    };
    const operationId = randomUUID();

    const operation = await provider.collect(request, operationId);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://developer.zhihu.com/api/v1/content/global_search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      Query: 'private-query-sentinel',
      Count: '1',
      SearchDB: 'realtime',
      Filter: 'host=="news.example.com" AND publish_time>=1785542400'
    });
    expect(calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer unit-test-secret');
    expect(operation).toMatchObject({
      operationId,
      browserBindingId: null,
      platform: 'web',
      capability: request.capability,
      executionTarget: 'official_api',
      state: 'completed',
      terminalReason: 'official_api_response_ready'
    });

    const artifact = await artifacts.get(operation.artifact.artifactId);
    expect(artifact).toMatchObject({
      operationId,
      capability: request.capability,
      provenance: { browserUsed: false, authentication: 'gateway_local_access_secret' },
      request: {
        count: 1,
        searchDatabase: 'realtime',
        site: 'news.example.com',
        publishedAfter: '2026-08-01T00:00:00.000Z'
      },
      response: { Code: 0, Data: { Items: expect.any(Array) } }
    });
    expect(artifact?.request.queryDigest).toMatch(/^[a-f0-9]{64}$/);
    const persistedText = await persistedStateText(directory);
    expect(persistedText).not.toContain('private-query-sentinel');
    expect(persistedText).not.toContain('unit-test-secret');

    const restartedOperations = await OfficialSourceOperationStore.create(directory);
    const restartedArtifacts = await ZhihuOfficialArtifactStore.create(directory);
    expect(await restartedOperations.get(operationId)).toEqual(operation);
    expect(await restartedArtifacts.get(operation.artifact.artifactId)).toEqual(artifact);
  });

  test.each([
    [jsonResponse({ Code: 20001, Message: 'Authorization failed', Data: null }), 'zhihu_official_api_authentication_failed'],
    [new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } }), 'zhihu_official_api_rate_limited'],
    [new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } }), 'zhihu_official_api_response_media_type_invalid'],
    [new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': '9000000' } }), 'zhihu_official_api_response_too_large'],
    [jsonResponse({ Code: 0, Message: 'unit-test-secret', Data: { HasMore: false, Items: [] } }), 'zhihu_official_api_response_contains_credential']
  ])('maps provider failures without automatic retries', async (response, expectedError) => {
    const directory = await stateDirectory();
    const operations = await OfficialSourceOperationStore.create(directory);
    const artifacts = await ZhihuOfficialArtifactStore.create(directory);
    let callCount = 0;
    const provider = new ZhihuOfficialApiProvider({
      accessSecret: 'unit-test-secret',
      artifacts,
      operations,
      fetchImpl: async () => {
        callCount += 1;
        return response;
      }
    });

    await expect(provider.collect(searchRequest(), randomUUID())).rejects.toThrow(expectedError);
    expect(callCount).toBe(1);
    expect(operations.list()).toEqual([]);
    expect(artifacts.list()).toEqual([]);
  });

  test('rejects a response that resolves outside the fixed official origin', async () => {
    const directory = await stateDirectory();
    const operations = await OfficialSourceOperationStore.create(directory);
    const artifacts = await ZhihuOfficialArtifactStore.create(directory);
    const response = jsonResponse(searchResponse());
    Object.defineProperty(response, 'url', { value: 'https://evil.example/redirected', configurable: true });
    const provider = new ZhihuOfficialApiProvider({
      accessSecret: 'unit-test-secret',
      artifacts,
      operations,
      fetchImpl: async () => response
    });

    await expect(provider.collect(searchRequest(), randomUUID()))
      .rejects.toThrow('zhihu_official_api_response_origin_invalid');
  });
});

function searchRequest() {
  return {
    schemaVersion: 3 as const,
    clientRequestId: randomUUID(),
    platform: 'zhihu' as const,
    capability: 'zhihu.search.public_content.v1' as const,
    executionTarget: 'official_api' as const,
    input: { query: 'RAG', count: 1 }
  };
}

function searchResponse(): Record<string, unknown> {
  return {
    Code: 0,
    Message: 'success',
    Data: {
      HasMore: false,
      Items: [{
        Title: '公开结果',
        ContentType: 'Answer',
        ContentID: '123',
        ContentText: '公开摘要',
        Url: 'https://www.zhihu.com/question/1/answer/2',
        CommentCount: 1,
        VoteUpCount: 2,
        AuthorName: '公开作者',
        AuthorAvatar: '',
        AuthorBadge: '',
        AuthorBadgeText: '',
        EditTime: 1,
        AuthorityLevel: '1'
      }]
    }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zhihu-official-provider-'));
  directories.push(directory);
  return directory;
}

async function persistedStateText(directory: string): Promise<string> {
  const index = await readFile(join(directory, 'zhihu-official-artifacts.json'), 'utf8');
  const operations = await readFile(join(directory, 'official-source-operations.json'), 'utf8');
  const artifactFiles = await Promise.all(
    JSON.parse(index).map((summary: { artifactId: string }) =>
      readFile(join(directory, 'zhihu-official-artifacts', `${summary.artifactId}.json`), 'utf8')
    )
  );
  return [index, operations, ...artifactFiles].join('\n');
}
