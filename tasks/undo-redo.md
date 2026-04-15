size: small
---

react-grid supports undo and redo. i think i implemented it in ../pgkit. let's add it to the table view thing

- [x] add relation-grid undo/redo history
  note: implemented as app-level row snapshot history around `onRowsChange`, following the ReactGrid docs approach
- [x] add visible undo/redo controls
  note: `Undo` / `Redo` buttons sit above editable relation grids
- [x] wire keyboard shortcuts
  note: `cmd/ctrl+z`, `cmd/ctrl+shift+z`, and `ctrl+y` route through the same history handlers
- [x] add a browser spec
  note: the spec currently proves the visible controls path

## Log

- ReactGrid does not ship built-in undo/redo state here; the docs explicitly push this responsibility to the application layer.
