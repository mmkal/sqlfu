import fs from 'node:fs';
import path from 'node:path';

import {formatSql} from './formatter.js';

import type {ESLint, Linter, Rule} from 'eslint';
import type * as ESTree from 'estree';

/**
 * sqlfu's lint plugin. Targets both ESLint (flat config) and oxlint (via
 * oxlint's `jsPlugins` — alpha as of 2026-04-20).
 *
 * Imports `sqlfu`'s formatter so the formatting rule can produce exact
 * autofix output. `eslint` and `estree` are type-only imports that
 * TypeScript erases during compilation.
 *
 * Consumers wire it in ESLint flat config:
 *
 *   import sqlfu from 'sqlfu/lint-plugin';
 *   export default [{plugins: {sqlfu}, rules: {'sqlfu/query-naming': 'error'}}];
 *
 * Or via the preset:
 *
 *   import sqlfu from 'sqlfu/lint-plugin';
 *   export default [sqlfu.configs.recommended];
 */

const CLIENT_METHODS = new Set(['all', 'run', 'iterate']);

function normalizeSqlForMatch(sql: string): string {
  const lines = sql.split('\n');
  const indents = lines.filter((line) => line.trim().length > 0).map((line) => line.match(/^[\t ]*/)?.[0].length || 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const dedented = lines.map((line) => line.slice(minIndent)).join('\n');
  return dedented.trim().replace(/\s+/g, ' ').toLowerCase();
}

interface LoadedQuery {
  absolutePath: string;
  relativePath: string;
  functionName: string;
  normalized: string;
}

interface LoadQueriesOptions {
  queriesDir?: string;
}

interface Cache {
  projectRoot: string;
  queriesDir: string;
  queries: LoadedQuery[];
  mtimeMs: number;
}

const caches = new Map<string, Cache>();

function loadQueriesForFile(fromFile: string, options: LoadQueriesOptions): LoadedQuery[] | null {
  const projectRoot = findProjectRoot(fromFile);
  if (!projectRoot) return null;

  const queriesDir = options.queriesDir
    ? path.resolve(projectRoot, options.queriesDir)
    : resolveQueriesDir(projectRoot);

  if (!queriesDir || !fs.existsSync(queriesDir)) return null;

  const cacheKey = `${projectRoot}::${queriesDir}`;
  const mtimeMs = directoryMtime(queriesDir);
  const cached = caches.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs) return cached.queries;

  const queries = walkSqlFiles(queriesDir).map((absolutePath): LoadedQuery => {
    const relative = path.relative(queriesDir, absolutePath).replace(/\\/g, '/');
    const name = relative.replace(/\.sql$/, '');
    return {
      absolutePath,
      relativePath: relative,
      functionName: toCamelCase(name),
      normalized: normalizeSqlForMatch(fs.readFileSync(absolutePath, 'utf8')),
    };
  });

  caches.set(cacheKey, {projectRoot, queriesDir, queries, mtimeMs});
  return queries;
}

function findProjectRoot(fromFile: string): string | null {
  let dir = path.dirname(path.resolve(fromFile));
  const root = path.parse(dir).root;
  while (true) {
    for (const name of ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs']) {
      if (fs.existsSync(path.join(dir, name))) return dir;
    }
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

function resolveQueriesDir(projectRoot: string): string | null {
  for (const name of ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs']) {
    const configPath = path.join(projectRoot, name);
    if (!fs.existsSync(configPath)) continue;
    // Cheap text parse — executing the config synchronously would need a
    // bundler/worker, and the typical shape is `queries: './sql'`.
    const text = fs.readFileSync(configPath, 'utf8');
    const match = text.match(/queries\s*:\s*['"]([^'"]+)['"]/);
    if (match) {
      const value = match[1];
      const base = value.replace(/\/\*\*?.*$/, '').replace(/\/[^/]*\*[^/]*$/, '');
      return path.resolve(projectRoot, base || '.');
    }
  }
  const fallback = path.join(projectRoot, 'sql');
  return fs.existsSync(fallback) ? fallback : null;
}

function walkSqlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSqlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      out.push(full);
    }
  }
  return out;
}

function directoryMtime(dir: string): number {
  let latest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    try {
      const stat = fs.statSync(current);
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
      }
    } catch {
      // dir might have been removed mid-walk — ignore
    }
  }
  return latest;
}

function toCamelCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.toLowerCase() : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

/**
 * Clear the in-process query cache. Exposed for tests only.
 */
export function resetQueryCache(): void {
  caches.clear();
}

