import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { GatewayIdentityConfig } from './identity';

export interface UserBrowserGatewayConfig extends GatewayIdentityConfig {
  displayName: string;
  deploymentMode: 'user_owned_browser_extension';
}

const LEGACY_RUNTIME_ENVIRONMENT_KEYS = [
  'COLLECTOR_BROWSER_HOST_MAIN',
  'COLLECTOR_BROWSER_HOST_STATE_DIR',
  'COLLECTOR_BROWSER_HOST_ENDPOINT',
  'COLLECTOR_BROWSER_HEADLESS',
  'COLLECTOR_BROWSER_PROXY_SERVER'
] as const;

const LEGACY_STATE_ENTRIES = [
  'profiles',
  'browser-profiles.json',
  'browser-host'
] as const;

/**
 * Production configuration for the user-owned browser model.  It intentionally
 * has no extension path, Browser Host executable, proxy, Chromium, or Profile
 * fields: an installed MV3 extension is the browser-side runtime.
 */
export function loadUserBrowserGatewayConfig(): UserBrowserGatewayConfig {
  assertNoLegacyRuntimeEnvironment();
  const displayName = (process.env.COLLECTOR_GATEWAY_NAME ?? 'Local Collector Gateway').trim();
  if (!displayName || displayName.length > 80) {
    throw new Error('collector_gateway_name_invalid');
  }
  return {
    host: '127.0.0.1',
    port: gatewayPort(process.env.COLLECTOR_GATEWAY_PORT),
    displayName,
    stateDirectory: userBrowserStateDirectory(),
    deploymentMode: 'user_owned_browser_extension'
  };
}

/**
 * Reject accidental reuse of a legacy Browser Host state root.  Reading that
 * state would blur the ownership boundary even when no Chromium is launched.
 */
export async function assertUserBrowserStateIsolation(stateDirectory: string): Promise<void> {
  for (const entry of LEGACY_STATE_ENTRIES) {
    try {
      await lstat(resolve(stateDirectory, entry));
      throw new Error('user_browser_state_contains_legacy_runtime');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function defaultUserBrowserHomeDirectory(): string {
  const configured = process.env.COLLECTOR_USER_BROWSER_HOME?.trim();
  if (configured) return resolve(configured);
  const localAppData = process.env.LOCALAPPDATA?.trim() || resolve(homedir(), 'AppData', 'Local');
  return resolve(localAppData, 'PersonalIntelligenceCollector');
}

function userBrowserStateDirectory(): string {
  const configured = process.env.COLLECTOR_USER_BROWSER_STATE_DIR?.trim() ||
    process.env.COLLECTOR_GATEWAY_STATE_DIR?.trim();
  return resolve(configured || resolve(defaultUserBrowserHomeDirectory(), 'gateway'));
}

function gatewayPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 43_127;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error('collector_gateway_port_invalid');
  }
  return parsed;
}

function assertNoLegacyRuntimeEnvironment(): void {
  for (const key of LEGACY_RUNTIME_ENVIRONMENT_KEYS) {
    if (process.env[key]?.trim()) throw new Error('user_browser_legacy_runtime_environment_rejected');
  }
}
