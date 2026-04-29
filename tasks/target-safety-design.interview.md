# target-safety-design Interview

## Q1 - Safety enforcement: mechanical or conventional? - 2026-04-28T14:40:22Z

Good. I've read all the relevant files. Here is question 1.

---

**Q1 - Safety enforcement: mechanical or conventional?**

The `sync` command in `cli-router.ts` already carries this in its description:

> *"this should only be used for local development. For production databases, use 'sqlfu migrate' instead."*

But there is no enforcement. A user who runs `sqlfu --config sqlfu.config.prod.ts sync` today will happily trash their production schema.

The root branch of the design tree is this:

**Does production need sqlfu to mechanically refuse destructive commands (sync, goto, draft) - or is "don't run those commands on prod" purely a documentation and convention concern that users enforce themselves?**

**My recommendation: mechanical.** The `--config` flag makes it one argument swap to accidentally run `sync` on the wrong config. Pre-alpha or not, a footgun that has no guard rail is hard to undo once users adopt the pattern. A lightweight `safety: 'migrate-only'` field in `SqlfuConfig` (which blocks `sync`, `goto`, and `draft` at the command layer) adds almost no API surface and answers the question permanently. It also collapses "should I introduce a target concept or not?" into a separate, smaller question - because if safety is just a config field, you don't need targets to protect prod; you just add the field to your prod config.

## A1 - 2026-04-28T14:40:22Z

Yes, production needs mechanical refusal. Documentation-only is not enough here.

I would not use `migrate-only` as the name, and I would be careful not to classify `draft` as destructive. `draft` is project-authoring: it reads Desired Schema + Migrations and writes a migration file. It does not touch the selected database. The real danger set is target-mutating commands: `sync`, `goto`, `baseline`, `migrate`, table-row edits, ad-hoc write SQL, and maybe any future "apply" command.

[guess: The right product stance is "mechanical guardrails for target writes; project-authoring commands can stay available, but the UI/CLI should not present them as prod operations."]

So my answer:

- Prod safety must be enforced mechanically.
- Default production policy should allow `check`, read-only schema/table browsing, pending/applied inspection, and `migrate`.
- Production policy should block `sync` and `goto` by default.
- `baseline` is an emergency reconciliation command: block by default unless an explicit override is passed.
- UI writes and ad-hoc write SQL should be blocked by default for production.
- `draft` should not be blocked because it is not a target operation, but command grouping/docs should make clear it is a local/project workflow.
- There should be an explicit escape hatch for the operator, but it should be noisy and command-specific, not a global habit-forming "yes to everything".

This does not by itself answer whether we need `target`. It only says every config/target that points at prod needs a safety classification.

---

## Q2 - "Target" concept: needed now, or does per-config safety cover the ground? - 2026-04-28T14:41:35Z

Understood. That's a precise scope. Let me ask the next branch.

---

**Q2 - "Target" concept: needed now, or does per-config safety cover the ground?**

With Q1 resolved, there are two coherent paths:

**Path A - Per-config safety only.** Add a `safety: 'production'` (or similar) field to `SqlfuConfig`. Users separate environments via multiple config files (`sqlfu.config.ts`, `sqlfu.config.prod.ts`); the `--config` flag from PR #63 is the env-switching mechanism. Each config that points at a production database declares its safety policy. No new "target" concept.

**Path B - First-class targets.** A single `sqlfu.config.ts` declares `targets: { dev: {...}, prod: {..., safety: 'production'} }`. The CLI grows `--target prod`. The UI can show both environments. Cross-target comparison (`check dev vs prod`) is a natural operation.

The practical gap between the two: Path A cannot, without extra CLI surface, answer "how does dev differ from prod right now?" in one command, and the UI can only show one environment per server process. Path B solves both, but introduces a new top-level schema concept, complicates config validation and resolution, and adds "which target is default?" as a question that must now be answered everywhere.

**My recommendation: Path A, no target concept yet.** The cross-target comparison use case is real but not urgent - `sqlfu --config A check` and `sqlfu --config B check` give you the two pictures, and diffing them is a UI concern that can be added later. Introducing `targets` now means every downstream consumer (config resolution, the UI server, error messages, docs) must understand the concept before you have a single user who needs it. The `--config` flag is already the env-switching handle; bolting safety onto the config it selects is a small, self-contained change.

**Is the cross-target comparison or single-file config enough of a near-term need to justify the `target` concept now - or is Path A sufficient for the first production-safety story?**

## A2 - 2026-04-28T14:41:35Z

Path A is sufficient for the first production-safety story. Do not add a first-class `targets` object yet.

