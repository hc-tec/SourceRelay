import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Worker } from 'playwright';
import {
  COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY,
  type CollectorNativeBridgeConfig,
  type ExtensionRuntimeExpectation,
  type ExtensionRuntimeSummary
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';

const WORKER_WAIT_MS = 15_000;
const LOCAL_POLL_MS = 100;
const RELOAD_SETTLE_MS = 500;

interface ExtensionWorkerProbe {
  worker: Worker;
  extensionId: string;
  manifestVersion: string;
  runtimeVersion: string | null;
  controlSurfaceRevision: number | null;
  buildFingerprint: string | null;
}

export interface ExtensionPreparation {
  extensionId: string;
  initialManifestVersion: string;
  initialRuntimeVersion: string | null;
  initialControlSurfaceRevision: number | null;
  initialBuildFingerprint: string | null;
  reloadAttempted: boolean;
}

export async function prepareExtensionRuntime(input: {
  expectation: ExtensionRuntimeExpectation;
  launchProbeContext: () => Promise<BrowserContext>;
}): Promise<ExtensionPreparation> {
  const firstContext = await input.launchProbeContext();
  let initial: ExtensionWorkerProbe;
  try {
    const observed = await waitForWorker(firstContext, input.expectation.runtimeBootstrapKey, WORKER_WAIT_MS);
    if (!observed) throw extensionError('collector_extension_worker_missing');
    initial = observed;
    if (workerMatches(observed, input.expectation)) return preparation(observed, false);
    await requestWorkerReload(observed.worker);
    await delay(RELOAD_SETTLE_MS);
  } finally {
    await firstContext.close().catch(() => undefined);
  }

  const verificationContext = await input.launchProbeContext();
  try {
    const verified = await waitForWorker(
      verificationContext,
      input.expectation.runtimeBootstrapKey,
      WORKER_WAIT_MS,
      (probe) => workerMatches(probe, input.expectation)
    );
    if (!verified || verified.extensionId !== initial.extensionId) {
      throw extensionError('collector_extension_worker_version_mismatch', initial, input.expectation);
    }
    return {
      ...preparation(initial, true),
      extensionId: verified.extensionId
    };
  } finally {
    await verificationContext.close().catch(() => undefined);
  }
}

export async function adoptVisibleExtension(input: {
  context: BrowserContext;
  expectation: ExtensionRuntimeExpectation;
  preparation: ExtensionPreparation;
}): Promise<{ worker: Worker; summary: ExtensionRuntimeSummary }> {
  const probe = await waitForWorker(
    input.context,
    input.expectation.runtimeBootstrapKey,
    WORKER_WAIT_MS,
    (candidate) => workerMatches(candidate, input.expectation)
  );
  if (!probe || probe.extensionId !== input.preparation.extensionId) {
    throw extensionError('collector_extension_visible_worker_mismatch', probe, input.expectation);
  }
  return {
    worker: probe.worker,
    summary: {
      extensionId: probe.extensionId,
      expectedVersion: input.expectation.version,
      expectedControlSurfaceRevision: input.expectation.controlSurfaceRevision,
      expectedBuildFingerprint: input.expectation.buildFingerprint,
      initialManifestVersion: input.preparation.initialManifestVersion,
      initialRuntimeVersion: input.preparation.initialRuntimeVersion,
      initialControlSurfaceRevision: input.preparation.initialControlSurfaceRevision,
      initialBuildFingerprint: input.preparation.initialBuildFingerprint,
      finalManifestVersion: probe.manifestVersion,
      finalRuntimeVersion: probe.runtimeVersion!,
      finalControlSurfaceRevision: probe.controlSurfaceRevision!,
      finalBuildFingerprint: probe.buildFingerprint!,
      headlessProbePerformed: true,
      headlessProbeNetworkMode: 'offline',
      reloadAttempted: input.preparation.reloadAttempted,
      visibleContextRestarted: false,
      nativeBridgeConnected: false
    }
  };
}

export async function configureNativeBridge(worker: Worker, config: CollectorNativeBridgeConfig): Promise<void> {
  await worker.evaluate(async ({ key, value }) => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: { storage: { session: { set(items: Record<string, unknown>): Promise<void> } } };
    };
    await extensionGlobal.chrome.storage.session.set({ [key]: value });
  }, { key: COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY, value: config });
}

