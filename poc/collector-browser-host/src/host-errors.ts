import {
  browserHostError,
  type BrowserHostErrorScope,
  type BrowserHostRetryClass,
  type PageDisposition,
  type ProfileSafetyDisposition
} from '@intelligence/collector-contracts';

export function hostError(input: {
  code: string;
  category: string;
  scope: BrowserHostErrorScope;
  retryClass?: BrowserHostRetryClass;
  platformActionAttempted?: boolean;
  pageDisposition?: PageDisposition;
  profileSafetyDisposition?: ProfileSafetyDisposition;
  safeDetails?: Readonly<Record<string, string | number | boolean | null>>;
}) {
  return browserHostError({
    code: input.code,
    category: input.category,
    scope: input.scope,
    terminality: 'terminal',
    retryClass: input.retryClass ?? 'never',
    platformActionAttempted: input.platformActionAttempted ?? false,
    pageDisposition: input.pageDisposition ?? 'unchanged',
    profileSafetyDisposition: input.profileSafetyDisposition ?? 'ready',
    safeDetails: input.safeDetails ?? {}
  });
}
