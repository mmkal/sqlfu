import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './test',
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
