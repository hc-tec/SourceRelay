import { createServer } from 'node:http';
import { AccountSafetyRegistry } from './account-safety';
import { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import { BilibiliAccountProfileHostRunner } from './bilibili-account-profile-host-runner';
import { BilibiliAccountVideoDetailMaterializationArtifactStore } from './bilibili-account-video-detail-materialization-artifacts';
import { BilibiliAccountVideoDetailMaterializationHostRunner } from './bilibili-account-video-detail-materialization-host-runner';
import { BilibiliAccountVideoPageTwoArtifactStore } from './bilibili-account-video-page-two-artifacts';
import { BilibiliAccountVideoPageTwoHostRunner } from './bilibili-account-video-page-two-host-runner';
import { BilibiliAccountVideoPaginationArtifactStore } from './bilibili-account-video-pagination-artifacts';
import { BilibiliAccountVideoPaginationHostRunner } from './bilibili-account-video-pagination-host-runner';
import { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import { BilibiliAccountVideoInventoryHostRunner } from './bilibili-account-video-inventory-host-runner';
import { BilibiliDynamicArtifactStore } from './bilibili-dynamic-artifacts';
import { BilibiliDynamicHostRunner } from './bilibili-dynamic-host-runner';
import { BilibiliDanmakuArtifactStore } from './bilibili-danmaku-artifacts';
import { BilibiliDanmakuHostRunner } from './bilibili-danmaku-host-runner';
import { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import { BilibiliNativeSearchHostRunner } from './bilibili-native-search-host-runner';
import { BilibiliNativeSearchBatchArtifactStore } from './bilibili-native-search-batch-artifacts';
import { BilibiliNativeSearchBatchCoverageArtifactStore } from './bilibili-native-search-batch-coverage-artifacts';
import { BilibiliNativeSearchBatchHostRunner } from './bilibili-native-search-batch-host-runner';
import { BilibiliNativeSearchBatchCheckpointStore } from './bilibili-native-search-batch-checkpoints';
import { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import { BilibiliVideoDetailHostRunner } from './bilibili-video-detail-host-runner';
import { BilibiliVideoDiscussionArtifactStore } from './bilibili-video-discussion-artifacts';
import { BilibiliVideoDiscussionHostRunner } from './bilibili-video-discussion-host-runner';
import { BilibiliTranscriptArtifactStore } from './bilibili-transcript-artifacts';
import { BilibiliTranscriptHostRunner } from './bilibili-transcript-host-runner';
import { CollectionBrowserManager } from './browser-manager';
import { loadGatewayConfig } from './config';
import { handleGatewayRoute } from './gateway-routes';
import { safeErrorCode, sendJson } from './gateway-http';
import { loadGatewayIdentity } from './identity';
import { BrowserProfileRegistry } from './profiles';

const config = loadGatewayConfig();
const identity = await loadGatewayIdentity(config);
const profileRegistry = await BrowserProfileRegistry.create(config.profileDirectory, config.stateDirectory);
const accountSafety = await AccountSafetyRegistry.create(config.stateDirectory);
const browserManager = new CollectionBrowserManager(config, profileRegistry);
const accountVideoDetailMaterializationArtifacts =
  await BilibiliAccountVideoDetailMaterializationArtifactStore.create(config.stateDirectory);
const accountProfileArtifacts = await BilibiliAccountProfileArtifactStore.create(config.stateDirectory);
const accountVideoPageTwoArtifacts = await BilibiliAccountVideoPageTwoArtifactStore.create(config.stateDirectory);
const accountVideoPaginationArtifacts = await BilibiliAccountVideoPaginationArtifactStore.create(config.stateDirectory);
const accountVideoInventoryArtifacts = await BilibiliAccountVideoInventoryArtifactStore.create(config.stateDirectory);
const dynamicArtifacts = await BilibiliDynamicArtifactStore.create(config.stateDirectory);
const nativeSearchArtifacts = await BilibiliNativeSearchArtifactStore.create(config.stateDirectory);
const nativeSearchBatchArtifacts = await BilibiliNativeSearchBatchArtifactStore.create(config.stateDirectory);
const nativeSearchBatchCoverageArtifacts = await BilibiliNativeSearchBatchCoverageArtifactStore.create(config.stateDirectory);
const nativeSearchBatchCheckpoints = await BilibiliNativeSearchBatchCheckpointStore.create(config.stateDirectory);
const videoDetailArtifacts = await BilibiliVideoDetailArtifactStore.create(config.stateDirectory);
const discussionArtifacts = await BilibiliVideoDiscussionArtifactStore.create(config.stateDirectory);
const transcriptArtifacts = await BilibiliTranscriptArtifactStore.create(config.stateDirectory);
const danmakuArtifacts = await BilibiliDanmakuArtifactStore.create(config.stateDirectory);
const dynamicRunner = new BilibiliDynamicHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: dynamicArtifacts
});
const accountProfileRunner = new BilibiliAccountProfileHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: accountProfileArtifacts
});
const accountVideoInventoryRunner = new BilibiliAccountVideoInventoryHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: accountVideoInventoryArtifacts
});
const nativeSearchRunner = new BilibiliNativeSearchHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: nativeSearchArtifacts
});
const nativeSearchBatchRunner = new BilibiliNativeSearchBatchHostRunner({
  singleRunner: nativeSearchRunner,
  singleArtifacts: nativeSearchArtifacts,
  artifacts: nativeSearchBatchArtifacts,
  checkpoints: nativeSearchBatchCheckpoints
});
const accountVideoPageTwoRunner = new BilibiliAccountVideoPageTwoHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: accountVideoPageTwoArtifacts
});
const accountVideoPaginationRunner = new BilibiliAccountVideoPaginationHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: accountVideoPaginationArtifacts
});
const videoDetailRunner = new BilibiliVideoDetailHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: videoDetailArtifacts
});
const discussionRunner = new BilibiliVideoDiscussionHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: discussionArtifacts
});
const transcriptRunner = new BilibiliTranscriptHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: transcriptArtifacts
});
const danmakuRunner = new BilibiliDanmakuHostRunner({
  accountSafety,
  browserManager,
  profiles: profileRegistry,
  artifacts: danmakuArtifacts
});
const accountVideoDetailMaterializationRunner = new BilibiliAccountVideoDetailMaterializationHostRunner({
  accountSafety,
  profiles: profileRegistry,
  sourceArtifacts: accountVideoPaginationArtifacts,
  detailRunner: videoDetailRunner,
  artifacts: accountVideoDetailMaterializationArtifacts
});
const expectedHost = `${config.host}:${config.port}`;

