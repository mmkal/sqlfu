status: done
size: medium

# Replace `confirm(...)` error-throw hack in the web UI

## Status

Done, with a follow-up pass to move the confirmation flow onto a real websocket instead of an HTTP-streaming hack.

- v1: `schema.command` streams `needsConfirmation` / `done` over SSE and `schema.submitConfirmation` is a sibling HTTP mutation. Correlates via a module-scoped pending-confirmation map keyed by UUID.
- v2 (current): same router shape, but those two procedures are served over `@orpc/server/ws` at `/api/rpc-ws`. Each upgrade creates a per-socket `PendingConfirmations` registry held in the router context, so the correlation map is scoped to the connection and disposed on `close`. No module-global state. The rest of the router still runs over fetch (`/api/rpc`) — all the stateless procedures use the same preflight/CORS path and the existing Playwright `waitForResponse` assertions keep working.

## Context

`runSqlfuCommand` (in `packages/sqlfu/src/api.ts`) accepts a `SqlfuCommandConfirm` callback that can prompt the user for a preview body (e.g. SQL to apply, migration file contents to write). Locally, the CLI uses a real interactive prompt. In the web UI, the server-side `schema.command` procedure (`packages/sqlfu/src/ui/router.ts`) simulates this by:

1. Running the command with a fake `confirm(params)` that checks whether the caller passed a pre-supplied `confirmation` string in the RPC input.
2. If not, it throws an `ORPCError('BAD_REQUEST')` whose message encodes the full `{title, body, bodyType, editable, ...}` payload as JSON (`confirmation_missing:{...}`).
3. The client (`packages/ui/src/client.tsx`) catches the error, parses the JSON out of the message string (`parseConfirmationRequest`), shows a dialog, and re-issues the mutation with `confirmation: <edited body>`.

This means the server throws away all the work it already did on the first call, runs the whole command a second time, and relies on a JSON-in-error-message side channel. We want a cleaner handshake.

## Plan

### Picking the transport

`@orpc/server@1.13.13` ships:

- `@orpc/server/ws` — an RPC-over-websocket adapter (peer model, client→server calls only).
- `eventIterator` / async-iterator-returning procedures — server→client streaming responses over regular HTTP (see `node_modules/.pnpm/@orpc+server@1.13.13_*/@orpc/server/dist/index.d.ts`). The `@orpc/client` RPCLink already decodes these as `AsyncIterable`.

We don't need full bidirectional sockets: the server just needs to push confirmation prompts out mid-call and read the answer back. A streaming HTTP response handles the push; a separate tiny mutation handles the answer. This keeps the existing HTTP plumbing, avoids a new ws upgrade path, and uses orpc's native streaming.

### New shape

`schema.command` becomes a streaming procedure. Each invocation returns an `AsyncIterable<CommandEvent>` where

```ts
type CommandEvent =
  | {kind: 'needsConfirmation'; id: string; params: ConfirmationRequest}
  | {kind: 'done'};
```

Add a sibling procedure `schema.submitConfirmation({id, body})`, where `body` is the edited text or `null` for cancel.

Server wiring (in `ui/router.ts`):

- Keep a module-scoped `Map<string, {resolve: (body: string | null) => void}>` of pending confirmations, keyed by a freshly generated id per prompt.
- The `schema.command` handler is an `async function*` generator that drives `runSqlfuCommand(..., async (params) => {...})`. Inside the inner confirm:
  1. Generate `id` (e.g. `crypto.randomUUID()`).
  2. `yield {kind: 'needsConfirmation', id, params}`.
  3. Create a `Promise<string | null>`, store its `resolve` in the map under `id`, `await` it.
  4. Return the resolved value.
- After `runSqlfuCommand` returns: `yield {kind: 'done'}` and clean up any remaining entries.
- On iterator close/abort (finally block in the generator), reject any still-pending entries so the mutation rejects cleanly.
- `schema.submitConfirmation({id, body})` looks up the entry, resolves it, and deletes it. If the id is unknown, throw a `BAD_REQUEST`.

Client wiring (in `packages/ui/src/client.tsx`):

- Delete `parseConfirmationRequest` and the `confirmation_missing:` error prefix parsing.
- Replace the retry-on-error pattern in `handleInitialize` / `handleSchemaCommand` with a helper (e.g. `runSchemaCommand(command)`) that:
  1. Calls the command procedure to get the iterator.
  2. Loops the iterator. On `needsConfirmation`, calls `confirmationDialogStore.confirm(params)` and then `orpc.schema.submitConfirmation.call({id, body: result.body ?? null})`.
  3. On `done`, resolves.
- The existing `confirmationDialogStore` stays; just its caller changes.

### Why CLI is unaffected

`SqlfuCommandConfirm` in `packages/sqlfu/src/api.ts` is the public interface and keeps its `(params) => Promise<string | null>` signature. The CLI in `packages/sqlfu/src/cli.ts` already supplies a local implementation that edits a temp file; it has never touched the web-side throw/retry hack.

### Existing tests that continue to cover this

- `packages/sqlfu/test/ui-server.test.ts` — the `"sqlfu server can initialize a fresh directory through the ui rpc"` test drives `client.schema.command({command: 'sqlfu init', confirmation: ...})`. This becomes `await consume(client.schema.command({command: 'sqlfu init'}))`, submitting the same confirmation body through the new `submitConfirmation` procedure. Easiest: add a tiny test-side helper that consumes the iterator and supplies a single pre-canned confirmation — but conceptually the test still exercises init-with-confirmation end-to-end.
- `packages/ui/test/studio.spec.ts` — the Playwright tests use `confirmAndRunSchemaCommand`, which clicks `sqlfu draft` / `sqlfu baseline`, waits for the dialog, fills the editor, then clicks "Confirm" and waits for an rpc response. With the new streaming design, the dialog trigger path and the Confirm-button path still fire an rpc call (to `schema/submitConfirmation` now). The helper's `waitForResponse` matcher needs to match the new url, otherwise the flow is identical from the user's perspective.

### Deletions

Per `AGENTS.md` ("DELETE stuff that is no longer serving us"):

- remove the `confirmation_missing:` error convention and `parseConfirmationRequest`
- remove the `confirmation` input field from `schema.command`
- remove the retry-on-catch flow in `handleInitialize` / `handleSchemaCommand`

## Acceptance

- `pnpm -F sqlfu test` passes (ui-server.test.ts updated).
- `pnpm -F sqlfu-ui test:node` passes.
- Playwright Studio spec still passes (with updated `waitForResponse` matcher).
- No remaining references to `confirmation_missing` in the repo.
