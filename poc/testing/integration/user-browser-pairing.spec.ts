import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveExactExtensionPermission } from '../../collector-extension/scripts/native-permission-harness.mjs';
import { launchProductionExtension } from '../../collector-extension/scripts/extension-test-harness.mjs';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = resolve(pocRoot, 'collector-extension', 'dist');
const extensionSourceDirectory = resolve(pocRoot, 'collector-extension');
const gatewayDirectory = resolve(pocRoot, 'collector-gateway');

test('a real installed MV3 extension pairs with the direct Gateway without creating an isolated browser runtime', async () => {
  test.skip(process.platform !== 'win32', 'native extension-permission verification currently uses Windows UI Automation');
  test.setTimeout(120_000);

  const port = await availableLoopbackPort();
  const stateDirectory = await mkdtemp(resolve(tmpdir(), 'collector-user-browser-gateway-'));
  let gateway = startGateway(port, stateDirectory);
  const gatewayOrigin = `http://127.0.0.1:${port}`;
  const platformRequests: string[] = [];
  let launched: Awaited<ReturnType<typeof launchProductionExtension>> | undefined;
  try {
    await waitForGateway(gatewayOrigin);
    const status = await (await fetch(gatewayOrigin + '/v1/status')).json() as {
      deploymentMode?: string;
      browserProcessControl?: string;
    };
    expect(status).toMatchObject({
      deploymentMode: 'user_owned_browser_extension',
      browserProcessControl: 'not_available'
    });
    launched = await launchProductionExtension(extensionPath, 'collector-user-browser-extension-', {
      forceHeaded: true,
      onContext(context: { on(event: 'request', listener: (request: { url(): string }) => void): void }) {
        context.on('request', (request) => {
          const url = new URL(request.url());
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            platformRequests.push(`${url.protocol}//${url.host}${url.pathname}`);
          }
        });
      }
    });

    const consolePage = await launched.context.newPage();
    await consolePage.goto(gatewayOrigin);
    await consolePage.locator('#create-browser-binding-pairing').click();
    await expect(consolePage.locator('#browser-binding-pairing')).toBeVisible();
    const identityFingerprint = await consolePage.locator('#browser-binding-pairing-fingerprint').textContent();
    const pairingSessionId = await consolePage.locator('#browser-binding-pairing-session').textContent();
    const pairingCode = await consolePage.locator('#browser-binding-pairing-code').textContent();
    expect(identityFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(pairingSessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(pairingCode).toMatch(/^\d{8}$/);

    const extensionId = await launched.worker.evaluate(() => chrome.runtime.id);
    const controlPage = await launched.context.newPage();
    await controlPage.goto(`chrome-extension://${extensionId}/control.html`);
    await expect(controlPage.locator('html[data-collector-control-ready="true"]')).toHaveCount(1);
    await controlPage.locator('input[name="loopbackOrigin"]').fill(gatewayOrigin);
    await controlPage.locator('input[name="identityFingerprint"]').fill(identityFingerprint!);
    await controlPage.locator('input[name="pairingSessionId"]').fill(pairingSessionId!);
    await controlPage.locator('input[name="pairingCode"]').fill(pairingCode!);

    const approval = approveExactExtensionPermission(extensionSourceDirectory, '127.0.0.1', '127.0.0.1', 20);
    await controlPage.locator('#pair-gateway button[type="submit"]').click();
    await approval;
    await expect(controlPage.locator('#gateway-state')).toContainText('已连接');

    const permissions = await launched.worker.evaluate(async () => await chrome.permissions.getAll());
    expect(permissions.origins).toContain('http://127.0.0.1/*');
    await consolePage.reload();
    await expect(consolePage.locator('#browser-bindings')).toContainText('浏览器绑定');
    await expect(consolePage.locator('#browser-bindings')).toContainText('在线');

    const persisted = await readFile(resolve(stateDirectory, 'extension-pairings.json'), 'utf8');
    expect(persisted).toContain('browserBindingId');
    expect(persisted).not.toMatch(/profileId|userDataDirectory|cookie|password/i);
    expect(platformRequests.every((request) => request.startsWith(gatewayOrigin))).toBe(true);
    expect(platformRequests).toEqual(expect.arrayContaining([
      `${gatewayOrigin}/v1/browser-bindings/pairing-sessions`,
      `${gatewayOrigin}/v1/extension/pairing/claim`,
      `${gatewayOrigin}/v1/extension/browser-binding`
    ]));
    const stateEntries = await readdir(stateDirectory);
    expect(stateEntries).not.toContain('profiles');
    expect(stateEntries).not.toContain('browser-host');
    expect(stateEntries).not.toContain('browser-profiles.json');

    // Gateway restart must retain the pairing state without starting, closing,
    // or attaching the browser that owns the installed extension.
    await stopGateway(gateway);
    gateway = startGateway(port, stateDirectory);
    await waitForGateway(gatewayOrigin);
    const restartedStatus = await (await fetch(gatewayOrigin + '/v1/status')).json() as {
      deploymentMode?: string;
      browserBindingCount?: number;
      browserProcessControl?: string;
    };
    expect(restartedStatus).toMatchObject({
      deploymentMode: 'user_owned_browser_extension',
      browserBindingCount: 1,
      browserProcessControl: 'not_available'
    });
    expect(controlPage.isClosed()).toBe(false);
    expect(consolePage.isClosed()).toBe(false);
    const restartedStateEntries = await readdir(stateDirectory);
    expect(restartedStateEntries).not.toContain('profiles');
    expect(restartedStateEntries).not.toContain('browser-host');

    await controlPage.close();
    await consolePage.close();
  } finally {
    await launched?.close();
    await stopGateway(gateway);
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  if (!address || typeof address === 'string' || address.port < 1024) throw new Error('test_loopback_port_unavailable');
  return address.port;
}

function startGateway(port: number, stateDirectory: string): ChildProcess {
  return spawn(process.execPath, ['dist/user-browser-server.js'], {
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      COLLECTOR_GATEWAY_PORT: String(port),
      COLLECTOR_GATEWAY_STATE_DIR: stateDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function waitForGateway(origin: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/v1/status`);
      if (response.ok) return;
    } catch {
      // The process is still starting. No platform request is involved.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('test_gateway_start_timeout');
}

async function stopGateway(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}
