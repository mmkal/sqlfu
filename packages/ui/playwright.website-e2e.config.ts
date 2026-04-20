import {defineConfig} from '@playwright/test';

// Dedicated config for the website -> studio end-to-end spec. That spec stands
// up its own three-server topology (website, UI, sqlfu backend) on free ports,
// so we deliberately do not set a Playwright-managed `webServer` here. Keeping
// this separate from `playwright.config.ts` also means the default test harness
// stays snappy and is not forced to run these heavier scenarios.
export default defineConfig({
  testDir: './test',
  testMatch: /website-landing-to-studio\.spec\.ts/u,
  timeout: 180_000,
  use: {
    headless: true,
  },
});
