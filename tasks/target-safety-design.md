---
status: ready
size: medium
---

# Target, config, and safety design

## High-level status

Planning complete. The design keeps `--config` as the environment/target selector, adds config-level production safety, and defers a first-class `targets` API. No product code has been implemented in this branch.

## Summary

The first production-safety story should use multiple config files:

```sh
sqlfu --config sqlfu.config.ts check
sqlfu --config sqlfu.config.prod.ts check
```

A config file represents one sqlfu project plus one selected database target. "Target" becomes product language for "the database this resolved config points at," but not a new config key yet.

Production safety is explicit:

```ts
export default defineConfig({
  safety: 'production',
  db: () => openProdDb(),
  definitions: './definitions.sql',
  migrations: './migrations',
  queries: './sql',
});
```

## Resolved decisions

### Environment model

- Do not add `targets: {}` or `--target` in the first pass.
- Use `--config` as the selector for dev/prod/staging configs.
- Recommend shared config factoring (`base` object/import) when dev and prod share schema artifacts.
- Consider future cross-target comparison as a separate feature that can accept two config paths before introducing nested targets.

### Safety field

- Add `safety?: 'development' | 'production'` to `SqlfuConfig`.
- Resolve omitted `safety` to `'development'`.
- Keep it flat on the config.
- Do not add granular blocklists or policy knobs yet.
- Do not add a `'staging'` value until there is a concrete different policy.

### Production command policy

| Command | Production behavior |
| --- | --- |
| `check`, `generate`, `pending`, `applied`, `find`, `config` | Allowed |
| `migrate` and `migrate --yes` | Allowed; this is the production path |
| `draft` | Allowed; project-authoring, no DB touch |
| `sync` | Hard no; no override |
| `goto` | Blocked by default; `--force-production` unlocks |
| `baseline` | Blocked by default; `--force-production` unlocks |

### Escape hatch

- `--force-production` exists only on `goto` and `baseline`.
- It is per-invocation only.
- It is not a config field and not an environment variable.
- It does not replace the existing confirmation body.
- The UI does not expose it in the first pass.

### Production UI

- The server enforces production safety; hiding UI controls is not enough.
- Table editing is blocked.
- Production SQL runner allows only a conservative read-only subset:
  - exactly one statement
  - `select ...`
  - `explain ...`
  - `explain query plan ...`
  - no broad `pragma`
  - no `with` unless a real classifier can prove read-only behavior
- Generated query execution uses the same read-only gate.
- No production `migrate` button in the first pass.
- UI can show pending migrations, applied history, drift/check cards, and exact CLI commands to run.
- `goto` / `baseline` production recommendations appear as text-only command hints with "Requires production override" framing.

### Check recommendations

- Never recommend `sync` on production.
- Recommend `migrate` normally.
- Recommend `draft` normally when there is repo drift.
- For `goto` and `baseline`, include `--force-production` in the displayed command and mark the recommendation as an exceptional reconciliation override.

### `serve --config`

Multiple configs are only safe if the selected config is preserved into the UI backend.

- `startSqlfuServer({projectRoot})` keeps today's auto-discovery behavior.
- `startSqlfuServer({configPath})` uses exactly that config file on every request.
- Passing both `projectRoot` and `configPath` should be rejected unless an implementation constraint proves that impossible.
- `sqlfu serve --config sqlfu.config.prod.ts` must thread `configPath`; it must not convert back to `projectRoot` and rediscover `sqlfu.config.ts`.

## Implementation checklist

- [ ] Add `SqlfuSafety = 'development' | 'production'` and `safety?: SqlfuSafety` to the config types.
- [ ] Resolve `safety` to `'development'` in `SqlfuProjectConfig`.
- [ ] Validate the `safety` field in config shape checks.
- [ ] Add a central command-safety guard so CLI and UI command paths share the same policy.
- [ ] Refuse `sync` on production with a message pointing at migrations.
- [ ] Add `--force-production` to `goto` and `baseline`, and require it for production configs.
- [ ] Keep `migrate --yes` working on production.
- [ ] Make check recommendations safety-aware.
- [ ] Thread fixed `configPath` through `startSqlfuServer`.
- [ ] Add server-side production gates for UI table edits, ad-hoc SQL, and generated query execution.
- [ ] Add or reuse a conservative read-only SQL classifier for production UI execution.
- [ ] Update docs to explain multiple configs, target language, and production safety.
- [ ] Add tests for CLI safety enforcement, UI server config-path propagation, recommendation shaping, and production UI write blocking.

## Guesses and assumptions

- [guess] The right product stance is "mechanical guardrails for target writes; project-authoring commands can stay available, but the UI/CLI should not present them as prod operations."
- [guess] The user's preference is likely to spend the existing `--config` complexity before introducing a second selector.
- [guess] Do not add `'staging'` until there is a concrete different policy.
- [guess] Keeping production overrides CLI-only is the right tradeoff for emergency reconciliation.
- [guess] Initially rejecting some valid read queries is better than accidentally blessing a write path on production.
- [guess] Rejecting `{projectRoot, configPath}` together is cleaner than defining precedence.

## Out of scope

- A first-class `targets` config object.
- `--target`.
- Production UI migration execution.
- Per-command user-configurable safety blocklists.
- Driver-level read-only connection enforcement.
- Auth, hosted backends, or cloud sharing.

## Decision trail

The full interview transcript is in [`target-safety-design.interview.md`](target-safety-design.interview.md).
