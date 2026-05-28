import {defineConfig, sql} from '../src/index.js';
import type {SyncClient} from '../src/types.js';

const app = defineConfig({
  definitions: sql`
    create table metrics(rowsAffected integer not null);
  `,
  migrations: [],
  queries: {
    listMetrics: {
      query: sql`
        select rowsAffected from metrics
      `,
      mode: 'many',
      $type: {} as {result: {rowsAffected: number}},
    },
    createMetric: {
      query: sql`
        insert into metrics(rowsAffected) values (1)
      `,
      mode: 'metadata',
      $type: {} as {},
    },
  },
});

declare const client: SyncClient;

const metrics: {rowsAffected: number}[] = app(client).listMetrics();
const runResult: {rowsAffected?: number} = app(client).createMetric();
