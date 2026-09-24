import { defineConfig, devices } from '@playwright/test';

import { isCI } from './tests/helpers/isCI';

/**
 * E2E が使う dev サーバーのポート。既定は 5173（起動中の dev サーバーをそのまま再利用する）。
 * 並列作業の worktree など、5173 の dev サーバーと分けたいときだけ `E2E_PORT=5199` のように指定する。
 * 一時的な playwright 設定ファイルを作ったり、node_modules をリンクで共有したりしないこと。
 */
const envPort = Number(process.env.E2E_PORT);
const port = Number.isInteger(envPort) && envPort >= 1 && envPort <= 65535 ? envPort : 5173;
const baseURL = `http://localhost:${port}`;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: isCI(),
  /* CI は直列実行なので 2 回。ローカルは並列実行で稀に1件取りこぼす（マシン負荷依存で、
     落ちるテストは毎回変わる）ため 1 回だけ再試行する。本物の失敗は再試行でも落ちる。 */
  retries: isCI() ? 2 : 1,
  /* Opt out of parallel tests on CI. */
  workers: isCI() ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Force Japanese locale so E2E assertions match Japanese UI text */
    locale: 'ja-JP',
    /* Browser-detected defaults and official GSD oracle dates must be host-TZ independent. */
    timezoneId: 'Asia/Tokyo',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Skip onboarding tour and set language for all tests */
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

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/responsive-panels.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      testMatch: '**/responsive-panels.spec.ts',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    // Firefox と WebKit は必要に応じて有効化
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `pnpm run dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !isCI(),
  },
});
