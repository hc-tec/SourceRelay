import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pocRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const verificationRoot = await mkdtemp(join(tmpdir(), 'collector-sdk-release-install-'));
const releaseDirectory = join(verificationRoot, 'release');
const jsConsumer = join(verificationRoot, 'js-consumer');
const pythonEnvironment = join(verificationRoot, 'python-venv');

try {
  await runNpm(['run', 'package:core-release', '--', '--output', releaseDirectory], pocRoot);
  const manifest = JSON.parse(await readFile(join(releaseDirectory, 'release-manifest.json'), 'utf8'));
  if (manifest.releaseVersion !== '0.7.17' || manifest.boundaries?.browserMode !== 'user_owned_browser_only') {
    throw new Error('sdk_release_manifest_invalid');
  }

  await writeFile(join(verificationRoot, 'js-package.json'), JSON.stringify({
    name: 'collector-sdk-release-consumer',
    private: true,
    type: 'module',
    dependencies: { '@intelligence/collector-client': `file:${join(releaseDirectory, 'npm', manifest.packages.javascriptSdk)}` }
  }, null, 2), 'utf8');
  await runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', jsConsumer,
    `file:${join(releaseDirectory, 'npm', manifest.packages.javascriptSdk)}`], verificationRoot);
  const jsProbe = await runNodeProbe(jsConsumer, `import { CORE_RELEASE_VERSION, CORE_SERVICE_SCHEMA_VERSION, createClientRequestId, listDirectCapabilities, bilibiliVideoDetail } from '@intelligence/collector-client';
if (CORE_RELEASE_VERSION !== '0.7.17' || CORE_SERVICE_SCHEMA_VERSION !== 3 || listDirectCapabilities().length !== 15) throw new Error('js_sdk_release_probe_failed');
const request = bilibiliVideoDetail({ clientRequestId: createClientRequestId(), browserBindingId: '11111111-1111-4111-8111-111111111111', canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' });
if (request.schemaVersion !== 3 || request.capability !== 'bilibili.video_detail' || typeof request.clientRequestId !== 'string') throw new Error('js_sdk_builder_probe_failed');
console.log(JSON.stringify({ ok: true, release: CORE_RELEASE_VERSION, directCapabilities: listDirectCapabilities().length }));`);
  if (!jsProbe.includes('"ok":true')) throw new Error('js_sdk_release_probe_invalid');

  await runPython(['-m', 'venv', pythonEnvironment], verificationRoot);
  const pythonExecutable = process.platform === 'win32' ? join(pythonEnvironment, 'Scripts', 'python.exe') : join(pythonEnvironment, 'bin', 'python');
  await runPythonExecutable(pythonExecutable, ['-m', 'pip', 'install', '--disable-pip-version-check', 'httpx>=0.28,<1'], verificationRoot);
  await runPythonExecutable(pythonExecutable, ['-m', 'pip', 'install', '--no-index', '--find-links', join(releaseDirectory, 'python'), `intelligence-collector-client==${manifest.releaseVersion}`], verificationRoot);
  const pythonProbe = await runPythonExecutable(pythonExecutable, ['-c', "from intelligence_collector import CORE_RELEASE_VERSION, CORE_SERVICE_SCHEMA_VERSION, create_client_request_id, list_direct_capabilities, bilibili_video_detail; assert CORE_RELEASE_VERSION == '0.7.17'; assert CORE_SERVICE_SCHEMA_VERSION == 3; assert len(list_direct_capabilities()) == 15; request = bilibili_video_detail(client_request_id=create_client_request_id(), browser_binding_id='11111111-1111-4111-8111-111111111111', canonical_video_url='https://www.bilibili.com/video/BV1qZSLBYEpa'); assert request['schemaVersion'] == 3 and request['capability'] == 'bilibili.video_detail' and isinstance(request['clientRequestId'], str); print('{\\\"ok\\\":true,\\\"release\\\":\\\"' + CORE_RELEASE_VERSION + '\\\",\\\"directCapabilities\\\":' + str(len(list_direct_capabilities())) + '}')"], verificationRoot);
  if (!pythonProbe.includes('"ok":true')) throw new Error('python_sdk_release_probe_invalid');

  console.log(JSON.stringify({
    ok: true,
    gate: 'collector-sdk-release-installation',
    releaseVersion: manifest.releaseVersion,
    jsSdkInstalledFromArtifact: true,
    pythonSdkInstalledFromArtifact: true,
    sourceCheckoutImports: false,
    livePlatformRequests: 0
  }, null, 2));
} finally {
  await rm(verificationRoot, { recursive: true, force: true });
}

function runNpm(args, cwd) {
  const command = process.env.npm_execpath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  return run(command, commandArgs, cwd);
}

function runNodeProbe(cwd, source) {
  return run(process.execPath, ['--input-type=module', '-e', source], cwd);
}

function runPython(args, cwd) {
  return run(process.platform === 'win32' ? 'python.exe' : 'python3', args, cwd);
}

function runPythonExecutable(command, args, cwd) {
  return run(command, args, cwd);
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    let output = '';
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (chunk) => { output += String(chunk); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0
      ? resolveRun(output)
      : rejectRun(new Error(`sdk_release_command_failed:${command}:${code ?? signal}`)));
  });
}
