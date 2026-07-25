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
await assertProductionExtension(sourceDirectory);
await mkdir(homeDirectory, { recursive: true });

if (await pathExists(targetDirectory) && !replace) {
  process.stdout.write(JSON.stringify({
    ok: true,
    state: 'already_prepared',
    extensionDirectory: targetDirectory,
    nextAction: 'load_this_unchanged_directory_in_chrome_or_edge'
  }, null, 2) + '\n');
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
  await access(resolve(directory, 'runtime-build.json'));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
