/*
 * Vendored from https://github.com/wsporto/typesql at
 * f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local additions:
 * - expose a sqlite-only descriptor-level API for sqlfu
 * - avoid the upstream file-oriented compile pipeline when sqlfu generates wrappers
 */
import {isLeft} from '../small-utils.js';
import {validateAndDescribeQuery} from './codegen/sqlite.js';
import {closeClient, createClient, loadSchemaInfo} from './schema-info.js';
import type {TsDescriptor} from './codegen/shared/codegen-util.js';
import type {TypeSqlError} from './types.js';

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

export async function analyzeSqliteQueries(databaseUri: string, queries: readonly SqlfuQueryInput[]): Promise<readonly SqlfuQueryAnalysis[]> {
	const databaseClientResult = await createClient(databaseUri, 'sqlite');
	if (databaseClientResult.isErr()) {
		throw new Error(databaseClientResult.error.description);
	}

	const databaseClient = databaseClientResult.value;

	try {
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
	} finally {
		await closeClient(databaseClient);
	}
}