/**
 * Flags inline SQL template literals that duplicate a checked-in .sql file.
 *
 * Point: sqlfu's model is "your filename is your query's identity". An inline
 * string that happens to match a named file is a regression — the caller loses
 * the generated types, the name, and the observability tie.
 *
 * Fires on:
 *   client.all(`select * from users`)
 *   client.run(`select * from users`)
 *   client.iterate(`select * from users`)
 *   client.sql`select * from users`
 *
 * Only when the template has no `${}` interpolations, and only when the
 * normalized SQL matches a file under the project's queries directory.
 */
interface ClientTemplateOptions {
  clientPattern: RegExp;
  onTemplate: (template: ESTree.TemplateLiteral) => void;
}

/**
 * Shared visitor: invokes `onTemplate` for each inline SQL template literal
 * passed to a recognized client call (`client.all|run|iterate(\`...\`)`) or
 * used as the body of `client.sql\`...\``. Used by every rule that operates
 * on inline SQL so the detection logic stays consistent.
 */
function createClientTemplateVisitor({clientPattern, onTemplate}: ClientTemplateOptions): Rule.RuleListener {
  function isClientIdentifier(node: ESTree.Node | null | undefined): boolean {
    if (!node) return false;
    if (node.type !== 'Identifier') return false;
    return clientPattern.test(node.name);
  }

  return {
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type !== 'MemberExpression' || callee.computed) return;
      if (callee.property.type !== 'Identifier') return;
      if (!CLIENT_METHODS.has(callee.property.name)) return;
      if (!isClientIdentifier(callee.object)) return;
      const arg = node.arguments[0];
      if (!arg || arg.type !== 'TemplateLiteral') return;
      onTemplate(arg);
    },
    TaggedTemplateExpression(node) {
      const tag = node.tag;
      if (tag.type !== 'MemberExpression' || tag.computed) return;
      if (tag.property.type !== 'Identifier' || tag.property.name !== 'sql') return;
      if (!isClientIdentifier(tag.object)) return;
      onTemplate(node.quasi);
    },
  };
}

function resolveClientPattern(options: {clientIdentifierPattern?: string}): RegExp {
  return options.clientIdentifierPattern
    ? new RegExp(options.clientIdentifierPattern, 'u')
    : /^(client|db|sqlfu|.*Client)$/u;
}

function readTemplateRawSql(template: ESTree.TemplateLiteral): string {
  return template.quasis.map((q: ESTree.TemplateElement) => q.value.cooked || q.value.raw).join('');
}

/**
 * Flags inline SQL template literals that duplicate a checked-in .sql file.
 *
 * Point: sqlfu's model is "your filename is your query's identity". An inline
 * string that happens to match a named file is a regression — the caller loses
 * the generated types, the name, and the observability tie.
 *
 * Fires on:
 *   client.all(`select * from users`)
 *   client.run(`select * from users`)
 *   client.iterate(`select * from users`)
 *   client.sql`select * from users`
 *
 * Only when the template has no `${}` interpolations, and only when the
 * normalized SQL matches a file under the project's queries directory.
 */
const queryNaming: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'flag inline SQL template literals that duplicate a named .sql file; use the generated query wrapper instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          queriesDir: {type: 'string'},
          clientIdentifierPattern: {type: 'string'},
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = (context.options[0] || {}) as {
      queriesDir?: string;
      clientIdentifierPattern?: string;
    };

    const filename = context.filename || context.getFilename();
    if (!filename || filename === '<input>' || filename === '<text>') {
      // Without a real filename we can't locate the project root.
      return {};
    }

    const queries = loadQueriesForFile(filename, {queriesDir: options.queriesDir});
    if (!queries || queries.length === 0) return {};

    const index = new Map(queries.map((query) => [query.normalized, query]));

    return createClientTemplateVisitor({
      clientPattern: resolveClientPattern(options),
      onTemplate(template) {
        if (template.expressions.length > 0) return; // parameterized — out of scope
        const raw = readTemplateRawSql(template);
        const normalized = normalizeSqlForMatch(raw);
        const match = index.get(normalized);
        if (!match) return;
        context.report({
          node: template,
          message: `inline SQL matches '${match.relativePath}'. Import '${match.functionName}' from the generated wrapper so the query keeps its name, types, and observability metadata.`,
        });
      },
    });
  },
};

