import { resolve } from 'node:path';

export interface GatewayConfig {
  host: '127.0.0.1';
  port: number;
  displayName: string;
  stateDirectory: string;
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
  return {
    host: '127.0.0.1',
    port: gatewayPort(process.env.COLLECTOR_GATEWAY_PORT),
    displayName,
    stateDirectory: resolve(process.env.COLLECTOR_GATEWAY_STATE_DIR ?? 'runtime')
  };
}
