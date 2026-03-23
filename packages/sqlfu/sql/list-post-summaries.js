export async function listPostSummaries(client) {
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
	
	`;
    return client.execute(sql)
        .then(res => res.rows)
        .then(rows => rows.map(row => mapArrayToListPostSummariesResult(row)));
}
function mapArrayToListPostSummariesResult(data) {
    const result = {
        id: data[0],
        slug: data[1],
        title: data[2],
        published_at: data[3],
        excerpt: data[4]
    };
    return result;
}
//# sourceMappingURL=list-post-summaries.js.map