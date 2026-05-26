// Live-database introspection helpers for the pg dialect. These power the
// studio's schema browser and row editor by querying pg's catalog tables
// for the `public` schema. They mirror the sqlite dialect's
// `listLiveRelations` / `getRelationInfo` / `getRelationColumns` impls
// (which read `sqlite_master` / `sqlite_schema` / `PRAGMA table_xinfo`).
//
// Scope: `public` schema only. If a project ever needs cross-schema
// browsing in the studio, this helper grows a `schema` argument and the
// queries take a `where n.nspname = $N` clause; for now we keep it simple.
import type {Dialect} from 'sqlfu';

export const pgListLiveRelations: Dialect['listLiveRelations'] = async (client) => {
  const rows = await client.all<{name: string; kind: string; sql: string | null}>({
    sql: `
      select c.relname as name,
             c.relkind::text as kind,
             case when c.relkind = 'v' then pg_get_viewdef(c.oid, true) else null end as sql
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'v')
      order by c.relkind, c.relname
    `,
    args: [],
  });
  return rows.map((row) => ({
    name: row.name,
    kind: row.kind === 'v' ? 'view' : 'table',
    sql: row.sql ?? undefined,
  }));
};

export const pgGetRelationInfo: Dialect['getRelationInfo'] = async (client, relationName) => {
  const rows = await client.all<{name: string; kind: string; sql: string | null}>({
    sql: `
      select c.relname as name,
             c.relkind::text as kind,
             case when c.relkind = 'v' then pg_get_viewdef(c.oid, true) else null end as sql
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = ?
        and c.relkind in ('r', 'v')
    `,
    args: [relationName],
  });
  const row = rows[0];
  if (!row) {
    throw new Error(`Unknown relation "${relationName}"`);
  }
  return {
    name: row.name,
    kind: row.kind === 'v' ? 'view' : 'table',
    sql: row.sql ?? undefined,
  };
};

export const pgGetRelationColumns: Dialect['getRelationColumns'] = async (client, relationName) => {
  // Primary-key membership comes from pg_index — we look for any unique
  // primary index whose `indkey` array contains the column's `attnum`.
  // The `coalesce` makes the result `false` (rather than null) for
  // tables without any primary key.
  const rows = await client.all<{name: string; type: string; not_null: boolean; primary_key: boolean}>({
    sql: `
      select a.attname as name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
             a.attnotnull as not_null,
             coalesce((
               select i.indisprimary
               from pg_index i
               where i.indrelid = a.attrelid
                 and a.attnum = any(i.indkey)
                 and i.indisprimary
               limit 1
             ), false) as primary_key
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = ?
        and a.attnum > 0
        and not a.attisdropped
      order by a.attnum
    `,
    args: [relationName],
  });
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    notNull: row.not_null,
    primaryKey: row.primary_key,
  }));
};

export const pgGetRelationForeignKeys: Dialect['getRelationForeignKeys'] = async (client, relationName) => {
  const rows = await client.all<{
    columns: string[];
    referenced_relation: string;
    referenced_columns: string[];
  }>({
    sql: `
      select array_agg(source_attribute.attname order by keys.ordinality) as columns,
             referenced_class.relname as referenced_relation,
             array_agg(referenced_attribute.attname order by keys.ordinality) as referenced_columns
      from pg_constraint constraint_info
      join pg_class source_class on source_class.oid = constraint_info.conrelid
      join pg_namespace source_namespace on source_namespace.oid = source_class.relnamespace
      join pg_class referenced_class on referenced_class.oid = constraint_info.confrelid
      join unnest(constraint_info.conkey, constraint_info.confkey) with ordinality as keys(source_attnum, referenced_attnum, ordinality) on true
      join pg_attribute source_attribute on source_attribute.attrelid = source_class.oid
        and source_attribute.attnum = keys.source_attnum
      join pg_attribute referenced_attribute on referenced_attribute.attrelid = referenced_class.oid
        and referenced_attribute.attnum = keys.referenced_attnum
      where source_namespace.nspname = 'public'
        and source_class.relname = ?
        and constraint_info.contype = 'f'
      group by constraint_info.oid, referenced_class.relname
      order by constraint_info.conname
    `,
    args: [relationName],
  });
  return rows.map((row) => ({
    columns: row.columns,
    referencedRelation: row.referenced_relation,
    referencedColumns: row.referenced_columns,
  }));
};
