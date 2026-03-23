CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE post_events (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE VIEW post_summaries AS
SELECT
  id,
  slug,
  title,
  published_at,
  substr(body, 1, 160) AS excerpt
FROM posts;

CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  body
);

CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO post_events (post_id, kind)
  VALUES (new.id, 'created');
END;

CREATE TRIGGER posts_publish_au AFTER UPDATE OF published_at ON posts
WHEN old.published_at IS NULL AND new.published_at IS NOT NULL BEGIN
  INSERT INTO post_events (post_id, kind)
  VALUES (new.id, 'published');
END;
