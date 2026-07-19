import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright';
import type { BrowserProfileRuntimeSummary } from '../../collector-extension/src/shared/control-plane';
import {
  POLL_GATEWAY_TASKS,
  type CapabilityValidationRunSnapshot,
  type DetailCapabilityValidationRunSnapshot,
  type TranscriptCapabilityValidationRunSnapshot
} from '../../collector-extension/src/shared/protocol';
import {
  resolveDetailStrategy,
  resolveNativeSearchStrategy,
  resolveTranscriptStrategy
} from '../../collector-extension/src/shared/strategy-registry';
import type { GatewayConfig } from './config';
import type { BrowserProfileRegistry } from './profiles';
import type { AccountSafetyRegistry } from './account-safety';
import {
  BilibiliDetailSourceObserver,
  sourceReconnaissanceErrorCode,
  type BilibiliDetailSourceReconnaissanceRecord
} from './source-reconnaissance';
import {
  BilibiliInteractionReconnaissanceRunner,
  type BilibiliInteractionReconnaissanceRecord
} from './interaction-reconnaissance';
import { runTranscriptValidationControlLoop } from './transcript-control-loop';
import { executeBilibiliTranscriptInteraction } from './bilibili-transcript-interaction';
import {
  ManagedExtensionRuntime,
  extensionControlSnapshot,
  extensionHasOrigins,
  extensionMessage,
  extensionStoredValidationRuns
} from './managed-extension-runtime';

function canonicalBilibiliVideoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (url.protocol !== 'https:' || !match || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  } catch {
    return null;
  }
}

function platformLoginEntrypoint(platform: string): string {
  if (platform === 'bilibili') return 'https://passport.bilibili.com/login';
  throw new Error('profile_login_entrypoint_unsupported');
}

function platformHomeEntrypoint(platform: string): string {
  if (platform === 'bilibili') return 'https://www.bilibili.com/';
  throw new Error('profile_login_status_unsupported');
}

function isPlatformLoginPage(page: Page, platform: string): boolean {
  try {
    const url = new URL(page.url());
    return platform === 'bilibili' &&
      url.protocol === 'https:' &&
      url.hostname === 'passport.bilibili.com' &&
      url.pathname === '/login';
  } catch {
    return false;
  }
}

export interface PlatformLoginStatusSnapshot {
  schemaVersion: 1;
  platform: 'bilibili';
  state: 'authenticated' | 'anonymous' | 'indeterminate';
  checkedAt: string;
  visibleSignals: {
    accountEntry: boolean;
    loginEntry: boolean;
  };
}

async function inspectBilibiliLoginStatus(page: Page): Promise<PlatformLoginStatusSnapshot> {
  let visibleSignals = { accountEntry: false, loginEntry: false };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    visibleSignals = await page.evaluate(() => {
      const visible = (element: Element): boolean => {
        const html = element as HTMLElement;
        const rect = html.getBoundingClientRect();
        const style = getComputedStyle(html);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const inHeader = (element: Element): boolean => Boolean(element.closest(
        'header, .bili-header, .mini-header, [class*="header-channel"], [class*="header-bar"]'
      ));
      const accountEntry = Array.from(document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="space.bilibili.com/"]'
      )).some((anchor) =>
        visible(anchor) && inHeader(anchor) && /^https:\/\/space\.bilibili\.com\/\d+\/?(?:[?#].*)?$/.test(anchor.href)
      );
      const loginEntry = Array.from(document.querySelectorAll(
        '.header-login-entry, a[href*="passport.bilibili.com/login"], button, [role="button"]'
      )).some((element) =>
        visible(element) && inHeader(element) && (element.textContent ?? '').replace(/\s+/g, ' ').trim() === '登录'
      );
      return { accountEntry, loginEntry };
    });
    if (visibleSignals.accountEntry || visibleSignals.loginEntry) break;
    await delay(500);
  }
  return {
    schemaVersion: 1,
    platform: 'bilibili',
    state: visibleSignals.accountEntry
      ? 'authenticated'
      : visibleSignals.loginEntry
        ? 'anonymous'
        : 'indeterminate',
    checkedAt: new Date().toISOString(),
    visibleSignals
  };
}

