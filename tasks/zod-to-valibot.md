---
status: needs-grilling
size: medium
---

# Swap zod → valibot for sqlfu's internal usage

zod is currently sqlfu's only hard runtime dependency for schema validation — used in `src/ui/router.ts` and `src/cli-router.ts` for orpc input schemas and CLI option parsing. valibot is ~3× smaller on disk and plays nicely with tree-shaking.

If we can drop zod from `dependencies` (it'd stay as a codegen target in devDeps, like arktype/valibot are now), every sqlfu consumer avoids pulling zod into their node_modules for features they may not even use.

Two open questions to grill before starting:

1. Does orpc support valibot schemas as input validators? (It supports Standard Schema, so likely yes — confirm.)
2. Does trpc-cli? (CLI option parsing is currently a thin zod layer — replaceable with whatever the CLI framework takes.)

If either answer is "no / only zod", the scope grows (wrap / adapter layer), so triage those before committing to the swap.
