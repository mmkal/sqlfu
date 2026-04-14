create table a(id int primary key not null);

create table b(id int primary key not null);

create table ab(
  id int primary key not null,
  a_id int not null,
  b_id int not null
);
