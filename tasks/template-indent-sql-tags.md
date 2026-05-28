---
status: in-progress
size: small
---

# Add template indentation linting for sql tags

Status: initial spec is ready. Implementation still needs to add `eslint-plugin-unicorn`, configure `unicorn/template-indent` for `sql` tagged template literals, and verify the repo lint command.

## Goal

Make ESLint enforce sensible indentation inside inline `sql` tagged template literals by enabling the `template-indent` rule from `eslint-plugin-unicorn`.

## Assumptions

- Base branch is `main`.
- The rule should run only for `sql` tagged template literals, not for every tagged template in the repo.
- The existing sqlfu ESLint plugin configuration should remain the source of sqlfu-specific lint behavior; this change is repo-level formatting lint for inline SQL authoring.

## Checklist

- [ ] Add `eslint-plugin-unicorn` as a workspace dev dependency.
- [ ] Configure `unicorn/template-indent` in `eslint.config.js` for `sql` tags.
- [ ] Verify the configured rule with the repo lint command.
- [ ] Move this task to `tasks/complete/` once the PR implementation is done.

## Implementation Notes

- Worktree: `../worktrees/sqlfu/template-indent-sql-tags`
- Branch: `worktree/template-indent-sql-tags`
