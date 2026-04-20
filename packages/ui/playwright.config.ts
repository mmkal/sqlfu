import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './test',
  // The website -> studio end-to-end spec manages its own three-server topology
  // and is run via `playwright.website-e2e.config.ts`. Excluding it here keeps
  // the default harness snappy and avoids spurious port 3218 collisions with
  // the dedicated config.
  testIgnore: /website-landing-to-studio\.spec\.ts/u,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3218',
    headless: true,
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1, MAP localhost 127.0.0.1'],
    },
  },
  webServer: {
    command: 'pnpm exec tsx test/start-server.ts --dev --port 3218',
    port: 3218,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
