import { defineConfig, devices } from '@playwright/test';

import { isCI } from './tests/helpers/isCI';

if (isCI()) {
  throw new Error('The interaction performance runner is local-only and must not run in CI.');
}

// ポートの切り替えは playwright.config.ts と同じ `E2E_PORT`（既定 5173）。
const envPort = Number(process.env.E2E_PORT);
const port = Number.isInteger(envPort) && envPort >= 1 && envPort <= 65535 ? envPort : 5173;
const baseURL = `http://localhost:${port}`;

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
    baseURL,
    locale: 'ja-JP',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
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
    command: `pnpm run dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
  },
});
