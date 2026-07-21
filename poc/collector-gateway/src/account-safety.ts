import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SupportedPlatform } from '../../collector-extension/src/shared/collection-contracts';

const MAX_ACTION_IDS_PER_RUN = 20;
const UNLOCK_ACKNOWLEDGEMENT = 'resume_authenticated_platform_actions';

export type AccountSafetyState = 'ready' | 'running' | 'locked';
export type AccountSafetyRunPurpose =
  | 'authenticated_interaction_reconnaissance'
  | 'authenticated_account_archive_reconnaissance'
  | 'authenticated_account_profile_reconnaissance'
  | 'authenticated_collection_series_reconnaissance'
  | 'authenticated_series_detail_reconnaissance'
  | 'authenticated_article_inventory_reconnaissance'
  | 'authenticated_article_detail_reconnaissance'
  | 'authenticated_dynamic_reconnaissance'
  | 'authenticated_video_detail_reconnaissance'
  | 'authenticated_transcript_validation'
  | 'formal_collection_stage';

export interface AccountSafetyRecord {
  schemaVersion: 2;
  profileId: string;
  platform: SupportedPlatform;
  state: AccountSafetyState;
  reasonCode: string | null;
  manualUnlockRequired: boolean;
  activeRun: {
    runId: string;
    purpose: AccountSafetyRunPurpose;
    startedAt: string;
    attemptedActionIds: string[];
  } | null;
  lastRunAt: string | null;
  updatedAt: string;
}

interface PersistedAccountSafetyRecord extends Omit<AccountSafetyRecord, 'schemaVersion' | 'state'> {
  schemaVersion: 1 | 2;
  state: AccountSafetyState | 'cooldown';
  cooldownUntil?: string | null;
}

export interface AccountSafetyRunPermit {
  runId: string;
  profileId: string;
  platform: SupportedPlatform;
  startedAt: string;
}

export interface AccountSafetyUnlockInput {
  acknowledgement: typeof UNLOCK_ACKNOWLEDGEMENT;
}

const profileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeCodePattern = /^[a-z0-9_]{1,100}$/;

function safetyKey(profileId: string, platform: SupportedPlatform): string {
  return `${profileId}\n${platform}`;
}

function isSafetyRecord(value: unknown): value is PersistedAccountSafetyRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedAccountSafetyRecord>;
  const activeRun = candidate.activeRun;
  return (
    (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) &&
    typeof candidate.profileId === 'string' &&
    profileIdPattern.test(candidate.profileId) &&
    (candidate.platform === 'bilibili' || candidate.platform === 'zhihu' ||
      candidate.platform === 'weibo' || candidate.platform === 'xiaohongshu') &&
    (candidate.state === 'ready' || candidate.state === 'running' ||
      candidate.state === 'cooldown' || candidate.state === 'locked') &&
    (candidate.reasonCode === null || (typeof candidate.reasonCode === 'string' && safeCodePattern.test(candidate.reasonCode))) &&
    typeof candidate.manualUnlockRequired === 'boolean' &&
    (candidate.cooldownUntil === undefined || candidate.cooldownUntil === null ||
      typeof candidate.cooldownUntil === 'string') &&
    (activeRun === null || Boolean(
      activeRun &&
      typeof activeRun.runId === 'string' &&
      profileIdPattern.test(activeRun.runId) &&
      (activeRun.purpose === 'authenticated_interaction_reconnaissance' ||
        activeRun.purpose === 'authenticated_account_archive_reconnaissance' ||
        activeRun.purpose === 'authenticated_account_profile_reconnaissance' ||
        activeRun.purpose === 'authenticated_collection_series_reconnaissance' ||
        activeRun.purpose === 'authenticated_series_detail_reconnaissance' ||
        activeRun.purpose === 'authenticated_article_inventory_reconnaissance' ||
        activeRun.purpose === 'authenticated_article_detail_reconnaissance' ||
        activeRun.purpose === 'authenticated_dynamic_reconnaissance' ||
        activeRun.purpose === 'authenticated_video_detail_reconnaissance' ||
        activeRun.purpose === 'authenticated_transcript_validation' ||
        activeRun.purpose === 'formal_collection_stage') &&
      typeof activeRun.startedAt === 'string' &&
      Array.isArray(activeRun.attemptedActionIds) &&
      activeRun.attemptedActionIds.every((actionId) => typeof actionId === 'string' && safeCodePattern.test(actionId))
    )) &&
    (candidate.lastRunAt === null || typeof candidate.lastRunAt === 'string') &&
    typeof candidate.updatedAt === 'string'
  );
}

