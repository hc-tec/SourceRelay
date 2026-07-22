import { expect, test } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeVerifier } from '../support/run-node-verifier.js';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const verifierPath = resolve(
  pocRoot,
  'collector-browser-host',
  'scripts',
  'verify-real-extension-runtime-rejection.mjs'
);

test('Browser Host rejects a production MV3 worker version mismatch before profile launch', async () => {
  const { report } = await runNodeVerifier({
    scriptPath: verifierPath,
    cwd: pocRoot,
    timeoutMs: 110_000
  });

  expect(report).toMatchObject({
    ok: true,
    gate: 'browser-host-real-extension-runtime-rejection',
    livePlatformRequests: 0,
    actualProductionWorkerObserved: true,
    workerVersionMismatchRejected: true,
    versionMismatchRejectedBeforeProfileRegistration: true,
    visibleContextNotLaunched: true,
    nativeMessagingNeverInstalled: true,
    journalHasNoProfileLaunched: true,
    testScopedProcessResidue: 0,
    testScopedExplicitCleanup: true
  });
});
