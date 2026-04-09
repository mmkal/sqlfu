import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import dedent from 'dedent';
import {execa} from 'execa';
import {chromium, type Page} from 'playwright';
import ts from 'typescript';
import {expect, test} from 'vitest';

const packageRoot = path.resolve(path.dirname(import.meta.filename), '..');
declare const createExpoSqliteClient: typeof import('../src/client.ts').createExpoSqliteClient;
declare const sql: typeof import('../src/client.ts').sql;
type ExecaProcess = ReturnType<typeof execa>;

test(
  'createExpoSqliteClient works in a real expo web app',
  {timeout: 180_000},
  async () => {
    await using fixture = await createExpoWebFixture(
      class ClientDotAllTest {
        client: ReturnType<typeof createExpoSqliteClient>;

        constructor(db: any) {
          this.client = createExpoSqliteClient(db);
        }

        async testme() {
          return this.client.all(sql`select 1 as value`);
        }
      },
    );

    expect(await fixture.stub.testme()).toMatchObject([{value: 1}]);
  },
);

test(
  'createExpoSqliteClient can write and read rows in a real expo web app',
  {timeout: 180_000},
  async () => {
    await using fixture = await createExpoWebFixture(
      class ClientPersonTest {
        client: ReturnType<typeof createExpoSqliteClient>;

        constructor(db: any) {
          this.client = createExpoSqliteClient(db);
        }

        async resetPeople() {
          await this.client.run(sql`
            drop table if exists person
          `);
          await this.client.run(sql`
            create table if not exists person (
              id integer primary key,
              name text not null
            )
          `);
          await this.client.run(sql`delete from person`);
        }

        async insertPerson(id: number, name: string) {
          return this.client.run(sql`
            insert into person (id, name) values (${id}, ${name})
          `);
        }

        async listPeople() {
          return this.client.all<{id: number; name: string}>(sql`
            select id, name
            from person
            order by id
          `);
        }
      },
    );

    await fixture.stub.resetPeople();
    await fixture.stub.insertPerson(1, 'bob');
    await fixture.stub.insertPerson(2, 'ada');

    expect(await fixture.stub.listPeople()).toMatchObject([
      {id: 1, name: 'bob'},
      {id: 2, name: 'ada'},
    ]);
  },
);