export interface ManagedProfilePairingInput {
  loopbackOrigin: string;
  gatewayInstanceId: string;
  pairingSessionId: string;
  pairingCode: string;
}

function validationSnapshot(
  value: unknown,
  runId: string,
  profileId: string,
  extensionVersion: string
): CapabilityValidationRunSnapshot {
  if (!value || typeof value !== 'object') throw new Error('validation_extension_response_missing');
  const response = value as { ok?: unknown; validation?: unknown; error?: unknown };
  if (response.ok !== true) {
    const error = typeof response.error === 'string' && /^[a-z0-9_]{1,100}$/.test(response.error)
      ? response.error
      : 'validation_extension_rejected';
    throw new Error(error);
  }
  if (!response.validation || typeof response.validation !== 'object') {
    throw new Error('validation_extension_snapshot_missing');
  }
  const validation = response.validation as Partial<CapabilityValidationRunSnapshot>;
  if (validation.schemaVersion !== 1) throw new Error('validation_extension_schema_mismatch');
  if (validation.collectorVersion !== extensionVersion) throw new Error('validation_extension_version_mismatch');
  if (validation.runId !== runId) throw new Error('validation_extension_run_mismatch');
  if (validation.profileId !== profileId) throw new Error('validation_extension_profile_mismatch');
  if (validation.platform !== 'bilibili') throw new Error('validation_extension_platform_mismatch');
  if (validation.accountCategory !== 'anonymous') throw new Error('validation_extension_account_mismatch');
  if (typeof validation.state !== 'string') throw new Error('validation_extension_state_invalid');
  return validation as CapabilityValidationRunSnapshot;
}

function detailValidationSnapshot(
  value: unknown,
  runId: string,
  profileId: string,
  extensionVersion: string
): DetailCapabilityValidationRunSnapshot {
  if (!value || typeof value !== 'object') throw new Error('detail_validation_extension_response_missing');
  const response = value as { ok?: unknown; validation?: unknown; error?: unknown };
  if (response.ok !== true) {
    const error = typeof response.error === 'string' && /^[a-z0-9_]{1,100}$/.test(response.error)
      ? response.error
      : 'detail_validation_extension_rejected';
    throw new Error(error);
  }
  if (!response.validation || typeof response.validation !== 'object') {
    throw new Error('detail_validation_extension_snapshot_missing');
  }
  const validation = response.validation as Partial<DetailCapabilityValidationRunSnapshot>;
  if (validation.schemaVersion !== 1) throw new Error('detail_validation_extension_schema_mismatch');
  if (validation.collectorVersion !== extensionVersion) throw new Error('detail_validation_extension_version_mismatch');
  if (validation.runId !== runId) throw new Error('detail_validation_extension_run_mismatch');
  if (validation.profileId !== profileId) throw new Error('detail_validation_extension_profile_mismatch');
  if (validation.platform !== 'bilibili') throw new Error('detail_validation_extension_platform_mismatch');
  if (validation.accountCategory !== 'anonymous') throw new Error('detail_validation_extension_account_mismatch');
  if (validation.evidenceObjective !== 'detail_read') throw new Error('detail_validation_extension_objective_mismatch');
  if (typeof validation.state !== 'string') throw new Error('detail_validation_extension_state_invalid');
  return validation as DetailCapabilityValidationRunSnapshot;
}

export class CollectionBrowserManager {
  readonly #registry: BrowserProfileRegistry;
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #runtime: ManagedExtensionRuntime;

  constructor(config: GatewayConfig, registry: BrowserProfileRegistry, accountSafety: AccountSafetyRegistry) {
    this.#registry = registry;
    this.#accountSafety = accountSafety;
    this.#runtime = new ManagedExtensionRuntime(config, registry);
  }

