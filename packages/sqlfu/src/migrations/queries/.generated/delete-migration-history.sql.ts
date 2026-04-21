import type {Client} from 'sqlfu';

const sql = `delete from sqlfu_migrations;`

export const deleteMigrationHistory = Object.assign(
	async function deleteMigrationHistory(client: Client) {
		const query = { sql, args: [], name: "delete-migration-history" };
		return client.run(query);
	},
	{ sql },
);
