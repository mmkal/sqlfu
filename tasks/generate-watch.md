---
status: ready
size: small
---

# `sqlfu generate --watch`

## Summary

Regenerate the typegen output (wrappers under `queries/.generated/`, tables file, barrel, query catalog, migrations bundle) whenever an input file changes. Today the dev loop is "edit SQL → run `sqlfu generate` → look at types → repeat"; watch mode closes that loop so the user keeps typing and `.generated/` stays fresh.

**Executive summary:** implementation landed. `--watch` flag wired into the CLI; `watchGenerateQueryTypesForConfig` is a reusable entry-point that takes an `AbortSignal` so tests shut it down cleanly. Chokidar v4 watches `config.queries/`, plus `definitions.sql` or `migrations/` depending on `generate.authority`. `.generated/` is ignored so regen output doesn't re-trigger regen. Errors are logged and the watcher keeps running. 4 integration tests plus a manual smoke test against `template-project` all pass.

## Scope

Add a `--watch` flag to the `sqlfu generate` CLI command. When set, sqlfu runs the generation once, then watches the relevant input paths and re-runs generation on change, until the process is killed.

### Inputs that should trigger a re-run

Depends on `generate.authority` (see `packages/sqlfu/src/typegen/index.ts:235 readSchemaForAuthority`):

- Always: the `queries/` directory (`config.queries`) — SQL files here are the primary generation input.
- `authority: 'desired_schema'` (default): `config.definitions` (the single `definitions.sql` file).
- `authority: 'migrations'`: `config.migrations.path` (directory).
- `authority: 'migration_history'`: `config.migrations.path` (directory). **Skip watching the live DB** for an initial cut — changes to DB rows shouldn't necessarily retrigger typegen, and DB-watching is a can of worms. Document this.
- `authority: 'live_schema'`: no file input — `--watch` doesn't make sense here. Error out with a helpful message (or fall back to polling? see grilling).

Do **not** watch `sqlfu.config.ts`. Config changes are rare and the clean way to pick them up is to restart the watcher. (Can be revisited.)

### Events to listen for

`add`, `change`, `unlink` on the watched paths. Directory watches should be recursive.

### Debounce

Batch rapid-fire events (e.g., a save-all from the editor, or git operations touching multiple files). A single trailing-edge debounce of ~150ms is the right default — matches what Vite/Rollup/etc. do for the same situation. Don't make this configurable in the first cut.

### Error handling

- If a generation run throws, log the error but keep the watcher alive. The user fixes the SQL / definitions file and the next save recovers.
- On `SIGINT`/`SIGTERM`, close watchers cleanly before exit.

### Output

- On start: `sqlfu generate --watch` → run once, then print `watching for changes…` (or similar one-liner) with the list of watched paths.
- On re-run: print what triggered it (`change: sql/users/get_by_id.sql`) and the usual "Generated …" line. Keep it quiet — one or two lines per cycle, no progress spinners.

## Design

### Watcher choice

Use `chokidar`. It's the de facto standard for this exact problem in Node, handles cross-platform gotchas (macOS fsevents, Windows recursion, atomic-save rename dances) that `fs.watch` gets wrong, and is already a transitive dependency of most JS tooling — adding it directly is ~zero blast radius. Add to `packages/sqlfu`'s `dependencies`.

(Node 20.x+ has `fs.promises.watch` with `recursive: true` on Linux/macOS/Windows, but the event stream is raw and debouncing/dedup is on us. Chokidar is worth the dep.)

### Where it lives

New file: `packages/sqlfu/src/typegen/watch.ts`, exporting `watchGenerateQueryTypes(config, host, options)`.
- Takes the already-loaded config + host so it matches `generateQueryTypesForConfig`'s shape.
- Contains: start watchers, debounce, run generation, handle shutdown. No CLI concerns.

Wire it up in `packages/sqlfu/src/node/cli-router.ts`:

