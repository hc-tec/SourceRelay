import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GatewayConfig {
  host: '127.0.0.1';
  port: number;
  displayName: string;
  stateDirectory: string;
  profileDirectory: string;
  extensionDirectory: string;
  browserHostMainModulePath: string;
  browserHostStateDirectory: string;
  browserHostEndpointPath: string;
  proxyServer?: string;
}

function gatewayPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 43_127;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error('COLLECTOR_GATEWAY_PORT must be an integer between 1024 and 65535.');
  }
  return parsed;
}

export function loadGatewayConfig(): GatewayConfig {
  const displayName = (process.env.COLLECTOR_GATEWAY_NAME ?? 'Local Collector Gateway').trim();
  if (!displayName || displayName.length > 80) throw new Error('COLLECTOR_GATEWAY_NAME must contain 1 to 80 characters.');
  const stateDirectory = resolve(process.env.COLLECTOR_GATEWAY_STATE_DIR ?? 'runtime');
  const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const browserHostStateDirectory = resolve(
    process.env.COLLECTOR_BROWSER_HOST_STATE_DIR ?? resolve(stateDirectory, 'browser-host')
  );
  const proxyServer = normaliseProxyServer(process.env.COLLECTOR_BROWSER_PROXY_SERVER);
  return {
    host: '127.0.0.1',
    port: gatewayPort(process.env.COLLECTOR_GATEWAY_PORT),
    displayName,
    stateDirectory,
    profileDirectory: resolve(stateDirectory, 'profiles'),
    extensionDirectory: resolve(process.env.COLLECTOR_EXTENSION_DIRECTORY ?? '../collector-extension/dist'),
    browserHostMainModulePath: resolve(
      process.env.COLLECTOR_BROWSER_HOST_MAIN ?? resolve(packageDirectory, '../collector-browser-host/dist/main.js')
    ),
    browserHostStateDirectory,
    browserHostEndpointPath: resolve(
      process.env.COLLECTOR_BROWSER_HOST_ENDPOINT ?? resolve(browserHostStateDirectory, 'endpoint.json')
    ),
    ...(proxyServer ? { proxyServer } : {})
  };
}

function normaliseProxyServer(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const url = new URL(value.trim());
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol)) {
    throw new Error('COLLECTOR_BROWSER_PROXY_SERVER must use http, https, or socks5.');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('COLLECTOR_BROWSER_PROXY_SERVER must not contain credentials, path, query, or fragment.');
  }
  if (!url.hostname || !url.port) throw new Error('COLLECTOR_BROWSER_PROXY_SERVER must include host and port.');
  return `${url.protocol}//${url.host}`;
}
