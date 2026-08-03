import { defineConfig, devices } from '@playwright/test';

import { isCI } from './tests/helpers/isCI';

if (isCI()) {
  throw new Error('The interaction performance runner is local-only and must not run in CI.');
}

export default defineConfig({
  testDir: './tests/perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  // This is a manually invoked measurement job, not a pass/fail CI test.
  // Do not discard a long 300-entry Box run because of a generic test timeout.
  timeout: 0,
  expect: { timeout: 10_000 },
  outputDir: './_local/playwright-perf-artifacts',
  use: {
    actionTimeout: 10_000,
    baseURL: 'http://localhost:5173',
    locale: 'ja-JP',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [
            { name: 'candy-boost-planner:onboarding-done', value: '1' },
            { name: 'candy-boost-planner:lang', value: 'ja' },
          ],
        },
      ],
    },
  },
  projects: [
    {
      name: 'chromium-local-perf',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
