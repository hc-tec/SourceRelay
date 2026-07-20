import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { BrowserProfileRecord } from '../../collector-extension/src/shared/control-plane';
import {
  isSupportedPlatform,
  type BrowserProfileBinding,
  type BrowserProfileKind,
  type SupportedPlatform
} from '../../collector-extension/src/shared/collection-contracts';

export interface CreateBrowserProfileInput {
  kind: BrowserProfileKind;
  platform: SupportedPlatform;
  accountCategory: 'anonymous' | 'user_managed';
  accountLabel: string;
  expectedVisibleIdentity?: string;
}

const profileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const extensionVersionPattern = /^\d{1,6}(?:\.\d{1,6}){2,3}$/;

function boundedLabel(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${name}_invalid`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name}_invalid`);
  return normalized;
}

export function createBrowserProfileInput(value: unknown): CreateBrowserProfileInput {
  if (!value || typeof value !== 'object') throw new Error('profile_input_invalid');
  const candidate = value as Partial<CreateBrowserProfileInput>;
  const allowedKeys = new Set([
    'kind',
    'platform',
    'accountCategory',
    'accountLabel',
    'expectedVisibleIdentity'
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) throw new Error('profile_input_invalid');
  if (candidate.kind !== 'collection' && candidate.kind !== 'validation') throw new Error('profile_kind_invalid');
  if (!isSupportedPlatform(candidate.platform)) throw new Error('profile_platform_invalid');
  if (candidate.accountCategory !== 'anonymous' && candidate.accountCategory !== 'user_managed') {
    throw new Error('profile_account_category_invalid');
  }
  if (candidate.kind === 'collection' && candidate.accountCategory === 'anonymous') {
    throw new Error('profile_collection_requires_user_managed_account');
  }
  return {
    kind: candidate.kind,
    platform: candidate.platform,
    accountCategory: candidate.accountCategory,
    accountLabel: boundedLabel(candidate.accountLabel, 'profile_account_label', 80),
    ...(candidate.expectedVisibleIdentity === undefined
      ? {}
      : { expectedVisibleIdentity: boundedLabel(candidate.expectedVisibleIdentity, 'profile_expected_identity', 160) })
  };
}

function browserProfileRecord(value: unknown): BrowserProfileRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BrowserProfileRecord>;
  const account = candidate.account;
  const valid = (
    candidate.schemaVersion === 1 &&
    typeof candidate.profileId === 'string' &&
    profileIdPattern.test(candidate.profileId) &&
    (candidate.kind === 'collection' || candidate.kind === 'validation') &&
    isSupportedPlatform(candidate.platform) &&
    Boolean(account) &&
    (account?.category === 'anonymous' || account?.category === 'user_managed') &&
    typeof account.label === 'string' &&
    account.label.length > 0 &&
    account.label.length <= 80 &&
    (account.expectedVisibleIdentity === undefined ||
      (typeof account.expectedVisibleIdentity === 'string' && account.expectedVisibleIdentity.length <= 160)) &&
    (candidate.kind !== 'collection' || account.category === 'user_managed') &&
    candidate.browser === 'playwright_chromium' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.lastLaunchedAt === null || typeof candidate.lastLaunchedAt === 'string') &&
    (candidate.lastExtensionVersion === undefined || candidate.lastExtensionVersion === null ||
      (typeof candidate.lastExtensionVersion === 'string' && extensionVersionPattern.test(candidate.lastExtensionVersion)))
  );
  if (!valid) return null;
  return {
    schemaVersion: 1,
    profileId: candidate.profileId!,
    kind: candidate.kind!,
    platform: candidate.platform!,
    account: structuredClone(account!),
    browser: 'playwright_chromium',
    createdAt: candidate.createdAt!,
    lastLaunchedAt: candidate.lastLaunchedAt ?? null,
    lastExtensionVersion: candidate.lastExtensionVersion ?? null
  };
}

