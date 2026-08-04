const ACCESS_SECRET_MIN_LENGTH = 20;
const ACCESS_SECRET_MAX_LENGTH = 256;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export interface ZhihuOfficialApiConfig {
  accessSecret: string | null;
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
  if (raw !== raw.trim() || raw.length < ACCESS_SECRET_MIN_LENGTH ||
    raw.length > ACCESS_SECRET_MAX_LENGTH || CONTROL_CHARACTER.test(raw)) {
    throw new Error('zhihu_official_api_credential_invalid');
  }
  return { accessSecret: raw };
}

export function zhihuOfficialApiCredentialConfigured(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return loadZhihuOfficialApiConfig(environment).accessSecret !== null;
}