function defaultRecord(
  profileId: string,
  platform: SupportedPlatform,
  now: Date
): AccountSafetyRecord {
  if (!profileIdPattern.test(profileId)) throw new Error('account_safety_profile_invalid');
  return {
    schemaVersion: 2,
    profileId,
    platform,
    state: 'ready',
    reasonCode: null,
    manualUnlockRequired: false,
    activeRun: null,
    lastRunAt: null,
    updatedAt: now.toISOString()
  };
}

export function accountSafetyUnlockInput(value: unknown): AccountSafetyUnlockInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('account_safety_unlock_input_invalid');
  }
  const candidate = value as Partial<AccountSafetyUnlockInput>;
  if (Object.keys(candidate).some((key) => key !== 'acknowledgement')) {
    throw new Error('account_safety_unlock_input_invalid');
  }
  if (candidate.acknowledgement !== UNLOCK_ACKNOWLEDGEMENT) {
    throw new Error('account_safety_unlock_acknowledgement_required');
  }
  return { acknowledgement: UNLOCK_ACKNOWLEDGEMENT };
}

export class AccountSafetyRegistry {
  readonly #registryPath: string;
  readonly #records = new Map<string, AccountSafetyRecord>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#registryPath = resolve(stateDirectory, 'account-safety.json');
  }

  static async create(stateDirectory: string, now = new Date()): Promise<AccountSafetyRegistry> {
    const registry = new AccountSafetyRegistry(stateDirectory);
    await mkdir(resolve(stateDirectory), { recursive: true });
    let changed = false;
    try {
      const parsed = JSON.parse(await readFile(registry.#registryPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const candidate of parsed.filter(isSafetyRecord)) {
          const {
            cooldownUntil: _legacyCooldownUntil,
            schemaVersion: _persistedSchemaVersion,
            state: persistedState,
            ...persisted
          } = structuredClone(candidate);
          const record: AccountSafetyRecord = {
            ...persisted,
            schemaVersion: 2,
            state: persistedState === 'cooldown' ? 'ready' : persistedState
          };
          if (
            candidate.schemaVersion !== 2 ||
            candidate.state === 'cooldown' ||
            candidate.cooldownUntil !== undefined
          ) {
            record.updatedAt = now.toISOString();
            changed = true;
          }
          if (record.state === 'running' || record.activeRun) {
            record.state = 'locked';
            record.reasonCode = 'previous_run_interrupted_manual_review_required';
            record.manualUnlockRequired = true;
            record.activeRun = null;
            record.updatedAt = now.toISOString();
            changed = true;
          } else if (record.state === 'locked') {
            if (!record.manualUnlockRequired) changed = true;
            record.manualUnlockRequired = true;
          } else {
            if (record.manualUnlockRequired) changed = true;
            record.manualUnlockRequired = false;
          }
          registry.#records.set(safetyKey(record.profileId, record.platform), record);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (changed) await registry.#save();
    return registry;
  }

  list(): AccountSafetyRecord[] {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }

  get(profileId: string, platform: SupportedPlatform, now = new Date()): AccountSafetyRecord {
    const record = this.#records.get(safetyKey(profileId, platform)) ?? defaultRecord(profileId, platform, now);
    return structuredClone(record);
  }

  async pause(
    profileId: string,
    platform: SupportedPlatform,
    reasonCode = 'user_safety_pause',
    now = new Date()
  ): Promise<AccountSafetyRecord> {
    if (!safeCodePattern.test(reasonCode)) throw new Error('account_safety_reason_invalid');
    const record = this.#record(profileId, platform, now);
    record.state = 'locked';
    record.reasonCode = reasonCode;
    record.manualUnlockRequired = true;
    record.activeRun = null;
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  async unlock(
    profileId: string,
    platform: SupportedPlatform,
    input: AccountSafetyUnlockInput,
    now = new Date()
  ): Promise<AccountSafetyRecord> {
    if (input.acknowledgement !== UNLOCK_ACKNOWLEDGEMENT) {
      throw new Error('account_safety_unlock_acknowledgement_required');
    }
    const record = this.#record(profileId, platform, now);
    if (record.state === 'running' || record.activeRun) throw new Error('account_safety_run_active');
    record.state = 'ready';
    record.reasonCode = null;
    record.manualUnlockRequired = false;
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  async beginAuthenticatedRun(
    profileId: string,
    platform: SupportedPlatform,
    purpose: AccountSafetyRunPurpose = 'authenticated_interaction_reconnaissance',
    now = new Date()
  ): Promise<AccountSafetyRunPermit> {
    const record = this.#record(profileId, platform, now);
    if (record.state === 'locked') throw new Error('account_safety_manual_unlock_required');
    if (record.state === 'running' || record.activeRun) throw new Error('account_safety_run_active');
    const runId = randomUUID();
    record.state = 'running';
    record.reasonCode = 'authenticated_run_in_progress';
    record.manualUnlockRequired = false;
    record.activeRun = {
      runId,
      purpose,
      startedAt: now.toISOString(),
      attemptedActionIds: []
    };
    record.updatedAt = now.toISOString();
    await this.#save();
    return { runId, profileId, platform, startedAt: now.toISOString() };
  }

  async assertPlatformNavigationAllowed(
    profileId: string,
    platform: SupportedPlatform,
    now = new Date()
  ): Promise<void> {
    const record = this.#record(profileId, platform, now);
    if (record.state === 'locked') throw new Error('account_safety_manual_unlock_required');
    if (record.state === 'running' || record.activeRun) throw new Error('account_safety_run_active');
  }

  async recordActionAttempt(
    profileId: string,
    platform: SupportedPlatform,
    runId: string,
    actionId: string,
    now = new Date()
  ): Promise<AccountSafetyRecord> {
    if (!safeCodePattern.test(actionId)) throw new Error('account_safety_action_invalid');
    const record = this.#record(profileId, platform, now);
    if (record.state !== 'running' || record.activeRun?.runId !== runId) {
      throw new Error('account_safety_run_not_active');
    }
    if (record.activeRun.attemptedActionIds.includes(actionId)) {
      throw new Error('account_safety_action_already_attempted');
    }
    if (record.activeRun.attemptedActionIds.length >= MAX_ACTION_IDS_PER_RUN) {
      throw new Error('account_safety_action_budget_exceeded');
    }
    record.activeRun.attemptedActionIds.push(actionId);
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  async finishAuthenticatedRun(
    profileId: string,
    platform: SupportedPlatform,
    runId: string,
    reasonCode: string,
    now = new Date()
  ): Promise<AccountSafetyRecord> {
    if (!safeCodePattern.test(reasonCode)) throw new Error('account_safety_reason_invalid');
    const record = this.#record(profileId, platform, now);
    if (record.state !== 'running' || record.activeRun?.runId !== runId) {
      throw new Error('account_safety_run_not_active');
    }
    const hardLock = /verification_required|rate_limited|risk_control|captcha|authentication_lost|user_safety_pause/.test(
      reasonCode
    );
    record.state = hardLock ? 'locked' : 'ready';
    record.reasonCode = reasonCode;
    record.manualUnlockRequired = hardLock;
    record.activeRun = null;
    record.lastRunAt = now.toISOString();
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  #record(profileId: string, platform: SupportedPlatform, now: Date): AccountSafetyRecord {
    const key = safetyKey(profileId, platform);
    const existing = this.#records.get(key);
    if (existing) return existing;
    const created = defaultRecord(profileId, platform, now);
    this.#records.set(key, created);
    return created;
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporaryPath = `${this.#registryPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify([...this.#records.values()], null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.#registryPath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
