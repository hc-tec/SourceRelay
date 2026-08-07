const ACCESS_SECRET_MIN_LENGTH = 20;
const ACCESS_SECRET_MAX_LENGTH = 256;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export interface ZhihuOfficialApiConfig {
  accessSecret: string | null;
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
