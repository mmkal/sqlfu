---
status: needs-grilling
size: medium
---

# Lint stale generated queries

## Status Summary

Kickoff stub. The task still needs grilling/specification before implementation.

## Checklist

- [ ] Flesh out the desired lint behavior and generated metadata contract.
- [ ] Add a lint plugin rule that detects when `sqlfu generate` output is stale relative to query files.
- [ ] Update generator output if needed to make the stale check reliable.
- [ ] Cover the behavior with TDD-style integration tests.

