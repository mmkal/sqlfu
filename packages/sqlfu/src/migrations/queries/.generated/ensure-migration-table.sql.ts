import type {Client} from 'sqlfu';

const sql = `
create table if not exists sqlfu_migrations (
  name text primary key check (name not like '%.sql'),
  checksum text not null,
  applied_at text not null
);
`.trim();
const query = { sql, args: [], name: "ensureMigrationTable" };

export const ensureMigrationTable = Object.assign(
	async function ensureMigrationTable(client: Client) {
		return client.run(query);
	},
	{ sql, query },
);
