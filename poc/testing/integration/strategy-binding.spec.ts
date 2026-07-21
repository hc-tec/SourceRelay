import { expect, test } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeVerifier } from '../support/run-node-verifier.js';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const verifierPath = resolve(pocRoot, 'collector-browser-host', 'scripts', 'verify-real-strategy-binding.mjs');

test('production Browser Host and MV3 complete a zero-navigation strategy binding round trip', async () => {
  const { report } = await runNodeVerifier({
    scriptPath: verifierPath,
    cwd: pocRoot,
    timeoutMs: 110_000
  });

  expect(report).toMatchObject({
    ok: true,
    gate: 'browser-host-real-chromium-strategy-observer-binding',
    platformNavigationCount: 0,
    livePlatformRequests: 0,
    nativeMessagingBridgeConnected: true,
    hostToExtensionStrategyCommandRoundTripCompleted: true,
    videoDetailDomOnlyBindingRoundTripCompleted: true,
    accountVideoInventoryDomOnlyBindingRoundTripCompleted: true,
    runLeaseMismatchRejectedBeforeExtensionDispatch: true,
    recordVersionMismatchRejectedBeforeExtensionDispatch: true,
    testScopedExplicitCleanup: true
  });
});
