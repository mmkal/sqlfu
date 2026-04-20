import type {Client} from 'sqlfu';

export const EnsureMigrationTableSql = `
create table if not exists sqlfu_migrations(
  name text primary key check(name not like '%.sql'),
  checksum text not null,
  applied_at text not null
);
`

export const ensureMigrationTable = Object.assign(
	async function ensureMigrationTable(client: Client): Promise<void> {
		const query = { sql: EnsureMigrationTableSql, args: [], name: "ensure-migration-table" };
		await client.run(query);
	},
	{ sql: EnsureMigrationTableSql },
);
