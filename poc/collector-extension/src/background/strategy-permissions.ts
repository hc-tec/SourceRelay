import type { StrategyPermissionSnapshot } from '../shared/control-plane';
import {
  STATIC_PLATFORM_STRATEGIES,
  strategyProvenance,
  type StaticPlatformStrategy
} from '../shared/strategy-registry';

const LEGACY_DYNAMIC_SCRIPT_PREFIX = 'collector-strategy';

function uniquePlatformStrategies(): StaticPlatformStrategy[] {
  const byPlatform = new Map(STATIC_PLATFORM_STRATEGIES.map((strategy) => [strategy.platform, strategy]));
  return [...byPlatform.values()];
}

async function hasRequiredOrigins(strategy: StaticPlatformStrategy): Promise<boolean> {
  return chrome.permissions.contains({ origins: [...strategy.browser.optionalHostPermissions] });
}

export async function synchroniseStrategyContentScripts(): Promise<void> {
  // Platform scripts are injected only into an exact task-bound tab. Remove
  // any registration created by an earlier POC so a granted host permission
  // never causes collection code to enter unrelated user tabs.
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const managedIds = existing
    .map((registration) => registration.id)
    .filter((id) => id.startsWith(`${LEGACY_DYNAMIC_SCRIPT_PREFIX}-`));
  if (managedIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: managedIds });
  }
}

export async function strategyPermissionSnapshots(): Promise<StrategyPermissionSnapshot[]> {
  const snapshots: StrategyPermissionSnapshot[] = [];
  for (const strategy of uniquePlatformStrategies()) {
    snapshots.push({
      platform: strategy.platform,
      strategy: strategyProvenance(strategy),
      requiredOrigins: strategy.browser.optionalHostPermissions,
      granted: await hasRequiredOrigins(strategy),
      domExecution: 'task_document_only',
      responseObservation: strategy.approvedResponseRouteIds.length > 0 ? 'task_document_only' : 'disabled'
    });
  }
  return snapshots;
}
