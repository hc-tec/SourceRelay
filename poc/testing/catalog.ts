export const VALIDATION_TIERS = ['static', 'pure', 'contract', 'real_local', 'live_canary'] as const;
export type ValidationTier = (typeof VALIDATION_TIERS)[number];

export const PLATFORM_POLICIES = ['forbidden', 'managed_profile_low_frequency'] as const;
export type PlatformPolicy = (typeof PLATFORM_POLICIES)[number];

export interface ValidationCatalogEntry {
  id: string;
  tier: ValidationTier;
  owner: string;
  runner: 'npm' | 'vitest' | 'playwright' | 'production_canary' | 'pytest';
  command: string | null;
  timeoutMs: number | null;
  platformPolicy: PlatformPolicy;
  ci: 'pull_request' | 'nightly' | 'sidecar' | 'never';
  capabilities: readonly string[];
  strategy?: Readonly<{ id: string; version: string; maturity: string }>;
  canaryRecord?: string;
}

/**
 * The catalog records what a green result is actually allowed to claim. It is
 * deliberately separate from strategy code so local tests cannot silently
 * promote a platform capability.
 */
export const collectorValidationCatalog = [
  {
    id: 'collector-production-build',
    tier: 'static',
    owner: 'collector-core',
    runner: 'npm',
    command: 'npm run verify:local',
    timeoutMs: 180_000,
    platformPolicy: 'forbidden',
    ci: 'pull_request',
    capabilities: ['production-build', 'manifest-boundary', 'artifact-boundary']
  },
  {
    id: 'collector-contracts-native-bridge-guards',
    tier: 'pure',
    owner: 'collector-contracts',
    runner: 'vitest',
    command: 'npm run test:unit -- --project contracts',
    timeoutMs: 30_000,
    platformPolicy: 'forbidden',
    ci: 'pull_request',
    capabilities: ['native-messaging', 'runtime-guard', 'canonical-json']
  },
  {
    id: 'collector-gateway-account-safety-state-machine',
    tier: 'pure',
    owner: 'collector-gateway',
    runner: 'vitest',
    command: 'npm run test:unit -- --project gateway-domain',
    timeoutMs: 30_000,
    platformPolicy: 'forbidden',
    ci: 'pull_request',
    capabilities: ['account-safety', 'at-most-once-action', 'restart-lock']
  },
  {
    id: 'collector-validation-catalog',
    tier: 'contract',
    owner: 'collector-core',
    runner: 'vitest',
    command: 'npm run test:unit -- --project governance',
    timeoutMs: 30_000,
    platformPolicy: 'forbidden',
    ci: 'pull_request',
    capabilities: ['validation-governance', 'maturity-boundary']
  },
  {
    id: 'collector-extension-production-boot',
    tier: 'real_local',
    owner: 'collector-extension',
    runner: 'playwright',
    command: 'npm run test:real-local -- --grep "production MV3 boot"',
    timeoutMs: 120_000,
    platformPolicy: 'forbidden',
    ci: 'pull_request',
    capabilities: ['production-extension', 'mv3-worker', 'control-surface']
  },
  {
    id: 'collector-gateway-host-real-local-lifecycle',
    tier: 'real_local',
    owner: 'collector-gateway',
    runner: 'playwright',
    command: 'npm run test:real-local -- --grep "Gateway and Browser Host lifecycle"',
    timeoutMs: 180_000,
    platformPolicy: 'forbidden',
    ci: 'pull_request',
    capabilities: ['gateway-reconnect', 'browser-host', 'native-messaging', 'explicit-close']
  },
  {
    id: 'bilibili-account-video-page-two-live-canary',
    tier: 'live_canary',
    owner: 'collector-bilibili-strategy',
    runner: 'production_canary',
    command: null,
    timeoutMs: null,
    platformPolicy: 'managed_profile_low_frequency',
    ci: 'never',
    capabilities: ['bilibili-account-inventory', 'trusted-pagination'],
    strategy: {
      id: 'bilibili.account.video-inventory.dom.v1',
      version: '0.1.0',
      maturity: 'research_canary_proved_not_admitted'
    },
    canaryRecord: 'docs/validation/bilibili-account-video-page-two-v0.1.md'
  }
] as const satisfies readonly ValidationCatalogEntry[];

export function validateCatalog(entries: readonly ValidationCatalogEntry[] = collectorValidationCatalog): string[] {
  const errors: string[] = [];
  const identifiers = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z0-9-]{3,120}$/.test(entry.id)) errors.push(`invalid_id:${entry.id}`);
    if (identifiers.has(entry.id)) errors.push(`duplicate_id:${entry.id}`);
    identifiers.add(entry.id);
    if (!VALIDATION_TIERS.includes(entry.tier)) errors.push(`invalid_tier:${entry.id}`);
    if (!PLATFORM_POLICIES.includes(entry.platformPolicy)) errors.push(`invalid_policy:${entry.id}`);
    if (entry.tier === 'live_canary') {
      if (entry.command !== null) errors.push(`live_canary_command_forbidden:${entry.id}`);
      if (entry.ci !== 'never') errors.push(`live_canary_ci_forbidden:${entry.id}`);
      if (entry.platformPolicy !== 'managed_profile_low_frequency') errors.push(`live_canary_policy:${entry.id}`);
      if (!entry.strategy || !entry.canaryRecord?.startsWith('docs/validation/')) {
        errors.push(`live_canary_evidence_missing:${entry.id}`);
      }
      continue;
    }
    if (entry.command === null) errors.push(`local_command_missing:${entry.id}`);
    if (!entry.timeoutMs || entry.timeoutMs <= 0) errors.push(`local_timeout_missing:${entry.id}`);
    if (entry.platformPolicy !== 'forbidden') errors.push(`local_platform_policy:${entry.id}`);
    if (entry.ci === 'never') errors.push(`local_ci_missing:${entry.id}`);
  }
  return errors;
}
