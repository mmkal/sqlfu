import type {Client} from 'sqlfu';

export const SelectMigrationHistorySql = `
select name, checksum, applied_at
from sqlfu_migrations
order by name;
`

export const selectMigrationHistory = Object.assign(
	async function selectMigrationHistory(client: Client): Promise<selectMigrationHistory.Result[]> {
		const query = { sql: SelectMigrationHistorySql, args: [], name: "select-migration-history" };
		return client.all<selectMigrationHistory.Result>(query);
	},
	{ sql: SelectMigrationHistorySql },
);

export namespace selectMigrationHistory {
	export type Result = {
		name: string;
		checksum: string;
		applied_at: string;
	};
}
