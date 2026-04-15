size: small
---

in the UI, add a '+' row at the bottom of the relations view table (i guess below the last row number?) for adding additional row(s).

- [x] add a synthetic `+` row at the bottom of editable relation grids
  note: focusing it appends a blank draft row
- [x] support saving appended rows
  note: save payloads now include synthetic `new` row keys, and the server inserts those rows instead of trying to update them
- [x] keep appended rows compatible with existing dirty/save/discard flows
  note: blank appended rows are treated as draft rows until saved or discarded
- [x] add a browser spec for append-and-save
  note: covers adding a new `posts` row from the grid and seeing it after reload

## Log

- New rows start blank/null and rely on normal grid editing before save. Constraint failures still come from SQLite if required columns are left incomplete.
