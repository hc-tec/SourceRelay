import type { StrategyPermissionSnapshot } from '../shared/control-plane';
import {
  STATIC_PLATFORM_STRATEGIES,
  strategyProvenance,
  type StaticPlatformStrategy
} from '../shared/strategy-registry';

const LEGACY_DYNAMIC_SCRIPT_PREFIX = 'collector-strategy';

function strategiesByPlatform(): Array<{
  platform: StaticPlatformStrategy['platform'];
  strategies: StaticPlatformStrategy[];
}> {
  const grouped = new Map<StaticPlatformStrategy['platform'], StaticPlatformStrategy[]>();
  for (const strategy of STATIC_PLATFORM_STRATEGIES) {
    grouped.set(strategy.platform, [...(grouped.get(strategy.platform) ?? []), strategy]);
  }
  return [...grouped].map(([platform, strategies]) => ({ platform, strategies }));
}

async function hasRequiredOrigins(origins: readonly string[]): Promise<boolean> {
  return chrome.permissions.contains({ origins: [...origins] });
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
  for (const group of strategiesByPlatform()) {
    const strategy = group.strategies[0];
    const requiredOrigins = [...new Set(group.strategies.flatMap(
      (candidate) => candidate.browser.optionalHostPermissions
    ))];
    snapshots.push({
      platform: group.platform,
      strategy: strategyProvenance(strategy),
      capabilities: group.strategies.map(strategyProvenance),
      requiredOrigins,
      granted: await hasRequiredOrigins(requiredOrigins),
      domExecution: 'task_document_only',
      responseObservation: group.strategies.some((candidate) => candidate.approvedResponseRouteIds.length > 0)
        ? 'task_document_only'
        : 'disabled'
    });
  }
  return snapshots;
}
