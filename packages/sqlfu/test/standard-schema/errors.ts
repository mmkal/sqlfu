// Adapted from https://github.com/standard-schema/standard-schema
// Local test copy for readable validation failures in fixture parsing.

import {StandardSchemaV1} from './contract.js';
import {looksLikeStandardSchemaFailure} from './utils.js';

export const prettifyStandardSchemaError = (error: unknown): string | null => {
  if (!looksLikeStandardSchemaFailure(error)) {
    return null;
  }

  const issues = [...error.issues]
    .map((issue) => {
      const path = issue.path || [];
      const primitivePathSegments = path.map((segment) => {
        if (typeof segment === 'string' || typeof segment === 'number' || typeof segment === 'symbol') {
          return segment;
        }
        return segment.key;
      });
      const dotPath = toDotPath(primitivePathSegments);
      return {
        issue,
        path,
        dotPath,
      };
    })
    .sort((a, b) => a.path.length - b.path.length);

  const lines: string[] = [];
  for (const {issue, dotPath} of issues) {
    let message = `✖ ${issue.message}`;
    if (dotPath) {
      message += ` → at ${dotPath}`;
    }
    lines.push(message);
  }

  return lines.join('\n');
};

function toDotPath(path: (string | number | symbol)[]): string {
  const segments: string[] = [];
  for (const segment of path) {
    if (typeof segment === 'number') {
      segments.push(`[${segment}]`);
      continue;
    }
    if (typeof segment === 'symbol') {
      segments.push(`[${JSON.stringify(String(segment))}]`);
      continue;
    }
    if (/[^\w$]/.test(segment)) {
      segments.push(`[${JSON.stringify(segment)}]`);
      continue;
    }
    if (segments.length) {
      segments.push('.');
    }
    segments.push(segment);
  }

  return segments.join('');
}

export class StandardSchemaV1Error extends Error implements StandardSchemaV1.FailureResult {
  issues: StandardSchemaV1.FailureResult['issues'];

  constructor(failure: StandardSchemaV1.FailureResult, options?: {cause?: Error}) {
    super('Standard Schema error - details in `issues`.', options);
    this.issues = failure.issues;
  }
}
