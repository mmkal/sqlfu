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
- [x] allow primary-key editing on newly appended rows
  note: primary keys stay locked on existing rows, but synthetic `new` rows can fill them in before save
- [x] focus the clicked data cell when the `+` row creates a new row
  note: clicking inside a specific column on the append row now creates the draft row and selects that same column

## Log

- New rows start blank/null and rely on normal grid editing before save. Constraint failures still come from SQLite if required columns are left incomplete.
