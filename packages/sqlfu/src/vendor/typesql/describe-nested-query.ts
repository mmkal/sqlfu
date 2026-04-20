// sqlfu: trimmed to just the public types. The `describeNestedQuery` and
// `generateNestedInfo` helpers operated on MySQL's AST; both were unused from
// the sqlite path and dropped along with the MySQL parser. The live sqlite
// implementation is in sqlite-query-analyzer/sqlite-describe-nested-query.ts.

export type NestedResultInfo = {
	relations: RelationInfo[];
};

export type RelationInfo = {
	name: string;
	groupKeyIndex: number;
	columns: ModelColumn[];
};

export type Cardinality = 'one' | 'many' | '';

export type ModelColumn = Field | RelationField;

export type Field = {
	type: 'field';
	name: string;
	index: number;
};

export type RelationField = {
	type: 'relation';
	name: string;
	cardinality: Cardinality;
	notNull: boolean;
};
