import {prettifyStandardSchemaError} from '../vendor/standard-schema/errors.js';

/**
 * Run a validator `.parse()`-style callback and, if it throws a Standard Schema-compatible
 * failure, re-throw with a readable, indented message (built from the failure's `issues`).
 *
 * All three supported validators (zod, valibot, zod-mini) throw errors whose shape matches
 * Standard Schema v1 `FailureResult` (`{issues: Issue[]}`). This helper is the uniform
 * pretty-errors path across them.
 *
 * Used by generated query wrappers when `generate.prettyErrors` is true (default).
 */
export function runWithPrettyErrors<TValue>(label: string, fn: () => TValue): TValue {
  try {
    return fn();
  } catch (error) {
    const prettified = prettifyStandardSchemaError(error);
    if (prettified === null) {
      throw error;
    }
    throw new Error(`${label} validation failed:\n${prettified}`, {cause: error});
  }
}
