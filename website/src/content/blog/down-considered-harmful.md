---
title: "The path to hell is paved with down migrations"
slug: "down-considered-harmful"
date: "2026-05-30"
description: "sqlfu does not have a `sqlfu down` command, or any concept of \"down\" migrations. This is because they're essentially a stressful lie."
heroImage: "/assets/blog/down-to-hell.png"
heroAlt: "A fiery path leading downward into a database migration rollback"
---

sqlfu does not have a `sqlfu down` command, or any concept of "down" migrations. This is because they're essentially a stressful lie.

More precisely: sqlfu rejects the pretence that every schema change has a useful inverse that can be generated now, ignored for months, and safely trusted during an outage.

Let's say your `definitions.sql` looks like this

```sql
create table person(
  id int,
  name text
);
```

You now need to add "title" to the person table, so you update `definitions.sql` to add it - with sqlfu, all schema changes will be derived from this. You can think of it as the equivalent to drizzle's schema.ts, but it's just plain SQL DDL:

```sql
create table person(
    id int,
    name text,
    title text
);
```

You run `sqlfu draft` and you get a new migration (say, `0002_add_title.sql`):

```sql
alter table person
add column title text;
```

So why don't we generate a `0002_add_title.down.sql` with something like `alter table person drop column title`?

> up=heaven

Well, because it's terrifying. Generating an "up" migration is a happy thing to do. Typically, you're adding to your schema, creating space for some future happy little data points. That's what you *want* to do, and you're very likely going to immediately pay attention to it, shape it lovingly, making changes if necessary, and then test it out on a local or staging environment, before sending off your happy little "up" migration into the world of production.

> down=hell

But a "down" migration is a different beast entirely. None of the above pleasant characteristics are true. `drop column title` is *destroying* data. Dropping a column is the *opposite* of what you want to do right now. So, you *won't* look at it, or shape it lovingly. And you almost certainly *won't* test it (which of course means for more complicated examples, you actually have no idea if it even works). So good luck to you if you're ever in the position where you want to run it to revert something in production.

So, what should you do instead when you realise you've made a terrible mistake, and altered your schema in a way that you regret?

> The truth will set you free.

Your migrations are a history book. They're not a record of everything you wish you'd ever done. They're a record of what *actually happened* to your database. They're facts. They're not opinions. (In sqlfu, your "opinion", or your record of what you wish your schema looked like, is a first-class concept: `definitions.sql`). This means if you create a migration, and you run it, it's a permanent part of your application's history. And if you regret it: just create another up migration which undoes its behaviour. The biographers writing about your paradigm-breaking ai-agent-harness-todo-app will see how it came into being. Warts and all.

> `goto` considered harmful. `down` is even worse.

And if you are really sure that you *don't* want to tell the truth about this database's recorded migration history, you can rewrite that record with `sqlfu goto`.

`goto` will generate a diff between your database's live schema, and the schema implied by a specific migration, and - after human confirmation - apply it directly to your database. It will also replace the migration history recorded in that database with the selected target. Your migration files and git history aren't touched.

We chose the name `goto` because this is a *very scary operation* and it will make any humans and LLMs immediately think of the phrase ["goto considered harmful"](https://homepages.cwi.nl/~storm/teaching/reader/Dijkstra68.pdf) so you *feel* like you're doing something scary when you are doing something scary. But it's less scary than a down migration, because you're not trusting a destructive SQL query that was generated for you months ago (and you probably didn't read it at the time).

So no, `sqlfu down` is not coming. If you made the wrong schema change, make the next schema change honestly. If you need to drag a database to a different point in history, use a command that says exactly how dangerous it is. But we're not going to help you generate a destructive file, which is ignored until production is on fire, and call it a rollback plan.
