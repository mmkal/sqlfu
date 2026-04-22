---
status: needs-grilling
size: medium
---

# Light root export: make `import 'sqlfu'` runtime-safe

Being grilled via `grill-you`. See `/tmp/grillings/sqlfu/light-root-export/interview.md` for the live transcript. This file will be rewritten when the interview finishes.

## Problem statement

The user just landed `e143355 slim down root export`, which trimmed `packages/sqlfu/src/index.ts` to:

```ts
export * from './client.js';
export * from './core/config.js';
export {prettifyStandardSchemaError} from './vendor/standard-schema/errors.js';
```

…and added a top-of-file comment declaring the rule: **anything reachable from the root `sqlfu` export must be runtime-safe** — no heavy deps, and no `node:*` imports, because those complicate Cloudflare Workers and Bun.

The slim-down was a surface fix. The real problem is `core/config.ts`, which imports `node:fs/promises`, `node:path`, `node:url` and mixes pure helpers (`defineConfig`, `resolveProjectConfig`, etc.) with I/O functions (`loadProjectConfig`, `loadProjectStateFrom`, `initializeProject`). The user wants:

1. A refactor that splits the pure config helpers from the filesystem-backed loaders.
2. An enforcement mechanism so this rule doesn't silently regress.

Adapters already follow the rule (`XyzDatabaseLike` types only, no concrete imports of `@libsql/client` / `bun:sqlite`). That convention stays.

## Status after grilling

_(to be filled in by Phase 2)_
