---
status: needs-grilling
size: small
---

you could in theory write `definitions.sql` like this:

```sql
create table posts(id int, slug text, title text, body text);

insert into posts(id, slug, title, body)
values (1, 'hello-world', 'Hello World', 'How is everybody doing');
```

but this would be nonsensical and would not be captured anywhere

We may already have all the pieces to catch this - we could try to pinpoint the statement which doesn't affect the schema, basically.

Also worth mentioning in docs that you might have insert statements in *migrations* which will get wiped out by `goto` - is this a design flaw?