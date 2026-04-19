# Schemadiff Guidelines

This folder contains schema-diffing logic. Changes here should bias toward explicit semantic models over ad-hoc SQL text inspection.

## Preferred Approach

- Prefer inspected structure over regexes, `.includes`, or SQL string surgery.
- When a new SQLite behavior matters, first ask whether we should extend the inspected schema model so the planner can reason about it explicitly.
- Keep the planner honest about destructive changes. If we cannot prove a direct transformation is safe, prefer a rebuild or an explicit failure.

## Dependencies

- Treat dependencies as real planner input, not incidental detail.
- If an operation requires dropping and recreating dependent objects, model those dependencies explicitly rather than relying on statement ordering that "happens to work".
- As the planner grows, prefer data structures that can support topological ordering of objects and operations.

## Heuristics

- SQL text heuristics are a last resort.
- If a heuristic is temporarily necessary, keep it narrow, document why it exists, and leave a clear path toward replacing it with inspected structure.
- Do not expand heuristic-based planning just because it makes one fixture pass.

## Inspiration

- This code is inspired by `@pgkit/schemainspect` and `@pgkit/migra`.
- `pgkit`'s implementations were themselves ported from djrobstep's Python `schemainspect` and `migra`.
- Those implementations are PostgreSQL-only. This folder is SQLite-only for now, so similarities in planner structure do not imply the same DDL capabilities or safety rules.
- Port ideas, not assumptions.
