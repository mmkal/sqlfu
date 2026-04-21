Prefer lowercase SQL keywords.

Prefer concise truthy/falsy checks. `foo && bar` over `foo !== undefined ? bar : undefined`; `!foo` over `foo === undefined` when the guarded branch short-circuits. Avoid verbose `=== undefined` / `!== undefined` chains unless the code genuinely needs to distinguish `undefined` from `null` / `0` / `''`.

Note: this library is in pre-pre-pre-alpha. It is EXTREMELY HARMFUL to write or recommend changes that keep around legacy baggage. Instead, DELETE stuff that is no longer serving us if we update the design, implementation or API.

The project is currently in two parts:

- packages/sqlfu - all the juicy bits. The client, the CLI, the diff engine, the migrator, the formatter.
- packages/ui - a web server for using sqlfu from the browser. Run queries, migrations, etc.

When I refer to "dev-project", I'm talking about the scratch project which lives at ./packages/ui/test/projects/dev-project - that's the one that I tinker with manually via the UI. You can run commands in it with something like `(cd packages/ui/test/projects/dev-project && tsx ../../../../sqlfu/src/cli.ts check)`.

If I report a bug, it's fine to investigate first, but reproduce with a red test before fixing in code. Check your skills!

Sometimes I'll reference "pgkit". That's a similar project I built a while ago for postgresql. It's checked out next door at ../pgkit, so you should freely explore the code as a reference implementation.

## Deciding where a feature gets documented

Don't jump straight to "add a section to the README". Most non-trivial features need information on several surfaces, and each one is doing a different job. Work through these in order:

1. **Reframe the feature in the project's voice first.** What does this feature look like through the `SQL First, TypeScript Second` lens? A feature that looks like "OpenTelemetry integration" is really *"your query filenames are the query's identity everywhere"*. That reframing decides which existing section or page it belongs near, and often narrows "where does it go" down to one obvious answer.
2. **Assess importance honestly.** Tentpole (hero copy), tentpole-adjacent (augment an existing panel, add a docs page), useful-to-some (docs page only), or niche (inline JSDoc + a sentence in the relevant docs page). Don't add a feature-grid panel for something that isn't a feature-grid-level claim; don't bury something that genuinely differentiates sqlfu from Drizzle/Kysely/Prisma.
3. **Pick the search terms a user would use to find it.** That's the docs page title. SEO beats clever naming — `observability` beats `tracing and errors` because real searches are `sqlfu observability`, `sqlfu opentelemetry`, `sqlfu sentry`. The page title should catch all of them.

### The surfaces, and what each is for

- **Landing page (`website/`)** — hero + existing value panels. Only touch it for tentpole or tentpole-adjacent features, and prefer one sentence inside an existing panel over adding a new panel (a new panel implies a new axis of the product).
- **`packages/sqlfu/README.md`** — this file IS the website's "sqlfu" overview docs page (rendered by `website/build.mjs`). One edit, two surfaces. One paragraph + a link into `docs/*.md` is usually the right shape; don't duplicate the deep-dive content here.
- **Root `README.md`** — generated from `packages/sqlfu/README.md` via `scripts/sync-root-readme.ts`. **Don't edit directly.** Edit the package README; the pre-commit hook will regenerate the root.
- **`packages/sqlfu/docs/*.md`** — deep-dive pages, argument-first. Explain *why*, not just *how*. These are auto-rendered in the website docs sidebar. Recipes for third-party tools (OTel, Sentry, Datadog) belong here, not in the README.
- **CLI `--help`** — command syntax + one-line description. Not the mental model. Someone reading `--help` knows what sqlfu is; they just forgot a flag name. Point to docs only if the command has a real design (e.g. `sqlfu migrate` retry semantics).
- **Error messages** — actionable + recommendation-style. Tell the operator what's wrong and what to do *now*. Assume the state they're in is visible in the error (or include it). Pointer to docs only when the next step isn't obvious from the message.
- **In the UI** — tooltips / inline hints for information that only makes sense alongside state the user has in front of them. A migration card tooltip saying "Pending" is useful; prose paragraphs aren't — they belong in docs.
- **CLAUDE.md (this file / vendored variants)** — agent-specific working conventions, not product documentation. Things that affect *how to work in the repo*, not *what sqlfu does*.

### Reference code in docs should invite copy-paste

When a feature ships a helper like `createOtelHook`, the doc should plainly say it's a reference implementation, not the blessed-forever API. The stable contract is the underlying hook/type; the helper is one valid way to satisfy it. Users should copy it and edit it to match their team's conventions without feeling they're going off-piste.

---

When I say "bedtime!" as well as your normal instructions I want you to *always* do the evergreen `tasks/improve-docs.md` and `tasks/cleanup-tasks.md` tasks. Don't move them to complete, just update it with your notes as necessary, especially when you make executive decisions on my behalf (which you are welcome to do if you think there's a clear benefit - I will always review the changes before merging anyway).
