---
status: needs-grilling
size: small
---

The Getting Started walkthrough uses `./db/app.sqlite` as the database path, which means the database lives in a subdirectory (`db/`) while migrations and queries live at the project root (`migrations/`, `sql/`). That inconsistency is minor but noticeable -- a new user might reasonably wonder why the database gets its own folder when nothing else does, or might just put it at `./app.sqlite` and have a mismatch with `sqlfu.config.ts`. Worth a brief grilling session to decide: should the default config use `./app.sqlite` (flat), keep `./db/app.sqlite` (nested, consistent with frameworks that use a `db/` directory), or does it not matter and we just document the reasoning?

No prescribed solution. Grilling questions: Do we expect users to .gitignore the database file? Is `db/` a useful namespace for future database-adjacent files (seeds, fixtures)? Does `./db/` conflict with any common framework conventions?