export class BrowserProfileRegistry {
  readonly #profileRoot: string;
  readonly #registryPath: string;
  #profiles: BrowserProfileRecord[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(profileRoot: string, stateDirectory: string) {
    this.#profileRoot = resolve(profileRoot);
    this.#registryPath = resolve(stateDirectory, 'browser-profiles.json');
  }

  static async create(profileRoot: string, stateDirectory: string): Promise<BrowserProfileRegistry> {
    const registry = new BrowserProfileRegistry(profileRoot, stateDirectory);
    await mkdir(resolve(stateDirectory), { recursive: true });
    await mkdir(registry.#profileRoot, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(registry.#registryPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        registry.#profiles = parsed.map(browserProfileRecord)
          .filter((profile): profile is BrowserProfileRecord => profile !== null);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return registry;
  }

  list(): BrowserProfileRecord[] {
    return this.#profiles.map((profile) => structuredClone(profile));
  }

  get(profileId: string): BrowserProfileRecord {
    const profile = this.#profiles.find((candidate) => candidate.profileId === profileId);
    if (!profile) throw new Error('profile_not_found');
    return structuredClone(profile);
  }

  async createProfile(input: CreateBrowserProfileInput, now = new Date()): Promise<BrowserProfileRecord> {
    const duplicate = this.#profiles.some((profile) =>
      profile.kind === input.kind &&
      profile.platform === input.platform &&
      profile.account.category === input.accountCategory &&
      profile.account.label.toLowerCase() === input.accountLabel.toLowerCase()
    );
    if (duplicate) throw new Error('profile_binding_already_exists');
    const profile: BrowserProfileRecord = {
      schemaVersion: 1,
      profileId: randomUUID(),
      kind: input.kind,
      platform: input.platform,
      account: {
        category: input.accountCategory,
        label: input.accountLabel,
        ...(input.expectedVisibleIdentity ? { expectedVisibleIdentity: input.expectedVisibleIdentity } : {})
      },
      browser: 'playwright_chromium',
      createdAt: now.toISOString(),
      lastLaunchedAt: null,
      lastExtensionVersion: null
    };
    await mkdir(this.userDataDirectory(profile.profileId), { recursive: true });
    this.#profiles.push(profile);
    try {
      await this.#save();
    } catch (error) {
      this.#profiles = this.#profiles.filter((candidate) => candidate.profileId !== profile.profileId);
      throw error;
    }
    return structuredClone(profile);
  }

  collectionBindings(
    platforms: readonly SupportedPlatform[],
    profileIds: Partial<Record<SupportedPlatform, string>>
  ): Partial<Record<SupportedPlatform, BrowserProfileBinding>> {
    const platformSet = new Set(platforms);
    if (Object.keys(profileIds).some((platform) => !isSupportedPlatform(platform) || !platformSet.has(platform))) {
      throw new Error('task_profile_bindings_invalid');
    }
    const bindings: Partial<Record<SupportedPlatform, BrowserProfileBinding>> = {};
    for (const platform of platforms) {
      const profileId = profileIds[platform];
      if (typeof profileId !== 'string' || !profileIdPattern.test(profileId)) {
        throw new Error('task_profile_binding_required');
      }
      const profile = this.get(profileId);
      if (profile.kind !== 'collection') throw new Error('task_profile_kind_invalid');
      if (profile.platform !== platform) throw new Error('task_profile_platform_mismatch');
      if (profile.account.category !== 'user_managed') throw new Error('task_profile_account_invalid');
      bindings[platform] = {
        profileId: profile.profileId,
        kind: profile.kind,
        platform: profile.platform,
        account: structuredClone(profile.account)
      };
    }
    return bindings;
  }

  async markLaunched(
    profileId: string,
    extensionVersion: string,
    launchedAt = new Date()
  ): Promise<BrowserProfileRecord> {
    const profile = this.#profiles.find((candidate) => candidate.profileId === profileId);
    if (!profile) throw new Error('profile_not_found');
    if (!extensionVersionPattern.test(extensionVersion)) throw new Error('profile_extension_version_invalid');
    const previousLaunch = profile.lastLaunchedAt;
    const previousExtensionVersion = profile.lastExtensionVersion;
    profile.lastLaunchedAt = launchedAt.toISOString();
    profile.lastExtensionVersion = extensionVersion;
    try {
      await this.#save();
    } catch (error) {
      profile.lastLaunchedAt = previousLaunch;
      profile.lastExtensionVersion = previousExtensionVersion;
      throw error;
    }
    return structuredClone(profile);
  }

  userDataDirectory(profileId: string): string {
    if (!profileIdPattern.test(profileId)) throw new Error('profile_id_invalid');
    const path = resolve(this.#profileRoot, profileId);
    if (!path.startsWith(`${this.#profileRoot}${sep}`)) throw new Error('profile_path_rejected');
    return path;
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporaryPath = `${this.#registryPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.#profiles, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.#registryPath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
