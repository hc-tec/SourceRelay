import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { writeJsonAtomic, writeTextAtomic } from '../atomic-file.js';
import { childPath } from '../validation.js';

const execFileAsync = promisify(execFile);
const REGISTRY_ROOTS = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  'HKCU\\Software\\Chromium\\NativeMessagingHosts'
] as const;

export interface NativeMessagingHostRegistration {
  nativeHostName: string;
  extensionOrigin: string;
  manifestPath: string;
  uninstall(): Promise<void>;
}

export async function installNativeMessagingHost(input: {
  stateDirectory: string;
  endpointPath: string;
  bridgeModulePath: string;
  profileId: string;
  browserSessionId: string;
  extensionId: string;
}): Promise<NativeMessagingHostRegistration> {
  if (process.platform !== 'win32') throw new Error('native_messaging_installer_platform_unsupported');
  const extensionOrigin = `chrome-extension://${input.extensionId}/`;
  const identityDigest = createHash('sha256')
    .update(`${resolve(input.endpointPath)}\n${input.profileId}`)
    .digest('hex')
    .slice(0, 32);
  const nativeHostName = `com.intelligence.collector.p_${identityDigest}`;
  const directory = childPath(resolve(input.stateDirectory), identityDigest);
  const wrapperPath = resolve(directory, 'collector-native-bridge.cmd');
  const manifestPath = resolve(directory, `${nativeHostName}.json`);
  const wrapper = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `${batchArgument(process.execPath)} ${batchArgument(resolve(input.bridgeModulePath))} ` +
      `--endpoint ${batchArgument(resolve(input.endpointPath))} ` +
      `--profile-id ${batchArgument(input.profileId)} ` +
      `--browser-session-id ${batchArgument(input.browserSessionId)} ` +
      `--expected-origin ${batchArgument(extensionOrigin)} -- %*`,
    ''
  ].join('\r\n');
  await writeTextAtomic(wrapperPath, wrapper);
  await writeJsonAtomic(manifestPath, {
    name: nativeHostName,
    description: 'Personal Intelligence Collector Browser Host bridge',
    path: basename(wrapperPath),
    type: 'stdio',
    allowed_origins: [extensionOrigin]
  });

  const registeredRoots: string[] = [];
  try {
    for (const root of REGISTRY_ROOTS) {
      const key = `${root}\\${nativeHostName}`;
      await execFileAsync('reg.exe', ['ADD', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
        windowsHide: true
      });
      registeredRoots.push(root);
    }
  } catch (error) {
    await uninstallRegistration(nativeHostName, registeredRoots, directory);
    throw error;
  }

  return {
    nativeHostName,
    extensionOrigin,
    manifestPath,
    uninstall: () => uninstallRegistration(nativeHostName, [...REGISTRY_ROOTS], directory)
  };
}

async function uninstallRegistration(
  nativeHostName: string,
  roots: readonly string[],
  directory: string
): Promise<void> {
  await Promise.all(roots.map((root) => execFileAsync(
    'reg.exe',
    ['DELETE', `${root}\\${nativeHostName}`, '/f'],
    { windowsHide: true }
  ).catch(() => undefined)));
  await rm(directory, { recursive: true, force: true });
}

function batchArgument(value: string): string {
  if (!value || /[\r\n%"]/.test(value)) throw new Error('native_messaging_wrapper_argument_invalid');
  return `"${value}"`;
}