  async list(): Promise<BrowserProfileRuntimeSummary[]> {
    const summaries: BrowserProfileRuntimeSummary[] = [];
    for (const profile of this.#registry.list()) {
      const running = this.#runtime.get(profile.profileId);
      let extensionPaired = false;
      let strategyPermission: BrowserProfileRuntimeSummary['strategyPermission'] = 'unknown';
      if (running) {
        const extensionPage = running.context.pages().find((page) => {
          try {
            return new URL(page.url()).host === running.extensionId;
          } catch {
            return false;
          }
        });
        const extensionRuntime = extensionPage ?? running.context.serviceWorkers()[0];
        if (extensionRuntime) {
          const runtimeState = await extensionRuntime.evaluate(async (requiredOrigins) => {
            const extensionGlobal = globalThis as typeof globalThis & {
              chrome: {
                storage: {
                  local: {
                    get(key: string): Promise<Record<string, unknown>>;
                  };
                };
                permissions: {
                  contains(permission: { origins: string[] }): Promise<boolean>;
                };
              };
            };
            const key = 'collector.gateway-pairing.v1';
            return {
              paired: Boolean((await extensionGlobal.chrome.storage.local.get(key))[key]),
              permission: await extensionGlobal.chrome.permissions.contains({ origins: requiredOrigins })
            };
          }, [...resolveNativeSearchStrategy(profile.platform).browser.optionalHostPermissions]).catch(() => null);
          extensionPaired = runtimeState?.paired ?? false;
          strategyPermission = runtimeState?.permission ? 'granted' : 'missing';
        }
      }
      summaries.push({
        profile,
        running: Boolean(running),
        extensionLoaded: Boolean(running),
        extensionVersion: running?.extensionVersion ?? null,
        extensionAdoption: running?.extensionAdoption ?? null,
        extensionPaired,
        strategyPermission
      });
    }
    return summaries;
  }

  async launch(profileId: string): Promise<BrowserProfileRuntimeSummary> {
    await this.#runtime.launch(profileId);
    return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
  }

