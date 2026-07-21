import { defineConfig } from '@playwright/test';

/**
 * L3 only. Every spec uses production dist plus a fresh test-scoped profile
 * and must leave livePlatformRequests at zero. Live websites are forbidden.
 */
export default defineConfig({
  testDir: './testing/real-local',
  outputDir: 'runtime/test-results/real-local',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'runtime/test-results/real-local/junit.xml' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  }
});
