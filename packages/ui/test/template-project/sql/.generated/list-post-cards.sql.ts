import type {Client} from 'sqlfu';

const sql = `
select id, slug, title, published
from post_cards
order by id;
`.trim();
const query = { sql, args: [], name: "listPostCards" };

export const listPostCards = Object.assign(
	async function listPostCards(client: Client): Promise<listPostCards.Result[]> {
		return client.all<listPostCards.Result>(query);
	},
	{ sql, query },
);

export namespace listPostCards {
	export type Result = {
		id: number;
		slug: string;
		title: string;
		published: number;
	};
}
