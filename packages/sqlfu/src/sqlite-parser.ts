import {isIdentLike, SqlTokenizerError, tokenize, type Token} from './vendor/sqlfu-sqlite-parser/tokenizer.js';

export type SqliteToken = Token;

export type SqliteCreateStatementKind = 'table' | 'index' | 'view' | 'trigger' | 'virtual-table';

export type SqliteCreateStatement = {
  kind: SqliteCreateStatementKind;
  temporary: boolean;
  unique: boolean;
  name: SqliteIdentifierSpan | null;
  onName: SqliteIdentifierSpan | null;
};

export type SqliteIdentifierSpan = {
  name: string;
  start: number;
  end: number;
};

export function firstSqliteKeyword(sql: string): string | null {
  const tokens = tryTokenizeSqlite(sql);
  if (!tokens) return fallbackFirstKeyword(sql);
  const first = tokens[0];
  if (!first) return null;
  if (first.kind === 'KEYWORD') return first.value.toLowerCase();
  const fallback = fallbackFirstKeyword(sql);
  if (fallback && fallback === first.value.toLowerCase()) return fallback;
  return null;
}

export function containsSqliteKeyword(sql: string, keyword: string): boolean {
  const normalizedKeyword = keyword.toUpperCase();
  const tokens = tryTokenizeSqlite(sql);
  if (!tokens) return fallbackContainsKeyword(sql, normalizedKeyword);
  return tokens.some((token) => token.kind === 'KEYWORD' && token.value === normalizedKeyword);
}

export function classifySqliteCreateStatement(sql: string): SqliteCreateStatement | null {
  const tokens = tryTokenizeSqlite(sql);
  if (!tokens) return fallbackClassifyCreateStatement(sql);

  const cursor = new TokenCursor(tokens);
  if (!cursor.matchKeyword('CREATE')) return null;

  const temporary = cursor.matchKeyword('TEMP') || cursor.matchKeyword('TEMPORARY');
  const unique = cursor.matchKeyword('UNIQUE');
  if (unique) {
    if (!cursor.matchKeyword('INDEX')) return null;
    cursor.matchIfNotExists();
    const name = cursor.readIdentifier(sql);
    const onName = cursor.readOnName(sql);
    return {kind: 'index', temporary, unique, name, onName};
  }

  if (cursor.matchKeyword('VIRTUAL')) {
    if (!cursor.matchKeyword('TABLE')) return null;
    cursor.matchIfNotExists();
    return {kind: 'virtual-table', temporary, unique: false, name: cursor.readIdentifier(sql), onName: null};
  }

  if (cursor.matchKeyword('TABLE')) {
    cursor.matchIfNotExists();
    return {kind: 'table', temporary, unique: false, name: cursor.readIdentifier(sql), onName: null};
  }
  if (cursor.matchKeyword('INDEX')) {
    cursor.matchIfNotExists();
    const name = cursor.readIdentifier(sql);
    const onName = cursor.readOnName(sql);
    return {kind: 'index', temporary, unique: false, name, onName};
  }
  if (cursor.matchKeyword('VIEW')) {
    cursor.matchIfNotExists();
    return {kind: 'view', temporary, unique: false, name: cursor.readIdentifier(sql), onName: null};
  }
  if (cursor.matchKeyword('TRIGGER')) {
    cursor.matchIfNotExists();
    const name = cursor.readIdentifier(sql);
    const onName = cursor.readOnName(sql);
    return {kind: 'trigger', temporary, unique: false, name, onName};
  }
  return null;
}

export function replaceSqliteIdentifierSpan(
  sql: string,
  identifier: SqliteIdentifierSpan,
  replacement: string,
): string {
  return `${sql.slice(0, identifier.start)}${replacement}${sql.slice(identifier.end)}`;
}

function tryTokenizeSqlite(sql: string): SqliteToken[] | null {
  try {
    return tokenize(sql);
  } catch (error) {
    if (error instanceof SqlTokenizerError) return null;
    throw error;
  }
}