async function createExpoWebFixture<TInstance extends object>(classDef: new (...args: any[]) => TInstance) {
  await ensurePlaywrightBrowserInstalled();

  const classDefString = classDef.toString().trim();
  const className = classDefString.match(/^class (\w+) \{/)?.[1];
  if (!className) {
    throw new Error(`Failed to extract class name from class definition: ${classDefString}`);
  }

  const methodNames = Object.getOwnPropertyNames(classDef.prototype).filter((name) => name !== 'constructor');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-expo-web-'));
  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;

  await Promise.all([
    fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'sqlfu-expo-web-fixture',
        private: true,
        dependencies: {
          expo: '55.0.13',
          'expo-sqlite': '55.0.15',
          react: '19.2.0',
          'react-dom': '19.2.0',
          'react-native': '0.83.4',
          'react-native-web': '0.21.2',
        },
      }),
    ),
    fs.writeFile(
      path.join(root, 'app.json'),
      JSON.stringify({
        expo: {
          name: 'sqlfu expo web fixture',
          slug: 'sqlfu-expo-web-fixture',
        },
      }),
    ),
    fs.writeFile(
      path.join(root, 'metro.config.js'),
      dedent`
        const {getDefaultConfig} = require('expo/metro-config');
        const config = getDefaultConfig(__dirname);
        config.resolver.assetExts.push('wasm');
        module.exports = config;
      ` + '\n',
    ),
    fs.mkdir(path.join(root, 'runtime'), {recursive: true}),
  ]);

  await Promise.all([
    writeTranspiledModule(path.join(packageRoot, 'src/core/sql.ts'), path.join(root, 'runtime', 'sql.js')),
    writeTranspiledModule(
      path.join(packageRoot, 'src/adapters/expo-sqlite.ts'),
      path.join(root, 'runtime', 'expo-sqlite.js'),
      [['../core/sql.js', './sql.js']],
    ),
  ]);

  await fs.writeFile(
    path.join(root, 'App.js'),
    dedent`
      import React, {useEffect, useState} from 'react';
      import {Button, Text, TextInput, View} from 'react-native';
      import * as SQLite from 'expo-sqlite';
      import {createExpoSqliteClient} from './runtime/expo-sqlite.js';
      import {sql} from './runtime/sql.js';

      ${classDefString}

      const methodNames = ${JSON.stringify(methodNames)};
      let fixturePromise;

      function bootFixture() {
        if (!fixturePromise) {
          fixturePromise = SQLite.openDatabaseAsync('fixture.db').then((db) => new ${className}(db));
        }
        return fixturePromise;
      }

      export default function App() {
        const [bootStatus, setBootStatus] = useState('booting');
        const [bootError, setBootError] = useState('');
        const [argTexts, setArgTexts] = useState(() => Object.fromEntries(methodNames.map((method) => [method, '[]'])));
        const [requestId, setRequestId] = useState(0);
        const [callStatus, setCallStatus] = useState('idle');
        const [callResult, setCallResult] = useState('');
        const [callError, setCallError] = useState('');

        useEffect(() => {
          bootFixture().then(
            () => setBootStatus('ready'),
            (error) => {
              setBootStatus('error');
              setBootError(String(error));
            },
          );
        }, []);

        async function invoke(method) {
          const nextRequestId = requestId + 1;
          setRequestId(nextRequestId);
          setCallStatus('running');
          setCallResult('');
          setCallError('');
          try {
            const parsed = JSON.parse(argTexts[method]);
            if (!Array.isArray(parsed)) {
              throw new Error('Method args must be a JSON array');
            }
            const fixture = await bootFixture();
            const value = await fixture[method](...parsed);
            setCallResult(JSON.stringify({requestId: nextRequestId, value}));
            setCallStatus('success');
          } catch (error) {
            setCallError(JSON.stringify({requestId: nextRequestId, message: String(error)}));
            setCallStatus('error');
          }
        }

        return (
          <View>
            <Text testID="boot-status">{bootStatus}</Text>
            <Text testID="boot-error">{bootError}</Text>
            <Text testID="rpc-request-id">{String(requestId)}</Text>
            <Text testID="rpc-status">{callStatus}</Text>
            <Text testID="rpc-result">{callResult}</Text>
            <Text testID="rpc-error">{callError}</Text>
            {methodNames.map((method) => (
              <View key={method}>
                <TextInput
                  testID={\`rpc-input-\${method}\`}
                  value={argTexts[method]}
                  onChangeText={(text) => {
                    setArgTexts((current) => ({...current, [method]: text}));
                  }}
                />
                <Button
                  testID={\`rpc-\${method}\`}
                  title={method}
                  onPress={() => {
                    void invoke(method);
                  }}
                />
              </View>
            ))}
          </View>
        );
      }
    `,
  );

  const env = {CI: '1', EXPO_NO_TELEMETRY: '1'};

  await runCommand('pnpm', ['install'], root, env);

  const server = execa(
    'pnpm',
    ['exec', 'expo', 'start', '--port', String(port)],
    {cwd: root, env, all: true, reject: false}
  );
  const serverLogs = captureOutput(server);

  try {
    await waitForHttp(url, 30_000);
    const browser = await chromium.launch({headless: true});
    const page = await browser.newPage();
    const browserLogs = capturePageOutput(page);
    await page.goto(url, {waitUntil: 'networkidle'});
    await waitForFixtureBoot(page, serverLogs, browserLogs);

    return {
      stub: createExpoWebStub<TInstance>(page, serverLogs, browserLogs),
      async [Symbol.asyncDispose]() {
        await Promise.allSettled([browser.close(), stopProcess(server), fs.rm(root, {recursive: true, force: true})]);
      },
    };
  } catch (error) {
    await Promise.allSettled([stopProcess(server), fs.rm(root, {recursive: true, force: true})]);
    throw new Error(formatFixtureFailure(error instanceof Error ? error.message : String(error), serverLogs(), []));
  }
}