/**
 * Flags unformatted SQL. One rule, two shapes:
 *
 *  1. **Inline template**: `client.all`/`client.run`/`client.iterate`/
 *     `` client.sql`...` `` in TS/JS source. The fix replaces the template
 *     body with `formatSql(raw, {style: 'sqlfu'})`, preserving the caller's
 *     indentation so the body stays visually aligned.
 *  2. **Whole `.sql` file**: the `sql` processor wraps the file in a
 *     `__sqlfuSqlFile\`...\`` tagged template literal so ESLint's JS parser
 *     can lint it; this rule recognizes the wrapper and emits a fix that
 *     `postprocess` remaps to a full-file replacement.
 *
 * Templates with `${}` interpolations are always skipped — we can't safely
 * round-trip them through the formatter.
 */
const formatSqlRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'flag SQL that does not match sqlfu formatter output (inline templates and .sql files); autofix available.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          clientIdentifierPattern: {type: 'string'},
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = (context.options[0] || {}) as {clientIdentifierPattern?: string};
    const sourceCode = context.sourceCode || context.getSourceCode();

    // Shape 1: inline SQL passed to a recognized client call.
    const clientVisitor = createClientTemplateVisitor({
      clientPattern: resolveClientPattern(options),
      onTemplate(template) {
        if (template.expressions.length > 0) return;
        const raw = readTemplateRawSql(template);
        if (!raw.trim()) return;
        const indent = detectTemplateIndent(sourceCode.getText(), template);
        const normalized = stripLeadingIndent(raw, indent);
        let formatted: string;
        try {
          formatted = formatSql(normalized, {style: 'sqlfu'});
        } catch {
          // Formatter failed — probably unparseable SQL. Skip silently.
          return;
        }
        const formattedForTemplate = reapplyTemplateIndent(formatted, raw, indent);
        if (formattedForTemplate === raw) return;
        context.report({
          node: template,
          message: 'inline SQL is not formatted — run sqlfu format or apply the autofix.',
          fix(fixer) {
            const [start, end] = template.range as [number, number];
            return fixer.replaceTextRange([start + 1, end - 1], formattedForTemplate);
          },
        });
      },
    });

    return {
      CallExpression: clientVisitor.CallExpression,
      TaggedTemplateExpression(node) {
        // Shape 2: the `sql` processor's wrapper around a standalone .sql
        // file. Short-circuits before client-call detection because the
        // wrapper tag can't double as a client identifier.
        if (node.tag.type === 'Identifier' && node.tag.name === SQL_FILE_TAG) {
          if (node.quasi.expressions.length > 0) return;
          const raw = readTemplateRawSql(node.quasi);
          // Backticks and `${` inside the SQL are backslash-escaped by the
          // processor; recover the true file bytes before formatting.
          const sql = unescapeWrappedSql(raw);
          const formatted = formatSqlFileContents(sql);
          if (formatted === sql) return;
          context.report({
            node,
            message: 'SQL file is not formatted — run sqlfu format or apply the autofix.',
            // Fix range is the *wrapped* range (first quasi's body between
            // the backticks). `postprocess` remaps it to
            // `[0, originalFileLength]` on the original file, replacing the
            // whole file with `formatted`.
            fix(fixer) {
              const quasi = node.quasi.quasis[0];
              const [start, end] = quasi.range as [number, number];
              return fixer.replaceTextRange([start, end], escapeForWrappedSql(formatted));
            },
          });
          return;
        }
        // Shape 1 (tag form): `client.sql\`...\``.
        clientVisitor.TaggedTemplateExpression?.(node);
      },
    };
  },
};

function detectTemplateIndent(fullText: string, template: ESTree.TemplateLiteral): string {
  const [start] = template.range as [number, number];
  const lineStart = fullText.lastIndexOf('\n', start - 1) + 1;
  const match = fullText.slice(lineStart, start).match(/^[\t ]*/);
  return match ? match[0] : '';
}

