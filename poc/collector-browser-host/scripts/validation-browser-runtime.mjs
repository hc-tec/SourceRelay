import { spawn } from 'node:child_process';
import { access, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  browserHostEndpointPath,
  browserHostMainModulePath,
  browserHostStateDirectory,
  browserProfileRoot,
  extensionDirectory,
  publicRuntime,
  readExtensionRuntimeExpectation,
  runtimeMatches,
  validationAutomationProfileId,
  validationBrowserPaths,
  validationProfileId
} from './validation-browser-config.mjs';

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pocRoot = resolve(hostRoot, '..');
const PROFILE_START_TIMEOUT_MS = 60_000;

export { validationBrowserPaths };

export async function startValidationBrowser() {
  const expected = await readExtensionRuntimeExpectation();
  const { BrowserHostClient, launchBrowserHost } = await browserHostApi();
  await launchBrowserHost({
    mainModulePath: browserHostMainModulePath,
    stateDirectory: browserHostStateDirectory,
    profileRoot: browserProfileRoot,
    extensionDirectory,
    validationAutomationProfileId,
    endpointPath: browserHostEndpointPath,
    timeoutMs: 30_000
  });
  // A normal start is a non-disruptive query first. It must not take over an
  // in-flight test controller merely to discover that the visible fixture is
  // already healthy.
  const observer = await BrowserHostClient.connectObserver(browserHostEndpointPath, 'validation-browser-start-observer');
  let snapshot;
  try {
    snapshot = await observer.command({ type: 'get_snapshot' });
    const profile = profileFrom(snapshot);
    if (profile?.running && runtimeMatches(profile.extensionRuntime, expected)) {
      return resultFor('reused', profile, expected);
    }
    if (profile?.running) {
      // `start` is intentionally non-disruptive.  A developer may invoke it
      // just to discover a running validation browser; it must never turn
      // that harmless status-like action into a visible close/reopen cycle.
      // The only command allowed to replace this test fixture is the
      // explicitly named `rebuild` command below.
      throw new Error('validation_browser_runtime_mismatch_requires_explicit_rebuild');
    }
  } finally {
    observer.close();
  }

  const client = await BrowserHostClient.connect(browserHostEndpointPath, 'validation-browser-controller');
  try {
    snapshot = await client.command({ type: 'get_snapshot' });
    let profile = profileFrom(snapshot);
    if (profile?.running && runtimeMatches(profile.extensionRuntime, expected)) {
      return resultFor('reused', profile, expected);
    }
    if (profile?.running) {
      throw new Error('validation_browser_runtime_mismatch_requires_explicit_rebuild');
    }
    snapshot = await client.command({
      type: 'launch_profile',
      request: {
        profileId: validationProfileId,
        maximumManagedPages: 1,
        headless: false,
        // Startup stays on the local extension/control surface. Keeping the
        // Profile online allows later, explicitly initiated live recon runs.
        offlineOnly: false,
        extensionRuntime: expected
      }
    }, { timeoutMs: PROFILE_START_TIMEOUT_MS });
    profile = profileFrom(snapshot);
    if (!profile?.running || !runtimeMatches(profile.extensionRuntime, expected)) {
      throw new Error('validation_browser_extension_runtime_mismatch');
    }
    if (profile.livePlatformRequests !== 0) {
      throw new Error('validation_browser_boot_made_platform_request');
    }
    return resultFor('started', profile, expected);
  } finally {
    client.close();
  }
}

export async function validationBrowserStatus() {
  const expected = await readExtensionRuntimeExpectation();
  const connected = await connectExistingHost('observer');
  if (!connected) return { ok: true, state: 'not_running', runtime: publicRuntime(expected, null) };
  try {
    const snapshot = await connected.client.command({ type: 'get_snapshot' });
    const profile = profileFrom(snapshot);
    if (!profile?.running) return { ok: true, state: 'not_running', runtime: publicRuntime(expected, null) };
    return {
      ok: runtimeMatches(profile.extensionRuntime, expected),
      state: runtimeMatches(profile.extensionRuntime, expected) ? 'ready' : 'runtime_mismatch',
      lifecycle: 'browser_host_managed_persistent_context',
      profileClass: 'isolated_validation_profile',
      runtime: publicRuntime(expected, profile.extensionRuntime),
      browser: publicBrowser(profile),
      livePlatformRequests: profile.livePlatformRequests
    };
  } finally {
    connected.client.close();
  }
}

