process.env.CLOUDFLARE_PROFILE ||= 'mishagmail';

import {execFileSync} from 'node:child_process';
import {statSync} from 'node:fs';
import {join} from 'node:path';

import alchemy from 'alchemy';
import {Website} from 'alchemy/cloudflare';

const productionStage = 'mmkal';

const app = await alchemy('sqlfu');

throwIfProductionStageFromGitWorktree(app.stage);

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

function throwIfProductionStageFromGitWorktree(stage: string) {
  if (stage !== productionStage) {
    return;
  }

  const repoRoot = gitRepoRoot();
  const gitEntry = join(repoRoot, '.git');

  let gitEntryIsFile: boolean;
  try {
    gitEntryIsFile = statSync(gitEntry).isFile();
  } catch (error) {
    throw new Error(
      [
        `Refusing to deploy production Alchemy stage "${productionStage}" because the git checkout could not be inspected.`,
        `Expected to read ${gitEntry}.`,
        String(error),
      ].join('\n'),
    );
  }

  if (!gitEntryIsFile) {
    return;
  }

  throw new Error(
    [
      `Refusing to deploy production Alchemy stage "${productionStage}" from a git worktree.`,
      'Production Alchemy state lives in ignored .alchemy files, so deploying from a linked worktree can try to create resources that already exist.',
      'Run the production deploy from the main checkout that owns the prod .alchemy state, or use a non-production --stage value.',
    ].join('\n'),
  );
}

function gitRepoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error(
      [
        `Refusing to deploy production Alchemy stage "${productionStage}" because git rev-parse failed.`,
        String(error),
      ].join('\n'),
    );
  }
}
