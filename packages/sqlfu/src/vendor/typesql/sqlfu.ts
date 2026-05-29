/*
 * Vendored from https://github.com/wsporto/typesql at
 * f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local additions:
 * - expose a sqlite-only descriptor-level API for sqlfu
 * - avoid the upstream file-oriented compile pipeline when sqlfu generates wrappers
 * - re-export the browser-safe client-level entrypoint from sqlfu-with-client.ts
 */
import {closeClient, createClient} from './schema-info.js';
import {
	analyzeSqliteQueriesWithClient,
	type SqlfuQueryAnalysis,
	type SqlfuQueryInput,
} from './sqlfu-with-client.js';

export {analyzeSqliteQueriesWithClient};
export type {SqlfuQueryAnalysis, SqlfuQueryInput};

export async function analyzeSqliteQueries(databaseUri: string, queries: readonly SqlfuQueryInput[]): Promise<readonly SqlfuQueryAnalysis[]> {
	const databaseClientResult = await createClient(databaseUri, 'sqlite');
	if (databaseClientResult.isErr()) {
		throw new Error(databaseClientResult.error.description);
	}

	const databaseClient = databaseClientResult.value;

	try {
		return await analyzeSqliteQueriesWithClient(databaseClient, queries);
	} finally {
		await closeClient(databaseClient);
	}
}
