/*
 * pgDialect — postgres implementation of sqlfu's `Dialect` contract.
 *
 * Factory shape (matching `sqliteDialect()` from main sqlfu):
 *
 *   import {pgDialect} from '@sqlfu/pg';
 *   defineConfig({
 *     dialect: pgDialect({adminUrl: process.env.DATABASE_URL!}),
 *     // ...
 *   });
 *
 * `adminUrl` is a postgres connection URL with `CREATEDB` privileges. The
 * dialect uses it to spin up ephemeral databases (`CREATE DATABASE …`) for
 * schemadiff materialization, typegen schema materialization, and
 * `materializeSchemaSql`. Each scratch database is dropped on
 * `Symbol.asyncDispose`. No env-var indirection — the URL flows through
 * the factory closure.
 */
import type {Dialect} from 'sqlfu';

import {pgDiffSchema} from './impl/schemadiff.js';
import {pgFormatSql} from './impl/format.js';
import {pgQuoteIdentifier} from './impl/identifiers.js';
import {
  pgGetRelationColumns,
  pgGetRelationForeignKeys,
  pgGetRelationInfo,
  pgListLiveRelations,
} from './impl/live-introspection.js';
import {pgDefaultMigrationTableDdl, pgWithMigrationLock} from './impl/migrations.js';
import {pgExtractSchemaFromClient, pgMaterializeSchemaSql} from './impl/schema.js';
import {pgAnalyzeQueries, pgLoadSchemaForTypegen, pgMaterializeTypegenSchema} from './impl/typegen.js';

export interface PgDialectOptions {
  /**
   * A postgres connection URL with `CREATEDB` privilege. Used to open an
   * admin connection for `CREATE DATABASE` / `DROP DATABASE` of ephemeral
   * scratch databases (schemadiff, typegen materialize, etc.).
   *
   * Typically the same as `config.db`'s connection string. We require it
   * explicitly so the dialect doesn't have to introspect the user's
   * `db` factory; passing it once at config time is dialect-honest.
   */
  adminUrl: string;
}

export function pgDialect(options: PgDialectOptions): Dialect {
  const {adminUrl} = options;
  return {
    name: 'postgresql',
    diffSchema: pgDiffSchema(adminUrl),
    formatSql: pgFormatSql,
    quoteIdentifier: pgQuoteIdentifier,
    defaultMigrationTableDdl: pgDefaultMigrationTableDdl,
    withMigrationLock: pgWithMigrationLock,
    materializeSchemaSql: pgMaterializeSchemaSql(adminUrl),
    extractSchemaFromClient: pgExtractSchemaFromClient,
    listLiveRelations: pgListLiveRelations,
    getRelationInfo: pgGetRelationInfo,
    getRelationColumns: pgGetRelationColumns,
    getRelationForeignKeys: pgGetRelationForeignKeys,
    materializeTypegenSchema: pgMaterializeTypegenSchema(adminUrl),
    loadSchemaForTypegen: pgLoadSchemaForTypegen,
    analyzeQueries: pgAnalyzeQueries,
  };
}
