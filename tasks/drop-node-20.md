---
status: ready
size: small
---

# Drop Node 20 support

CI already runs on Node 22 (bumped in the `config-db-pluggable` PR because
Node 20 can't strip type-only imports from the vendored sql-formatter).
The runtime still has Node-20 fallbacks that can come out.

- [ ] `openMainDevDatabase` in `packages/sqlfu/src/typegen/index.ts` —
  drop the `better-sqlite3` fallback, leave only the `node:sqlite`
  path. Delete the "Node 22" explanation comment.
- [ ] `scripts/generate-internal-queries.ts` — stop importing
  `better-sqlite3`; use `node:sqlite` (or just go through the node host
  like typegen now does). Delete the Node-20 comment.
- [ ] Root + package `engines.node` — set to `>=22`.
- [ ] `packages/sqlfu/package.json` devDependencies — remove
  `better-sqlite3` if no tests still need it (grep: `errors.test.ts`,
  `core-sqlite.test.ts`, `generate-authority.test.ts`,
  `recipes/id-helpers.test.ts`, `test/better-sqlite3.d.ts` — these
  assert the adapter itself works, keep them).
- [ ] README + docs — any "supports Node 20+" phrasing becomes
  "Node 22+".

Not blocking anything; pick up whenever convenient.