class TokenCursor {
  private index = 0;

  constructor(private tokens: SqliteToken[]) {}

  matchKeyword(keyword: string): boolean {
    const token = this.tokens[this.index];
    if (!token || token.kind !== 'KEYWORD' || token.value !== keyword) return false;
    this.index += 1;
    return true;
  }

  matchIfNotExists(): void {
    const startIndex = this.index;
    if (this.matchKeyword('IF') && this.matchKeyword('NOT') && this.matchKeyword('EXISTS')) return;
    this.index = startIndex;
  }

  readIdentifier(sql: string): SqliteIdentifierSpan | null {
    const first = this.tokens[this.index];
    if (!isIdentLike(first)) return null;
    this.index += 1;

    let nameToken = first;
    if (this.tokens[this.index]?.kind === 'DOT' && isIdentLike(this.tokens[this.index + 1])) {
      this.index += 1;
      nameToken = this.tokens[this.index]!;
      this.index += 1;
    }

    const raw = sql.slice(nameToken.start, nameToken.stop + 1);
    return {
      name: parseSqliteIdentifierName(raw),
      start: first.start,
      end: nameToken.stop + 1,
    };
  }

  readOnName(sql: string): SqliteIdentifierSpan | null {
    while (this.index < this.tokens.length) {
      if (this.matchKeyword('ON')) return this.readIdentifier(sql);
      this.index += 1;
    }
    return null;
  }
}

export function parseSqliteIdentifierName(rawIdentifier: string): string {
  if (rawIdentifier.startsWith('"') && rawIdentifier.endsWith('"')) {
    return rawIdentifier.slice(1, -1).replaceAll('""', '"');
  }
  if (rawIdentifier.startsWith('`') && rawIdentifier.endsWith('`')) {
    return rawIdentifier.slice(1, -1).replaceAll('``', '`');
  }
  if (rawIdentifier.startsWith('[') && rawIdentifier.endsWith(']')) {
    return rawIdentifier.slice(1, -1);
  }
  return rawIdentifier;
}

function fallbackFirstKeyword(sql: string): string | null {
  const stripped = stripLeadingSqlTriviaFallback(sql);
  const match = /^([a-z_][a-z0-9_$]*)\b/iu.exec(stripped);
  return match ? match[1]!.toLowerCase() : null;
}

function fallbackContainsKeyword(sql: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'iu').test(sql);
}

function fallbackClassifyCreateStatement(sql: string): SqliteCreateStatement | null {
  let rest = stripLeadingSqlTriviaFallback(sql);
  const createMatch = /^create\b/iu.exec(rest);
  if (!createMatch) return null;
  rest = rest.slice(createMatch[0].length).trimStart();

  let temporary = false;
  const tempMatch = /^(temp|temporary)\b/iu.exec(rest);
  if (tempMatch) {
    temporary = true;
    rest = rest.slice(tempMatch[0].length).trimStart();
  }

  let unique = false;
  const uniqueMatch = /^unique\b/iu.exec(rest);
  if (uniqueMatch) {
    unique = true;
    rest = rest.slice(uniqueMatch[0].length).trimStart();
    if (/^index\b/iu.test(rest)) return {kind: 'index', temporary, unique, name: null, onName: null};
    return null;
  }

  if (/^virtual\s+table\b/iu.test(rest)) {
    return {kind: 'virtual-table', temporary, unique: false, name: null, onName: null};
  }
  if (/^table\b/iu.test(rest)) return {kind: 'table', temporary, unique: false, name: null, onName: null};
  if (/^index\b/iu.test(rest)) return {kind: 'index', temporary, unique: false, name: null, onName: null};
  if (/^view\b/iu.test(rest)) return {kind: 'view', temporary, unique: false, name: null, onName: null};
  if (/^trigger\b/iu.test(rest)) return {kind: 'trigger', temporary, unique: false, name: null, onName: null};
  return null;
}

function stripLeadingSqlTriviaFallback(sql: string): string {
  return sql.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
