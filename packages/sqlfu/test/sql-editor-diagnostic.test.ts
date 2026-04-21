import {expect, test} from 'vitest';

import {isInternalUnsupportedSqlAnalysisError} from '../src/core/sql-editor-diagnostic.js';

// Guards that the UI's ad-hoc SQL editor stays silent (returns no
// diagnostics) when the parser/analyzer can't handle a statement kind,
// rather than surfacing an internal error message to the user. Each
// shape below represents a message the analyzer can actually emit.
const unsupportedMessages = [
  // Hand-rolled parser: keyword not in the dispatcher's recognized list
  // (e.g. someone types EXPLAIN in the runner).
  "parseSqlToShim: unsupported top-level keyword 'EXPLAIN'",
  // Hand-rolled parser: empty / whitespace-only input.
  'parseSqlToShim: no keyword found in SQL: ""',
  // Analyzer-level: parser produced a Sql_stmtContext but traverse can't
  // dispatch on it.
  'traverse_Sql_stmtContext',
  // Legacy path, kept for forward-compat on the detector.
  'Not supported!',
];

for (const message of unsupportedMessages) {
  test(`treats ${JSON.stringify(message)} as an unsupported-kind signal`, () => {
    expect(isInternalUnsupportedSqlAnalysisError(new Error(message))).toBe(true);
  });
}

test('does NOT swallow real syntax errors the user should see', () => {
  // If the parser fails mid-statement (e.g. user typed `select where`),
  // the message is specific to the failure — the UI should show a red
  // diagnostic rather than silently returning empty.
  expect(
    isInternalUnsupportedSqlAnalysisError(new Error("expected expression after 'where'")),
  ).toBe(false);
  expect(isInternalUnsupportedSqlAnalysisError(new Error('no such column: foo'))).toBe(false);
});
