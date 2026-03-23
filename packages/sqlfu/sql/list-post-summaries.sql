SELECT
  id,
  slug,
  title,
  published_at,
  excerpt
FROM post_summaries
WHERE published_at IS NOT NULL
ORDER BY published_at DESC;
