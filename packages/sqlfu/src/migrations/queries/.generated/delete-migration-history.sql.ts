import type {Client} from 'sqlfu';

export const DeleteMigrationHistorySql = `delete from sqlfu_migrations;`

export const deleteMigrationHistory = Object.assign(
	async function deleteMigrationHistory(client: Client): Promise<deleteMigrationHistory.Result> {
		const query = { sql: DeleteMigrationHistorySql, args: [], name: "delete-migration-history" };
		const result = await client.run(query);
		if (result.rowsAffected === undefined) {
			throw new Error('Expected rowsAffected to be present on query result');
		}
		return {
			rowsAffected: result.rowsAffected,
		};
	},
	{ sql: DeleteMigrationHistorySql },
);

export namespace deleteMigrationHistory {
	export type Result = {
		rowsAffected: number;
	};
}
