size: small
---

table improvements. make the cell viewer part of a higher-order table component. (probably needs an "editable" prop). that way we can click to view cell content everywhere the table is used, like SQL runner and save query runner. also, cell content should be monospace.

- [x] reuse the existing shared `DataTable` cell viewer for result tables too
  note: SQL runner results and saved-query results now get the same click-to-inspect panel as relation tables
- [x] keep relation editing support on the same table surface
  note: the shared table surface still accepts editable relation-table props, so no separate viewer component was needed
- [x] make table cell content monospace
  note: grid cells now use the same mono stack as the code/editor surfaces
- [x] add browser coverage for result-table cell inspection
  note: specs cover relation tables, SQL runner results, and saved-query results

## Log

- I did not introduce a new thin wrapper component here. The existing shared `DataTable` already had the right shape, so widening its use was the cleaner move.
