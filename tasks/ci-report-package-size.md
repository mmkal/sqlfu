---
status: ready
size: small
---

# Report published-package size on PRs

After the slim-package work (PR #29) got the tarball from 1.5 MB / 18.8 MB down to 217 kB / 965 kB, we should surface any regression in a PR comment before it lands on main. `npm pack --dry-run --json` has everything we need (packed size, unpacked size, file count, per-file sizes).

## Executive decisions (locked in)

- **Delivery mechanism: single-shot GitHub Action.** No third-party service dependency (pkg-size.dev, bundle-stats). The measurement is a one-line `npm pack --dry-run --json` and the comparison is ~50 lines of TS. Not worth outsourcing.
- **Comment strategy: sticky comment, overwrite on each push.** Using `marocchino/sticky-pull-request-comment@v2` (battle-tested, tiny surface area). Avoids comment spam on force-pushes / branch iteration.
- **What gets measured:**
  - tarball size (`npm pack --dry-run --json` -> `.size`)
  - unpacked size (`unpackedSize`)
  - file count (`entryCount`)
  - per-file breakdown for `dist/vendor/*.js` (the biggest moving piece; bundled output from `build:bundle-vendor`)
- **Thresholds: prose-only.** If packed size grows ≥10%, the comment gets a warning and a sentence saying "if this is intentional, acknowledge in the task file". No build failure, no hard gate — a human reviewer can read 4 lines of markdown and decide.
- **Only `packages/sqlfu` gets measured.** That's the only package we publish today. `@sqlfu/ui` is a workspace peer that gets embedded via `pkg-pr-new` but isn't its own release. If UI ever ships standalone, add a second matrix entry.

## Checklist

- [ ] create `scripts/compare-package-size.ts` — tsx-runnable, accepts `--base <path-to-main.json> --head <path-to-pr.json>`, emits markdown to stdout. Knows how to humanize bytes and format a percent delta.
- [ ] create `.github/workflows/pr-package-size.yml` — PR-only workflow that packs on the PR branch and on `main`, diffs the two, and posts a sticky comment.
- [ ] dogfood the output locally (run build on main, save json; checkout branch, build, save json; feed both to the script).
- [ ] sanity-check the workflow in the PR itself. The first run should compare `ci-report-package-size` against `main` and the sizes should be nearly identical (only `.github/` + `scripts/` additions, which aren't in the npm tarball).

## Design notes

### Which `npm pack` to invoke

`pnpm pack --dry-run` doesn't print JSON. `npm pack --dry-run --json` does. We run `npm pack` from `packages/sqlfu/` (not `pnpm`), cd'd in. That's a minor ugly but there's no pnpm equivalent. Using the workflow step's `working-directory` keeps it clean.

### Getting a `main` baseline

Options considered:

1. **Second checkout in the same job.** Use `actions/checkout@v4` again with `ref: main` into a sub-path, install + build, pack. Roughly doubles the job time. Simple and reliable.
2. **Cache the main tarball JSON.** Use `actions/cache` keyed on `main`'s SHA. First PR after a main push pays the cost; subsequent PRs reuse. More clever, but cache invalidation is a headache if `main` moves during a long PR review.
3. **Download latest published version from pkg-pr-new or npm.** Version-pinned to what `main` actually shipped, but complicated and not really what we want (we want to compare against the current tip of `main`, not a published snapshot).

Going with **option 1** (fresh checkout + build). The build is ~3s and an install is ~30s on CI; doubling that is cheap, and cache invalidation is not a class of bug I want to debug.

### JSON shape we rely on

`npm pack --dry-run --json` emits an array of one object (per package), with:

```jsonc
{
  "name": "sqlfu",
  "version": "...",
  "size": 222534,           // packed (tarball) bytes
  "unpackedSize": 988445,   // unpacked bytes
  "entryCount": 156,
  "files": [
    { "path": "dist/cli.js", "size": 12345 },
    // ...
  ]
}
```

Script groups `files` matching `dist/vendor/*.js` and totals them for the vendor-bundles row.

### Comment format

```
## Package size

|            | main      | this PR   | Δ           |
| ---------- | --------- | --------- | ----------- |
| packed     | 217.3 kB  | 220.1 kB  | +1.3%       |
| unpacked   | 965 kB    | 970 kB    | +0.5%       |
| files      | 156       | 156       | 0           |

### dist/vendor/*.js bundles

|                            | main     | this PR  | Δ      |
| -------------------------- | -------- | -------- | ------ |
| vendor/typesql/sqlfu.js    | 512 kB   | 514 kB   | +0.4%  |
| vendor/sql-formatter/*.js  | 118 kB   | 118 kB   | 0      |
```

If any row's packed Δ ≥ +10%, prepend a warning line: "Package size bump >10% — if intentional, acknowledge in the task file."

## Implementation log

<!-- filled during implementation -->
