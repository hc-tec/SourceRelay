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
    npmArgs: ['run', 'verify:lifecycle', '--workspace', '@intelligence/collector-browser-host']
  },
  {
    id: 'strategy-binding',
    scope: 'real local Chromium MV3 and Native Messaging strategy binding',
    npmArgs: ['run', 'verify:strategy-binding', '--workspace', '@intelligence/collector-browser-host']
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
    id: 'gateway-host-integration',
    scope: 'real local Gateway to Browser Host reconnect lifecycle',
    npmArgs: ['run', 'verify:host-integration', '--workspace', '@intelligence/collector-gateway']
  }
]);

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
  for (const lane of lanes) await runLane(lane);
  console.log(JSON.stringify({
    ok: true,
    gate: 'collector-local-validation-suite',
    livePlatformRequests: 0,
    realExecutionSurface: {
      chromium: true,
      mv3: true,
      nativeMessaging: true,
      gatewayHostReconnect: true
    },
    livePlatformCanaryExcluded: true,
    lanes: lanes.map((lane) => ({ id: lane.id, scope: lane.scope }))
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
