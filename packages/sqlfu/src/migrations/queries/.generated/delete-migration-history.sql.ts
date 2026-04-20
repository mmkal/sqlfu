import type {Client} from 'sqlfu';

export const DeleteMigrationHistorySql = `delete from sqlfu_migrations;`

export const deleteMigrationHistory = Object.assign(
	async function deleteMigrationHistory(client: Client): Promise<void> {
		const query = { sql: DeleteMigrationHistorySql, args: [], name: "delete-migration-history" };
		await client.run(query);
	},
	{ sql: DeleteMigrationHistorySql },
);
