import type {VendoredQueryAnalysis, VendoredQueryInput} from './analyze-vendored-typesql.js';

export type {VendoredQueryAnalysis, VendoredQueryInput};

export function analyzeVendoredTypesqlQueriesWithClient(
  client: unknown,
  queries: readonly VendoredQueryInput[],
): Promise<readonly VendoredQueryAnalysis[]>;
