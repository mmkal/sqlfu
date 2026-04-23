import type {AsyncClient, Client, QueryArg, SyncClient} from './types.js';

export async function extractSchema(
  client: Client,
  schemaName = 'main',
  input: {
    excludedTables?: string[];
  } = {},
): Promise<string> {
  const excludedTables = input.excludedTables ?? [];
  const excludedTableFilter = excludedTables
    .map((tableName) => `and name != ${sqlStringLiteral(tableName)}`)
    .join('\n        ');
  const rows = await client.all<{sql: string | null}>({
    sql: `
      select sql
      from ${schemaName}.sqlite_schema
      where sql is not null
        and name not like 'sqlite_%'
        ${excludedTableFilter}
      order by
        case type
          when 'table' then 0
          when 'view' then 1
          when 'index' then 2
          when 'trigger' then 3
        end,
        name
    `,
    args: [],
  });

  return rows.map((row) => `${String(row.sql).toLowerCase()};`).join('\n');
}

function sqlStringLiteral(value: string) {
  return `'${value.replaceAll(`'`, `''`)}'`;
}

export type SqliteSchemaFingerprint = {
  tables: {
    name: string;
    columns: {
      name: string;
      type: string;
      notNull: boolean;
      defaultValue: string | null;
      primaryKeyPosition: number;
      hidden: number;
    }[];
    indexes: {
      unique: boolean;
      origin: string;
      partial: boolean;
      columns: string[];
    }[];
  }[];
  views: {
    name: string;
    sql: string;
  }[];
};

export async function inspectSchemaFingerprint(client: Client, schemaName = 'main'): Promise<SqliteSchemaFingerprint> {
  const objects = await client.all<{
    type: 'table' | 'view';
    name: string;
    sql: string | null;
  }>({
    sql: `
      select type, name, sql
      from ${schemaName}.sqlite_schema
      where type in ('table', 'view')
        and name not like 'sqlite_%'
        and name != 'sqlfu_migrations'
      order by type, name
    `,
    args: [],
  });

  const tables = [];
  const views = [];

  for (const object of objects) {
    if (object.type === 'view') {
      views.push({
        name: object.name,
        sql: normalizeSchemaStatement(object.sql ?? ''),
      });
      continue;
    }

    const tableNameLiteral = quoteSqlString(object.name);
    const columns = await client.all<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
      hidden: number;
    }>({
      sql: `select name, type, "notnull", dflt_value, pk, hidden from pragma_table_xinfo(${tableNameLiteral}) order by cid`,
      args: [],
    });
    const indexList = await client.all<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>({
      sql: `select name, "unique", origin, partial from pragma_index_list(${tableNameLiteral}) order by name`,
      args: [],
    });

    const indexes = [];
    for (const index of indexList) {
      const indexNameLiteral = quoteSqlString(index.name);
      const indexColumns = await client.all<{name: string}>({
        sql: `select name from pragma_index_info(${indexNameLiteral}) order by seqno`,
        args: [],
      });
      indexes.push({
        unique: Boolean(index.unique),
        origin: index.origin,
        partial: Boolean(index.partial),
        columns: indexColumns.map((column) => column.name),
      });
    }

    tables.push({
      name: object.name,
      columns: columns.map((column) => ({
        name: column.name,
        type: String(column.type ?? '').toLowerCase(),
        notNull: Boolean(column.notnull),
        defaultValue: column.dflt_value,
        primaryKeyPosition: column.pk,
        hidden: column.hidden,
      })),
      indexes,
    });
  }

  return {tables, views};
}

export function rawSqlWithSqlSplittingSync(
  runOne: (query: {sql: string; args: QueryArg[]}) => {
    rowsAffected?: number;
    lastInsertRowid?: string | number | bigint | null;
  },
  sql: string,
) {
  if (!sql.trim()) {
    return {};
  }

  const statements = splitSqlStatements(sql).filter((statement) => !isCommentOnlySql(statement));
  if (statements.length === 0) {
    return {};
  }
  if (statements.length <= 1) {
    return runOne({sql: statements[0]!, args: []});
  }

  let lastResult = {};
  for (const statement of statements) {
    lastResult = runOne({sql: statement, args: []});
  }
  return lastResult;
}

export async function rawSqlWithSqlSplittingAsync(
  runOne: (query: {
    sql: string;
    args: QueryArg[];
  }) => Promise<{rowsAffected?: number; lastInsertRowid?: string | number | bigint | null}>,
  sql: string,
) {
  if (!sql.trim()) {
    return {};
  }

  const statements = splitSqlStatements(sql).filter((statement) => !isCommentOnlySql(statement));
  if (statements.length === 0) {
    return {};
  }
  if (statements.length <= 1) {
    return runOne({sql: statements[0]!, args: []});
  }

  let lastResult = {};
  for (const statement of statements) {
    lastResult = await runOne({sql: statement, args: []});
  }
  return lastResult;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (inLineComment) {
      current += char;
      if (char === '\n') {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '-' && next === '-') {
      inLineComment = true;
      current += char;
      current += next;
      index += 2;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '/' && next === '*') {
      inBlockComment = true;
      current += char;
      current += next;
      index += 2;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        index += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      index += 1;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      current += char;
      if (inDoubleQuote && next === '"') {
        current += next;
        index += 2;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      index += 1;
      continue;
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      if (isTriggerStatementInProgress(current) && !isTriggerTerminator(current)) {
        current += char;
        index += 1;
        continue;
      }

      const statement = current.trim();
      if (statement && stripSqlComments(statement).trim()) {
        statements.push(`${statement};`);
      }
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  const trailing = current.trim();
  if (trailing && stripSqlComments(trailing).trim()) {
    statements.push(trailing);
  }

  return statements;
}

function isCommentOnlySql(sql: string) {
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '-' && next === '-') {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '/' && next === '*') {
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        index += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      index += 1;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !/\s/u.test(char)) {
      return false;
    }

    index += 1;
  }

  return true;
}

export function surroundWithBeginCommitRollbackSync<TDriver, TResult>(
  client: SyncClient<TDriver>,
  fn: (tx: SyncClient<TDriver>) => TResult,
): TResult;
export function surroundWithBeginCommitRollbackSync<TDriver, TResult>(
  client: SyncClient<TDriver>,
  fn: (tx: SyncClient<TDriver>) => Promise<TResult>,
): Promise<TResult>;
export function surroundWithBeginCommitRollbackSync<TDriver, TResult>(
  client: SyncClient<TDriver>,
  fn: (tx: SyncClient<TDriver>) => TResult | Promise<TResult>,
): TResult | Promise<TResult> {
  client.run({sql: 'begin', args: []});
  try {
    const result = fn(client);
    if (isPromiseLike(result)) {
      return result.then(
        (value) => {
          client.run({sql: 'commit', args: []});
          return value;
        },
        (error) => {
          tryRollbackSync(client);
          throw error;
        },
      );
    }
    client.run({sql: 'commit', args: []});
    return result;
  } catch (error) {
    tryRollbackSync(client);
    throw error;
  }
}

export async function surroundWithBeginCommitRollbackAsync<TDriver, TResult>(
  client: AsyncClient<TDriver>,
  fn: (tx: AsyncClient<TDriver>) => Promise<TResult> | TResult,
): Promise<TResult> {
  await client.run({sql: 'begin', args: []});
  try {
    const result = await fn(client);
    await client.run({sql: 'commit', args: []});
    return result;
  } catch (error) {
    await tryRollbackAsync(client);
    throw error;
  }
}

// if a rollback fails (e.g. because the inner sql included its own commit), preserve the
// original error. the caller only cares about what actually went wrong in their code.
function tryRollbackSync<TDriver>(client: SyncClient<TDriver>) {
  try {
    client.run({sql: 'rollback', args: []});
  } catch {
    // ignore
  }
}

async function tryRollbackAsync<TDriver>(client: AsyncClient<TDriver>) {
  try {
    await client.run({sql: 'rollback', args: []});
  } catch {
    // ignore
  }
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function normalizeSchemaStatement(sql: string) {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim();
}

function quoteSqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function isPromiseLike<TResult>(value: TResult | Promise<TResult>): value is Promise<TResult> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

function isTriggerStatementInProgress(sql: string): boolean {
  return /^\s*create\s+trigger\b/iu.test(stripSqlComments(sql));
}

function isTriggerTerminator(sql: string): boolean {
  return /\bend\s*$/iu.test(stripSqlComments(sql).trim());
}
