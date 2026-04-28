# client-prepare — grill-me interview log

_Sub-claude (sonnet) interviewing the agent standing in for Misha. One question per turn. Answers flagged `[guess: ...]` are load-bearing judgement calls the user should spot-check._

## Q1 — sync vs async handle shape

**Research:** sync/async split is load-bearing throughout. `execAdHocSql` always receives an `AsyncClient`, so async-only would cover the stated scope.

**Question:** Add `SyncPreparedStatement` for `SyncClient` now, or only ship `PreparedStatement` on `AsyncClient`?

**Sub-claude's recommendation:** Add `SyncPreparedStatement` now — sync adapters all have native sync handles to wrap.

## A1

Agree, both. Two reasons beyond consistency:
1. `generate.sync: true` wrappers are the eventual caller; deferring forces a re-refactor or routes sync wrappers through async (defeats sync-mode point).
2. Every sync adapter already has a native handle (`StatementSync`, better-sqlite3 `Statement`, bun, libsql-sync, DO shim).

Mirror `DisposableAsyncClient`: sync handle uses `Symbol.dispose`, async handle uses `Symbol.asyncDispose`.

---

## Q2 — execAdHocSql: classifier vs try/catch

**Research:** `node/host.ts:118-119` documents why `sqlReturnsRows` exists — drivers disagree on whether `.all()` on a write throws (better-sqlite3) or silently returns `[]` (node:sqlite). Try/catch would misclassify writes on node:sqlite as reads.

**Question:** Keep keyword classifier (move to shared util like `packages/sqlfu/src/sql-classify.ts`), or delete it for prepare→try/catch?

**Sub-claude's recommendation:** Keep classifier, move to shared util. Try/catch is the wrong abstraction.

## A2

Keep, shared util. Reasoning is right: `execAdHocSql`'s job is "rows table or row count?", not "did it fail". A `.all()` on a write under better-sqlite3 might also have *partial side effects* before throwing, so try-then-fall-back-to-`.run()` could double-execute writes. Classifier is the correct primitive.

Placement: `packages/sqlfu/src/sqlite-text.ts` (alongside `rawSqlWithSqlSplittingAsync`). Don't create a new file. Export `sqlReturnsRows(sql: string): boolean`.

---

## Q3 — Named params: tokenizer placement

**Research:** sqlite-wasm `exec` natively accepts `bind: Record`, D1's `.bind()` is positional-only, DO's `exec(sql, ...bindings)` is positional-only.

**Question:** Move tokenizer to `sqlite-text.ts` so each adapter handles its own translation (Option A), or delete it entirely and keep callers responsible (Option B)?

**Sub-claude's recommendation:** Option A — adapters own translation; `execAdHocSql` becomes a clean pass-through.

## A3

Option A. Adapters own translation, callers pass through.

Refinement: prefer driver-native named-param support where it exists (better-sqlite3, node:sqlite, bun accept `{name: value}` against `:name`; libsql-client `execute({sql, args: {...}})`; sqlite-wasm `exec({sql, bind: {...}})`). Only fall back to the shared tokenizer for strictly-positional drivers — D1, DO, turso-serverless, expo-sqlite. Tokenizer is documented as an *adapter-internal compatibility shim*, not the universal path.

[guess: I'm asserting better-sqlite3, node:sqlite, bun, sqlite-wasm all natively accept the unprefixed `Record` form against `:name` placeholders. 90% on better-sqlite3 and node:sqlite from prior projects, less sure on bun and sqlite-wasm — implementer should verify; if any reject Record, fall back to tokenizer for that adapter.]

---

## Q4 — sqlite-wasm prepare: native `Stmt` vs `db.exec` shim

**Research:** `SqliteWasmDatabaseLike` has only `exec`/`selectValue`/`changes`. Native `db.prepare(sql)` returns a `Stmt` with `step/get/finalize` (lower-level cursor API).

**Question:** Wrap native `Stmt` (truly prepare-once + finalize lifecycle) or shim with `db.exec` per call?

**Sub-claude's recommendation:** Shim. sqlite-wasm internally caches prepared statements at the C level; wrapping the cursor adds finalize complexity for no real perf benefit on the demo-browser-only path.

## A4

Shim. Reasons:
1. sqlite-wasm runs in demo browser only (and as a scratch DB in tests). Not a perf hot path.
2. Wider interface = more surface to keep in sync. `SqliteWasmDatabaseLike` is intentionally minimal so users can pass either OO1 `db` or a compatible shim.
3. sqlite-wasm's internal `prepare` cache means re-issued `exec` for the same SQL isn't a fresh syscall at the C level.

Document the "no real prepare-once on this adapter" property in a code comment so a future agent doesn't believe sqlite-wasm got the perf benefit. Same logic confirmed for DO.

---

## Q5 — Test structure

**Research:** Each existing adapter test file has its own fixture (miniflare for D1, bare `DatabaseSync` for node-sqlite, etc.). A single matrix file would either duplicate ~7 fixture shapes or skip them.

**Question:** Shared helper called from each existing file (Option A), or one matrix file with locally-testable adapters only (Option B)?

**Sub-claude's recommendation:** Option A.

## A5

Option A. Concretely:
- New file `packages/sqlfu/test/adapters/prepare-suite.ts`. Exports `applyAsyncPrepareSuite({label, openClient})` and `applySyncPrepareSuite({label, openClient})`. Each calls a fixed set of `test(...)` cases using `openClient()` per test.
- Each adapter test file adds one line at the bottom: `applySyncPrepareSuite({label: 'better-sqlite3', openClient: () => ...});`. Below all existing tests + local fixture helpers.

Aesthetic: opening any adapter file, the reader sees existing tests up top, suite invocation as last line, helper next door.

Coverage minimum:
- positional `args` array
- named `Record` params
- prepare once → `.all(p1)` then `.all(p2)`
- prepare once → `.all()` then `.run()` (the original "reuse" motivation)
- iterate
- dispose callable + idempotent (second call doesn't throw)

[guess: I'm recommending all 11 adapters get this. If one or two need bun-specific or workerd to run the helpers, fine — leave to existing test runner and add the suite call there too.]

---

## Q6 — Disposal: `finalize` on native-prepare adapters

**Research:** None of the current `XxxStatementLike` interfaces expose `finalize`. node:sqlite `StatementSync`, better-sqlite3 `Statement`, bun `Statement` all have a real `finalize()` (sqlite3_finalize); failing to call it leaks SQLite VM memory until connection close.

**Question:** (a) extend interfaces with `finalize?(): void`? (b) noop dispose on shim adapters? (c) enforce throw-after-dispose?

**Sub-claude's recommendation:** (a) yes, optional; (b) yes, noop; (c) no enforcement.

## A6

All three agreed.

(a) Optional `finalize?(): void` in `*StatementLike` interfaces; call as `stmt.finalize?.()` in `[Symbol.dispose]`. Optional because these `*Like` interfaces are structural contracts for *user-provided* drivers — required would push burden onto every test mock and onto users wrapping a sqlite-shaped client without exposing finalize. [guess: trading silent-leak risk for ergonomic fit. Pre-alpha, optional is fine; if leaks bite, tighten to required + clear error.]

(b) Noop on shims. The slot (`[Symbol.dispose]` / `[Symbol.asyncDispose]`) must still *exist* on the handle — `using` keyword requires the symbol present, just empty body.

(c) No disposed-state tracking. `using` handles scope exit; no concrete payoff in zero-users codebase.

---

## Phase 2 ready

Sub-claude signaled `ready for Phase 2`. Decision log captured above and folded into the rewritten task file.
