import type {Client} from 'sqlfu';

const sql = `
select name, checksum, applied_at
from sqlfu_migrations
order by name;
`

export const selectMigrationHistory = Object.assign(
	async function selectMigrationHistory(client: Client): Promise<selectMigrationHistory.Result[]> {
		const query = { sql, args: [], name: "select-migration-history" };
		return client.all<selectMigrationHistory.Result>(query);
	},
	{ sql },
);

export namespace selectMigrationHistory {
	export type Result = {
		name: string;
		checksum: string;
		applied_at: string;
	};
}
