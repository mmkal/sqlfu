import type {Client} from './types.js';

export async function extractSchema(client: Client, schemaName = 'main'): Promise<string> {
  const rows = await client.all<{sql: string | null}>({
    sql: `
      select sql
      from ${schemaName}.sqlite_schema
      where sql is not null
        and name not like 'sqlite_%'
      order by type, name
    `,
    args: [],
  });

  return rows.map((row) => `${String(row.sql).toLowerCase()};`).join('\n');
}

export async function runSqlStatements(client: Client, sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await client.run({sql: statement, args: []});
  }
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

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function summarizeDatabaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^SQLITE_ERROR:\s*/u, '').trim();
}
