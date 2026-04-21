/*
 * Thin adapter around vendored TypeSQL code from https://github.com/wsporto/typesql
 * at commit f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local modifications are intentionally minimal:
 * - expose sqlite query analysis as an importable function
 * - keep sqlfu's main TS program isolated from vendored sources
 */

export type GeneratedField = {
  readonly name: string;
  readonly tsType: string;
  readonly notNull: boolean;
  readonly optional?: boolean;
};

export type GeneratedQueryDescriptor = {
  readonly sql: string;
  readonly queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy' | 'Ddl';
  readonly returning?: true;
  readonly multipleRowsResult: boolean;
  readonly columns: readonly GeneratedField[];
  readonly parameters: readonly (GeneratedField & {
    readonly toDriver: string;
    readonly isArray: boolean;
  })[];
  readonly data?: readonly (GeneratedField & {
    readonly toDriver: string;
    readonly isArray: boolean;
  })[];
};

export type VendoredQueryInput = {
  readonly sqlPath: string;
  readonly sqlContent: string;
};

export type VendoredQueryAnalysis =
  | {
      readonly sqlPath: string;
      readonly ok: true;
      readonly descriptor: GeneratedQueryDescriptor;
    }
  | {
      readonly sqlPath: string;
      readonly ok: false;
      readonly error: {
        readonly name: string;
        readonly description: string;
      };
    };

type VendoredTypesqlModule = {
  analyzeSqliteQueries(
    databaseUri: string,
    queries: readonly VendoredQueryInput[],
  ): Promise<readonly VendoredQueryAnalysis[]>;
};

async function loadVendoredTypesql(): Promise<VendoredTypesqlModule> {
  const modulePath = import.meta.url.endsWith('.ts') ? '../vendor/typesql/sqlfu.ts' : '../vendor/typesql/sqlfu.js';

  return import(modulePath) as Promise<VendoredTypesqlModule>;
}

export async function analyzeVendoredTypesqlQueries(
  databasePath: string,
  queries: readonly VendoredQueryInput[],
): Promise<readonly VendoredQueryAnalysis[]> {
  const {analyzeSqliteQueries} = await loadVendoredTypesql();
  return analyzeSqliteQueries(databasePath, queries);
}
