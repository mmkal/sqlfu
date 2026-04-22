create table posts (
  id integer primary key,
  slug text not null unique,
  title text not null,
  body text not null,
  published_at text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create table post_events (
  id integer primary key,
  post_id integer not null,
  kind text not null,
  created_at text not null default current_timestamp,
  foreign key (post_id) references posts (id)
);

create view post_summaries as
select id, slug, title, published_at, substr(body, 1, 160) as excerpt
from posts;

create virtual table posts_fts using fts5 (title, body);

create trigger posts_ai after insert on posts begin
insert into
  post_events (post_id, kind)
values
  (new.id, 'created');

end;

create trigger posts_publish_au after
update of published_at on posts when old.published_at is null
and new.published_at is not null begin
insert into
  post_events (post_id, kind)
values
  (new.id, 'published');

end;
