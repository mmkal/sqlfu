import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Miniflare} from 'miniflare';
import ts from 'typescript';
import {expect, test} from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
declare const createD1Client: typeof import('../src/index.ts').createD1Client;
declare const sql: typeof import('../src/index.ts').sql;

test('createD1Client works in a generated local worker fixture', async () => {
  await using fixture = await createD1Fixture({
    async fetch(request: Request, env: {DB: unknown}) {
      const db = createD1Client(env.DB as Parameters<typeof createD1Client>[0]);
      const url = new URL(request.url);

      if (url.pathname === '/create') {
        await db.run(sql`
          create table if not exists person (
            id integer primary key,
            name text not null
          )
        `);
        return Response.json({ok: true});
      }

      if (url.pathname === '/insert') {
        await db.run(sql`
          insert into person (id, name)
          values (${Number(url.searchParams.get('id'))}, ${String(url.searchParams.get('name'))})
        `);
        return Response.json({ok: true});
      }

      if (url.pathname === '/list') {
        const rows = await db.all<{id: number; name: string}>(sql`
          select id, name
          from person
          order by id
        `)
        return Response.json(rows);
      }

      return new Response('not found', {status: 404});
    },
  });

  expect(await fixture.json('/create')).toMatchObject({ok: true});
  expect(await fixture.json('/insert?id=1&name=bob')).toMatchObject({ok: true});
  expect(await fixture.json('/insert?id=2&name=ada')).toMatchObject({ok: true});
  expect(await fixture.json('/list')).toMatchObject([
    {id: 1, name: 'bob'},
    {id: 2, name: 'ada'},
  ]);
});

async function createD1Fixture(workerDef: {
  fetch(request: Request, env: {DB: unknown}, ctx: unknown): Promise<Response> | Response;
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-d1-fixture-'));
  const workerPath = path.join(tempDir, 'worker.js');
  const sqlRuntimePath = path.join(tempDir, 'runtime/sql.js');
  const d1RuntimePath = path.join(tempDir, 'runtime/d1.js');

  await Promise.all([
    writeTranspiledModule(path.join(packageRoot, 'src/core/sql.ts'), sqlRuntimePath),
    writeTranspiledModule(
      path.join(packageRoot, 'src/adapters/d1.ts'),
      d1RuntimePath,
      [['../core/sql.js', './sql.js']],
    ),
  ]);

  await fs.writeFile(
    workerPath,
    [
      `import {createD1Client} from './runtime/d1.js';`,
      `import {sql} from './runtime/sql.js';`,
      ``,
      `const userFetch = ${toCallableFunctionSource(workerDef.fetch.toString())};`,
      ``,
      `export default {`,
      `  fetch(request, env, ctx) {`,
      `    return userFetch(request, env, ctx);`,
      `  },`,
      `};`,
      ``,
    ].join('\n'),
  );

  const miniflare = new Miniflare({
    rootPath: tempDir,
    modulesRoot: tempDir,
    scriptPath: 'worker.js',
    modules: true,
    modulesRules: [{type: 'ESModule', include: ['**/*.js']}],
    d1Databases: ['DB'],
  });

  await miniflare.ready;

  const worker = await miniflare.getWorker() as unknown as WorkerFetcherLike;

  return {
    async fetch(input: string, init?: RequestInit) {
      return worker.fetch(`http://fixture${input}`, init);
    },
    async json(input: string, init?: RequestInit) {
      const response = await worker.fetch(`http://fixture${input}`, init);
      return response.json();
    },
    async [Symbol.asyncDispose]() {
      await miniflare.dispose();
      await fs.rm(tempDir, {recursive: true, force: true});
    },
  };
}

function toCallableFunctionSource(source: string): string {
  if (source.startsWith('async fetch(')) {
    return source.replace(/^async fetch\(/, 'async function fetch(');
  }

  if (source.startsWith('fetch(')) {
    return source.replace(/^fetch\(/, 'function fetch(');
  }

  return source;
}

async function writeTranspiledModule(
  sourcePath: string,
  outputPath: string,
  replacements: ReadonlyArray<readonly [from: string, to: string]> = [],
) {
  const source = await fs.readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: sourcePath,
  });

  let output = transpiled.outputText;
  for (const [from, to] of replacements) {
    output = output.replaceAll(from, to);
  }

  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, output);
}

interface WorkerFetcherLike {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