I still want the word "target" in the product language, but not as config API yet. A target is "the database this resolved config points at." Under Path A, one config selects one project+target pair. That is enough to explain the model without adding `targets: {}` and `--target`.

[guess: The user's preference here is likely to spend the existing `--config` complexity before introducing a second selector. The earlier "could we just use --config?" prompt is a signal toward this simpler first step.]

Important constraint: `serve --config sqlfu.config.prod.ts` must actually preserve that config path into the UI backend. In PR #63, the CLI `serve` handler resolves a project state, then calls `startSqlfuServer({projectRoot})`; `startSqlfuServer` then loads the default config for that root. If the selected file is `sqlfu.config.prod.ts` in the same directory as `sqlfu.config.ts`, the server path can accidentally fall back to dev. That is unacceptable if multiple configs are the env mechanism.

So Path A means:

- Keep `--config` as the environment/target selector.
- Add config-level safety metadata.
- Make every command path, especially `serve`, carry the selected config file through instead of re-discovering default config from project root.
- Defer `targets: {}` until a concrete feature needs simultaneous multi-target awareness.
- For comparison, prefer a future command that accepts two config paths before adding nested targets, e.g. `sqlfu compare --config dev.sqlfu.config.ts --with prod.sqlfu.config.ts`.

Single-file config with `targets` is attractive, but it is not worth the conceptual and implementation cost yet.

## Q3 - Safety field: name and type shape - 2026-04-28T14:42:39Z

Noted. And the `serve` config-path leak is a concrete bug to track - I'll include that in the task file.

---

**Q3 - Safety field: name and type shape**

The production policy you've described has a fixed structure: allow `check`/read/`migrate`, block `sync`/`goto`/UI writes, and put `baseline` behind an explicit per-invocation override. That is one named policy, not a freeform blocklist.

Candidate shapes:

**A. `safety: 'production'`**
```ts
export default defineConfig({
  db: prodFactory,
  safety: 'production',
  definitions: './db/definitions.sql',
  migrations: './db/migrations',
  queries: './db/sql',
})
```
Clean, one new field, one named policy for now. Future policies (`'staging'`, `'readonly'`) can be added as named strings. The name `safety` is the vocabulary from the task and from Q1/Q2.

**B. `target: { safety: 'production' }`**
```ts
target: { safety: 'production' }
```
Reserves a `target` namespace for future per-target metadata without adding `targets: {}`. But introduces a sub-object immediately, and "target" still isn't in the config API per the Q2 decision.

**C. `readonly: true`**
Too narrow - it implies "no writes at all," but `migrate` is explicitly allowed on production. Would need to be overloaded or renamed.

**D. Freeform blocklist: `block: ['sync', 'goto']`**
Flexible, but forces users to think about the command surface instead of expressing intent. Doesn't compose with future UI-level blocking. Produces configs that partially protect prod by omission.

**My recommendation: `safety: 'production'` (Option A).** One flat field, one named value, minimal API surface. The vocabulary matches what you've already established. If a `'staging'` policy with slightly different defaults is needed later, it's a string enum extension. The `target` word stays in product language and docs, not in config keys.

**Do you want `safety` as the field name, and a string enum as the type - or a different name/shape?**

## A3 - 2026-04-28T14:42:39Z

Use `safety`, flat on the config, with a string enum. Do not introduce `target: {}` yet.

I would make the resolved shape explicit:

```ts
type SqlfuSafety = 'development' | 'production';
```

`safety` is optional in user config and resolves to `'development'`. Production configs opt in with `safety: 'production'`.

Reasoning:

- `environment` sounds like app/runtime metadata and will invite people to ask whether sqlfu should load `.env.production`, branch behavior by `NODE_ENV`, etc.
- `readonly` is wrong because production can still allow `migrate`.
- A blocklist makes users model sqlfu internals instead of intent.
- `safety: 'production'` can be used for staging/shared QA if they want production-like guardrails; the value means "use the production safety policy," not "this database is literally prod."

[guess: We should not add `'staging'` until there is a concrete different policy. Staging usually wants either development flexibility or production-like safety; a third named value now would mostly create debate.]

Maybe later this becomes object-shaped if there are real knobs:

```ts
safety: {
  policy: 'production',
  allowAdHocWrites: false,
}
```

But the first pass should intentionally not expose granular policy controls.

---

## Q4 - Escape hatch: shape, and which blocked commands even get one - 2026-04-28T14:43:49Z

Locked in. `SqlfuSafety = 'development' | 'production'`, flat, optional, defaults to `'development'`. No granular knobs in the first pass.

---

**Q4 - Escape hatch: shape, and which blocked commands even get one**

You said in Q1: *"an explicit escape hatch for the operator, noisy and command-specific, not a global habit-forming 'yes to everything'."*

But the blocked commands are not all the same kind of risk:

- **`sync`** is explicitly documented as a local-development tool. Its whole purpose is "update the live schema directly without a migration." On production that is always wrong - not just dangerous, but semantically wrong. There is no emergency scenario where you want to run `sync` against a production database; if the live schema is wrong, you write a migration.
- **`goto`** replaces the live schema and rewrites migration history atomically. It is dangerous but has a legitimate emergency use case: rolling back to a known state when a bad migration landed.
- **`baseline`** rewrites migration history without touching the live schema. Same category: dangerous, but the specific emergency of "prod DB was provisioned manually and has no history" is real.

So the question is whether `sync` should even have an escape hatch, or if it should be a hard no on any `safety: 'production'` config.

**My recommendation:** `sync` is fully blocked with no override on production - not gated, just refused with a clear error message pointing at `migrate`. `goto` and `baseline` get a per-invocation `--force-on-production` flag (exact name TBD) that must be typed explicitly every time; it is not a config option and not an environment variable. The error messages for blocked `goto`/`baseline` should name the override flag and explain what it allows.

**Do you agree that `sync` should be a hard no on production (no override), while `goto` and `baseline` get a named per-invocation override flag?**

## A4 - 2026-04-28T14:43:49Z

Yes. `sync` should be a hard no for `safety: 'production'`; no command-line override.

`sync` is the wrong semantic operation for production because it bypasses migration history. If a user really wants to bypass that, they can edit the config to `safety: 'development'`, but sqlfu should not provide a convenient prod-sync flag.

`goto` and `baseline` get a per-invocation override. I would probably call it `--force-production` rather than `--force-on-production`, but the exact name can be settled during implementation. Requirements:

- The override exists only on the commands that need it.
- It is not a config field.
- It is not an environment variable.
- It does not replace the existing confirmation body; it only unlocks the command.
- The UI should not expose this override in the first pass. Production UI stays read-only plus migrate/check style operations.

[guess: Keeping the override CLI-only for now is the right tradeoff. Emergency reconciliation is operator work, not something the studio should make easy.]

`migrate` remains allowed on production because it is the production path. `migrate --yes` should continue to work for CI/deploy pipelines.

---

## Q5 - Production UI: SQL runner and the migrate action - 2026-04-28T14:45:07Z

Clear. `sync` = hard no, no override, period. `goto` and `baseline` unlock with `--force-production` CLI-only. `migrate --yes` remains the CI/deploy path.

---

**Q5 - Production UI: SQL runner and the migrate action**

You've said production UI is "read-only plus migrate/check style operations." Two concrete questions fold into one here:

**SQL runner on production.** The current UI has a SQL runner that accepts arbitrary SQL. On production there are two options:

- **Fully blocked** - the server refuses all SQL runner queries when `safety: 'production'`. Clean enforcement but removes read-only inspection value (you can't `SELECT * FROM users LIMIT 10` against prod from the UI).
- **Reads-only heuristic** - allow queries that begin with `SELECT`/`PRAGMA`/`EXPLAIN` (after trimming whitespace/comments), refuse everything else. This is a pragmatic gate, not a guarantee, but it preserves the inspection use case.

For factory-based `db` configs (D1, Turso, libsql), sqlfu can't open the connection in a native read-only mode - it controls the factory's returned client interface, not the driver's access mode. So "reads-only" on the server side is a statement classification, not a connection-level lock.

**`migrate` in the production UI.** The CLI allows `migrate` (and `migrate --yes` for CI). Should the UI surface a `migrate` trigger at all, or should "apply migrations to production" always go through the CLI? The concern is: a UI migrate button is lower-friction than the CLI, which may conflict with the "noisy" principle for prod operations.

**My recommendations:**
- SQL runner on production: reads-only heuristic (`SELECT`/`PRAGMA`/`EXPLAIN`) - the inspection use case is real and worth preserving; blocking completely loses too much value.
- `migrate` in production UI: **not in the first pass**. Production migrate stays CLI-only. The UI can show pending migrations and migration history for inspection, but the apply action is absent. This is consistent with keeping the escape hatch CLI-only.

**Do you agree: reads-only SQL runner heuristic on production, and no migrate action in the production UI?**

## A5 - 2026-04-28T14:45:07Z

Mostly yes, with a stricter read-only rule than "starts with SELECT/PRAGMA/EXPLAIN."

Production UI should preserve read inspection, including the SQL runner, but write prevention belongs on the server. The UI hiding buttons is not enough.

The production SQL runner should allow only a conservative read-only subset:

- exactly one statement
- `select ...`
- `explain ...` / `explain query plan ...`
- maybe a small allowlist of read-only pragmas if needed for inspection

Do not broadly allow `PRAGMA`; some pragmas mutate state. Do not allow `WITH` in the first pass unless we have a real classifier that can distinguish read CTEs from DML CTEs. Do not rely on the current "returns rows" classifier because `RETURNING` and some pragmas blur that line.

[guess: It is better to initially reject some valid read queries than to accidentally bless a write path on a production config.]

Also apply the same production gate to generated query execution in the UI. A generated `insert-user.sql` or `delete-session.sql` should not be executable just because it is checked in. If the catalog has enough metadata to classify it as read-only, allow read-only queries; otherwise block production execution.

No production `migrate` button in the first pass. The UI may show pending migrations, applied history, drift/check cards, and the exact CLI command to run, but applying to production stays CLI/CI only.

---

## Q6 - `serve` and config-path propagation - 2026-04-28T14:46:46Z

Precisely drawn. Server-side enforcement for the SQL runner, conservative single-statement allowlist, same gate for generated queries, no production migrate button. UI shows state and the CLI command to run.

---

**Q6 - `serve` and config-path propagation**

You flagged this yourself in Q2 and it is the critical implementation concern for Path A to actually work. Currently in `cli-router.ts`:

```ts
serve: base.handler(async ({context, input}) => {
  await startSqlfuServer({
    port: input?.port,
    projectRoot: context.projectRoot,   // <- no config path here
    ui: ...
  });
})
```

And `startSqlfuServer` -> `loadProjectStateFrom(projectRoot)` auto-discovers the default config. So `sqlfu serve --config sqlfu.config.prod.ts` silently serves dev config if `sqlfu.config.ts` exists in the same directory. That is a safety hole: the user selects a production config, the server silently downgrades to development.

Two design options for fixing it:

**A. Pass `configPath` into `startSqlfuServer`.**
The server receives the selected file path. Every per-request config load uses that file, not auto-discovery. Config changes to `sqlfu.config.prod.ts` are still picked up on reload (no stale-config problem). The signature becomes `startSqlfuServer({ port, projectRoot, configPath?, ui? })`.

**B. Pass the already-resolved `SqlfuProjectConfig` into the server.**
The CLI resolves the config once; the server holds it for the session. No per-request re-reading. Cleaner in principle, but loses the ability to pick up config edits without restarting the server process - which is a worse dev experience, especially for the local/dev case where config iteration is common.

**My recommendation: Option A.** `startSqlfuServer` takes `configPath?: string`. The server uses it as the fixed file for all config loads in that process. The default (no `--config` flag) falls through to auto-discovery as today. This is a small, self-contained change that closes the safety hole without regressing the reload behavior.

**Do you agree with Option A - thread `configPath` through `startSqlfuServer` rather than the resolved config?**

## A6 - 2026-04-28T14:46:46Z

Yes, thread `configPath`, not a resolved config object.

Slightly sharpened API preference:

- `startSqlfuServer({projectRoot})` keeps today's auto-discovery behavior.
- `startSqlfuServer({configPath})` uses exactly that config file on every request.
- CLI `serve --config ...` should call the `configPath` path, not convert back to `projectRoot` only.
- If both `projectRoot` and `configPath` are passed, either reject as ambiguous or document that `configPath` wins. I prefer rejecting unless there is already an internal callsite that needs both.

[guess: rejecting both is cleaner because it keeps "root discovery" and "fixed config file" as two separate resolver modes.]

The server should re-load the selected config file per request or through the existing project-state path, so editing `sqlfu.config.prod.ts` while the server is running behaves like editing the default config today.

This is not optional for Path A. Multiple configs are only safe if the selected config file is the authority across CLI and UI backend boundaries.

---

## Q7 - Check recommendations on a production config - 2026-04-28T14:48:04Z

Sharp. Two resolver modes, no ambiguity: `{projectRoot}` or `{configPath}`, never both. Re-loading on each request preserves hot-edit behavior regardless of which mode is active.

---

**Q7 - Check recommendations on a production config**

`analyzeDatabase` in `api.ts` produces `CheckRecommendation[]`. Each recommendation has a `command` tuple that becomes the command hint in output. Today the possible commands include `sync`, `goto`, `baseline`, `migrate`, `draft`. On a `safety: 'production'` config, some of those are blocked or require `--force-production`.

Three options for how recommendations adapt:

**A. Accurate commands - include `--force-production` for unlockable commands, omit blocked-forever ones.**
- `goto` recommendation -> `sqlfu goto <target> --force-production`
- `baseline` recommendation -> `sqlfu baseline <target> --force-production`
- `sync` recommendation -> omitted entirely (not replaced; the check output describes the problem, sqlfu does not suggest `sync` to a production operator)

**B. Show problems, no command hints for production-blocked operations.**
- Mismatches still surface (schema drift, pending migrations, etc.)
- Command hints are suppressed entirely for anything that would be blocked or need an override
- Operators figure out the fix themselves

**C. Recommendations unchanged; enforcement is only at execution time.**
- `check` always recommends the same commands; the command itself rejects if safety blocks it
- Dishonest: the CLI recommends a command that will fail without telling you why it will fail

**My recommendation: Option A.** Recommendations should be accurate and immediately actionable. An operator looking at check output on a production target should see the real invocation needed, not a command that will fail with a confusing error. `sync` disappears entirely - there is no production analog to recommend in its place. If there is sync drift and no migration path, the honest output is "Desired Schema does not match Live Schema" with no command hint, and the fix is to author a migration first.

**Do you want Option A - accurate recommendations that include `--force-production` where needed, and no `sync` recommendation on production?**

## A7 - 2026-04-28T14:48:04Z

Yes, Option A, with one wording constraint: production recommendations that require force should be framed as exceptional, not normal next steps.

Rules:

- Never recommend `sync` on production.
- Continue recommending `migrate` normally; it is the production path.
- Continue recommending `draft` when there is repo drift; it is project-authoring and not a target write.
- For `goto` / `baseline`, include the real command with `--force-production`, but the label/rationale should say it is a production override / reconciliation operation.
- In the UI, show those commands as text only, not action buttons.

The bad state is a command hint that will fail or, worse, a dev-only command presented as legitimate production repair. The output should tell the truth about both the mismatch and the policy.

Example intent:

```text
- `sqlfu baseline <target> --force-production` Record the current production schema as already applied. Requires production override.
```

Not:

```text
- `sqlfu sync` Update the database from Desired Schema.
```

---

## Ready for Phase 2 - 2026-04-28T14:49:09Z

That closes every branch. The decision trail is complete.

---

**Ready for Phase 2.**

Here is the full decision record for the task file:

---

**Target/safety/config design - resolved decisions**

**Environment model**
- Path A: no first-class `targets` object. Multiple config files are the env-switching mechanism. `--config` (PR #63) is the selector. "Target" is product language for "the database a resolved config points at," not a config API key.
- Future: `sqlfu compare --config dev --with prod.config.ts` before nested `targets: {}`.

**Safety field**
- `safety?: 'development' | 'production'` on `SqlfuConfig`, flat, optional, resolves to `'development'`.
- No granular policy knobs in this pass. No `'staging'` value until there is a concrete different policy.

**Production command policy**
| Command | Production behavior |
|---|---|
| `check`, `generate`, `pending`, `applied`, `find`, `config` | Allowed |
| `migrate` (incl. `--yes`) | Allowed - this is the production path |
| `draft` | Allowed - project-authoring, no DB touch |
| `sync` | **Hard no. No override.** Error points to `migrate`. |
| `goto` | Blocked by default. `--force-production` unlocks (CLI only, per-invocation, not config/env). |
| `baseline` | Same as `goto`. |

**Escape hatch rules**
- `--force-production` exists only on `goto` and `baseline`.
- Not a config field. Not an environment variable. Does not replace confirmation.
- UI never exposes it.

**UI production mode**
- SQL runner: server-side allowlist - single statement, `SELECT`, `EXPLAIN`, `EXPLAIN QUERY PLAN`. No broad `PRAGMA`. No `WITH` in first pass.
- Generated query execution: same gate.
- Table editing: blocked (DML not in allowlist).
- No `migrate` action button. UI shows pending migrations, applied history, drift/check cards, and the exact CLI command to run.
- `goto`/`baseline` appear as text-only command hints with exceptional framing: *"Requires production override."* Not action buttons.

**Recommendations in check output on production**
- `sync` recommendation: suppressed entirely.
- `migrate`, `draft`: recommended normally.
- `goto`, `baseline`: recommended with `--force-production` in the command, label/rationale marks them as reconciliation overrides.

**`serve` config propagation**
- `startSqlfuServer` accepts either `{projectRoot}` (auto-discovery) or `{configPath}` (fixed file), never both - reject if both passed.
- `serve --config <path>` threads `configPath`, does not convert back to `projectRoot`.
- Server re-loads the selected config file per request, same as today's hot-edit behavior.
- This fix is required for Path A to be safe.

---
