import type {Client} from 'sqlfu';

export const InsertMigrationSql = `
insert into sqlfu_migrations(name, checksum, applied_at)
values (?, ?, ?);
`

export const insertMigration = Object.assign(
	async function insertMigration(client: Client, params: insertMigration.Params): Promise<insertMigration.Result> {
		const query = { sql: InsertMigrationSql, args: [params.name, params.checksum, params.applied_at], name: "insert-migration" };
		const result = await client.run(query);
		if (result.rowsAffected === undefined) {
			throw new Error('Expected rowsAffected to be present on query result');
		}
		if (result.lastInsertRowid === undefined || result.lastInsertRowid === null) {
			throw new Error('Expected lastInsertRowid to be present on query result');
		}
		return {
			rowsAffected: result.rowsAffected,
			lastInsertRowid: Number(result.lastInsertRowid),
		};
	},
	{ sql: InsertMigrationSql },
);

export namespace insertMigration {
	export type Params = {
		name: string;
		checksum: string;
		applied_at: string;
	};
	export type Result = {
		rowsAffected: number;
		lastInsertRowid: number;
	};
}