function createExpoWebStub<TInstance extends object>(
  page: Page,
  serverLogs: () => string,
  browserLogs: () => readonly string[],
) {
  let nextRequestId = 1;

  return new Proxy({} as TInstance, {
    get(_target, propertyKey) {
      if (typeof propertyKey !== 'string') {
        return undefined;
      }

      return async (...args: readonly unknown[]) => {
        const requestId = nextRequestId++;

        try {
          await page.getByTestId(`rpc-input-${propertyKey}`).fill(JSON.stringify(args));
          await page.getByTestId(`rpc-${propertyKey}`).click();

          await page.waitForFunction(
            ({requestId}) => {
              const browserGlobal = globalThis as typeof globalThis & {document?: any};
              const renderedRequestId = browserGlobal.document?.querySelector('[data-testid="rpc-request-id"]')?.textContent;
              const renderedStatus = browserGlobal.document?.querySelector('[data-testid="rpc-status"]')?.textContent;
              return renderedRequestId === String(requestId) && renderedStatus !== 'running';
            },
            {requestId},
            {timeout: 30_000},
          );

          const status = await page.getByTestId('rpc-status').textContent();
          const resultText = await page.getByTestId('rpc-result').textContent();
          const errorText = await page.getByTestId('rpc-error').textContent();

          if (status === 'error') {
            const payload = errorText ? JSON.parse(errorText) as {requestId: number; message: string} : undefined;
            throw new Error(payload?.message ?? 'Fixture RPC failed');
          }

          const payload = resultText ? JSON.parse(resultText) as {requestId: number; value: unknown} : undefined;
          if (!payload || payload.requestId !== requestId) {
            throw new Error(`Fixture returned an unexpected RPC result for ${propertyKey}`);
          }

          return payload.value;
        } catch (error) {
          throw new Error(
            formatFixtureFailure(error instanceof Error ? error.message : String(error), serverLogs(), browserLogs()),
          );
        }
      };
    },
  });
}

async function waitForFixtureBoot(
  page: Page,
  serverLogs: () => string,
  browserLogs: () => readonly string[],
): Promise<void> {
  try {
    await page.waitForFunction(() => {
      const browserGlobal = globalThis as typeof globalThis & {document?: any};
      const status = browserGlobal.document?.querySelector('[data-testid="boot-status"]')?.textContent;
      return status === 'ready' || status === 'error';
    }, undefined, {timeout: 30_000});

    const bootStatus = await page.getByTestId('boot-status').textContent();
    if (bootStatus === 'error') {
      const bootError = await page.getByTestId('boot-error').textContent();
      throw new Error(bootError || 'Fixture boot failed');
    }
  } catch (error) {
    throw new Error(formatFixtureFailure(error instanceof Error ? error.message : String(error), serverLogs(), browserLogs()));
  }
}

async function ensurePlaywrightBrowserInstalled(): Promise<void> {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/executable doesn't exist|please run the following command/i.test(message)) {
      throw error;
    }
  }

  await runCommand('pnpm', ['exec', 'playwright', 'install', 'chromium'], packageRoot);
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

async function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error(`Failed to allocate a local port: ${String(address)}`));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}

    await delay(250);
  }

  throw new Error(`Timed out waiting for Expo web to respond at ${url}`);
}

function captureOutput(child: ExecaProcess) {
  const chunks: string[] = [];
  child.all?.on('data', (chunk: string | Buffer) => {
    chunks.push(String(chunk));
    if (chunks.length > 200) {
      chunks.shift();
    }
  });

  return () => chunks.join('');
}

function capturePageOutput(page: Page) {
  const entries: string[] = [];
  const push = (line: string) => {
    entries.push(line);
    if (entries.length > 100) {
      entries.shift();
    }
  };

  page.on('console', (message) => {
    push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    push(`[pageerror] ${error.message}`);
  });

  return () => entries;
}

function formatFixtureFailure(message: string, serverLogs: string, browserLogs: readonly string[]): string {
  return [
    message,
    '',
    'Server logs:',
    serverLogs.trim() || '(none)',
    '',
    'Browser logs:',
    browserLogs.length > 0 ? browserLogs.join('\n') : '(none)',
  ].join('\n');
}

async function stopProcess(child: ExecaProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGINT');
  const exited = await Promise.race([child.then(() => true, () => true), delay(5_000).then(() => false)]);

  if (!exited && child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
    await child.catch(() => undefined);
  }
}

async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<void> {
  const result = await execa(command, args, {
    cwd,
    env: extraEnv,
    all: true,
    reject: false,
  });

  if (result.exitCode === 0) {
    return;
  }

  throw new Error(result.all?.trim() || `${command} exited with code ${result.exitCode ?? 'unknown'}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
