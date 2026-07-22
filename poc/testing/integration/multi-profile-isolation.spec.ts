import { expect, test } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeVerifier } from '../support/run-node-verifier.js';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const verifierPath = resolve(pocRoot, 'collector-browser-host', 'scripts', 'verify-real-multi-profile-isolation.mjs');

test('Browser Host isolates two production MV3 Profiles and their Native Messaging registrations', async () => {
  const { report } = await runNodeVerifier({
    scriptPath: verifierPath,
    cwd: pocRoot,
    timeoutMs: 110_000
  });

  expect(report).toMatchObject({
    ok: true,
    gate: 'browser-host-real-multi-profile-isolation',
    livePlatformRequests: 0,
    twoProductionMv3ProfilesStarted: true,
    browserSessionsAndProcessesIsolated: true,
    nativeMessagingRegistrationsIsolated: true,
    profileLocalPageAliasesRejectedForeignLease: true,
    controllerDisconnectQuarantinedBothProfilesWithoutClosingBrowsers: true,
    closingOneProfileDidNotCloseTheOther: true,
    nativeMessagingRegistrationsCleanedPerProfile: true,
    testScopedProcessResidue: 0,
    testScopedExplicitCleanup: true
  });
});
