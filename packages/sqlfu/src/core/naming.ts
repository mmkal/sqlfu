/**
 * Inspired by github.com/mmkal/pgkit/tree/main/src/pgkit/packages/client/src/naming.ts
 *
 * Modifications for sqlfu:
 * - focused on migration SQL naming rather than general query naming
 * - keeps only a short slug from the first statement
 * - falls back to `migration` instead of hashing
 */

const tokenize = (sql: string): string[] => {
  const tokens: string[] = [];
  let index = 0;

  while (index < sql.length) {
    if (/\s/.test(sql[index])) {
      index += 1;
      continue;
    }

    if (sql[index] === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (sql[index] === '/' && sql[index + 1] === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (sql[index] === '"') {
      index += 1;
      let identifier = '';
      while (index < sql.length && sql[index] !== '"') {
        identifier += sql[index];
        index += 1;
      }
      index += 1;
      tokens.push(identifier);
      continue;
    }

    if (sql[index] === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }

        if (sql[index] === "'") {
          index += 1;
          break;
        }

        index += 1;
      }
      continue;
    }

    if ('();,=<>!+-*/.'.includes(sql[index])) {
      tokens.push(sql[index]);
      index += 1;
      continue;
    }

    if (/[\w$]/.test(sql[index])) {
      let word = '';
      while (index < sql.length && /[\w$]/.test(sql[index])) {
        word += sql[index];
        index += 1;
      }
      tokens.push(word);
      continue;
    }

    index += 1;
  }

  return tokens;
};

export function migrationNickname(sql: string): string {
  const tokens = tokenize(sql);
  const parts: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();

    if (token === ';') {
      break;
    }

    const pushNextIdentifier = () => {
      const candidate = tokens[index + 1];
      if (!candidate) {
        return;
      }

      if (/^[;,()=<>!+\-*/.]+$/.test(candidate)) {
        return;
      }

      parts.push(candidate.toLowerCase());
      index += 1;
    };

    if ((lower === 'create' || lower === 'alter' || lower === 'drop') && tokens[index + 1]) {
      const next = tokens[index + 1]!.toLowerCase();
      if (next === 'table' || next === 'index' || next === 'view' || next === 'trigger') {
        parts.push(`${lower}_${next}`);
        index += 1;
        pushNextIdentifier();
        continue;
      }
    }

    if (lower === 'add' && tokens[index + 1]?.toLowerCase() === 'column') {
      parts.push('add_column');
      index += 1;
      pushNextIdentifier();
      continue;
    }

    if (lower === 'rename' && tokens[index + 1]?.toLowerCase() === 'to') {
      parts.push('rename_to');
      index += 1;
      pushNextIdentifier();
      continue;
    }

    if (lower === 'update' || lower === 'into' || lower === 'from') {
      parts.push(lower);
      pushNextIdentifier();
      continue;
    }
  }

  const slug = parts
    .join('_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || 'migration';
}
