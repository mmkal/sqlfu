import {expect, test} from '@playwright/test';

import {ensureNgrokTunnel, stopNgrokTunnel} from './ngrok.ts';

test.skip(!process.env.SQLFU_TEST_NGROK, 'Set SQLFU_TEST_NGROK=1 to run the ngrok tunnel smoke test.');

test('hosted UI simulation is reachable through ngrok on top of the normal UI test server', async ({page}) => {
  await using fixture = await startNgrokForUiServer();

  expect(fixture.publicUrl).toMatch(/^https:\/\//u);

  await page.goto(fixture.publicUrl);

  await expect(page).toHaveTitle(/sqlfu\/ui/u);
});

async function startNgrokForUiServer() {
  const tunnel = await ensureNgrokTunnel({
    port: 3218,
    domain: process.env.SQLFU_NGROK_DOMAIN || '',
    url: process.env.SQLFU_NGROK_URL || '',
  });
  if (!tunnel) {
    throw new Error('ngrok is not installed or unavailable');
  }

  return {
    publicUrl: tunnel.public_url,
    async [Symbol.asyncDispose]() {
      await stopNgrokTunnel(tunnel.process);
    },
  };
}
