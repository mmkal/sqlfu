import type {Client} from 'sqlfu';

const sql = `
select id, slug, title, published
from posts
where slug = ?
limit 1;
`.trim();
const query = (params: findPostBySlug.Params) => ({ sql, args: [params.slug], name: "findPostBySlug" });

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, params: findPostBySlug.Params): Promise<findPostBySlug.Result | null> {
		const rows = await client.all<findPostBySlug.Result>(query(params));
		return rows.length > 0 ? rows[0] : null;
	},
	{ sql, query },
);

export namespace findPostBySlug {
	export type Params = {
		slug: string;
	};
	export type Result = {
		id: number;
		slug: string;
		title: string;
		published: number;
	};
}
