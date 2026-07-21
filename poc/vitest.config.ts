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
      reporter: ['text', 'json-summary', 'lcov']
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
          name: 'gateway-domain',
          include: ['collector-gateway/test/**/*.unit.test.ts'],
          environment: 'node'
        }
      }
    ]
  }
});
