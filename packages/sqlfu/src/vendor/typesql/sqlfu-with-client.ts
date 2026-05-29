/*
 * Vendored from https://github.com/wsporto/typesql at
 * f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local split from sqlfu.ts:
 * - expose a browser-safe client-level entrypoint for already-open sqlite clients
 * - avoid importing file-backed node/bun sqlite constructor loading
 */
import {isLeft} from '../small-utils.js';
import {validateAndDescribeQuery} from './codegen/sqlite.js';
import {loadSchemaInfo} from './schema-info-client.js';
import type {TsDescriptor} from './codegen/shared/codegen-util.js';
import type {DatabaseClient, TypeSqlError} from './types.js';

export type SqlfuQueryInput = {
	readonly sqlPath: string;
	readonly sqlContent: string;
};

export type SqlfuQueryAnalysis =
	| {
			readonly sqlPath: string;
			readonly ok: true;
			readonly descriptor: TsDescriptor;
	  }
	| {
			readonly sqlPath: string;
			readonly ok: false;
			readonly error: TypeSqlError;
	  };

export async function analyzeSqliteQueriesWithClient(
	databaseClient: DatabaseClient,
	queries: readonly SqlfuQueryInput[],
): Promise<readonly SqlfuQueryAnalysis[]> {
	const schemaInfoResult = await loadSchemaInfo(databaseClient);
	if (schemaInfoResult.isErr()) {
		throw new Error(schemaInfoResult.error.description);
	}

	return queries.map((query) => {
		const descriptorResult = validateAndDescribeQuery(databaseClient, query.sqlContent, schemaInfoResult.value.columns);
		if (isLeft(descriptorResult)) {
			return {
				sqlPath: query.sqlPath,
				ok: false,
				error: descriptorResult.left,
			};
		}

		return {
			sqlPath: query.sqlPath,
			ok: true,
			descriptor: descriptorResult.right,
		};
	});
}
