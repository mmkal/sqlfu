import type {Client} from 'sqlfu';

const sql = `
insert into sqlfu_migrations(name, checksum, applied_at)
values (?, ?, ?);
`

export const insertMigration = Object.assign(
	async function insertMigration(client: Client, params: insertMigration.Params) {
		const query = { sql, args: [params.name, params.checksum, params.applied_at], name: "insert-migration" };
		return client.run(query);
	},
	{ sql },
);

export namespace insertMigration {
	export type Params = {
		name: string;
		checksum: string;
		applied_at: string;
	};
}
