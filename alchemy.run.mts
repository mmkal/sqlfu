process.env.CLOUDFLARE_PROFILE ||= 'mishagmail';

import alchemy from 'alchemy';
import {Website} from 'alchemy/cloudflare';

const app = await alchemy('sqlfu');

// One Website, both hostnames (apex and www) bound to the same Worker.
// The UI ships under /ui/ via website/scripts/sync-ui.mjs copying
// packages/ui/dist into website/dist/ui before deploy. Single-origin
// deployment avoids the Cloudflare edge 403 that the separate-subdomain
// layout produced when Chrome coalesced HTTP/2 or HTTP/3 connections
// across sqlfu.dev hostnames — since both domains now point at the same
// Worker, any coalesced request still routes to the same place.
//
// A canonical-host 301 (www → apex) would be nice to have but requires
// CF API token scopes we don't have; set up manually in the dashboard if
// desired. Without it, both URLs just serve the same content.
await Website('www', {
  name: 'sqlfu-www',
  cwd: './website',
  build: 'pnpm build',
  assets: './dist',
  domains: [
    {domainName: 'sqlfu.dev', adopt: true},
    {domainName: 'www.sqlfu.dev', adopt: true},
  ],
});

await app.finalize();
