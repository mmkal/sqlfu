import type {Client} from 'sqlfu';

const sql = `
insert into
  sqlfu_migrations (name, checksum, applied_at)
values
  (?, ?, ?);
`.trim();
const query = (params: insertMigration.Params) => ({ sql, args: [params.name, params.checksum, params.applied_at], name: "insertMigration" });

export const insertMigration = Object.assign(
	async function insertMigration(client: Client, params: insertMigration.Params) {
		return client.run(query(params));
	},
	{ sql, query },
);

export namespace insertMigration {
	export type Params = {
		name: string;
		checksum: string;
		applied_at: string;
	};
}
