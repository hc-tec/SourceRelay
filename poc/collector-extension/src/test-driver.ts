import { START_NATIVE_SEARCH, type SupportedPlatform } from './shared/protocol';

declare global {
  interface Window {
    __collectorExtensionTest?: {
      startNativeSearch(platform: SupportedPlatform, query: string, fixtureBaseUrl: string): Promise<unknown>;
    };
  }
}

window.__collectorExtensionTest = {
  startNativeSearch(platform, query, testFixtureBaseUrl) {
    return chrome.runtime.sendMessage({ type: START_NATIVE_SEARCH, platform, query, testFixtureBaseUrl });
  }
};
