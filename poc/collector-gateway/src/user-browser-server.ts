import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';
import { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import { BrowserBindingSafetyRegistry } from './browser-binding-safety';
import { CollectorServiceAuditLog } from './collector-service-audit';
import { CollectorServiceClientRegistry } from './collector-service-clients';
import { CollectorServiceIdempotencyLedger } from './collector-service-idempotency';
import {
  assertUserBrowserStateIsolation,
  loadUserBrowserGatewayConfig
} from './user-browser-config';
import { ExtensionWorkQueue } from './extension-work-queue';
import { ExtensionWorkNativeSearchBatchArtifactStore } from './extension-work-native-search-batch-artifacts';
import { ExtensionWorkPassiveArtifactStore } from './extension-work-passive-artifacts';
import { XiaohongshuPublicNotesArtifactStore } from './xiaohongshu-public-notes-artifacts';
import { XiaohongshuAccountPublicNotesArtifactStore } from './xiaohongshu-account-public-notes-artifacts';
import { XiaohongshuNotePublicDetailArtifactStore } from './xiaohongshu-note-public-detail-artifacts';
import { XiaohongshuNotePublicCommentsArtifactStore } from './xiaohongshu-note-public-comments-artifacts';
import { XiaohongshuReplyArtifactStore } from './xiaohongshu-note-public-comment-replies-artifacts';
import { safeErrorCode, sendJson } from './gateway-http';
import { loadGatewayIdentity } from './identity';
import { PairingBroker } from './pairing';
import { handleUserBrowserGatewayRoute } from './user-browser-gateway-routes';
import { OperationalLog } from './operational-log';
import { OfficialSourceOperationStore } from './official-source-operation-store';
import { ZhihuOfficialApiProvider } from './zhihu-official-api-provider';
import { ZhihuOfficialArtifactStore } from './zhihu-official-artifacts';
import { loadZhihuOfficialApiConfig } from './zhihu-official-config';

const config = loadUserBrowserGatewayConfig();
await assertUserBrowserStateIsolation(config.stateDirectory);

// The user-browser Gateway has no browser/Profile control, but it still needs
// to reject stale workers before they consume work.  Resolve the checked-in
// production artifact by default; deployments can point at another artifact
// with COLLECTOR_EXTENSION_DIRECTORY.
const extensionDirectory = resolveUserBrowserExtensionDirectory();

const identity = await loadGatewayIdentity(config);
const operationalLog = await OperationalLog.create(config.stateDirectory);
const pairingBroker = await PairingBroker.create(identity, config.stateDirectory);
const browserBindingSafety = await BrowserBindingSafetyRegistry.create(config.stateDirectory);
const workQueue = await ExtensionWorkQueue.create(identity, config.stateDirectory);
const collectorServiceClients = await CollectorServiceClientRegistry.create(config.stateDirectory);
const collectorServiceAudit = await CollectorServiceAuditLog.create(config.stateDirectory);
const collectorServiceIdempotency = await CollectorServiceIdempotencyLedger.create(config.stateDirectory);
const officialSourceOperations = await OfficialSourceOperationStore.create(config.stateDirectory);
const zhihuOfficialArtifacts = await ZhihuOfficialArtifactStore.create(config.stateDirectory);
const zhihuOfficialApiProvider = new ZhihuOfficialApiProvider({
  ...loadZhihuOfficialApiConfig(),
  artifacts: zhihuOfficialArtifacts,
  operations: officialSourceOperations
});
const videoDetailArtifacts = await BilibiliVideoDetailArtifactStore.create(config.stateDirectory);
const nativeSearchArtifacts = await BilibiliNativeSearchArtifactStore.create(config.stateDirectory);
const nativeSearchBatchDirectArtifacts = await ExtensionWorkNativeSearchBatchArtifactStore.create(config.stateDirectory);
const accountProfileArtifacts = await BilibiliAccountProfileArtifactStore.create(config.stateDirectory);
const accountVideoInventoryArtifacts = await BilibiliAccountVideoInventoryArtifactStore.create(config.stateDirectory);
const passiveDirectArtifacts = await ExtensionWorkPassiveArtifactStore.create(config.stateDirectory);
const xiaohongshuPublicNotesArtifacts = await XiaohongshuPublicNotesArtifactStore.create(config.stateDirectory);
const xiaohongshuAccountPublicNotesArtifacts =
  await XiaohongshuAccountPublicNotesArtifactStore.create(config.stateDirectory);
const xiaohongshuNotePublicDetailArtifacts =
  await XiaohongshuNotePublicDetailArtifactStore.create(config.stateDirectory);
const xiaohongshuNotePublicCommentsArtifacts =
  await XiaohongshuNotePublicCommentsArtifactStore.create(config.stateDirectory);
const xiaohongshuReplyArtifacts=await XiaohongshuReplyArtifactStore.create(config.stateDirectory);
const expectedHost = config.host + ':' + config.port;

function resolveUserBrowserExtensionDirectory(): string {
  const configured = process.env.COLLECTOR_EXTENSION_DIRECTORY?.trim();
  if (configured) return resolve(configured);
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Monorepo source/build layout.
    resolve(moduleDirectory, '..', '..', 'collector-extension', 'dist'),
    // Packaged core release layout: gateway/dist beside extension/.
    resolve(moduleDirectory, '..', '..', 'extension')
  ];
  const discovered = candidates.find((candidate) =>
    existsSync(resolve(candidate, 'runtime-build.json'))
  );
  if (discovered) return discovered;
  // Preserve the existing error contract when neither layout is complete.
  return candidates[0]!;
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  let requestErrorCode: string | null = null;
  const url = new URL(request.url ?? '/', identity.publicIdentity.loopbackOrigin);
  response.setHeader('x-collector-request-id', requestId);
  response.once('finish', () => {
    void operationalLog.record({
      level: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
      eventType: 'http.request.completed',
      requestId,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: response.statusCode >= 400 ? 'failed' : 'completed',
      errorCode: requestErrorCode,
      details: {
        method: request.method ?? 'UNKNOWN',
        pathname: url.pathname,
        statusCode: response.statusCode
      }
    });
  });
  try {
    if (request.socket.remoteAddress !== config.host || request.headers.host !== expectedHost) {
      sendJson(response, 403, {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        ok: false,
        error: 'loopback_request_rejected'
      });
      return;
    }
    const handled = await handleUserBrowserGatewayRoute(request, response, url, {
      identity,
      pairingBroker,
      operationalLog,
      requestId,
      browserBindingSafety,
      workQueue,
      collectorServiceClients,
      collectorServiceAudit,
      collectorServiceIdempotency,
      officialSourceOperations,
      zhihuOfficialApiProvider,
      videoDetailArtifacts,
      nativeSearchArtifacts,
      nativeSearchBatchDirectArtifacts,
      accountProfileArtifacts,
      accountVideoInventoryArtifacts,
      passiveDirectArtifacts,
      xiaohongshuPublicNotesArtifacts,
      xiaohongshuAccountPublicNotesArtifacts,
      xiaohongshuNotePublicDetailArtifacts,
      xiaohongshuNotePublicCommentsArtifacts,
      xiaohongshuReplyArtifacts,
      zhihuOfficialArtifacts,
    });
    if (!handled) sendJson(response, 404, {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      ok: false,
      error: 'route_not_found'
    });
  } catch (error) {
    requestErrorCode = safeErrorCode(error);
    process.stderr.write('[user_browser_gateway_request_error] ' +
      (error instanceof Error ? error.stack ?? error.message : String(error)) + '\n');
    if (!response.headersSent) {
      sendJson(response, 400, {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        ok: false,
        error: safeErrorCode(error)
      });
    } else {
      response.destroy();
    }
  }
});

