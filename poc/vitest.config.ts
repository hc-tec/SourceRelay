import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const contractsEntry = fileURLToPath(new URL('./collector-contracts/src/index.ts', import.meta.url));
const browserHostClient = fileURLToPath(new URL('./collector-browser-host/src/client.ts', import.meta.url));

/**
 * L1/L2 only.  Platform behaviour must never be added to this runner: it is
 * proven separately by the real-local Playwright project and live Canaries.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@intelligence/collector-contracts': contractsEntry,
      '@intelligence/collector-browser-host/client': browserHostClient
    }
  },
  test: {
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'runtime/test-coverage',
      reporter: ['text', 'json-summary', 'lcov'],
      // Coverage is intentionally a high-risk-domain visibility report, not
      // a whole-repository vanity metric. Browser/platform behaviour is
      // judged by the real-local suites and Canary evidence instead.
      include: [
        'collector-contracts/src/{errors,ipc,native-bridge,strategy-observation}.ts',
        'collector-extension/src/shared/{bilibili-video-url,bilibili-account-video-inventory-url,control-plane,network-capture,strategy-registry}.ts',
        'collector-browser-host/src/{host-errors,security,validation}.ts',
        'collector-browser-host/src/ipc/wire-auth.ts',
        'collector-browser-host/src/page-ledger/{page-record,page-selection}.ts',
        'collector-browser-host/src/reclamation/page-reclamation.ts',
        'collector-gateway/src/{account-safety,evidence,profiles,tasks}.ts',
        'testing/catalog.ts'
      ]
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'governance',
          include: ['testing/**/*.unit.test.ts'],
          environment: 'node'
        }
      },
      {
        extends: true,
        test: {
          name: 'contracts',
          include: ['collector-contracts/test/**/*.unit.test.ts'],
          environment: 'node'
        }
      },
      {
        extends: true,
        test: {
          name: 'extension-domain',
          include: ['collector-extension/test/**/*.unit.test.ts'],
          environment: 'node'
        }
      },
      {
        extends: true,
        test: {
          name: 'browser-host-domain',
          include: ['collector-browser-host/test/**/*.unit.test.ts'],
          environment: 'node'
        }
      },
      {
        extends: true,
        test: {
          name: 'gateway-domain',
          include: ['collector-gateway/test/**/*.unit.test.ts'],
          environment: 'node'
        }
      }
    ]
  }
});
