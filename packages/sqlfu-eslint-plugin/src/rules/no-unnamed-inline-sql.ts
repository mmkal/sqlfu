import type {Rule} from 'eslint';
import type * as ESTree from 'estree';

import {loadQueriesForFile} from '../lib/load-queries.js';
import {normalizeSqlForMatch} from '../lib/normalize.js';

const CLIENT_METHODS = new Set(['all', 'run', 'iterate']);

/**
 * Flags inline SQL template literals that duplicate a checked-in .sql file.
 *
 * Point: sqlfu's model is "your filename is your query's identity". An
 * inline string that happens to match a named file is a regression —
 * the caller loses the generated types, the name, the observability tie.
 *
 * Fires on:
 *   client.all(`select * from users`)
 *   client.run(`select * from users`)
 *   client.iterate(`select * from users`)
 *   client.sql`select * from users`
 *
 * Only when the template literal has no `${}` interpolations, and only
 * when the normalized SQL matches a file under the project's queries
 * directory.
 */
const rule: Rule.RuleModule = {
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
    messages: {
      useNamed:
        "inline SQL matches '{{relativePath}}'. Import '{{functionName}}' from the generated wrapper so the query keeps its name, types, and observability metadata.",
    },
  },
  create(context) {
    const options = (context.options[0] || {}) as {
      queriesDir?: string;
      clientIdentifierPattern?: string;
    };
    const clientPattern = options.clientIdentifierPattern
      ? new RegExp(options.clientIdentifierPattern, 'u')
      : /^(client|db|sqlfu|.*Client)$/u;

    const filename = context.filename || context.getFilename();
    if (!filename || filename === '<input>' || filename === '<text>') {
      // Can't resolve a project root without a real filename — bail.
      return {};
    }

    const queries = loadQueriesForFile(filename, {queriesDir: options.queriesDir});
    if (!queries || queries.length === 0) return {};

    const index = new Map(queries.map((query) => [query.normalized, query]));

    function report(template: ESTree.TemplateLiteral) {
      if (template.expressions.length > 0) return; // parameterized — out of scope
      const raw = template.quasis.map((q: ESTree.TemplateElement) => q.value.cooked || q.value.raw).join('');
      const normalized = normalizeSqlForMatch(raw);
      const match = index.get(normalized);
      if (!match) return;
      context.report({
        node: template,
        messageId: 'useNamed',
        data: {
          relativePath: match.relativePath,
          functionName: match.functionName,
        },
      });
    }

    function isClientIdentifier(node: ESTree.Node | null | undefined): boolean {
      if (!node) return false;
      if (node.type !== 'Identifier') return false;
      return clientPattern.test(node.name);
    }

    return {
      // client.all(`...`) / client.run(`...`) / client.iterate(`...`)
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier') return;
        if (!CLIENT_METHODS.has(callee.property.name)) return;
        if (!isClientIdentifier(callee.object)) return;
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'TemplateLiteral') return;
        report(arg);
      },
      // client.sql`...`
      TaggedTemplateExpression(node) {
        const tag = node.tag;
        if (tag.type !== 'MemberExpression' || tag.computed) return;
        if (tag.property.type !== 'Identifier' || tag.property.name !== 'sql') return;
        if (!isClientIdentifier(tag.object)) return;
        report(node.quasi);
      },
    };
  },
};

export default rule;