```ts
generate: base
  .meta({ description: `Generate TypeScript functions for all queries in the sql/ directory.` })
  .input(z.object({ watch: z.boolean() }).partial().optional())
  .handler(async ({ input }) => {
    if (input?.watch) {
      await watchGenerateQueryTypes();
      return; // never returns in practice
    }
    await generateQueryTypes();
    return 'Generated schema-derived database and TypeSQL outputs.';
  }),
```

`watchGenerateQueryTypes` (no args) loads config + host the same way `generateQueryTypes()` does and delegates to the config-aware overload. Keeps the CLI-entry shape consistent with the rest of the router.

### What not to do

- Don't write a homegrown debouncer that lives in every caller. One util inside `watch.ts`.
- Don't refactor `generateQueryTypesForConfig` to be "incremental" (per-file regeneration). The runtime is already sub-second for typical projects; full rebuilds are fine and avoid whole classes of stale-output bugs. Revisit only if someone has a project big enough to feel the latency.
- Don't add `--watch` to any other sqlfu command in this PR. `check` and `migrate` are worth watching too (different task), but keep this one focused.

## Testing

Integration test in `packages/sqlfu/test/` — driven from the outside, hits the real CLI or the real `watchGenerateQueryTypes` function with a temp project dir. Shape roughly:

```ts
test('regenerates when a query file changes', async () => {
  await using project = await setupTempProject(/* minimal fixture: one query, definitions.sql */);
  await using watcher = startWatchOnBackground(project);
  await waitForGeneratedFile(project, 'queries/.generated/users.sql.ts');
  await project.writeQuery('users.sql', 'select id, name from users where id = :id');
  await waitForGeneratedContent(project, 'queries/.generated/users.sql.ts', /name: string/);
});
```

Fixtures use `Symbol.asyncDispose` per project conventions. Test should use real file writes + real chokidar, not a mocked FS — that's the point.

## Out of scope (call out explicitly)

- Watching the live DB (`authority: 'live_schema'`). First cut errors out.
- Watching `sqlfu.config.ts`. Restart manually.
- Incremental regeneration.
- Watch mode for `sqlfu check` / `sqlfu migrate`.
- UI integration (the UI already has its own live-reload mechanisms; this is for the CLI loop).

## Open questions

- `live_schema` authority: error vs. poll every N seconds vs. listen for SQLite WAL changes? Going with "error with a helpful message" in the first cut. Revisit if someone asks.
- Do we want to expose the debounce interval as a flag (`--watch-debounce=150`)? No — YAGNI until someone complains.
- Exit code on `ctrl-c`? 0, same as `vite` / `tsc --watch`.

## Implementation log

- Added `chokidar@^4.0.3` as a direct dependency of `packages/sqlfu`.
- New file: `packages/sqlfu/src/typegen/watch.ts`. Exports `watchGenerateQueryTypes()` (CLI entry, wires up SIGINT/SIGTERM) and `watchGenerateQueryTypesForConfig(config, host, options)` (reusable; takes `AbortSignal`, `onReady`, `logger`).
- Wired `--watch` into the `generate` command in `packages/sqlfu/src/node/cli-router.ts`.
- Paths watched: `config.queries/` always; `config.definitions` for `desired_schema`; `config.migrations.path` for `migrations` / `migration_history`; `.generated/` ignored to avoid feedback loop.
- Debounce: 150ms trailing; mutual-exclusion so a slow regen doesn't overlap with itself. While one run is in flight, new events set a `pending` flag and a single follow-up run fires at the end.
- Errors from `generateQueryTypesForConfig` are caught, logged via `logger.error`, and the watcher stays alive.
- Integration tests in `packages/sqlfu/test/generate-watch.test.ts` (4 cases) — all green. Full sqlfu test suite: 1315 passed, 0 failed. Manual smoke test against `packages/ui/test/template-project` confirmed query-file changes and `definitions.sql` changes both trigger regen, and SIGINT exits 0.