function stripLeadingIndent(sql: string, indent: string): string {
  if (!indent) return sql;
  const lines = sql.split('\n');
  return lines.map((line, i) => (i === 0 ? line : line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n');
}

function reapplyTemplateIndent(formatted: string, original: string, indent: string): string {
  const originalStartsOnNewline = original.startsWith('\n');
  const originalEndsOnNewline = /\n[\t ]*$/.test(original);
  const lines = formatted.split('\n');
  const indentedBody = lines.map((line, i) => (i === 0 ? line : indent + '  ' + line)).join('\n');
  const prefix = originalStartsOnNewline ? '\n' + indent + '  ' : '';
  const suffix = originalEndsOnNewline ? '\n' + indent : '';
  return prefix + indentedBody + suffix;
}

/**
 * Format a standalone `.sql` file's contents the same way the `format-sql`
 * rule formats inline SQL templates. Pure string-in, string-out; preserves a
 * trailing newline if the input had one. Exported for CLIs, CI scripts, and
 * editor integrations that want to reuse the formatter on `.sql` files.
 */
export function formatSqlFileContents(contents: string): string {
  const trailingNewline = contents.endsWith('\n') ? '\n' : '';
  const body = trailingNewline ? contents.slice(0, -1) : contents;
  if (!body.trim()) return contents;
  const formatted = formatSql(body, {style: 'sqlfu'});
  return formatted + trailingNewline;
}

function escapeForWrappedSql(sql: string): string {
  return sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function unescapeWrappedSql(raw: string): string {
  // Inverse of escapeForWrappedSql. Order matters: undo the `${` and `` ` ``
  // escapes first, then unescape backslashes.
  return raw.replace(/\\\$\{/g, '${').replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

const SQL_FILE_TAG = '__sqlfuSqlFile';
const SQL_FILE_WRAPPER_PREFIX = SQL_FILE_TAG + '`';
const SQL_FILE_WRAPPER_SUFFIX = '`;\n';

/**
 * Processor that lets ESLint lint standalone `.sql` files by wrapping their
 * contents in a `__sqlfuSqlFile\`...\`` tagged template literal — valid JS
 * syntax, recognized by the `format-sql` rule.
 */
const sqlFileProcessor: Linter.Processor = {
  meta: {name: 'sqlfu-sql', version: '1'},
  supportsAutofix: true,
  preprocess(text, filename) {
    const wrapped = SQL_FILE_WRAPPER_PREFIX + escapeForWrappedSql(text) + SQL_FILE_WRAPPER_SUFFIX;
    return [{text: wrapped, filename: `${path.basename(filename)}.js`}];
  },
  postprocess(messages, filename) {
    // Read the original file once to size the whole-file autofix range.
    // ESLint calls `postprocess` synchronously after linting, so the file on
    // disk matches what was linted (unless a fix from another pass has
    // already been written — ESLint handles the retry loop for us).
    let originalLength = 0;
    try {
      originalLength = fs.statSync(filename).size;
    } catch {
      // The file may have been linted from a string (e.g. in tests via
      // Linter.verify) — fall back to a range derived from the wrapper.
    }
    return messages.flat().map((message) => {
      if (!message.fix) return message;
      return {...message, fix: {range: [0, originalLength] as [number, number], text: unwrapFormattedSql(message)}};
    });
  },
};

function unwrapFormattedSql(message: Linter.LintMessage): string {
  // The rule's fix replaces the quasi body with the escaped formatted SQL.
  // Recover the raw formatted SQL by stripping the escapes it added.
  const fixText = message.fix?.text || '';
  return unescapeWrappedSql(fixText);
}

const plugin: ESLint.Plugin = {
  meta: {
    name: 'sqlfu',
  },
  rules: {
    'query-naming': queryNaming,
    'format-sql': formatSqlRule,
  },
  processors: {
    sql: sqlFileProcessor,
  },
};

/**
 * Flat-config preset that enables every rule in this plugin at `error`.
 *
 *   import sqlfu from 'sqlfu/lint-plugin';
 *   export default [sqlfu.configs.recommended];
 */
const recommended: Linter.Config = {
  plugins: {sqlfu: plugin},
  rules: {
    'sqlfu/query-naming': 'error',
    'sqlfu/format-sql': 'error',
  },
};

// Flat-config blocks that wire the `sql` processor + `format-sql` rule onto
// every `.sql` file. The processor extracts each `.sql` file into a synthetic
// `<name>.sql.js` block (ESLint's way of letting non-JS files be linted
// through the JS pipeline); the second block matches that virtual path
// (**\/*.sql/**\/*.js) and attaches the rule that operates on it.
//
// Use alongside `recommended` for full coverage:
//
//   export default [sqlfu.configs.recommended, ...sqlfu.configs.sqlFiles];
const sqlFiles: Linter.Config[] = [
  {
    files: ['**/*.sql'],
    plugins: {sqlfu: plugin},
    processor: 'sqlfu/sql',
  },
  {
    files: ['**/*.sql/**/*.js'],
    plugins: {sqlfu: plugin},
    rules: {
      'sqlfu/format-sql': 'error',
    },
  },
];

const exported: ESLint.Plugin & {configs: {recommended: Linter.Config; sqlFiles: Linter.Config[]}} = Object.assign(
  plugin,
  {
    configs: {recommended, sqlFiles},
  },
);

export default exported;