async function waitForWorker(
  context: BrowserContext,
  runtimeBootstrapKey: string,
  timeoutMs: number,
  predicate: (probe: ExtensionWorkerProbe) => boolean = () => true
): Promise<ExtensionWorkerProbe | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const worker of context.serviceWorkers()) {
      const probe = await probeWorker(worker, runtimeBootstrapKey);
      if (probe && predicate(probe)) return probe;
    }
    await delay(LOCAL_POLL_MS);
  } while (Date.now() < deadline);
  return null;
}

async function probeWorker(worker: Worker, runtimeBootstrapKey: string): Promise<ExtensionWorkerProbe | null> {
  const snapshot = await worker.evaluate(async (key) => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: {
        runtime: { id: string; getManifest(): { version?: unknown } };
        storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
      };
    };
    const stored = await extensionGlobal.chrome.storage.session.get(key);
    return {
      extensionId: extensionGlobal.chrome.runtime.id,
      manifestVersion: extensionGlobal.chrome.runtime.getManifest().version,
      runtimeBootstrap: stored[key]
    };
  }, runtimeBootstrapKey).catch(() => null);
  if (!snapshot ||
    typeof snapshot.extensionId !== 'string' || !/^[a-p]{32}$/.test(snapshot.extensionId) ||
    typeof snapshot.manifestVersion !== 'string') return null;
  const bootstrap = snapshot.runtimeBootstrap && typeof snapshot.runtimeBootstrap === 'object'
    ? snapshot.runtimeBootstrap as {
        schemaVersion?: unknown;
        collectorVersion?: unknown;
        controlSurfaceRevision?: unknown;
        buildFingerprint?: unknown;
      }
    : null;
  return {
    worker,
    extensionId: snapshot.extensionId,
    manifestVersion: snapshot.manifestVersion,
    runtimeVersion: bootstrap?.schemaVersion === 1 && typeof bootstrap.collectorVersion === 'string'
      ? bootstrap.collectorVersion
      : null,
    controlSurfaceRevision: bootstrap?.schemaVersion === 1 && typeof bootstrap.controlSurfaceRevision === 'number'
      ? bootstrap.controlSurfaceRevision
      : null,
    buildFingerprint: bootstrap?.schemaVersion === 1 && typeof bootstrap.buildFingerprint === 'string'
      ? bootstrap.buildFingerprint
      : null
  };
}

function workerMatches(probe: ExtensionWorkerProbe, expectation: ExtensionRuntimeExpectation): boolean {
  return probe.manifestVersion === expectation.version &&
    probe.runtimeVersion === expectation.version &&
    probe.controlSurfaceRevision === expectation.controlSurfaceRevision &&
    probe.buildFingerprint === expectation.buildFingerprint;
}

function preparation(probe: ExtensionWorkerProbe, reloadAttempted: boolean): ExtensionPreparation {
  return {
    extensionId: probe.extensionId,
    initialManifestVersion: probe.manifestVersion,
    initialRuntimeVersion: probe.runtimeVersion,
    initialControlSurfaceRevision: probe.controlSurfaceRevision,
    initialBuildFingerprint: probe.buildFingerprint,
    reloadAttempted
  };
}

async function requestWorkerReload(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const extensionGlobal = globalThis as typeof globalThis & { chrome: { runtime: { reload(): void } } };
    extensionGlobal.chrome.runtime.reload();
  }).catch(() => undefined);
}

function extensionError(
  code: string,
  observed?: ExtensionWorkerProbe | null,
  expected?: ExtensionRuntimeExpectation
) {
  return hostError({
    code,
    category: 'extension_runtime',
    scope: 'browser_session',
    profileSafetyDisposition: 'host_blocked',
    safeDetails: {
      expectedVersion: expected?.version ?? null,
      expectedControlSurfaceRevision: expected?.controlSurfaceRevision ?? null,
      expectedBuildFingerprint: expected?.buildFingerprint ?? null,
      observedManifestVersion: observed?.manifestVersion ?? null,
      observedRuntimeVersion: observed?.runtimeVersion ?? null,
      observedControlSurfaceRevision: observed?.controlSurfaceRevision ?? null,
      observedBuildFingerprint: observed?.buildFingerprint ?? null
    }
  });
}
