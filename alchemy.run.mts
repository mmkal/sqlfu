import {Website, Zone} from 'alchemy/cloudflare';

// This is the authoritative Cloudflare DNS zone for sqlfu.dev. The two
// Websites attach their custom domains through this zone, and it gives us one
// place to manage DNS and Pages bindings as code.
const zone = await Zone('sqlfu-zone', {
  name: 'sqlfu.dev',
  type: 'full',
  jumpStart: true,
  settings: {
    alwaysUseHttps: 'on',
    automaticHttpsRewrites: 'on',
    http2: 'on',
    http3: 'on',
    brotli: 'on',
  },
});

await Website('www', {
  name: 'sqlfu-www',
  cwd: './website',
  build: 'pnpm build',
  assets: './dist',
  domains: [
    {
      domainName: 'www.sqlfu.dev',
      zoneId: zone.id,
    },
  ],
});

await Website('local-ui', {
  name: 'sqlfu-local-ui',
  cwd: './packages/ui',
  build: 'pnpm build',
  assets: {
    directory: './dist',
    not_found_handling: 'single-page-application',
  },
  domains: [
    {
      domainName: 'local.sqlfu.dev',
      zoneId: zone.id,
    },
  ],
});
