import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pocRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const home = await mkdtemp(join(tmpdir(), 'collector-user-browser-deployment-'));
const environment = {
  ...process.env,
  COLLECTOR_USER_BROWSER_HOME: home
};

try {
  const prepared = await runNpm(['run', 'prepare:user-browser-deployment'], environment);
  assertState(prepared, 'prepared');
  const preparedBuild = JSON.parse(await readFile(join(home, 'extension', 'runtime-build.json'), 'utf8'));

  const alreadyPrepared = await runNpm(['run', 'prepare:user-browser-deployment'], environment);
  assertState(alreadyPrepared, 'already_prepared');

  const targetPath = join(home, 'extension', 'runtime-build.json');
  await writeFile(targetPath, JSON.stringify({ ...preparedBuild, buildFingerprint: '0'.repeat(64) }, null, 2), 'utf8');
  const updateRequired = await runNpm(['run', 'prepare:user-browser-deployment'], environment);
  assertState(updateRequired, 'update_required');

  const replaced = await runNpm(['run', 'update:user-browser-deployment'], environment);
  assertState(replaced, 'prepared');
  const restoredBuild = JSON.parse(await readFile(targetPath, 'utf8'));
  if (restoredBuild.buildFingerprint !== preparedBuild.buildFingerprint) throw new Error('user_browser_deployment_replace_failed');

  const stateEntries = await readdir(home);
  for (const forbidden of ['profiles', 'browser-host', 'browser-profiles.json']) {
    if (stateEntries.includes(forbidden)) throw new Error('user_browser_deployment_created_legacy_state');
  }
  console.log(JSON.stringify({
    ok: true,
    gate: 'user-browser-deployment-lifecycle',
    prepared: true,
    sameBuildIsIdempotent: true,
    staleBuildRequiresExplicitUpdate: true,
    replacementIsAtomic: true,
    browserProcessStarted: false,
    livePlatformRequests: 0
  }, null, 2));
} finally {
  await rm(home, { recursive: true, force: true });
}

function assertState(output, expected) {
  const states = [...output.matchAll(/"state"\s*:\s*"([a-z_]+)"/g)].map((match) => match[1]);
  const state = states.at(-1);
  if (state !== expected) throw new Error(`user_browser_deployment_state_unexpected:${state}:${expected}`);
}

function runNpm(args, env) {
  const command = process.env.npm_execpath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  return new Promise((resolveRun, rejectRun) => {
    let output = '';
    const child = spawn(command, commandArgs, { cwd: pocRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (chunk) => { output += String(chunk); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0
      ? resolveRun(output)
      : rejectRun(new Error(`user_browser_deployment_command_failed:${code ?? signal}`)));
  });
}