export async function stopValidationBrowser() {
  const connected = await connectExistingHost();
  if (!connected) return { ok: true, state: 'not_running' };
  try {
    const snapshot = await connected.client.command({ type: 'get_snapshot' });
    if (profileFrom(snapshot)?.running) {
      await connected.client.command({ type: 'close_profile', profileId: validationProfileId });
    }
    await connected.client.command({ type: 'shutdown_host' });
  } finally {
    connected.client.close();
  }
  await waitForHostStop(connected.processId);
  return { ok: true, state: 'stopped' };
}

export async function rebuildValidationBrowser() {
  const stopped = await stopValidationBrowser();
  await runBuild('build:contracts');
  await runBuild('build:extension');
  await runBuild('build:browser-host');
  const started = await startValidationBrowser();
  return { ...started, action: 'rebuilt_and_started', previousBrowser: stopped.state };
}

async function connectExistingHost(connectionMode = 'controller') {
  let endpoint;
  try {
    endpoint = JSON.parse(await readFile(browserHostEndpointPath, 'utf8'));
  } catch {
    return null;
  }
  const processId = Number.isSafeInteger(endpoint?.processId) ? endpoint.processId : null;
  try {
    const { BrowserHostClient } = await browserHostApi();
    const client = connectionMode === 'observer'
      ? await BrowserHostClient.connectObserver(browserHostEndpointPath, 'validation-browser-status')
      : await BrowserHostClient.connect(browserHostEndpointPath, 'validation-browser-controller');
    return { client, processId };
  } catch {
    if (!isLiveProcess(processId)) {
      await rm(browserHostEndpointPath, { force: true }).catch(() => undefined);
      return null;
    }
    throw new Error('validation_browser_host_unreachable');
  }
}

async function browserHostApi() {
  await access(browserHostMainModulePath);
  return await import('../dist/client.js');
}

function profileFrom(snapshot) {
  return snapshot.profiles?.find((candidate) => candidate.profileId === validationProfileId) ?? null;
}

function resultFor(action, profile, expected) {
  return {
    ok: true,
    action,
    state: 'ready',
    lifecycle: 'browser_host_managed_persistent_context',
    profileClass: 'isolated_validation_profile',
    runtime: publicRuntime(expected, profile.extensionRuntime),
    browser: publicBrowser(profile),
    livePlatformRequests: profile.livePlatformRequests
  };
}

function publicBrowser(profile) {
  return {
    mode: 'visible_playwright_persistent_context',
    browserProcessId: profile.browserProcessId,
    browserHostControl: 'authenticated_local_ipc',
    extensionPages: profile.extensionPages,
    unmanagedPages: profile.unmanagedPages
  };
}

async function waitForHostStop(processId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!isLiveProcess(processId)) return;
    await delay(100);
  }
  if (isLiveProcess(processId)) throw new Error('validation_browser_host_shutdown_timeout');
}

function isLiveProcess(processId) {
  if (!processId) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function runBuild(script) {
  const commands = {
    'build:contracts': [
      resolve(pocRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      resolve(pocRoot, 'collector-contracts', 'tsconfig.build.json')
    ],
    'build:extension': [resolve(pocRoot, 'collector-extension', 'scripts', 'build.mjs')],
    'build:browser-host': [resolve(pocRoot, 'collector-browser-host', 'scripts', 'build.mjs')]
  };
  const args = commands[script];
  if (!args) throw new Error('validation_browser_build_command_invalid');
  const child = spawn(process.execPath, args, { cwd: pocRoot, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode) => resolvePromise(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`validation_browser_${script}_failed`);
}
