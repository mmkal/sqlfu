import {defineConfig} from '@playwright/test';

const port = Number(process.env.SQLFU_UI_TEST_PORT || 3218);

export default defineConfig({
  testDir: './test',
  timeout: 30_000,
  // Default `expect` timeout (5s) is tight when pg specs run concurrently
  // with sqlite ones — the dev server services a real postgres database
  // for some workers and the renders gate on that. 15s is comfortably
  // longer than typical pg page loads under contention without masking
  // real regressions, and well within the per-test 30s ceiling.
  expect: {timeout: 15_000},
  // Snapshots are used for pure-algorithm output (no browser rendering), so
  // drop Playwright's default {platform} suffix — one file works on mac + linux.
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  globalSetup: './test/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1, MAP localhost 127.0.0.1'],
    },
  },
  webServer: {
    command: `pnpm exec tsx test/start-server.ts --dev --port ${port}`,
    port,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
