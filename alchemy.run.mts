process.env.CLOUDFLARE_PROFILE ||= 'mishagmail';

import alchemy from 'alchemy';
import {Website} from 'alchemy/cloudflare';

const app = await alchemy('sqlfu');

await Website('www', {
  name: 'sqlfu-www',
  cwd: './website',
  build: 'pnpm build',
  assets: './dist',
  domains: [
    {
      domainName: 'www.sqlfu.dev',
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
    },
  ],
});

await app.finalize();
