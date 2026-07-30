import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = typeof process.env.npm_execpath === 'string' && process.env.npm_execpath.length > 0
  ? process.env.npm_execpath
  : null;

/**
 * This is the canonical local-only validation spine. Every lane uses the
 * production packages and, where browser behavior matters, a real Chromium +
 * MV3 + Native Messaging execution surface. No lane may navigate a platform
 * or use an authenticated Collection Profile.
 *
 * A real platform canary is deliberately excluded: it has its own bounded
 * action budget, account-safety preflight, and evidence record.
 */
const skipPlaywrightOwned = process.argv.includes('--skip-playwright-owned');

const lanes = Object.freeze([
  {
    id: 'contracts-build',
    scope: 'shared contract compilation',
    npmArgs: ['run', 'build:contracts']
  },
  {
    id: 'extension-production-build',
    scope: 'MV3 typecheck, production bundle, artifact and load gates',
    npmArgs: ['run', 'verify:build', '--workspace', '@intelligence/collector-extension']
  },
  {
    id: 'extension-research-projectors',
    scope: 'research-only transcript projector regression without platform requests',
    npmArgs: ['run', 'verify:research-projectors', '--workspace', '@intelligence/collector-extension']
  },
  {
    id: 'browser-host-typecheck',
    scope: 'Browser Host and shared contract typecheck',
    npmArgs: ['run', 'typecheck:browser-host']
  },
  {
    id: 'browser-host-build',
    scope: 'Browser Host production bundle',
    npmArgs: ['run', 'build:browser-host']
  },
  {
    id: 'browser-host-lifecycle',
    scope: 'real local Chromium page pool, lease, input and lifecycle',
    npmArgs: ['run', 'verify:lifecycle', '--workspace', '@intelligence/collector-browser-host'],
    playwrightOwned: true
  },
  {
    id: 'browser-host-extension-runtime-rejection',
    scope: 'real production MV3 worker mismatch fails before profile and Native Messaging startup',
    npmArgs: ['run', 'verify:extension-runtime-rejection', '--workspace', '@intelligence/collector-browser-host'],
    playwrightOwned: true
  },
  {
    id: 'browser-host-multi-profile-isolation',
    scope: 'two real production MV3 Profiles keep Native Messaging, leases and close lifecycles isolated',
    npmArgs: ['run', 'verify:multi-profile-isolation', '--workspace', '@intelligence/collector-browser-host'],
    playwrightOwned: true
  },
  {
    id: 'strategy-binding',
    scope: 'real local Chromium MV3 and Native Messaging strategy binding',
    npmArgs: ['run', 'verify:strategy-binding', '--workspace', '@intelligence/collector-browser-host'],
    playwrightOwned: true
  },
  {
    id: 'gateway-build-and-contracts',
    scope: 'Gateway typecheck, account safety, artifacts and source contracts',
    npmArgs: ['run', 'verify:build', '--workspace', '@intelligence/collector-gateway']
  },
  {
    id: 'gateway-task-resume',
    scope: 'task safety resume state machine',
    npmArgs: ['run', 'verify:task-resume', '--workspace', '@intelligence/collector-gateway']
  },
  {
    id: 'gateway-research-contracts',
    scope: 'research-only account, article, series and transcript contract regression',
    npmArgs: ['run', 'verify:research-contracts', '--workspace', '@intelligence/collector-gateway']
  },
  {
    id: 'user-browser-deployment-lifecycle',
    scope: 'production user-browser extension prepare, idempotence, stale-build detection and atomic replacement',
    npmArgs: ['run', 'verify:user-browser-deployment']
  },
  {
    id: 'user-browser-api-smoke',
    scope: 'real local Gateway SDK compatibility, scope, operation admission and artifact boundary',
    npmArgs: ['run', 'verify:user-browser-api-smoke']
  },
  {
    id: 'sdk-release-installation',
    scope: 'versioned JS tarball and Python wheel installation outside the Core source checkout',
    npmArgs: ['run', 'verify:sdk-release-installation']
  },
  {
    id: 'gateway-host-integration',
    scope: 'real local Gateway to Browser Host reconnect lifecycle',
    npmArgs: ['run', 'verify:host-integration', '--workspace', '@intelligence/collector-gateway'],
    playwrightOwned: true
  }
]);

// The canonical Collector command runs these real Chromium processes through
// Playwright first so their project classification, timeout and artifact rules
// are recorded in one place. Keeping the original standalone lanes runnable
// preserves their focused developer entry points without opening a second
// identical browser session during the aggregate suite.
const selectedLanes = skipPlaywrightOwned
  ? lanes.filter((lane) => lane.playwrightOwned !== true)
  : lanes;

async function runLane(lane) {
  if (!npmCli) throw new Error('local_validation_npm_cli_unavailable');
  process.stdout.write('\n[local-validation] ' + lane.id + ': ' + lane.scope + '\n');
  await new Promise((resolveLane, rejectLane) => {
    const child = spawn(process.execPath, [npmCli, ...lane.npmArgs], {
      cwd: workspaceRoot,
      stdio: 'inherit',
      windowsHide: true
    });
    child.once('error', rejectLane);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveLane();
        return;
      }
      rejectLane(new Error(
        'local_validation_lane_failed:' + lane.id + ':exit=' + String(code) + ':signal=' + String(signal)
      ));
    });
  });
}

try {
  for (const lane of selectedLanes) await runLane(lane);
  console.log(JSON.stringify({
    ok: true,
    gate: 'collector-local-validation-suite',
    livePlatformRequests: 0,
    realExecutionSurface: skipPlaywrightOwned
      ? {
        chromium: 'delegated_to_playwright',
        mv3: 'delegated_to_playwright',
        nativeMessaging: 'delegated_to_playwright',
        gatewayHostReconnect: 'delegated_to_playwright'
      }
      : {
        chromium: true,
        mv3: true,
        nativeMessaging: true,
        gatewayHostReconnect: true
      },
    livePlatformCanaryExcluded: true,
    lanes: selectedLanes.map((lane) => ({ id: lane.id, scope: lane.scope })),
    skippedPlaywrightOwnedLanes: skipPlaywrightOwned
      ? lanes.filter((lane) => lane.playwrightOwned === true).map((lane) => lane.id)
      : []
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : 'local_validation_suite_failed';
  console.error(JSON.stringify({
    ok: false,
    gate: 'collector-local-validation-suite',
    livePlatformRequests: 0,
    error: message
  }, null, 2));
  process.exitCode = 1;
}
