import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION,
  COLLECTOR_RUNTIME_BOOTSTRAP_KEY,
  type CollectorRuntimeBootstrap
} from '@intelligence/collector-contracts';
import { COLLECTOR_EXTENSION_BUILD_FINGERPRINT } from '../shared/build-fingerprint';
import { initialiseNativeBridge } from './native-bridge';
import { initialiseNetworkObserverController } from './network-observer-controller';
import { initialiseXiaohongshuCurrentPageNetworkObserver } from './xiaohongshu-current-page-network';
import { initialiseExtensionWorkRunner } from './extension-work-runner';
import { cleanupStrategyScriptRegistrations } from './strategy-script-lifecycle';
import { initialiseGatewayPairingDraftPersistence } from './user-browser-gateway-storage';
import { initialiseBilibiliAccountProfileDocumentBridge } from './strategies/bilibili-account-profile-strategy';
import { initialiseBilibiliAccountVideoInventoryDocumentBridge } from './strategies/bilibili-account-video-inventory-strategy';
import { initialiseBilibiliNativeSearchDocumentBridge } from './strategies/bilibili-native-search-strategy';
import { initialiseBilibiliVideoDetailDocumentBridge } from './strategies/bilibili-video-detail-strategy';
import { cleanupExpiredBilibiliCollectionSeriesObserverBindings } from './strategies/bilibili-collection-series-strategy';
import { cleanupExpiredBilibiliCollectionSeriesDetailObserverBindings } from './strategies/bilibili-series-detail-strategy';

const runtimeBootstrap: CollectorRuntimeBootstrap = {
  schemaVersion: 1,
  collectorVersion: COLLECTOR_EXTENSION_VERSION,
  controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
  buildFingerprint: COLLECTOR_EXTENSION_BUILD_FINGERPRINT
};

void chrome.storage.session.set({ [COLLECTOR_RUNTIME_BOOTSTRAP_KEY]: runtimeBootstrap });
initialiseNetworkObserverController();
initialiseGatewayPairingDraftPersistence();
initialiseXiaohongshuCurrentPageNetworkObserver();
initialiseBilibiliAccountProfileDocumentBridge();
initialiseBilibiliAccountVideoInventoryDocumentBridge();
initialiseBilibiliNativeSearchDocumentBridge();
initialiseBilibiliVideoDetailDocumentBridge();
void cleanupExpiredBilibiliCollectionSeriesObserverBindings();
void cleanupExpiredBilibiliCollectionSeriesDetailObserverBindings();
void initialiseNativeBridge();
initialiseExtensionWorkRunner();
void cleanupStrategyScriptRegistrations();
