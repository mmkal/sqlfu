---
status: in-progress
size: medium
---

# Relations view: sort / filter / column select / pagination as SQL contributions

## Status (2026-04-22)

Core shipped and tested. Six Playwright specs cover the golden paths; 21 unit tests cover SQL generation shapes. All 52 Playwright tests in the package still pass.

Still pending manual polish:
- Visual design tweaks (icons, spacing). Currently using Unicode glyphs — fine for MVP, could swap for SVG later.
- Row-edit UX across mode transitions. Edits only work in default mode (`orpc.table.list`). Any icon click flips to SQL mode and grid becomes read-only. Unsaved edits silently lost — should likely warn.
- URL-based pagination (`#table/posts/2`) removed entirely. Any existing bookmarks land on the first page (state comes from localStorage).

Add icon-based UI on the Relations page that **builds up a SQL query** rendered in a CodeMirror editor. The SQL, not the icons, is the source of truth — it drives what the DataTable shows.

## Why this shape

Teaches the SQL by example. Every tweak a user makes in the UI has a visible SQL form they can learn from, copy, or continue editing by hand. "Just go to the SQL Runner" is always one step away — but casual browsing doesn't force them there.

## Behaviors

- [x] Query accordion appears below "Definition" on a Relation page. Collapsed by default. _`<details>` inside `RelationQueryPanel`; `accordion-open` persisted per relation in localStorage._
- [x] Auto-expands the first time the user contributes any clause. _`mutate()` helper flips `accordionOpen` on first invocation._
- [x] **Sort** — per-column icon cycles none → asc → desc → none. _`handleSortClick` in panel; single-column._
- [x] **Filter** — popover with operator dropdown + value input. All 11 operators supported. _`FilterPopover` component, `FILTER_OPERATORS` list._
- [x] **Column hide/show** — eye icon, hidden columns commented in the select list via `buildRelationQuery` → `/* "col" */`.
- [x] **Pagination** — toolbar `limit` input + Previous/Next buttons. Hash-based pagination removed (`Route.page` gone).
- [x] **Hard limit requirement** — `hasLimitClause(sql)` regex check; error callout + `enabled: false` on the useQuery when missing.
- [x] **Custom SQL banner** — `isSimpleSelectFromTable` heuristic; info callout with a link to `#sql`.

## Non-goals

- Multi-column sort (users can edit SQL directly).
- Editing rows through a filtered/sorted view — the DataTable becomes read-only once any contribution is made. Row edits still work in the default unmodified view.
- Saving arbitrary state beyond localStorage.
- Bi-directional parsing of the SQL back to UI state. Icons drive the SQL; when user edits SQL manually, icons become disabled until "Reset" is clicked.

## Files

- `packages/ui/src/relation-query-builder.ts` (new) — pure `buildRelationQuery(state)` + small helpers. Unit-tested.
- `packages/ui/src/relation-query-builder.test.ts` (new) — vitest, covers every clause shape.
- `packages/ui/src/relation-query-panel.tsx` (new) — the toolbar + per-header icons + popover + SqlCodeMirror accordion. React component.
- `packages/ui/src/client.tsx` — `TablePanel` wired to the new component. In "default mode" keeps existing `orpc.table.list` edit flow. In "custom query mode" switches to `orpc.sql.run`, grid becomes read-only.
- `packages/ui/test/studio.spec.ts` — add end-to-end specs.

## TDD order

1. Red: unit tests for `buildRelationQuery` covering each clause shape.
2. Green: implement `buildRelationQuery`.
3. Red: playwright spec — click sort icon, query accordion opens, CodeMirror shows `order by`, DataTable reorders.
4. Green: build the React component, wire to `TablePanel`.
5. Repeat red/green for filter, hide column, pagination, limit-required error, custom-SQL banner.

## Implementation log

- Pure SQL-builder (`relation-query-builder.ts`) stays framework-agnostic and is covered by 21 vitest cases. Every clause shape (including `in (...)`, `is null`, escape rules, non-zero offset) is pinned to an exact string — easy to evolve.
- React side intentionally does **not** parse the SQL back into structured state. Once the user edits the CodeMirror directly, we just store `customSql` and disable the icons. A "Reset" button returns to structured mode. Bi-directional parsing would be a lot of code for marginal benefit.
- `orpc.sql.run` is defined as a mutation in the router but oRPC procedures can be called as queries too. The panel uses `useQuery` with a `queryFn` that wraps `orpcClient.sql.run(...)` directly — simpler types than passing `queryOptions()` through as a prop.
- Data grid stays read-only in custom-query mode since `table.save`/`table.delete` are tied to `table.list`'s primary-key mapping. Editing still works in default mode.
