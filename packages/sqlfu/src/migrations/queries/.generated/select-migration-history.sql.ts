import type {Client} from 'sqlfu';

const sql = `
select name, checksum, applied_at
from sqlfu_migrations
order by name;
`.trim();
const query = { sql, args: [], name: "select-migration-history" };

export const selectMigrationHistory = Object.assign(
	async function selectMigrationHistory(client: Client): Promise<selectMigrationHistory.Result[]> {
		return client.all<selectMigrationHistory.Result>(query);
	},
	{ sql, query },
);

export namespace selectMigrationHistory {
	export type Result = {
		name: string;
		checksum: string;
		applied_at: string;
	};
}
