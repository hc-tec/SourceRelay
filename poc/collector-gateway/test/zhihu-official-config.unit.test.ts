import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ZHIHU_CREDENTIAL_FILE_NAME,
  clearPersistedZhihuOfficialAccessSecret,
  loadPersistedZhihuOfficialAccessSecret,
  loadZhihuOfficialApiConfig,
  persistZhihuOfficialAccessSecret,
  validateZhihuOfficialAccessSecret
} from '../src/zhihu-official-config.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Zhihu official credential persistence', () => {
  test('round-trips a Console secret through the local state file', async () => {
    const directory = await stateDirectory();
    await persistZhihuOfficialAccessSecret(directory, 'persisted-secret-123456');
    expect(await loadPersistedZhihuOfficialAccessSecret(directory)).toBe('persisted-secret-123456');
    await clearPersistedZhihuOfficialAccessSecret(directory);
    expect(await loadPersistedZhihuOfficialAccessSecret(directory)).toBeNull();
  });

  test('treats a missing or malformed credential file as unconfigured', async () => {
    const directory = await stateDirectory();
    expect(await loadPersistedZhihuOfficialAccessSecret(directory)).toBeNull();
    await writeFile(join(directory, ZHIHU_CREDENTIAL_FILE_NAME), '{not json', 'utf8');
    expect(await loadPersistedZhihuOfficialAccessSecret(directory)).toBeNull();
    await writeFile(join(directory, ZHIHU_CREDENTIAL_FILE_NAME), JSON.stringify({
      schemaVersion: 99,
      accessSecret: 'persisted-secret-123456'
    }), 'utf8');
    expect(await loadPersistedZhihuOfficialAccessSecret(directory)).toBeNull();
  });

  test('environment secret wins over a persisted file and is validated', async () => {
    expect(loadZhihuOfficialApiConfig({ ZHIHU_ACCESS_SECRET: 'environment-secret-1234567890' }))
      .toEqual({ accessSecret: 'environment-secret-1234567890' });
    expect(() => validateZhihuOfficialAccessSecret(' short '))
      .toThrow('zhihu_official_api_credential_invalid');
    expect(loadZhihuOfficialApiConfig({})).toEqual({ accessSecret: null });
  });
});

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zhihu-official-config-'));
  directories.push(directory);
  return directory;
}