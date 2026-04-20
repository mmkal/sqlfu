# Vendored Dependencies

This tree contains source copied (or lightly adapted) from other open-source projects. Each subdirectory has its own `CLAUDE.md` that pins the upstream commit or version, records local modifications, and describes how to resync from upstream.

Why vendor at all? Two reasons:

1. We expect to diverge locally - either to change behavior (the sql-formatter printer) or to expose API shapes the upstream does not provide (the TypeSQL descriptor-level entrypoint in `typesql/sqlfu.ts`).
2. Some of these need non-trivial glue to load in an ESM workspace, and a single committed copy is simpler than a per-install build step.

## Projects vendored here

| Directory | Upstream | License | Summary |
| --- | --- | --- | --- |
| [`antlr4/`](./antlr4/) | [antlr/antlr4](https://github.com/antlr/antlr4) v4.13.2 (`dist/antlr4.web.mjs`) | BSD-3-Clause | JavaScript runtime for the ANTLR4 parsers TypeSQL uses. See [`antlr4/CLAUDE.md`](./antlr4/CLAUDE.md) for why we use the web build in both runtimes. |
| [`code-block-writer/`](./code-block-writer/) | [dsherret/code-block-writer](https://github.com/dsherret/code-block-writer) v13.0.3 | MIT | Small helper used by TypeSQL's code generator. |
| [`sql-formatter/`](./sql-formatter/) | [sql-formatter-org/sql-formatter](https://github.com/sql-formatter-org/sql-formatter) v15.7.3 | MIT | SQL formatter; wrapped by `src/formatter.ts` with sqlfu defaults. See [`sql-formatter/CLAUDE.md`](./sql-formatter/CLAUDE.md). |
| [`typesql/`](./typesql/) | [wsporto/typesql](https://github.com/wsporto/typesql) @ commit f0356201 | MIT | Query analysis and code generation; drives `sqlfu generate`. See [`typesql/CLAUDE.md`](./typesql/CLAUDE.md). |
| [`typesql-parser/`](./typesql-parser/) | [wsporto/typesql-parser](https://github.com/wsporto/typesql-parser) v0.0.3 | MIT | ANTLR4 grammars + generated parsers for MySQL/Postgres/SQLite used by TypeSQL. See [`typesql-parser/CLAUDE.md`](./typesql-parser/CLAUDE.md). |
| [`small-utils.ts`](./small-utils.ts) | sqlfu-original + neverthrow-shaped helpers | MIT (sqlfu) | Minimal replacements for the subset of [`neverthrow`](https://github.com/supermacro/neverthrow) TypeSQL uses, plus sqlfu-original helpers consumed by the vendored tree. |

## Attribution policy

Every vendor subdirectory has an `CLAUDE.md` with:

- upstream repo URL
- pinned version or commit
- the list of local modifications we expect to reapply on resync
- a "when updating from upstream" checklist

We intentionally do *not* add per-file attribution comments inside the vendored trees, because the CLAUDE.md workflow relies on being able to overwrite a directory with fresh upstream source and then reapply a small set of local changes. Per-file banners would be overwritten on every resync and generate noisy diffs.

Where a file has enough sqlfu-specific modification to be worth explaining in place (e.g. `small-utils.ts`, `typesql/sqlfu.ts`, `typesql/cli.ts`, `typesql/sqlite-query-analyzer/query-executor.ts`), it has its own banner.

Entry-point files (`sql-formatter/index.ts`, `sql-formatter/sqlFormatter.ts`, `typesql-parser/index.ts`, `antlr4/index.js`, `code-block-writer/index.ts`) carry short banners pointing back at upstream and at this file.
