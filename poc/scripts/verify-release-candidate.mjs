import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(sourceRoot, '..');
const branch = await git(['branch', '--show-current'], repositoryRoot);
if (!branch) throw new Error('release_candidate_branch_unavailable');

const checkout = await mkdtemp(join(tmpdir(), 'collector-core-release-candidate-'));
const userHome = join(checkout, 'runtime', 'user-browser');
const stateDirectory = join(userHome, 'gateway');
const port = 43127 + (process.pid % 200);
let gateway = null;

try {
  await git(['clone', '--no-local', '--branch', branch, repositoryRoot, checkout], repositoryRoot);
  const environment = {
    ...process.env,
    COLLECTOR_USER_BROWSER_HOME: userHome,
    COLLECTOR_USER_BROWSER_STATE_DIR: stateDirectory,
    COLLECTOR_GATEWAY_PORT: String(port)
  };

  await runNpm(['ci'], sourceRootIn(checkout), environment);
  await runNpm(['run', 'verify:core-boundaries'], sourceRootIn(checkout), environment);
  await runNpm(['run', 'verify:core-capability-matrix'], sourceRootIn(checkout), environment);
  await runNpm(['run', 'build:user-browser-runtime'], sourceRootIn(checkout), environment);
  await runNpm(['run', 'prepare:user-browser-deployment'], sourceRootIn(checkout), environment);

  gateway = spawn(process.execPath, ['collector-gateway/dist/user-browser-server.js'], {
    cwd: sourceRootIn(checkout),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  gateway.stdout.on('data', (chunk) => process.stdout.write(`[release-gateway] ${chunk}`));
  gateway.stderr.on('data', (chunk) => process.stderr.write(`[release-gateway] ${chunk}`));
  const origin = `http://127.0.0.1:${port}`;
  await waitForGateway(origin);

  const release = await readJson(origin + '/v2/release');
  const capabilities = await readJson(origin + '/v2/capabilities');
  const openapi = await readJson(origin + '/v2/openapi.json');
  if (release?.boundaries?.browserMode !== 'user_owned_browser_only' || release?.boundaries?.arbitraryBrowserControl !== 'not_exposed') {
    throw new Error('release_candidate_deployment_boundary_invalid');
  }
  if (!Array.isArray(capabilities?.capabilities) || capabilities.capabilities.filter((entry) => entry?.dispatchState === 'direct_ready').length !== 15) {
    throw new Error('release_candidate_capability_catalog_invalid');
  }
  if (openapi?.info?.version !== release?.service?.openApiVersion) {
    throw new Error('release_candidate_openapi_release_mismatch');
  }
  await assertNoLegacyProfileState(stateDirectory);
  await access(join(userHome, 'extension', 'manifest.json'));
  console.log(JSON.stringify({
    ok: true,
    gate: 'collector-core-release-candidate',
    branch,
    releaseVersion: release.releaseVersion,
    directCapabilities: 15,
    browserProfileCreated: false,
    livePlatformRequests: 0
  }, null, 2));
} finally {
  if (gateway && gateway.exitCode === null) gateway.kill('SIGTERM');
  await rm(checkout, { recursive: true, force: true });
}

function sourceRootIn(checkoutRoot) {
  return join(checkoutRoot, 'poc');
}

async function waitForGateway(origin) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin + '/v2/release', { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* process is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('release_candidate_gateway_start_timeout');
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`release_candidate_endpoint_failed:${url}:${response.status}`);
  return payload;
}

async function assertNoLegacyProfileState(directory) {
  let entries = [];
  try { entries = await readdir(directory); } catch { return; }
  for (const name of entries) {
    if (name === 'profiles' || name === 'browser-profiles.json' || name === 'browser-host') {
      throw new Error('release_candidate_created_legacy_profile_state');
    }
  }
}

function runNpm(args, cwd, env) {
  return new Promise((resolveRun, rejectRun) => {
    const npmCli = env.npm_execpath;
    const child = npmCli
      ? spawn(process.execPath, [npmCli, ...args], { cwd, env, stdio: 'inherit', windowsHide: true })
      : spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`release_candidate_command_failed:${args.join(' ')}:${code ?? signal}`)));
  });
}

function git(args, cwd) {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn(process.platform === 'win32' ? 'git.exe' : 'git', args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', rejectGit);
    child.once('exit', (code) => code === 0
      ? resolveGit(stdout.trim())
      : rejectGit(new Error(`release_candidate_git_failed:${stderr.trim()}`)));
  });
}
