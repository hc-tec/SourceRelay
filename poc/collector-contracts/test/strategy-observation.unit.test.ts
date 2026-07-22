import { describe, expect, test } from 'vitest';
import {
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  BILIBILI_DYNAMIC_STRATEGY_ID,
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  isBridgeJsonValue,
  isCollectorExtensionBridgeCommandResult,
  isCollectorHostBridgeCommand,
  NATIVE_BRIDGE_MAX_MESSAGE_BYTES,
  NATIVE_BRIDGE_PROTOCOL_VERSION
} from '@intelligence/collector-contracts';

const longId = 'identifier-that-is-at-least-sixteen-characters';
const expiry = '2030-01-01T00:01:00.000Z';

function bindingFor(strategyId: string): Record<string, unknown> {
  const base = {
    schemaVersion: 1,
    profileId: 'profile-1',
    pageAlias: 'page-1',
    pageLeaseId: longId,
    expectedRecordVersion: 1,
    runId: `${longId}-run`,
    observerBindingId: `${longId}-binding`,
    expiresAt: expiry,
    maximumPayloadBytes: 64 * 1024
  };
  if (strategyId === BILIBILI_DYNAMIC_STRATEGY_ID) {
    return {
      ...base,
      strategyId,
      target: {
        stableAccountId: '7481602',
        canonicalUrl: 'https://space.bilibili.com/7481602/dynamic'
      },
      maximumResponseObservations: 1
    };
  }
  if (strategyId === BILIBILI_VIDEO_DETAIL_STRATEGY_ID) {
    return {
      ...base,
      strategyId,
      target: {
        bvid: 'BV1qZSLBYEpa',
        canonicalUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      },
      maximumResponseObservations: 0
    };
  }
  if (strategyId === BILIBILI_NATIVE_SEARCH_STRATEGY_ID) {
    return {
      ...base,
      strategyId,
      target: {
        canonicalUrl: 'https://search.bilibili.com/all?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD'
      },
      maximumResponseObservations: 0
    };
  }
  return {
    ...base,
    strategyId,
    target: {
      stableAccountId: '7481602',
      canonicalUrl: 'https://space.bilibili.com/7481602/upload/video'
    },
    maximumResponseObservations: 0
  };
}

function hostCommand(binding: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'collector_host_bridge_command',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    profileId: 'profile-1',
    browserSessionId: 'session-1',
    commandId: `${longId}-command`,
    issuedAt: '2026-07-22T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
    command: {
      type: 'collector_bind_strategy_observer',
      tabId: 1,
      nextDocumentGeneration: 1,
      binding
    }
  };
}

