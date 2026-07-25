import { defineConfig } from '@playwright/test';

/**
 * Explicit live-platform evidence only.  It is intentionally excluded from
 * `test:real-local`: this project opens a real public Bilibili page in a
 * fresh, test-owned Chromium profile and must be invoked deliberately with
 * `COLLECTOR_LIVE_CANARY=1`.
 */
export default defineConfig({
  testDir: './testing/canary',
  outputDir: 'runtime/live-canary-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [{ name: 'live-canary' }]
});
