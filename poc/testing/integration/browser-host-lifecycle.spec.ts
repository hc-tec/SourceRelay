import { expect, test } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeVerifier } from '../support/run-node-verifier.js';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const verifierPath = resolve(pocRoot, 'collector-browser-host', 'scripts', 'verify-real-browser-lifecycle.mjs');

test('Browser Host manages a production Chromium page pool without platform navigation', async () => {
  const { report } = await runNodeVerifier({
    scriptPath: verifierPath,
    cwd: pocRoot,
    timeoutMs: 110_000
  });

  expect(report).toMatchObject({
    ok: true,
    gate: 'browser-host-real-chromium-managed-page-lifecycle',
    livePlatformRequests: 0,
    nativeMessagingBridgeConnected: true,
    hostCreatedPagesBoundToExtensionTabs: true,
    repeatedLaunchDidNotCreateSecondBrowser: true,
    releasedPageReused: true,
    retainedPageProtected: true,
    retainedPageVisualEvidenceReadOnly: true,
    commandReplayDidNotRepeatNavigation: true,
    testScopedExplicitCleanup: true
  });
});
