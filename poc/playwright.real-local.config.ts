import { defineConfig } from '@playwright/test';

/**
 * Real-local only. Every spec uses production dist plus a fresh test-scoped
 * profile and must leave livePlatformRequests at zero. The projects make the
 * boundary explicit:
 *
 * - integration: one production subsystem boundary at a time (MV3, Native
 *   Messaging, or Browser Host); and
 * - e2e-local: Gateway API through Browser Host and Chromium as one product
 *   journey.
 *
 * Live websites are forbidden in both projects. They belong to the separate
 * manually initiated Canary evidence process.
 */
export default defineConfig({
  testDir: './testing',
  outputDir: 'runtime/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'runtime/test-results/junit.xml' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'integration',
      testMatch: 'integration/**/*.spec.ts',
      outputDir: 'runtime/test-results/integration'
    },
    {
      name: 'e2e-local',
      testMatch: 'e2e/**/*.spec.ts',
      outputDir: 'runtime/test-results/e2e-local'
    }
  ]
});