server.requestTimeout = 45_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 50;

server.once('error', (error) => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    process.stderr.write(
      'collector_gateway_port_in_use: 127.0.0.1:' + config.port +
      ' is already in use. Stop the conflicting local process or choose a stable ' +
      'COLLECTOR_GATEWAY_PORT before pairing the extension.\n'
    );
  } else {
    process.stderr.write(
      'collector_gateway_listen_failed:' + (code ?? safeErrorCode(error)) + '\n'
    );
  }
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  process.stdout.write('User-owned Browser Collector ready at ' + identity.publicIdentity.loopbackOrigin + '\n');
  process.stdout.write('Gateway identity ' + identity.publicIdentity.identityFingerprint + '\n');
  process.stdout.write('Browser process control is intentionally unavailable.\n');
  void operationalLog.record({
    eventType: 'gateway.ready',
    outcome: 'completed',
    details: { port: config.port, deploymentMode: 'user_owned_browser_extension' }
  });
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await operationalLog.record({ eventType: 'gateway.shutdown.started', outcome: 'started' });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await operationalLog.record({ eventType: 'gateway.shutdown.completed', outcome: 'completed' });
  await operationalLog.seal();
}

process.on('SIGINT', () => void shutdown().catch(() => { process.exitCode = 1; }));
process.on('SIGTERM', () => void shutdown().catch(() => { process.exitCode = 1; }));
