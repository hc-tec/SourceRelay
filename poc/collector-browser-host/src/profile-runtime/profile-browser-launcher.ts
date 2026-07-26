import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Request } from 'playwright';
import {
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  type ExtensionRuntimeExpectation,
  type ExtensionRuntimeSummary
} from '@intelligence/collector-contracts';
import {
  adoptVisibleExtension,
  configureNativeBridge,
  prepareExtensionRuntime
} from '../extension-runtime/extension-adoption.js';
import type { NativeBridgeRegistry } from '../native-bridge/native-bridge-registry.js';
import {
  installNativeMessagingHost,
  type NativeMessagingHostRegistration
} from '../native-bridge/native-host-installer.js';

export interface LaunchedProfileBrowser {
  context: BrowserContext;
  extensionRuntime: ExtensionRuntimeSummary | null;
  nativeHostRegistration: NativeMessagingHostRegistration | null;
}

interface LaunchProfileBrowserInput {
  profileId: string;
  browserSessionId: string;
  userDataDirectory: string;
  extensionDirectory: string | null;
  extensionRuntime: ExtensionRuntimeExpectation | null;
  nativeBridgeRegistry: NativeBridgeRegistry;
  nativeHostStateDirectory: string;
  hostEndpointPath: string;
  nativeBridgeModulePath: string;
  headless: boolean;
  offlineOnly: boolean;
  onExternalHttpRequestStarted: (request: Request) => void;
  onExternalHttpRequestSettled: (request: Request) => void;
}

export async function launchProfileBrowser(input: LaunchProfileBrowserInput): Promise<LaunchedProfileBrowser> {
  await mkdir(input.userDataDirectory, { recursive: true });
  if (Boolean(input.extensionDirectory) !== Boolean(input.extensionRuntime)) {
    throw new Error('extension_runtime_expectation_required');
  }
  const extensionArgs = input.extensionDirectory
    ? [
        `--disable-extensions-except=${input.extensionDirectory}`,
        `--load-extension=${input.extensionDirectory}`
      ]
    : [];
  const launchContext = (headless: boolean, offline: boolean) => chromium.launchPersistentContext(
    input.userDataDirectory,
    {
      channel: 'chromium',
      headless,
      offline,
      args: [
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=user-gesture-required',
        '--mute-audio',
        ...extensionArgs
      ]
    }
  );
  const preparation = input.extensionRuntime
    ? await prepareExtensionRuntime({
        expectation: input.extensionRuntime,
        launchProbeContext: () => launchContext(true, true)
      })
    : null;
  let registration: NativeMessagingHostRegistration | null = null;
  if (preparation && input.extensionRuntime) {
    registration = await installNativeMessagingHost({
      stateDirectory: input.nativeHostStateDirectory,
      endpointPath: input.hostEndpointPath,
      bridgeModulePath: input.nativeBridgeModulePath,
      profileId: input.profileId,
      browserSessionId: input.browserSessionId,
      extensionId: preparation.extensionId
    });
    input.nativeBridgeRegistry.expect({
      profileId: input.profileId,
      browserSessionId: input.browserSessionId,
      extensionId: preparation.extensionId,
      extensionOrigin: registration.extensionOrigin,
      collectorVersion: input.extensionRuntime.version,
      controlSurfaceRevision: input.extensionRuntime.controlSurfaceRevision
    });
  }

  let context: BrowserContext;
  try {
    context = await launchContext(input.headless, input.offlineOnly);
  } catch (error) {
    await clearNativeRegistration(input, registration);
    throw error;
  }
  const observedExternalRequests = new WeakSet<Request>();
  context.on('request', (request) => {
    if (!isExternalHttpRequest(request.url()) || observedExternalRequests.has(request)) return;
    observedExternalRequests.add(request);
    input.onExternalHttpRequestStarted(request);
  });
  const settleExternalRequest = (request: Request) => {
    if (!observedExternalRequests.delete(request)) return;
    input.onExternalHttpRequestSettled(request);
  };
  context.on('requestfinished', settleExternalRequest);
  context.on('requestfailed', settleExternalRequest);
  try {
    let extensionRuntime: ExtensionRuntimeSummary | null = null;
    if (preparation && input.extensionRuntime && registration) {
      const adoption = await adoptVisibleExtension({
        context,
        expectation: input.extensionRuntime,
        preparation
      });
      extensionRuntime = adoption.summary;
      await configureNativeBridge(adoption.worker, {
        schemaVersion: 1,
        protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
        nativeHostName: registration.nativeHostName,
        profileId: input.profileId,
        browserSessionId: input.browserSessionId
      });
      await input.nativeBridgeRegistry.waitForReady(input.profileId, input.browserSessionId, 10_000);
      extensionRuntime.nativeBridgeConnected = true;
    }
    return { context, extensionRuntime, nativeHostRegistration: registration };
  } catch (error) {
    await context.close().catch(() => undefined);
    await clearNativeRegistration(input, registration);
    throw error;
  }
}

async function clearNativeRegistration(
  input: Pick<LaunchProfileBrowserInput, 'profileId' | 'browserSessionId' | 'nativeBridgeRegistry'>,
  registration: NativeMessagingHostRegistration | null
): Promise<void> {
  input.nativeBridgeRegistry.clearProfile(input.profileId, input.browserSessionId);
  await registration?.uninstall().catch(() => undefined);
}

function isExternalHttpRequest(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
