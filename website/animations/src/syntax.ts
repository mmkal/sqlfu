import {theme} from './theme';

type Token = {text: string; color: string};

const SQL_KEYWORDS = new Set(
  [
    'create',
    'table',
    'view',
    'select',
    'from',
    'where',
    'order',
    'by',
    'limit',
    'insert',
    'into',
    'values',
    'update',
    'set',
    'delete',
    'alter',
    'add',
    'column',
    'drop',
    'primary',
    'key',
    'references',
    'default',
    'not',
    'null',
    'unique',
    'and',
    'or',
    'as',
    'on',
  ].map((k) => k.toLowerCase()),
);

const SQL_TYPES = new Set(['integer', 'int', 'text', 'real', 'blob', 'numeric', 'boolean', 'date', 'datetime']);

const TS_KEYWORDS = new Set([
  'import',
  'export',
  'from',
  'const',
  'let',
  'var',
  'function',
  'async',
  'await',
  'return',
  'type',
  'interface',
  'extends',
  'implements',
  'class',
  'new',
  'if',
  'else',
  'for',
  'while',
  'typeof',
  'readonly',
  'public',
  'private',
  'protected',
  'as',
]);

const TS_BUILTIN_TYPES = new Set([
  'Client',
  'SqlQuery',
  'Promise',
  'Array',
  'string',
  'number',
  'boolean',
  'void',
  'null',
  'undefined',
  'any',
  'unknown',
]);

/**
 * Crude, deterministic tokenizer — good enough for pre-known snippets baked
 * into the animations. Do not use this to highlight arbitrary user code.
 */
export function tokenizeSql(source: string): Token[] {
  return tokenize(source, {
    keywords: SQL_KEYWORDS,
    types: SQL_TYPES,
    paramPrefix: ':',
    lineCommentPrefix: '--',
  });
}

export function tokenizeTs(source: string): Token[] {
  return tokenize(source, {
    keywords: TS_KEYWORDS,
    types: TS_BUILTIN_TYPES,
    paramPrefix: null,
    lineCommentPrefix: '//',
  });
}

export function tokenizeTerminal(source: string): Token[] {
  return [{text: source, color: theme.terminalText}];
}

function tokenize(
  source: string,
  config: {
    keywords: Set<string>;
    types: Set<string>;
    paramPrefix: string | null;
    lineCommentPrefix: string;
  },
): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    // line comment
    if (ch === config.lineCommentPrefix[0] && source.startsWith(config.lineCommentPrefix, i)) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      tokens.push({text: source.slice(i, stop), color: theme.codeComment});
      i = stop;
      continue;
    }

    // whitespace / punctuation
    if (/\s/.test(ch)) {
      tokens.push({text: ch, color: theme.codeText});
      i += 1;
      continue;
    }

    // template string starts with backtick
    if (ch === '`' || ch === "'" || ch === '"') {
      const quote = ch;
      let end = i + 1;
      while (end < source.length && source[end] !== quote) {
        if (source[end] === '\\' && end + 1 < source.length) end += 2;
        else end += 1;
      }
      end = Math.min(end + 1, source.length);
      tokens.push({text: source.slice(i, end), color: theme.codeString});
      i = end;
      continue;
    }

    // param like :id or $id
    if (config.paramPrefix && ch === config.paramPrefix) {
      let end = i + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end]!)) end += 1;
      tokens.push({text: source.slice(i, end), color: theme.codeParam});
      i = end;
      continue;
    }

    // identifier/keyword/type
    if (/[A-Za-z_]/.test(ch)) {
      let end = i;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end]!)) end += 1;
      const word = source.slice(i, end);
      const lowered = word.toLowerCase();
      let color = theme.codeIdent;
      if (config.keywords.has(lowered)) color = theme.codeKeyword;
      else if (config.types.has(word) || config.types.has(lowered)) color = theme.codeType;
      tokens.push({text: word, color});
      i = end;
      continue;
    }

    // numeric literal
    if (/[0-9]/.test(ch)) {
      let end = i;
      while (end < source.length && /[0-9.]/.test(source[end]!)) end += 1;
      tokens.push({text: source.slice(i, end), color: theme.codeNumber});
      i = end;
      continue;
    }

    // single punctuation char
    tokens.push({text: ch, color: theme.codePunct});
    i += 1;
  }
  return tokens;
}

/**
 * Take a pre-tokenized source and return the first `charCount` characters'
 * worth of tokens, producing a typewriter effect one character at a time.
 */
export function sliceTokens(tokens: Token[], charCount: number): Token[] {
  const result: Token[] = [];
  let remaining = charCount;
  for (const token of tokens) {
    if (remaining <= 0) break;
    if (token.text.length <= remaining) {
      result.push(token);
      remaining -= token.text.length;
    } else {
      result.push({text: token.text.slice(0, remaining), color: token.color});
      remaining = 0;
    }
  }
  return result;
}
