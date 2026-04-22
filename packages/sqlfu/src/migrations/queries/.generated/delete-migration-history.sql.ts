import type {Client} from 'sqlfu';

const sql = `delete from sqlfu_migrations;`;
const query = { sql, args: [], name: "deleteMigrationHistory" };

export const deleteMigrationHistory = Object.assign(
	async function deleteMigrationHistory(client: Client) {
		return client.run(query);
	},
	{ sql, query },
);
