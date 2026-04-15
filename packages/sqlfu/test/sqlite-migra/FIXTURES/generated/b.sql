create table demo(
  id integer primary key,
  the_column text,
  the_column2 text generated always as ('the original generated value') stored
);
