import { defineConfig, devices } from '@playwright/test';

// ── Studio OS browser E2E (Phase PW) ─────────────────────────────────────────
// The suite is HERMETIC: a local static server serves the real HTML/JS/CSS, and
// every test stubs the Supabase client + mocks the /functions/v1/presence API
// with fixtures (see tests/e2e/helpers/app.ts). So it exercises the REAL page
// behaviour against controlled data — no backend, no credentials, no data
// mutation. Deterministic, independent, repeatable, fast, CI-ready.
export default defineConfig({
  testDir: './tests/e2e',
  snapshotDir: './tests/e2e/__screenshots__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,      // a stray test.only fails the CI gate
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],
  timeout: 30_000,
  expect: { timeout: 7_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npx http-server . -p 4173 -c-1 --silent',
    url: 'http://127.0.0.1:4173/today.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
