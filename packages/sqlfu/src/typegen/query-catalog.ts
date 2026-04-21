export type QueryCatalog = {
  readonly generatedAt: string;
  readonly queries: readonly QueryCatalogEntry[];
};

export type AdHocQueryAnalysis = {
  readonly sql: string;
  // `Ddl` covers create/drop/alter/pragma/etc. run via the UI SQL runner; the runtime
  // treats them as metadata-mode (no rows, no params).
  readonly queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy' | 'Ddl';
  readonly multipleRowsResult: boolean;
  readonly resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
  readonly args: readonly QueryCatalogArgument[];
  readonly dataSchema?: JsonSchemaObject;
  readonly paramsSchema?: JsonSchemaObject;
  readonly resultSchema: JsonSchemaObject;
  readonly columns: readonly QueryCatalogField[];
};

export type QueryCatalogEntry =
  | {
      readonly kind: 'query';
      readonly id: string;
      readonly sqlFile: string;
      readonly functionName: string;
      readonly sql: string;
      readonly queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy';
      readonly multipleRowsResult: boolean;
      readonly resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
      readonly args: readonly QueryCatalogArgument[];
      readonly dataSchema?: JsonSchemaObject;
      readonly paramsSchema?: JsonSchemaObject;
      readonly resultSchema: JsonSchemaObject;
      readonly columns: readonly QueryCatalogField[];
    }
  | {
      readonly kind: 'error';
      readonly id: string;
      readonly sqlFile: string;
      readonly functionName: string;
      readonly sql: string;
      readonly error: {
        readonly name: string;
        readonly description: string;
      };
    };

export type QueryCatalogArgument = {
  readonly scope: 'data' | 'params';
  readonly name: string;
  readonly tsType: string;
  readonly notNull: boolean;
  readonly optional: boolean;
  readonly isArray: boolean;
  readonly driverEncoding: 'identity' | 'boolean-number' | 'date' | 'datetime';
};

export type QueryCatalogField = {
  readonly name: string;
  readonly tsType: string;
  readonly notNull: boolean;
  readonly optional: boolean;
};

export type JsonSchema = boolean | JsonSchemaObject;

export type JsonSchemaObject = {
  readonly type?: string | readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly string[];
  readonly anyOf?: readonly JsonSchema[];
  readonly format?: string;
  readonly additionalProperties?: boolean;
};
