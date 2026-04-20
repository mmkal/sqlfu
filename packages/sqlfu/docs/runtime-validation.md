# Runtime validation

Generated wrappers can be emitted with a validator library — [zod](https://zod.dev), [valibot](https://valibot.dev), or [zod/mini](https://zod.dev/v4#introducing-zod-mini) — as the source of truth. Params are validated on the way in, rows are validated on the way out, and types are derived via the validator's native inference helper. One definition per thing, no drift.

This is an opt-in mode. By default, `sqlfu generate` emits plain TypeScript types with zero runtime validation.

## Why runtime validation at the wrapper boundary

The generator has always made SQL → TypeScript a compile-time guarantee. Runtime validation closes the loop:

- **Bad params fail loudly at the callsite.** Mistyped booleans, missing string args, enum typos throw a readable error before the SQL driver sees them.
- **Schema drift surfaces at the adapter boundary.** A column removed without regenerating, a newly-non-null field, a new enum variant — these become exceptions at the boundary, not silently-wrong objects reaching a React component.

The schemas are used by the generated wrapper itself, not just re-exported for consumers. That's the value-add over plain TS types — every query gets a validated request/response contract by default. The exported schemas are also usable for forms (`@rjsf`, react-hook-form), tRPC inputs, RPC wire validation, fixtures, etc. — but that's a secondary benefit.

## Turning it on

```ts
// sqlfu.config.ts
export default {
  db: './db/app.sqlite',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {
    validator: 'zod', // or 'valibot' or 'zod-mini'
  },
};
```

After toggling, re-run `sqlfu generate`. Install the validator library yourself if it isn't already a dependency — `zod` and `zod/mini` ship as the same package; `valibot` is a separate package.

## Picking a validator

All three implement [Standard Schema](https://standardschema.dev), so sqlfu treats them interchangeably. Pick the one whose tradeoffs you already prefer.

- **`'zod'`** — the default recommendation. Largest API surface, chainable fluent syntax (`.nullable()`, `.optional()`, `.extend()`), richest ecosystem of downstream integrations (tRPC, react-hook-form, @rjsf). Bundle cost is non-trivial on the browser side.
- **`'valibot'`** — smaller runtime, functional composition (`v.nullable(v.string())`, `v.parse(Schema, input)`). Best choice when you're shipping the validator to the browser and want to keep the bundle lean.
- **`'zod-mini'`** — bundle-optimised subset of zod v4. Same schema primitives, but a function-call API (`z.parse(Schema, input)`, `z.nullable(z.string())`). Choose this if you like zod's vocabulary but need valibot-style bundle savings.

## What the generated file looks like

For a query `sql/find-post-by-slug.sql`:

```sql
select id, slug, title, status from posts where slug = :slug limit 1;
```

With `generate.validator: 'zod'` you get:

```ts
// sql/.generated/find-post-by-slug.sql.ts  (generated - do not edit)
import {z} from 'zod';
import type {Client, SqlQuery} from 'sqlfu';

const Params = z.object({slug: z.string()});
const Result = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string().nullable(),
  status: z.enum(['draft', 'published']),
});
const sql = `
select id, slug, title, status from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
  async function findPostBySlug(
    client: Client,
    rawParams: z.infer<typeof Params>,
  ): Promise<z.infer<typeof Result> | null> {
    const parsedParams = Params.safeParse(rawParams);
    if (!parsedParams.success) throw new Error(z.prettifyError(parsedParams.error));
    const params = parsedParams.data;
    const query: SqlQuery = {sql, args: [params.slug], name: 'find-post-by-slug'};
    const rows = await client.all(query);
    if (rows.length === 0) return null;
    const parsed = Result.safeParse(rows[0]);
    if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
    return parsed.data;
  },
  {Params, Result, sql},
);

export namespace findPostBySlug {
  export type Params = z.infer<typeof findPostBySlug.Params>;
  export type Result = z.infer<typeof findPostBySlug.Result>;
}
```

With `validator: 'valibot'` the wrapper routes through Standard Schema's `~standard.validate` entry point (shared by valibot and zod-mini). The result-guard is inlined in the generated file — promise-check, issues-check, then use the value — so the only thing imported from sqlfu is `prettifyStandardSchemaError` (used to build the error message on failure):

```ts
// sql/.generated/find-post-by-slug.sql.ts  (generated - do not edit)
import * as v from 'valibot';
import {prettifyStandardSchemaError, type Client, type SqlQuery} from 'sqlfu';

// ...Params, Result, sql as above, using v.object/v.picklist/v.nullable...

export const findPostBySlug = Object.assign(
  async function findPostBySlug(
    client: Client,
    rawParams: v.InferOutput<typeof Params>,
  ): Promise<v.InferOutput<typeof Result> | null> {
    const parsedParamsResult = Params['~standard'].validate(rawParams);
    if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
    if ('issues' in parsedParamsResult) throw new Error(prettifyStandardSchemaError(parsedParamsResult) || 'Validation failed');
    const params = parsedParamsResult.value;
    const query: SqlQuery = {sql, args: [params.slug], name: 'find-post-by-slug'};
    const rows = await client.all(query);
    if (rows.length === 0) return null;
    const parsed = Result['~standard'].validate(rows[0]);
    if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
    if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');
    return parsed.value;
  },
  {Params, Result, sql},
);
```

Swap `validator: 'zod-mini'` and it emits the same inline Standard Schema guard, with `import * as z from 'zod/mini'`. The public shape — one callable, `.Params`, `.Result`, `.sql` — is identical across all three.

## Pretty errors

By default (`generate.prettyErrors: true`), validation failures throw an `Error` whose message is a readable, indented issues list — one line per issue with the dotted path:

```
✖ Expected string, received number → at slug
```

- **Zod** uses zod's native pretty-printer: `z.prettifyError(zodError)`. The generated wrapper calls `Params.safeParse(rawParams)` and throws `new Error(z.prettifyError(error))` on failure. No runtime helper is imported from sqlfu.
- **Valibot / zod-mini** share the [Standard Schema](https://standardschema.dev) `~standard.validate(input)` entry point. The generated wrapper inlines the result-guard (promise-check, then `'issues' in result`) and, on failure, calls `prettifyStandardSchemaError` — re-exported from `sqlfu` — to build the thrown `Error`'s message. That's the only thing imported from sqlfu in pretty-errors mode.

`prettifyStandardSchemaError` is vendored from [trpc-cli](https://github.com/mmkal/trpc-cli/tree/main/src/standard-schema) and re-exported as a reference implementation — it's a small function you're welcome to copy and adapt. The stable contract is the Standard Schema `Result` shape, not sqlfu's prettifier.

### `prettyErrors: false`

Set `prettyErrors: false` to let the raw error from the underlying validator library pass through untouched. Choose this if you have error-handling middleware that already introspects zod's `ZodError` / valibot's issues list structurally.

- **Zod** emits `Params.parse(rawParams)` directly — a `ZodError` propagates unchanged with `.issues` on it.
- **Valibot / zod-mini** emit an inline check on the Standard Schema result — on failure, `throw Object.assign(new Error('Validation failed'), {issues: result.issues})`. You still get the issues array on `error.issues`, without running it through the prettifier.

In `prettyErrors: false` mode with valibot or zod-mini, the generated file has **zero runtime dependency on sqlfu** — only `type Client` and `type SqlQuery` are imported, both erased at compile time. The wrapper is fully self-contained apart from its validator library.

```ts
generate: {
  validator: 'zod',
  prettyErrors: false, // default: true
},
```

## One identifier per query

The function name (camelCase, matching the SQL filename) is the identifier for everything related to the query:

```ts
import {findPostBySlug} from './sql/.generated/find-post-by-slug.sql.js';

// Call it.
const post = await findPostBySlug(client, {slug: 'hello'});
//    ^? findPostBySlug.Result | null

// Inferred types.
type P = findPostBySlug.Params; // { slug: string }
type R = findPostBySlug.Result; // { id: number; slug: string; title: string | null; status: 'draft' | 'published' }

// Runtime schemas (for forms, RPC, fixtures, etc.).
const schema = findPostBySlug.Params;
const result = findPostBySlug.Result;

// The raw SQL text.
const queryText = findPostBySlug.sql;
```

Namespace merging is what makes `findPostBySlug.Params` resolve as a value (the schema) *and* a type. Consumers of the library don't have to think about this — they just write `findPostBySlug.Params` in either position.

For queries with `update` semantics, the shape is `findPostBySlug.Data` + `findPostBySlug.Params` + `findPostBySlug.Result`, matching the plain-TS output.

## Error behavior

Validation throws on invalid input. Callers who want recovery can call the schemas directly via each library's `safeParse` equivalent:

```ts
// zod
const parsed = findPostBySlug.Params.safeParse(userInput);
if (!parsed.success) return handleError(parsed.error);

// valibot
import * as v from 'valibot';
const parsed = v.safeParse(findPostBySlug.Params, userInput);
if (!parsed.success) return handleError(parsed.issues);

// zod-mini
import * as z from 'zod/mini';
const parsed = z.safeParse(findPostBySlug.Params, userInput);
if (!parsed.success) return handleError(parsed.error);
```

The wrapper throwing by default is intentional — this is generated code and the right default is to fail loudly at the boundary.

## Not emitting a validator

If `generate.validator` is unset, `null`, or `undefined`, the generator emits the plain TS output (no validator import, no `.parse()` calls, types declared directly). No hybrid mode — a project picks one.

## Extending the generated shape

The generated file is readable and small. If you want a *specific* validator refinement (e.g. `.url()`, `.email()`, custom refinements) for a column, the honest answer today is to wrap the generated function in your application code:

```ts
import {findPostBySlug as rawFindPostBySlug} from './sql/.generated/find-post-by-slug.sql.js';
import {z} from 'zod';

const RichParams = rawFindPostBySlug.Params.extend({
  slug: z.string().regex(/^[a-z0-9-]+$/),
});

export async function findPostBySlug(client: Client, params: z.infer<typeof RichParams>) {
  return rawFindPostBySlug(client, RichParams.parse(params));
}
```

The generated schemas will never be richer than what a SQL type system can tell us. Column-level refinement is an application concern — today. Pluggable validators and per-column overrides are [planned](https://github.com/mmkal/sqlfu/blob/main/tasks/typegen-extensibility.md) but not in scope yet.