const server = createServer(async (request, response) => {
  try {
    if (request.socket.remoteAddress !== config.host || request.headers.host !== expectedHost) {
      sendJson(response, 403, { schemaVersion: 1, ok: false, error: 'loopback_request_rejected' });
      return;
    }
    const url = new URL(request.url ?? '/', identity.publicIdentity.loopbackOrigin);
    const handled = await handleGatewayRoute(request, response, url, {
      identity,
      browserManager,
      profileRegistry,
      accountSafety,
      accountProfileArtifacts,
      accountProfileRunner,
      accountVideoDetailMaterializationArtifacts,
      accountVideoDetailMaterializationRunner,
      accountVideoPageTwoArtifacts,
      accountVideoPageTwoRunner,
      accountVideoPaginationArtifacts,
      accountVideoPaginationRunner,
      accountVideoInventoryArtifacts,
      accountVideoInventoryRunner,
      dynamicArtifacts,
      dynamicRunner,
      nativeSearchArtifacts,
      nativeSearchRunner,
      nativeSearchBatchArtifacts,
      nativeSearchBatchCoverageArtifacts,
      nativeSearchBatchCheckpoints,
      nativeSearchBatchRunner,
      videoDetailArtifacts,
      videoDetailRunner,
      discussionArtifacts,
      discussionRunner,
      transcriptArtifacts,
      transcriptRunner,
      danmakuArtifacts,
      danmakuRunner
    });
    if (!handled) sendJson(response, 404, { schemaVersion: 1, ok: false, error: 'route_not_found' });
  } catch (error) {
    process.stderr.write(`[gateway_request_error] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    if (!response.headersSent) {
      const code = safeErrorCode(error);
      const status = code === 'browser_host_not_running' || code === 'profile_has_active_page_leases' ||
        code === 'bilibili_native_search_batch_recovery_outcome_unknown' ||
        code === 'bilibili_native_search_batch_checkpoint_not_resumable' ||
        code === 'bilibili_native_search_batch_checkpoint_not_resolvable' ||
        code === 'bilibili_native_search_batch_checkpoint_active'
        ? 409
        : 400;
      sendJson(response, status, { schemaVersion: 1, ok: false, error: code });
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
  process.stdout.write(`Collector Gateway ready at ${identity.publicIdentity.loopbackOrigin}\n`);
  process.stdout.write(`Gateway identity ${identity.publicIdentity.identityFingerprint}\n`);
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  browserManager.disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

process.on('SIGINT', () => void shutdown().catch(() => { process.exitCode = 1; }));
process.on('SIGTERM', () => void shutdown().catch(() => { process.exitCode = 1; }));