describe('Strategy observation contract guards', () => {
  test('accepts exactly the target and observation budget assigned to each strategy', () => {
    for (const strategyId of [
      BILIBILI_DYNAMIC_STRATEGY_ID,
      BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
      BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
      BILIBILI_NATIVE_SEARCH_STRATEGY_ID
    ]) {
      expect(isCollectorHostBridgeCommand(hostCommand(bindingFor(strategyId)))).toBe(true);
    }

    const dynamicWrongRoute = bindingFor(BILIBILI_DYNAMIC_STRATEGY_ID);
    dynamicWrongRoute.target = {
      stableAccountId: '7481602',
      canonicalUrl: 'https://space.bilibili.com/7481602/dynamic?from=unsafe'
    };
    expect(isCollectorHostBridgeCommand(hostCommand(dynamicWrongRoute))).toBe(false);

    const videoWithResponseBudget = bindingFor(BILIBILI_VIDEO_DETAIL_STRATEGY_ID);
    videoWithResponseBudget.maximumResponseObservations = 1;
    expect(isCollectorHostBridgeCommand(hostCommand(videoWithResponseBudget))).toBe(false);

    const inventoryWithDynamicRoute = bindingFor(BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID);
    inventoryWithDynamicRoute.target = {
      stableAccountId: '7481602',
      canonicalUrl: 'https://space.bilibili.com/7481602/dynamic'
    };
    expect(isCollectorHostBridgeCommand(hostCommand(inventoryWithDynamicRoute))).toBe(false);

    const nativeSearchWithExtraQuery = bindingFor(BILIBILI_NATIVE_SEARCH_STRATEGY_ID);
    nativeSearchWithExtraQuery.target = {
      canonicalUrl: 'https://search.bilibili.com/all?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&from_source=unsafe'
    };
    expect(isCollectorHostBridgeCommand(hostCommand(nativeSearchWithExtraQuery))).toBe(false);
  });

  test('rejects expired binding, oversized payload budgets, and invalid document generations', () => {
    const expired = bindingFor(BILIBILI_DYNAMIC_STRATEGY_ID);
    expired.expiresAt = '2020-01-01T00:00:00.000Z';
    expect(isCollectorHostBridgeCommand(hostCommand(expired))).toBe(false);

    const oversized = bindingFor(BILIBILI_DYNAMIC_STRATEGY_ID);
    oversized.maximumPayloadBytes = 192 * 1024 + 1;
    expect(isCollectorHostBridgeCommand(hostCommand(oversized))).toBe(false);

    const command = hostCommand(bindingFor(BILIBILI_DYNAMIC_STRATEGY_ID));
    command.command = {
      ...(command.command as Record<string, unknown>),
      nextDocumentGeneration: 0
    };
    expect(isCollectorHostBridgeCommand(command)).toBe(false);
  });

  test('admits only the two fixed document binding modes', () => {
    const nextNavigationOnly = bindingFor(BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID);
    nextNavigationOnly.documentBindingMode = 'next_navigation_only';
    expect(isCollectorHostBridgeCommand(hostCommand(nextNavigationOnly))).toBe(true);

    const unsafeMode = bindingFor(BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID);
    unsafeMode.documentBindingMode = 'accept_any_document';
    expect(isCollectorHostBridgeCommand(hostCommand(unsafeMode))).toBe(false);
  });

  test('accepts a bounded observation result and rejects duplicate tabs or unsafe response payloads', () => {
    const base = {
      type: 'collector_extension_bridge_command_result',
      protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
      profileId: 'profile-1',
      browserSessionId: 'session-1',
      commandId: `${longId}-command`,
      ok: true
    };
    expect(isCollectorExtensionBridgeCommandResult({
      ...base,
      result: { type: 'collector_extension_tab_inventory', schemaVersion: 1, tabIds: [1, 2] }
    })).toBe(true);
    expect(isCollectorExtensionBridgeCommandResult({
      ...base,
      result: { type: 'collector_extension_tab_inventory', schemaVersion: 1, tabIds: [1, 1] }
    })).toBe(false);

    const observation = {
      type: 'collector_strategy_observation',
      schemaVersion: 1,
      strategyId: BILIBILI_DYNAMIC_STRATEGY_ID,
      observerBindingId: `${longId}-binding`,
      pageAlias: 'page-1',
      documentGeneration: 1,
      routeGeneration: 0,
      capturedAt: '2026-07-22T00:00:00.000Z',
      payloadBytes: 24,
      payload: { cards: [{ title: 'visible public text' }] }
    };
    expect(isCollectorExtensionBridgeCommandResult({ ...base, result: observation })).toBe(true);
    expect(isCollectorExtensionBridgeCommandResult({
      ...base,
      result: { ...observation, payloadBytes: NATIVE_BRIDGE_MAX_MESSAGE_BYTES + 1 }
    })).toBe(false);
    expect(isCollectorExtensionBridgeCommandResult({
      ...base,
      result: { ...observation, payload: { constructor: 'unsafe' } }
    })).toBe(false);
  });

  test('keeps bridge JSON finite, bounded, and prototype-safe', () => {
    expect(isBridgeJsonValue({ list: [null, true, 1, 'visible'] })).toBe(true);
    expect(isBridgeJsonValue(Number.NaN)).toBe(false);
    expect(isBridgeJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isBridgeJsonValue({ '': 'empty-key' })).toBe(false);
    expect(isBridgeJsonValue(JSON.parse('{"prototype":"unsafe"}'))).toBe(false);
  });
});
