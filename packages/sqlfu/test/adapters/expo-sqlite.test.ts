import fs from 'node:fs/promises';
import path from 'node:path';

import dedent from 'dedent';
import {execa} from 'execa';
import {expect, test as baseTest} from 'vitest';

import {packageRoot} from './ensure-built.js';
import {
  captureOutput,
  createBrowserRpcFixture,
  type BrowserRpcFixture,
  type RenderedHost,
  runCommand,
  stopProcess,
} from './browser-rpc-fixture.js';

const test = baseTest.skipIf(!process.env.EXPO_TEST);

declare const createExpoSqliteClient: typeof import('../../src/client.js').createExpoSqliteClient;
declare const sql: typeof import('../../src/client.js').sql;

test('createExpoSqliteClient works in a real expo web app', {timeout: 180_000}, async () => {
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
});

test('createExpoSqliteClient can write and read rows in a real expo web app', {timeout: 180_000}, async () => {
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
});

test('createExpoSqliteClient.raw runs multiple statements in a real expo web app', {timeout: 180_000}, async () => {
  await using fixture = await createExpoWebFixture(
    class ClientMultiStatementTest {
      client: ReturnType<typeof createExpoSqliteClient>;

      constructor(db: any) {
        this.client = createExpoSqliteClient(db);
      }

      async seedPeople() {
        return this.client.raw(`
            create table person (
              id integer primary key,
              name text not null
            );
            insert into person (id, name) values (1, 'bob');
            insert into person (id, name) values (2, 'ada');
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

  await fixture.stub.seedPeople();

  expect(await fixture.stub.listPeople()).toMatchObject([
    {id: 1, name: 'bob'},
    {id: 2, name: 'ada'},
  ]);
});

function createExpoWebFixture<TInstance extends object>(
  classDef: new (...args: any[]) => TInstance,
): Promise<BrowserRpcFixture<TInstance>> {
  return createBrowserRpcFixture({
    classDef,
    async renderHost({root, port, classDefString, className, methodNames}): Promise<RenderedHost> {
      await Promise.all([
        fs.writeFile(
          path.join(root, 'package.json'),
          dedent`
            {
              "name": "sqlfu-expo-web-fixture",
              "private": true,
              "dependencies": {
                "expo": "55.0.13",
                "expo-sqlite": "55.0.15",
                "react": "19.2.0",
                "react-dom": "19.2.0",
                "react-native": "0.83.4",
                "react-native-web": "0.21.2"
              }
            }
          ` + '\n',
        ),
        fs.writeFile(
          path.join(root, 'app.json'),
          dedent`
            {
              "expo": {
                "name": "sqlfu expo web fixture",
                "slug": "sqlfu-expo-web-fixture"
              }
            }
          ` + '\n',
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
        fs.cp(path.join(packageRoot, 'dist'), path.join(root, 'runtime'), {recursive: true}),
      ]);

      await fs.writeFile(
        path.join(root, 'App.js'),
        dedent`
          import React, {useEffect, useState} from 'react';
          import {Button, Text, TextInput, View} from 'react-native';
          import * as SQLite from 'expo-sqlite';
          import {createExpoSqliteClient} from './runtime/adapters/expo-sqlite.js';
          import {sql} from './runtime/core/sql.js';

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

      const server = execa('pnpm', ['exec', 'expo', 'start', '--port', String(port)], {
        cwd: root,
        env,
        all: true,
        reject: false,
      });
      const serverLogs = captureOutput(server);

      return {
        serverLogs,
        async [Symbol.asyncDispose]() {
          await stopProcess(server);
        },
      };
    },
  });
}
