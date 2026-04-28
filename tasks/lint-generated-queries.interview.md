# Interview: lint-generated-queries

## Q1 - metadata placement - 2026-04-28

Good, I can see the full architecture. The `format-sql` rule already runs on the synthetic `.js` virtual file produced by the processor and the errors get remapped to the original `.sql` file by `postprocess`. The freshness rule will follow the same pattern: error appears on the `.sql` file the user just edited.

One thing that ISN'T settled by the existing code is **where the hash lives in generated output**. Before committing to the per-wrapper-header approach the dossier recommends, I want to confirm it with you.

**Q1: Should each per-query generated wrapper (`.generated/get-users.sql.ts`) carry its own source-hash comment, or should a single central artifact (like the existing `.generated/query-catalog.json` or a new `.generated/source-hashes.json`) hold all source hashes?**

Recommendation: per-wrapper header.

## A1 - 2026-04-28

Use a per-wrapper header. The generated file is already the per-query artifact users import and review, so putting the source hash there makes the freshness contract obvious and cheap to check.

Use a deterministic hash of the exact source `.sql` file bytes for that wrapper. [guess: exact bytes are less surprising than formatter-normalized SQL because this rule is specifically "did you rerun generate after changing the file", not "did semantic SQL change".]

Prefer a full SHA-256 hex string in the comment unless it becomes visually painful in fixtures. [guess: a full hash avoids explaining collision tradeoffs and generated files are not optimized for hand-editing.]

---

## Q2 - absent generated directory - 2026-04-28

**Q2: If the `.generated/` directory doesn't exist at all, should the freshness rule fire on every `.sql` file with "wrapper missing - run `sqlfu generate`", or stay silent?**

Recommendation from grill: soft-activate. If `.generated/` doesn't exist as a directory, skip silently. Once the user runs `sqlfu generate` for the first time, the directory is created and the rule starts enforcing.

## A2 - 2026-04-28

Use strict reporting. If the rule is enabled, no `.generated/` directory means `sqlfu generate` has not been run, which is exactly what this rule is meant to catch.

Report on each linted source `.sql` file whose generated wrapper is missing, including the case where the whole `.generated/` directory is absent. [guess: users who only want formatting can disable this rule or avoid the recommended config; silently passing the never-generated case would undercut the requested guarantee.]

---

## Q3 - final decision recap - 2026-04-28

That resolves the last open branch. Recapping all decisions:

| Decision | Answer |
|---|---|
| Hash location | Per-wrapper header comment in each `.generated/*.sql.ts` |
| Hash content | Exact raw bytes of the source `.sql` file |
| Hash format | Full SHA-256 hex string |
| Missing `.generated/` | Strict: report on every linted source `.sql` |
| Missing individual wrapper | Strict: report |
| Autofix | None |
| Rule name | `sqlfu/generated-query-freshness` |
| Where rule fires | `.sql` processor virtual files (`**/*.sql/**/*.js`), same pattern as `format-sql` |
| Added to `recommended` | Yes, in the `**/*.sql/**/*.js` block |

**Ready for Phase 2.**
