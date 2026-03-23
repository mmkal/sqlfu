import type { Client, Transaction } from '@libsql/client';

export type ListPostSummariesResult = {
	id?: any;
	slug?: any;
	title?: any;
	published_at?: any;
	excerpt?: any;
}

export async function listPostSummaries(client: Client | Transaction): Promise<ListPostSummariesResult[]> {
	const sql = `
	SELECT
	  id,
	  slug,
	  title,
	  published_at,
	  excerpt
	FROM post_summaries
	WHERE published_at IS NOT NULL
	ORDER BY published_at DESC;
	
	`
	return client.execute(sql)
		.then(res => res.rows)
		.then(rows => rows.map(row => mapArrayToListPostSummariesResult(row)));
}

function mapArrayToListPostSummariesResult(data: any) {
	const result: ListPostSummariesResult = {
		id: data[0],
		slug: data[1],
		title: data[2],
		published_at: data[3],
		excerpt: data[4]
	}
	return result;
}