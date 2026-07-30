import { access, cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pocRoot = resolve(gatewayRoot, '..');
const sourceDirectory = resolve(pocRoot, 'collector-extension', 'dist');
const homeDirectory = userBrowserHomeDirectory();
const targetDirectory = resolve(homeDirectory, 'extension');
const replace = process.argv.slice(2).includes('--replace');

await access(sourceDirectory);
const sourceRuntimeBuild = await assertProductionExtension(sourceDirectory);
await mkdir(homeDirectory, { recursive: true });

if (await pathExists(targetDirectory) && !replace) {
  const targetRuntimeBuild = await readRuntimeBuild(targetDirectory);
  if (targetRuntimeBuild?.buildFingerprint === sourceRuntimeBuild.buildFingerprint) {
    process.stdout.write(JSON.stringify({
      ok: true,
      state: 'already_prepared',
      extensionDirectory: targetDirectory,
      runtimeBuild: sourceRuntimeBuild,
      nextAction: 'load_this_unchanged_directory_in_chrome_or_edge'
    }, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify({
      ok: true,
      state: 'update_required',
      extensionDirectory: targetDirectory,
      currentRuntimeBuild: targetRuntimeBuild,
      availableRuntimeBuild: sourceRuntimeBuild,
      nextAction: 'rerun_with_replace_then_reload_the_extension_in_the_host_browser'
    }, null, 2) + '\n');
  }
} else {
  const stagingDirectory = resolve(homeDirectory, '.extension-staging-' + process.pid);
  await rm(stagingDirectory, { recursive: true, force: true });
  try {
    await cp(sourceDirectory, stagingDirectory, { recursive: true, force: false, errorOnExist: true });
    await assertProductionExtension(stagingDirectory);
    if (replace) await rm(targetDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, targetDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    state: 'prepared',
    extensionDirectory: targetDirectory,
    runtimeBuild: sourceRuntimeBuild,
    nextAction: 'load_this_unchanged_directory_in_chrome_or_edge'
  }, null, 2) + '\n');
}

function userBrowserHomeDirectory() {
  const configured = process.env.COLLECTOR_USER_BROWSER_HOME?.trim();
  if (configured) return resolve(configured);
  const localAppData = process.env.LOCALAPPDATA?.trim() || resolve(homedir(), 'AppData', 'Local');
  return resolve(localAppData, 'PersonalIntelligenceCollector');
}

async function assertProductionExtension(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest?.manifest_version !== 3 || manifest?.background?.service_worker !== 'background.js') {
    throw new Error('user_browser_extension_artifact_invalid');
  }
  await access(resolve(directory, 'background.js'));
  await access(resolve(directory, 'control.html'));
  const runtimeBuild = await readRuntimeBuild(directory);
  if (runtimeBuild?.schemaVersion !== 1 || typeof runtimeBuild.collectorVersion !== 'string' ||
    typeof runtimeBuild.buildFingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(runtimeBuild.buildFingerprint)) {
    throw new Error('user_browser_extension_runtime_build_invalid');
  }
  return runtimeBuild;
}

async function readRuntimeBuild(directory) {
  try {
    return JSON.parse(await readFile(resolve(directory, 'runtime-build.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
