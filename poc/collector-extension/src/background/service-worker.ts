import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION,
  COLLECTOR_RUNTIME_BOOTSTRAP_KEY,
  type CollectorRuntimeBootstrap
} from '@intelligence/collector-contracts';
import { initialiseNativeBridge } from './native-bridge';
import { initialiseNetworkObserverController } from './network-observer-controller';
import { cleanupStrategyScriptRegistrations } from './strategy-script-lifecycle';
import { initialiseBilibiliAccountProfileDocumentBridge } from './strategies/bilibili-account-profile-strategy';
import { initialiseBilibiliAccountVideoInventoryDocumentBridge } from './strategies/bilibili-account-video-inventory-strategy';
import { initialiseBilibiliNativeSearchDocumentBridge } from './strategies/bilibili-native-search-strategy';
import { initialiseBilibiliVideoDetailDocumentBridge } from './strategies/bilibili-video-detail-strategy';

const runtimeBootstrap: CollectorRuntimeBootstrap = {
  schemaVersion: 1,
  collectorVersion: COLLECTOR_EXTENSION_VERSION,
  controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION
};

void chrome.storage.session.set({ [COLLECTOR_RUNTIME_BOOTSTRAP_KEY]: runtimeBootstrap });
initialiseNetworkObserverController();
initialiseBilibiliAccountProfileDocumentBridge();
initialiseBilibiliAccountVideoInventoryDocumentBridge();
initialiseBilibiliNativeSearchDocumentBridge();
initialiseBilibiliVideoDetailDocumentBridge();
void initialiseNativeBridge();
void cleanupStrategyScriptRegistrations();
