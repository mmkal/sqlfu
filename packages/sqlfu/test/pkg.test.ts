import {execa} from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect, test} from 'vitest';

const packageRoot = path.resolve(path.dirname(import.meta.filename), '..');

test('packed package supports normal public imports', async () => {
  await using fixture = await createPackedPackageFixture();

  await fixture.run('root-import.mjs');
  await fixture.run('api-import.mjs');
  await fixture.run('cloudflare-import.mjs');
});

async function createPackedPackageFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-pkg-ignoreme-'));
  const pack = await execa('pnpm', ['pack', '--json', '--pack-destination', root], {cwd: packageRoot});
  const tarballPath = readPackedTarballPath(pack.stdout);

  await writeFixtureFiles(root, {
    'package.json': JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          sqlfu: `file:${tarballPath}`,
        },
      },
      null,
      2,
    ),
    'root-import.mjs': `
      import assert from 'node:assert/strict';
      import {DatabaseSync} from 'node:sqlite';
      import {createNodeSqliteClient} from 'sqlfu';

      const db = new DatabaseSync(':memory:');
      try {
        const client = createNodeSqliteClient(db);
        client.sql.run\`create table users(id integer primary key, email text not null)\`;
        client.sql.run\`insert into users(email) values (\${'ada@example.com'})\`;
        assert.deepEqual(
          client.sql.all\`select id, email from users\`,
          [{id: 1, email: 'ada@example.com'}],
        );
      } finally {
        db.close();
      }
    `,
    'api-import.mjs': `
      import assert from 'node:assert/strict';
      import {createSqlfuApi, format} from 'sqlfu/api';

      assert.equal(typeof createSqlfuApi, 'function');
      assert.equal(format('SELECT * FROM users WHERE id=1;'), 'select *\\nfrom users\\nwhere id = 1;');
    `,
    'cloudflare-import.mjs': `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import {findMiniflareD1Path} from 'sqlfu/cloudflare';
      import {sync} from 'sqlfu/api/sync';

      const miniflareV3Root = path.join(process.cwd(), '.alchemy', 'miniflare', 'v3');
      fs.mkdirSync(miniflareV3Root, {recursive: true});
      const dbPath = findMiniflareD1Path('my-dev-app-slug', {miniflareV3Root});
      assert.equal(path.dirname(path.dirname(path.dirname(dbPath))), miniflareV3Root);
      assert.match(dbPath, /\\.sqlite$/);
      assert.equal(typeof sync, 'function');
    `,
  });

  await execa('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], {cwd: root});

  return {
    async run(fileName: string) {
      await execa('node', [path.join(root, fileName)], {cwd: root});
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

function readPackedTarballPath(stdout: string) {
  const metadata = JSON.parse(stdout) as {filename?: unknown};
  expect(metadata).toMatchObject({filename: expect.any(String)});
  return String(metadata.filename);
}

async function writeFixtureFiles(root: string, files: Record<string, string>) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), {recursive: true});
    await fs.writeFile(fullPath, `${contents.trim()}\n`);
  }
}
