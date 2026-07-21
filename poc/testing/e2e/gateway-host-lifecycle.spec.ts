import { expect, test } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeVerifier } from '../support/run-node-verifier.js';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const verifierPath = resolve(pocRoot, 'collector-gateway', 'scripts', 'verify-real-browser-host-integration.mjs');

test('Gateway and Browser Host lifecycle runs through actual production processes', async () => {
  const { report } = await runNodeVerifier({
    scriptPath: verifierPath,
    cwd: pocRoot,
    timeoutMs: 110_000
  });

  expect(report).toMatchObject({
    ok: true,
    gate: 'gateway-real-browser-host-lifecycle',
    livePlatformRequests: 0,
    gatewayExitDidNotCloseHost: true,
    gatewayExitDidNotCloseBrowser: true,
    reconnectPreservedHostPid: true,
    reconnectPreservedBrowserPid: true,
    reconnectPreservedBrowserSession: true,
    extensionNativeBridgeConnected: true,
    crossSiteProfileCreationRejected: true,
    profileClosedOnlyByExplicitRequest: true,
    hostExitedOnlyByExplicitRequest: true,
    testScopedExplicitCleanup: true
  });
});
