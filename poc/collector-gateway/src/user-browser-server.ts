import { createServer } from 'node:http';
import { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import { BrowserBindingSafetyRegistry } from './browser-binding-safety';
import { CollectorServiceAuditLog } from './collector-service-audit';
import { CollectorServiceClientRegistry } from './collector-service-clients';
import {
  assertUserBrowserStateIsolation,
  loadUserBrowserGatewayConfig
} from './user-browser-config';
import { ExtensionWorkQueue } from './extension-work-queue';
import { safeErrorCode, sendJson } from './gateway-http';
import { loadGatewayIdentity } from './identity';
import { PairingBroker } from './pairing';
import { handleUserBrowserGatewayRoute } from './user-browser-gateway-routes';

const config = loadUserBrowserGatewayConfig();
await assertUserBrowserStateIsolation(config.stateDirectory);

const identity = await loadGatewayIdentity(config);
const pairingBroker = await PairingBroker.create(identity, config.stateDirectory);
const browserBindingSafety = await BrowserBindingSafetyRegistry.create(config.stateDirectory);
const workQueue = await ExtensionWorkQueue.create(identity, config.stateDirectory);
const collectorServiceClients = await CollectorServiceClientRegistry.create(config.stateDirectory);
const collectorServiceAudit = await CollectorServiceAuditLog.create(config.stateDirectory);
const videoDetailArtifacts = await BilibiliVideoDetailArtifactStore.create(config.stateDirectory);
const nativeSearchArtifacts = await BilibiliNativeSearchArtifactStore.create(config.stateDirectory);
const expectedHost = config.host + ':' + config.port;

const server = createServer(async (request, response) => {
  try {
    if (request.socket.remoteAddress !== config.host || request.headers.host !== expectedHost) {
      sendJson(response, 403, { schemaVersion: 2, ok: false, error: 'loopback_request_rejected' });
      return;
    }
    const url = new URL(request.url ?? '/', identity.publicIdentity.loopbackOrigin);
    const handled = await handleUserBrowserGatewayRoute(request, response, url, {
      identity,
      pairingBroker,
      browserBindingSafety,
      workQueue,
      collectorServiceClients,
      collectorServiceAudit,
      videoDetailArtifacts,
      nativeSearchArtifacts
    });
    if (!handled) sendJson(response, 404, { schemaVersion: 2, ok: false, error: 'route_not_found' });
  } catch (error) {
    process.stderr.write('[user_browser_gateway_request_error] ' +
      (error instanceof Error ? error.stack ?? error.message : String(error)) + '\n');
    if (!response.headersSent) {
      sendJson(response, 400, { schemaVersion: 2, ok: false, error: safeErrorCode(error) });
    } else {
      response.destroy();
    }
  }
});

server.requestTimeout = 45_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 50;

server.listen(config.port, config.host, () => {
  process.stdout.write('User-owned Browser Collector ready at ' + identity.publicIdentity.loopbackOrigin + '\n');
  process.stdout.write('Gateway identity ' + identity.publicIdentity.identityFingerprint + '\n');
  process.stdout.write('Browser process control is intentionally unavailable.\n');
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

process.on('SIGINT', () => void shutdown().catch(() => { process.exitCode = 1; }));
process.on('SIGTERM', () => void shutdown().catch(() => { process.exitCode = 1; }));
