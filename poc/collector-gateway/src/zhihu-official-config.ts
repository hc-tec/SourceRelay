import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const ACCESS_SECRET_MIN_LENGTH = 20;
const ACCESS_SECRET_MAX_LENGTH = 256;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export const ZHIHU_CREDENTIAL_FILE_NAME = 'zhihu-credential.json';
const ZHIHU_CREDENTIAL_SCHEMA_VERSION = 1 as const;

export interface ZhihuOfficialApiConfig {
  accessSecret: string | null;
}

interface PersistedZhihuCredential {
  schemaVersion: typeof ZHIHU_CREDENTIAL_SCHEMA_VERSION;
  accessSecret: string;
}

/**
 * Validate a caller-provided official-provider secret without ever returning
 * it from a status object.  The value is deliberately accepted only by the
 * Gateway process; it is not a Browser Provider or SDK credential.
 */
export function validateZhihuOfficialAccessSecret(value: unknown): string {
  if (typeof value !== 'string') throw new Error('zhihu_official_api_credential_invalid');
  if (value !== value.trim() || value.length < ACCESS_SECRET_MIN_LENGTH ||
    value.length > ACCESS_SECRET_MAX_LENGTH || CONTROL_CHARACTER.test(value)) {
    throw new Error('zhihu_official_api_credential_invalid');
  }
  return value;
}

/**
 * The official credential belongs to the local Gateway process. It is never
 * copied into an extension work item, SDK request, artifact or audit event.
 */
export function loadZhihuOfficialApiConfig(
  environment: NodeJS.ProcessEnv = process.env
): ZhihuOfficialApiConfig {
  const raw = environment.ZHIHU_ACCESS_SECRET;
  if (raw === undefined || raw === '') return { accessSecret: null };
  return { accessSecret: validateZhihuOfficialAccessSecret(raw) };
}

export function zhihuOfficialApiCredentialConfigured(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return loadZhihuOfficialApiConfig(environment).accessSecret !== null;
}

/**
 * Read the secret persisted by the Gateway Console from the local state
 * directory. A missing file returns null; a malformed file is ignored so a
 * corrupt credential can never block Gateway startup (it is overwritten the
 * next time the Console configures a credential).
 */
export async function loadPersistedZhihuOfficialAccessSecret(
  stateDirectory: string
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(resolve(stateDirectory, ZHIHU_CREDENTIAL_FILE_NAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const value = JSON.parse(raw) as Partial<PersistedZhihuCredential>;
    if (value.schemaVersion !== ZHIHU_CREDENTIAL_SCHEMA_VERSION) return null;
    return validateZhihuOfficialAccessSecret(value.accessSecret);
  } catch {
    return null;
  }
}

/** Persist the Console-provided secret atomically with a private file mode. */
export async function persistZhihuOfficialAccessSecret(
  stateDirectory: string,
  accessSecret: string
): Promise<void> {
  const secret = validateZhihuOfficialAccessSecret(accessSecret);
  await mkdir(stateDirectory, { recursive: true });
  const targetPath = resolve(stateDirectory, ZHIHU_CREDENTIAL_FILE_NAME);
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({
      schemaVersion: ZHIHU_CREDENTIAL_SCHEMA_VERSION,
      accessSecret: secret
    })}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  await rename(temporaryPath, targetPath);
}

/** Remove the persisted Console credential (environment variables are untouched). */
export async function clearPersistedZhihuOfficialAccessSecret(
  stateDirectory: string
): Promise<void> {
  await rm(resolve(stateDirectory, ZHIHU_CREDENTIAL_FILE_NAME), { force: true });
}