Prefer lowercase SQL keywords.

Note: this library is in pre-pre-pre-alpha. It is EXTREMELY HARMFUL to write or recommend changes that keep around legacy baggage. Instead, DELETE stuff that is no longer serving us if we update the design, implementation or API.

The project is currently in two parts:

- packages/sqlfu - all the juicy bits. The client, the CLI, the diff engine, the migrator, the formatter.
- packages/ui - a web server for using sqlfu from the browser. Run queries, migrations, etc.

When I refer to "dev-project", I'm talking about the scratch project which lives at ./packages/ui/test/projects/dev-project - that's the one that I tinker with manually via the UI. You can run commands in it with something like `(cd packages/ui/test/projects/dev-project && tsx ../../../../sqlfu/src/cli.ts check)`.

If I report a bug, it's fine to investigate first, but reproduce with a red test before fixing in code. Check your skills!

Sometimes I'll reference "pgkit". That's a similar project I built a while ago for postgresql. It's checked out next door at ../pgkit, so you should freely explore the code as a reference implementation.