  async runBilibiliAnonymousValidation(
    profileId: string,
    rawQuery: string,
    knownRunIds: ReadonlySet<string> = new Set()
  ): Promise<CapabilityValidationRunSnapshot> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'validation') throw new Error('validation_profile_kind_required');
    if (profile.platform !== 'bilibili') throw new Error('validation_profile_platform_mismatch');
    if (profile.account.category !== 'anonymous') throw new Error('validation_profile_anonymous_required');
    const query = rawQuery.replace(/\s+/g, ' ').trim();
    if (!query || query.length > 200) throw new Error('validation_query_invalid');

    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('validation_browser_not_running');
    const controlPage = await this.#runtime.controlPage(profileId);
    const queryDigest = createHash('sha256').update(query).digest('hex');
    const recoverable: CapabilityValidationRunSnapshot[] = [];
    for (const candidate of await extensionStoredValidationRuns(controlPage, 'collector.capability-validation.')) {
      if (!candidate || typeof candidate !== 'object') continue;
      const partial = candidate as Partial<CapabilityValidationRunSnapshot>;
      if (
        typeof partial.runId !== 'string' ||
        knownRunIds.has(partial.runId) ||
        partial.queryDigest !== queryDigest ||
        (partial.state !== 'completed' && partial.state !== 'inconclusive' && partial.state !== 'failed')
      ) {
        continue;
      }
      try {
        recoverable.push(validationSnapshot(
          { ok: true, validation: candidate },
          partial.runId,
          profileId,
          running.extensionVersion
        ));
      } catch {
        // Invalid session values are never returned to the Gateway registry.
      }
    }
    recoverable.sort((left, right) => Date.parse(right.completedAt ?? '') - Date.parse(left.completedAt ?? ''));
    if (recoverable[0]) return recoverable[0];

    const strategy = resolveNativeSearchStrategy('bilibili');
    if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
      await controlPage.bringToFront();
      const card = controlPage.locator('[data-platform="bilibili"]');
      await card.getByRole('button', { name: '授予站点权限' }).click({ timeout: 15_000 });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions)) break;
        await delay(500);
      }
      if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
        throw new Error('validation_host_permission_user_action_required');
      }
    }

    const runId = randomUUID();
    let snapshot = validationSnapshot(await extensionMessage(controlPage, {
      type: 'collector.startCapabilityValidation',
      runId,
      profileId,
      platform: 'bilibili',
      accountCategory: 'anonymous',
      query
    }), runId, profileId, running.extensionVersion);

    for (let attempt = 0; attempt < 70; attempt += 1) {
      if (snapshot.state === 'completed' || snapshot.state === 'inconclusive' || snapshot.state === 'failed') {
        return snapshot;
      }
      await delay(500);
      snapshot = validationSnapshot(await extensionMessage(controlPage, {
        type: 'collector.getCapabilityValidation',
        runId
      }), runId, profileId, running.extensionVersion);
    }
    throw new Error('validation_gateway_wait_timed_out');
  }

  async runBilibiliAnonymousDetailValidation(
    profileId: string,
    rawCanonicalUrl: string,
    knownRunIds: ReadonlySet<string> = new Set()
  ): Promise<DetailCapabilityValidationRunSnapshot> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'validation') throw new Error('detail_validation_profile_kind_required');
    if (profile.platform !== 'bilibili') throw new Error('detail_validation_profile_platform_mismatch');
    if (profile.account.category !== 'anonymous') throw new Error('detail_validation_profile_anonymous_required');
    const canonicalUrl = canonicalBilibiliVideoUrl(rawCanonicalUrl);
    if (!canonicalUrl) throw new Error('detail_validation_url_invalid');

    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('detail_validation_browser_not_running');
    const controlPage = await this.#runtime.controlPage(profileId);
    const targetUrlDigest = createHash('sha256').update(canonicalUrl).digest('hex');
    const recoverable: DetailCapabilityValidationRunSnapshot[] = [];
    for (const candidate of await extensionStoredValidationRuns(
      controlPage,
      'collector.detail-capability-validation.'
    )) {
      if (!candidate || typeof candidate !== 'object') continue;
      const partial = candidate as Partial<DetailCapabilityValidationRunSnapshot>;
      if (
        typeof partial.runId !== 'string' ||
        knownRunIds.has(partial.runId) ||
        partial.targetUrlDigest !== targetUrlDigest ||
        (partial.state !== 'completed' && partial.state !== 'inconclusive' && partial.state !== 'failed')
      ) continue;
      try {
        recoverable.push(detailValidationSnapshot(
          { ok: true, validation: candidate },
          partial.runId,
          profileId,
          running.extensionVersion
        ));
      } catch {
        // Invalid session values are never returned to the Gateway registry.
      }
    }
    recoverable.sort((left, right) => Date.parse(right.completedAt ?? '') - Date.parse(left.completedAt ?? ''));
    if (recoverable[0]) return recoverable[0];

    const strategy = resolveDetailStrategy('bilibili');
    if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
      await controlPage.bringToFront();
      const card = controlPage.locator('[data-platform="bilibili"]');
      await card.getByRole('button', { name: '授予站点权限' }).click({ timeout: 15_000 });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions)) break;
        await delay(500);
      }
      if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
        throw new Error('detail_validation_host_permission_user_action_required');
      }
    }

    const runId = randomUUID();
    let snapshot = detailValidationSnapshot(await extensionMessage(controlPage, {
      type: 'collector.startDetailCapabilityValidation',
      runId,
      profileId,
      platform: 'bilibili',
      accountCategory: 'anonymous',
      canonicalUrl
    }), runId, profileId, running.extensionVersion);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (snapshot.state === 'completed' || snapshot.state === 'inconclusive' || snapshot.state === 'failed') {
        return snapshot;
      }
      await delay(500);
      snapshot = detailValidationSnapshot(await extensionMessage(controlPage, {
        type: 'collector.getDetailCapabilityValidation',
        runId
      }), runId, profileId, running.extensionVersion);
    }
    throw new Error('detail_validation_gateway_wait_timed_out');
  }

  async runBilibiliAuthenticatedTranscriptValidation(
    profileId: string,
    rawCanonicalUrl: string
  ): Promise<TranscriptCapabilityValidationRunSnapshot> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'collection') throw new Error('transcript_validation_collection_kind_required');
    if (profile.platform !== 'bilibili') throw new Error('transcript_validation_platform_mismatch');
    if (profile.account.category !== 'user_managed') {
      throw new Error('transcript_validation_user_managed_required');
    }
    const canonicalUrl = canonicalBilibiliVideoUrl(rawCanonicalUrl);
    if (!canonicalUrl) throw new Error('transcript_validation_url_invalid');
    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('transcript_validation_browser_not_running');
    const controlPage = await this.#runtime.controlPage(profileId);
    const strategy = resolveTranscriptStrategy('bilibili');
    if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
      throw new Error('transcript_validation_host_permission_user_action_required');
    }
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profileId,
      'bilibili',
      'authenticated_transcript_validation'
    );
    let snapshot: TranscriptCapabilityValidationRunSnapshot;
    try {
      await this.#accountSafety.recordActionAttempt(
        profileId,
        'bilibili',
        permit.runId,
        'navigate_transcript_target'
      );
      snapshot = await runTranscriptValidationControlLoop({
        runId: permit.runId,
        profileId,
        canonicalUrl,
        extensionVersion: running.extensionVersion,
        sendMessage: (message) => extensionMessage(controlPage, message),
        executeInteraction: () => executeBilibiliTranscriptInteraction({
          context: running.context,
          canonicalUrl,
          beforeAction: (actionId) => this.#accountSafety.recordActionAttempt(
            profileId,
            'bilibili',
            permit.runId,
            actionId
          ).then(() => undefined)
        })
      });
      const finishReason = snapshot.state === 'completed'
        ? 'authenticated_transcript_validation_completed'
        : snapshot.terminalStatus === 'verification_required'
          ? 'transcript_validation_verification_required'
          : snapshot.terminalStatus === 'rate_limited'
            ? 'transcript_validation_rate_limited'
            : snapshot.errorCode ?? 'authenticated_transcript_validation_inconclusive';
      await this.#accountSafety.finishAuthenticatedRun(
        profileId,
        'bilibili',
        permit.runId,
        finishReason
      );
      return snapshot;
    } catch (error) {
      const safety = this.#accountSafety.get(profileId, 'bilibili');
      if (safety.state === 'running' && safety.activeRun?.runId === permit.runId) {
        const candidate = error instanceof Error ? error.message : '';
        await this.#accountSafety.finishAuthenticatedRun(
          profileId,
          'bilibili',
          permit.runId,
          /^[a-z0-9_]{1,100}$/.test(candidate)
            ? candidate
            : 'authenticated_transcript_validation_failed'
        );
      }
      throw error;
    }
  }

  async runBilibiliAnonymousDetailReconnaissance(
    profileId: string,
    rawCanonicalUrl: string
  ): Promise<BilibiliDetailSourceReconnaissanceRecord> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'validation') throw new Error('source_reconnaissance_profile_kind_required');
    if (profile.platform !== 'bilibili') throw new Error('source_reconnaissance_profile_platform_mismatch');
    if (profile.account.category !== 'anonymous') {
      throw new Error('source_reconnaissance_profile_anonymous_required');
    }
    const canonicalUrl = canonicalBilibiliVideoUrl(rawCanonicalUrl);
    if (!canonicalUrl) throw new Error('source_reconnaissance_url_invalid');

    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('source_reconnaissance_browser_not_running');
    const controlPage = await this.#runtime.controlPage(profileId);
    const strategy = resolveDetailStrategy('bilibili');
    if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
      await controlPage.bringToFront();
      const card = controlPage.locator('[data-platform="bilibili"]');
      await card.getByRole('button', { name: '授予站点权限' }).click({ timeout: 15_000 });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions)) break;
        await delay(500);
      }
      if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
        throw new Error('source_reconnaissance_host_permission_user_action_required');
      }
    }

    const runId = randomUUID();
    const observer = new BilibiliDetailSourceObserver({
      context: running.context,
      runId,
      profileId,
      collectorVersion: running.extensionVersion,
      canonicalUrl
    });
    observer.start();

    let snapshot: DetailCapabilityValidationRunSnapshot | null = null;
    let failureCode: string | null = null;
    try {
      snapshot = detailValidationSnapshot(await extensionMessage(controlPage, {
        type: 'collector.startDetailCapabilityValidation',
        runId,
        profileId,
        platform: 'bilibili',
        accountCategory: 'anonymous',
        canonicalUrl
      }), runId, profileId, running.extensionVersion);
      observer.recordExtensionSnapshot(snapshot);

      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (snapshot.state === 'completed' || snapshot.state === 'inconclusive' || snapshot.state === 'failed') break;
        await delay(500);
        snapshot = detailValidationSnapshot(await extensionMessage(controlPage, {
          type: 'collector.getDetailCapabilityValidation',
          runId
        }), runId, profileId, running.extensionVersion);
        observer.recordExtensionSnapshot(snapshot);
      }
      if (snapshot.state !== 'completed' && snapshot.state !== 'inconclusive' && snapshot.state !== 'failed') {
        failureCode = 'source_reconnaissance_validation_wait_timed_out';
      } else {
        // Keep a short, bounded tail after DOM terminal readiness so initial
        // page-state XHR/fetch can be compared with the completed DOM without
        // turning reconnaissance into an open-ended network monitor.
        await delay(5_000);
      }
    } catch (error) {
      failureCode = sourceReconnaissanceErrorCode(error);
    }
    return observer.finish(snapshot, failureCode);
  }

  async pairProfileWithGateway(
    profileId: string,
    input: ManagedProfilePairingInput
  ): Promise<BrowserProfileRuntimeSummary> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'collection') throw new Error('profile_collection_kind_required');
    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('profile_browser_not_running');
    const controlPage = await this.#runtime.controlPage(profileId);
    const current = await extensionControlSnapshot(controlPage);
    if (current.pairing?.gatewayInstanceId === input.gatewayInstanceId) {
      return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
    }
    if (current.pairing) throw new Error('profile_gateway_pairing_conflict');

    await controlPage.bringToFront();
    await controlPage.locator('input[name="gateway-origin"]').fill(input.loopbackOrigin);
    await controlPage.locator('input[name="pairing-session-id"]').fill(input.pairingSessionId);
    await controlPage.locator('input[name="pairing-code"]').fill(input.pairingCode);
    await controlPage.getByRole('button', { name: '核验并配对' }).click({ timeout: 15_000 });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await delay(500);
      const snapshot = await extensionControlSnapshot(controlPage).catch(() => null);
      if (snapshot?.pairing?.gatewayInstanceId === input.gatewayInstanceId) {
        return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
      }
      const error = await controlPage.locator('#control-error:not([hidden])').textContent().catch(() => null);
      if (error) throw new Error('profile_gateway_pairing_user_action_required');
    }
    throw new Error('profile_gateway_pairing_user_action_required');
  }

  async requestStrategyPermission(profileId: string): Promise<BrowserProfileRuntimeSummary> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'collection') throw new Error('profile_collection_kind_required');
    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('profile_browser_not_running');
    const controlPage = await this.#runtime.controlPage(profileId);
    const strategy = resolveNativeSearchStrategy(profile.platform);
    if (await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions)) {
      return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
    }

    await controlPage.bringToFront();
    const card = controlPage.locator(`[data-platform="${profile.platform}"]`);
    await card.getByRole('button', { name: '授予站点权限' }).click({ timeout: 15_000 });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions)) {
        return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
      }
      const error = await controlPage.locator('#control-error:not([hidden])').textContent().catch(() => null);
      if (error) throw new Error('profile_strategy_permission_user_action_required');
      await delay(500);
    }
    throw new Error('profile_strategy_permission_user_action_required');
  }

  async pollGatewayTasks(profileId: string): Promise<BrowserProfileRuntimeSummary> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'collection') throw new Error('profile_collection_kind_required');
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('profile_browser_not_running');
    const controlPage = await this.#runtime.controlPage(profileId);
    const response = await extensionMessage(controlPage, { type: POLL_GATEWAY_TASKS });
    if (!response || typeof response !== 'object' || (response as { ok?: unknown }).ok !== true) {
      throw new Error('profile_gateway_poll_failed');
    }
    return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
  }

  async openPlatformLoginPage(profileId: string): Promise<BrowserProfileRuntimeSummary> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'collection') throw new Error('profile_login_collection_kind_required');
    if (profile.account.category !== 'user_managed') throw new Error('profile_login_user_managed_required');
    const loginEntrypoint = platformLoginEntrypoint(profile.platform);
    await this.#accountSafety.assertPlatformNavigationAllowed(profileId, profile.platform);

    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('profile_browser_not_running');

    const existing = running.context.pages().find((page) => isPlatformLoginPage(page, profile.platform));
    const page = existing ?? await running.context.newPage();
    try {
      if (!existing) {
        await page.goto(loginEntrypoint, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      }
      await page.bringToFront();
    } catch (error) {
      if (!existing) await page.close().catch(() => undefined);
      throw error;
    }

    return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
  }

  async inspectPlatformLoginStatus(profileId: string): Promise<PlatformLoginStatusSnapshot> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'collection') throw new Error('profile_login_collection_kind_required');
    if (profile.account.category !== 'user_managed') throw new Error('profile_login_user_managed_required');
    const homeEntrypoint = platformHomeEntrypoint(profile.platform);
    await this.#accountSafety.assertPlatformNavigationAllowed(profileId, profile.platform);

    await this.launch(profileId);
    const running = this.#runtime.get(profileId);
    if (!running) throw new Error('profile_browser_not_running');

    const page = await running.context.newPage();
    try {
      await page.goto(homeEntrypoint, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (profile.platform !== 'bilibili') throw new Error('profile_login_status_unsupported');
      return await inspectBilibiliLoginStatus(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async runBilibiliAuthenticatedInteractionReconnaissance(
    profileId: string,
    rawCanonicalUrl: string,
    actionScope: 'subtitle' | 'discussion' | 'all',
    responseBodyMapping: 'disabled' | 'schema_only'
  ): Promise<BilibiliInteractionReconnaissanceRecord> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'collection') throw new Error('interaction_reconnaissance_collection_kind_required');
    if (profile.platform !== 'bilibili') throw new Error('interaction_reconnaissance_platform_mismatch');
    if (profile.account.category !== 'user_managed') {
      throw new Error('interaction_reconnaissance_user_managed_required');
    }
    const canonicalUrl = canonicalBilibiliVideoUrl(rawCanonicalUrl);
    if (!canonicalUrl) throw new Error('interaction_reconnaissance_url_invalid');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profileId,
      profile.platform,
      'authenticated_interaction_reconnaissance'
    );
    try {
      await this.launch(profileId);
      const running = this.#runtime.get(profileId);
      if (!running) throw new Error('interaction_reconnaissance_browser_not_running');
      const result = await new BilibiliInteractionReconnaissanceRunner({
        context: running.context,
        runId: permit.runId,
        profileId,
        collectorVersion: running.extensionVersion,
        canonicalUrl,
        actionScope,
        responseBodyMapping,
        beforeAction: async (actionId) => {
          await this.#accountSafety.recordActionAttempt(
            profileId,
            profile.platform,
            permit.runId,
            actionId
          );
        }
      }).run();
      await this.#accountSafety.finishAuthenticatedRun(
        profileId,
        profile.platform,
        permit.runId,
        result.errorCode ?? (result.state === 'completed'
          ? 'authenticated_run_completed'
          : 'authenticated_run_inconclusive')
      );
      return result;
    } catch (error) {
      const candidate = error instanceof Error ? error.message : '';
      const reasonCode = /^[a-z0-9_]{1,100}$/.test(candidate)
        ? candidate
        : 'authenticated_run_failed';
      await this.#accountSafety.finishAuthenticatedRun(
        profileId,
        profile.platform,
        permit.runId,
        reasonCode
      ).catch(() => undefined);
      throw error;
    }
  }

  async close(profileId: string): Promise<void> {
    await this.#runtime.close(profileId);
  }

  async closeAll(): Promise<void> {
    await this.#runtime.closeAll();
  }
}
