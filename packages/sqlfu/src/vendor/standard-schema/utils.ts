// Vendored from https://github.com/mmkal/trpc-cli/tree/main/src/standard-schema
// (Standard Schema spec recommends copy-pasting: https://standardschema.dev/schema)
// Modifications: none.

import type {StandardSchemaV1} from './contract.js';

export const looksLikeStandardSchemaFailure = (error: unknown): error is StandardSchemaV1.FailureResult => {
  return !!error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues);
};

export const looksLikeStandardSchema = (thing: unknown): thing is StandardSchemaV1 => {
  return !!thing && typeof thing === 'object' && '~standard' in thing && typeof thing['~standard'] === 'object';
};
