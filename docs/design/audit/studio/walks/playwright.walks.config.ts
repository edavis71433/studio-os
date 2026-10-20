import { defineConfig, devices } from '@playwright/test';

// Studio-side audit walks (docs/design/STUDIO-AUDIT-2026-10.md). Not part of the e2e suite.
// Run from the repo root:  npx playwright test -c docs/design/audit/studio/walks/playwright.walks.config.ts
process.env.TZ = 'UTC';
process.env.AUDIT_SHOTS = process.env.AUDIT_SHOTS || 'docs/design/audit/studio';
process.env.AUDIT_LOG = process.env.AUDIT_LOG || 'docs/design/audit/studio/walks.jsonl';
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4196', serviceWorkers: 'block', timezoneId: 'UTC' },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: { command: 'npx http-server . -p 4196 -c-1 --silent', cwd: '../../../../..', url: 'http://127.0.0.1:4196/today.html', reuseExistingServer: false, timeout: 60_000 },
});
