import {inlineSqlfu, sql} from '../src/api/exports.js';
import type {SyncClient} from '../src/types.js';

const app = inlineSqlfu({
  definitions: sql`
    create table metrics(rowsAffected integer not null);
  `,
  migrations: [],
  queries: {
    listMetrics: sql<{result: {rowsAffected: number}}>`
      select rowsAffected from metrics
    `,
    createMetric: sql`
      insert into metrics(rowsAffected) values (1)
    `,
  },
});

declare const client: SyncClient;

const metrics: {rowsAffected: number}[] = app(client).listMetrics();
const runResult: {rowsAffected?: number} = app(client).createMetric();
