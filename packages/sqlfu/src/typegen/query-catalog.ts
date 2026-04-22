export type QueryCatalog = {
  generatedAt: string;
  queries: QueryCatalogEntry[];
};

export type AdHocQueryAnalysis = {
  sql: string;
  // `Ddl` covers create/drop/alter/pragma/etc. run via the UI SQL runner; the runtime
  // treats them as metadata-mode (no rows, no params).
  queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy' | 'Ddl';
  multipleRowsResult: boolean;
  resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
  args: QueryCatalogArgument[];
  dataSchema?: JsonSchemaObject;
  paramsSchema?: JsonSchemaObject;
  resultSchema: JsonSchemaObject;
  columns: QueryCatalogField[];
};

export type QueryCatalogEntry =
  | {
      kind: 'query';
      id: string;
      sqlFile: string;
      functionName: string;
      /** Runtime-ready SQL with `?` placeholders; this is what the driver executes. */
      sql: string;
      /** Original `.sql` file contents (preserves named `:param` placeholders); shown in the UI. */
      sqlFileContent: string;
      queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy';
      multipleRowsResult: boolean;
      resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
      args: QueryCatalogArgument[];
      dataSchema?: JsonSchemaObject;
      paramsSchema?: JsonSchemaObject;
      resultSchema: JsonSchemaObject;
      columns: QueryCatalogField[];
    }
  | {
      kind: 'error';
      id: string;
      sqlFile: string;
      functionName: string;
      sql: string;
      sqlFileContent: string;
      error: {
        name: string;
        description: string;
      };
    };

export type QueryCatalogArgument = {
  scope: 'data' | 'params';
  name: string;
  tsType: string;
  notNull: boolean;
  optional: boolean;
  isArray: boolean;
  driverEncoding: 'identity' | 'boolean-number' | 'date' | 'datetime';
};

export type QueryCatalogField = {
  name: string;
  tsType: string;
  notNull: boolean;
  optional: boolean;
};

export type JsonSchema = boolean | JsonSchemaObject;

export type JsonSchemaObject = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  anyOf?: JsonSchema[];
  format?: string;
  additionalProperties?: boolean;
};
