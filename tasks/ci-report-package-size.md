---
status: ready
size: small
---

# Report published-package size on PRs

**Status:** done pending review. First run on PR #31 succeeded (47s total), sticky comment posted with zero deltas as predicted (this PR only adds CI files, none of which ship in the tarball). Ready to move to `complete/` once merged.

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

- [x] create `scripts/compare-package-size.ts` _implemented; groups `dist/vendor/*/*.js` by subdir, handles single-file vendor entries like `sha256.js` directly, warns at ≥10% packed bump_
- [x] create `.github/workflows/pr-package-size.yml` _PR-only, dual-checkout (head + main baseline), posts via `marocchino/sticky-pull-request-comment@v2`_
- [x] dogfood the output locally _ran against /tmp/sqlfu-pack-main.json as both base and head (zero deltas as expected) and against a fabricated +12% head to confirm warning renders_
- [x] sanity-check the workflow in the PR itself _ran on PR #31; job completed in 47s; sticky comment posted with zero deltas (packed 215.2 kB, unpacked 946.7 kB, 143 files, all four vendor-bundle rows at 0%) confirming the workflow compares against main correctly_

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

- `npm pack --dry-run --json` on `packages/sqlfu` after a full build returns the array shape we expected: `[{name, version, size, unpackedSize, entryCount, files: [{path, size}]}]`. We only look at the first element.
- Current tip-of-main numbers (2026-04-20, local build): packed 213.6 kB, unpacked 946.7 kB, 143 files. `dist/vendor/typesql/sqlfu.js` alone is 476.5 kB — that's the row to watch.
- Chose `marocchino/sticky-pull-request-comment@v2` over `peter-evans/create-or-update-comment@v4` because the former is one step (`header: package-size` acts as the sticky key) vs the latter needing a separate "find comment" step. Same output either way.
- Workflow does two checkouts into `head/` and `base/` and installs twice. The second `pnpm install` is cheap thanks to `actions/setup-node`'s pnpm store cache; overhead is dominated by the two `pnpm --filter sqlfu build` runs (~3s cold each on my machine; CI will be a bit slower). Accepted tradeoff for not having to think about `actions/cache` invalidation.
- Report also gets written to `$GITHUB_STEP_SUMMARY` so the workflow run page itself displays the table without clicking through to the PR comment. Handy when debugging CI.
