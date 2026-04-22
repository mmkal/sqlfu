/*
 * Thin adapter around vendored TypeSQL code from https://github.com/wsporto/typesql
 * at commit f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local modifications are intentionally minimal:
 * - expose sqlite query analysis as an importable function
 * - keep sqlfu's main TS program isolated from vendored sources
 */

export type GeneratedField = {
  name: string;
  tsType: string;
  notNull: boolean;
  optional?: boolean;
};

export type GeneratedQueryDescriptor = {
  sql: string;
  queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy' | 'Ddl';
  returning?: true;
  multipleRowsResult: boolean;
  columns: GeneratedField[];
  parameters: (GeneratedField & {
    toDriver: string;
    isArray: boolean;
  })[];
  data?: (GeneratedField & {
    toDriver: string;
    isArray: boolean;
  })[];
};

export type VendoredQueryInput = {
  sqlPath: string;
  sqlContent: string;
};

export type VendoredQueryAnalysis =
  | {
      sqlPath: string;
      ok: true;
      descriptor: GeneratedQueryDescriptor;
    }
  | {
      sqlPath: string;
      ok: false;
      error: {
        name: string;
        description: string;
      };
    };

type VendoredTypesqlModule = {
  analyzeSqliteQueries(
    databaseUri: string,
    queries: VendoredQueryInput[],
  ): Promise<VendoredQueryAnalysis[]>;
};

async function loadVendoredTypesql(): Promise<VendoredTypesqlModule> {
  const modulePath = import.meta.url.endsWith('.ts') ? '../vendor/typesql/sqlfu.ts' : '../vendor/typesql/sqlfu.js';

  return import(modulePath) as Promise<VendoredTypesqlModule>;
}

export async function analyzeVendoredTypesqlQueries(
  databasePath: string,
  queries: VendoredQueryInput[],
): Promise<VendoredQueryAnalysis[]> {
  const {analyzeSqliteQueries} = await loadVendoredTypesql();
  return analyzeSqliteQueries(databasePath, queries);
}
