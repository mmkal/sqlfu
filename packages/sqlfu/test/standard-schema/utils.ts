// Adapted from https://github.com/standard-schema/standard-schema
// Local test copy for fixture-parser validation helpers.

import {StandardSchemaV1} from './contract.js';

export const looksLikeStandardSchemaFailure = (error: unknown): error is StandardSchemaV1.FailureResult => {
  return !!error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues);
};
