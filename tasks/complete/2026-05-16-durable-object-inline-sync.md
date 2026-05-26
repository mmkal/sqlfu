---
status: complete
size: medium
branch: do-inline-sync-tests
---

# Durable Object Inline Sync

## Status

Implementation is complete on the branch. `sync(client, {definitions})` now lives on the `sqlfu/api/sync` export; Durable Object tests cover constructor initialization and redeploy-style migration of already-initialized object storage. Bugbot-reported scratch-prefix edge cases now have direct regression coverage. Remaining review note: the broader import-surface test still has an unrelated `sqlfu/analyze`/`node:sqlite` failure.

## Assumptions

- The runtime API should not live on the root `sqlfu` entrypoint or the full `sqlfu/api` command facade because it pulls in schema diffing code. It is exposed through `sqlfu/api/sync` as `sync(client, {definitions})`.
- The desired schema is provided as inline SQL definitions, equivalent to `definitions.sql` content.
- No generated migrations, migration history, or typegen participate in this task.
- Destructive sync is allowed for this exploratory pre-alpha path, matching the existing CLI `sync` behavior.
- Durable Object runtime cannot rely on scratch database creation, so the implementation uses prefixed resources there. Other sync clients use an attached scratch database by default, with `scratchSchema: 'scratch-db' | 'prefix'` as the explicit override.

## Checklist

- [x] Add a real Durable Object test that initializes schema from inline definitions inside the constructor. _Covered by `runtime sync applies inline definitions in a durable object constructor` in `packages/sqlfu/test/adapters/durable-object.test.ts`._
- [x] Add a redeploy-style Durable Object test path where the same object storage has the old schema, then new inline definitions cause `sync(...)` to migrate it. _Covered by `runtime sync migrates existing durable object storage on redeploy`, using `durableObjectsPersist` to reuse Miniflare DO storage._
- [x] Keep the test focused on public imports from the runtime where possible. _The worker fixture imports `createDurableObjectClient` and `sql` from `./runtime/index.js`, and imports `sync` from `./runtime/api/sync.js`, matching `sqlfu/api/sync`._
- [x] Implement the minimal runtime sync surface needed by the test. _Added `packages/sqlfu/src/api/sync.ts` and exposed it through the `sqlfu/api/sync` export._
- [x] Verify the targeted Durable Object tests pass. _Ran `pnpm --filter sqlfu exec vitest run test/adapters/durable-object.test.ts`._
- [x] Update the pull request body with the externally-visible behavior and before/after output once implementation is complete. _PR body updated after implementation with behavior, strategy, and verification._
- [x] Address follow-up review on the sync subpath and flat redeploy test. _Moved runtime sync onto the `sqlfu/api/sync` export and changed the redeploy spec to deploy V1 then V2 without extra scope blocks._
- [x] Address Bugbot scratch-prefix review comments. _Added `packages/sqlfu/test/api-sync.test.ts` for index-name substring replacement and literal scratch-prefix cleanup behavior._

## Implementation Notes

- Existing file to extend: `packages/sqlfu/test/adapters/durable-object.test.ts`.
- Existing DO fixture already supports generated migrations and one object name; it likely needs a second worker/module class or a helper option to simulate redeploying the same persisted Durable Object storage with changed constructor code.
- Existing schema diff code uses host scratch DBs. For Durable Objects, a same-connection temporary schema or name-prefix strategy may be needed instead.
- Miniflare rejects `temp.sqlite_schema` in Durable Objects with `SQLITE_AUTH`, so the implementation uses prefixed main-schema objects (`__sqlfu_sync_*`) as the desired-schema materialization, inspects them, unprefixes the inspected model, plans the diff, then cleans the prefixed objects.
- While exercising an added column plus a new unique index, the SQLite planner skipped explicit index changes for tables classified as `add-columns`. The implementation fixes that by collecting explicit index changes in that branch too.
- Follow-up review moved the inline runtime sync onto `sqlfu/api/sync` and flattened the redeploy test through `createDORedeployFixture()`.
- Bugbot caught two valid edge cases: `lastIndexOf` could replace a table-name substring when prefixing an index name, and SQLite `LIKE` underscores could broaden scratch cleanup. The fix now uses the leading regex capture length for replacement and filters scratch object names with `startsWith(syncObjectPrefix)`.
- Review follow-up kept the public `sqlfu/api/sync` subpath, added the explicit `scratchSchema` strategy option, and kept runtime sync out of `sqlfu/api` so the main API entry can stay the Node command facade.
