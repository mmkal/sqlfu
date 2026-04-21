status: done
size: medium

# Confirm

## Status Summary

- Roughly done: the shared confirm flow now exists in both the CLI and UI and appears to be working.
- Main completed pieces: server-driven confirmation requests, editable SQL/text confirmation bodies, UI dialog wiring, shadcn-style dialog primitives, and global error toast support.
- Main missing pieces: no dedicated automated coverage for the interactive CLI editor path yet; future UX polish is still possible.

## Goal

Add a shared "confirm before proceeding" concept similar to `pgkit`, with support for:

- CLI confirmation prompts that can show generated text before running a command
- editable confirmation bodies for cases like generated SQL
- UI confirmation handling that can show the same server-provided body in a modal
- reusable dialog/toast primitives in the UI so confirmation and error handling are not ad hoc

## Checklist

- [x] Add a shared confirm callback to the `sqlfu` command execution flow. _Implemented via `SqlfuCommandConfirm` plumbing in `packages/sqlfu/src/api.ts` and `packages/sqlfu/src/cli.ts`._
- [x] Show confirmation text in the CLI before applying draft/sync/migrate/baseline/goto actions. _Those command paths now call `confirm(...)` with a title/body payload._
- [x] Allow editable confirmation bodies where the operator may need to adjust generated SQL. _`draft`, `sync`, and `goto` pass `editable: true`; the CLI opens a temp file in an editor when requested._
- [x] Add UI confirmation handling driven by the server response rather than duplicating command logic in the browser. _`packages/ui/src/server.ts` surfaces `confirmation_missing:...` payloads and the client retries with the confirmed body._
- [x] Add a reusable dialog implementation for the UI confirm flow. _Implemented with the dialog primitives in `packages/ui/src/components/ui/dialog.tsx` and the host in `packages/ui/src/client.tsx`._
- [x] Add global toast support for mutation errors in the UI. _Implemented with `react-hot-toast`, `AppToaster`, and the shared mutation `onError` path in `packages/ui/src/client.tsx`._
- [x] Add UI coverage proving the server-provided confirmation text is used. _Covered by `schema commands use server-provided confirmation text` in `packages/ui/test/studio.spec.ts`._
- [x] Run the relevant automated checks. _`packages/sqlfu` test suite passed, and the targeted UI Playwright confirmation spec passed on 2026-04-16._

## Notes

- The UI implementation does not use SSE/HTTP streaming; it uses an error-mediated request/retry flow instead. _That seems sufficient for the current product shape._
- The main remaining risk is the interactive CLI editor branch, which is implemented but not exercised by an automated spec yet.

## Implementation Notes

- CLI confirm lives in `packages/sqlfu/src/cli.ts` and supports editor-based round-tripping through a temp file with `.sql` / `.md` / `.txt` extensions.
- UI confirm lives in `packages/ui/src/client.tsx` using an external-store dialog host so command mutations can await the user decision cleanly.
- Server command handling lives in `packages/ui/src/server.ts`, where missing confirmation bodies are surfaced as structured client errors that can be retried with user-edited content.
