-- default config: {"dialect":"sqlite"}

-- #region: select with asterisks
-- input:
SELECT tbl.*, count(*), col1 * col2 FROM tbl;
-- output:
select tbl.*, count(*), col1 * col2
from tbl;
-- #endregion

-- #region: complex select
-- input:
SELECT DISTINCT name, ROUND(age/7) field1, 18 + 20 AS field2, 'some string' FROM foo;
-- output:
select distinct
  name,
  round(age / 7) field1,
  18 + 20 as field2,
  'some string'
from foo;
-- #endregion

-- #region: complex where
-- input:
SELECT * FROM foo WHERE Column1 = 'testing'
AND ( (Column2 = Column3 OR Column4 >= ABS(5)) );
-- output:
select *
from foo
where
  column1 = 'testing'
  and (
    (
      column2 = column3
      or column4 >= abs(5)
    )
  );
-- #endregion

-- #region: top-level reserved words
-- input:
SELECT * FROM foo WHERE name = 'John' GROUP BY some_column
HAVING column > 10 ORDER BY other_column;
-- output:
select *
from foo
where name = 'John'
group by some_column
having column > 10
order by other_column;
-- #endregion

-- #region: keywords as column names in qualified references
-- input:
SELECT mytable.update, mytable.select FROM mytable WHERE mytable.from > 10;
-- output:
select mytable.update, mytable.select
from mytable
where mytable.from > 10;
-- #endregion

-- #region: order by
-- input:
SELECT * FROM foo ORDER BY col1 ASC, col2 DESC;
-- output:
select *
from foo
order by col1 asc, col2 desc;
-- #endregion

-- #region: subquery in from clause
-- input:
SELECT *, SUM(*) AS total FROM (SELECT * FROM Posts WHERE age > 10) WHERE a > b
-- output:
select *, sum(*) as total
from
  (
    select
      *
    from
      posts
    where
      age > 10
  )
where a > b
-- #endregion

-- #region: open paren after comma in values list
-- input:
INSERT INTO TestIds (id) VALUES (4),(5), (6),(7),(9),(10),(11);
-- output:
insert into
  testids (id)
values
  (4),
  (5),
  (6),
  (7),
  (9),
  (10),
  (11);
-- #endregion

-- #region: short nested parenthesized expression
-- input:
SELECT (a + b * (c - SIN(1)));
-- output:
select (a + b * (c - sin(1)));
-- #endregion

-- #region: multi-word reserved words with inconsistent spacing
-- input:
SELECT * FROM foo LEFT 	   
 JOIN mycol ORDER 
 BY blah
-- output:
select *
from foo left join mycol
order by blah
-- #endregion

-- #region: long double parenthesized query
-- input:
((foo = '0123456789-0123456789-0123456789-0123456789'))
-- output:
(
  (
    foo = '0123456789-0123456789-0123456789-0123456789'
  )
)
-- #endregion

-- #region: short double parenthesized query
-- input:
((foo = 'bar'))
-- output: <unchanged>
-- #endregion

-- #region: unicode letters in identifiers
-- input:
SELECT 结合使用, тест FROM töörõõm;
-- output:
select 结合使用, тест
from töörõõm;
-- #endregion

-- #region: unicode numbers in identifiers
-- input:
SELECT my၁၂၃ FROM tbl༡༢༣;
-- output:
select my၁၂၃
from tbl༡༢༣;
-- #endregion

-- #region: join keyword uppercasing
-- config: {"keywordCase":"upper"}
-- input:
select * from customers join foo on foo.id = customers.id;
-- output:
SELECT *
FROM customers JOIN foo ON foo.id = customers.id;
-- #endregion

-- #region: join using uppercasing
-- config: {"keywordCase":"upper"}
-- input:
select * from customers join foo using (id);
-- output:
SELECT *
FROM customers JOIN foo USING (id);
-- #endregion

-- #region: plain join
-- input:
SELECT * FROM customers
JOIN orders ON customers.customer_id = orders.customer_id
JOIN items ON items.id = orders.id;
-- output:
select *
from
  customers
  join orders on customers.customer_id = orders.customer_id
  join items on items.id = orders.id;
-- #endregion

-- #region: inner join
-- input:
SELECT * FROM customers
INNER JOIN orders ON customers.customer_id = orders.customer_id
INNER JOIN items ON items.id = orders.id;
-- output:
select *
from
  customers
  inner join orders on customers.customer_id = orders.customer_id
  inner join items on items.id = orders.id;
-- #endregion

-- #region: left join
-- input:
SELECT * FROM customers
LEFT JOIN orders ON customers.customer_id = orders.customer_id
LEFT JOIN items ON items.id = orders.id;
-- output:
select *
from
  customers
  left join orders on customers.customer_id = orders.customer_id
  left join items on items.id = orders.id;
-- #endregion

-- #region: right join
-- input:
SELECT * FROM customers
RIGHT JOIN orders ON customers.customer_id = orders.customer_id
RIGHT JOIN items ON items.id = orders.id;
-- output:
select *
from
  customers
  right join orders on customers.customer_id = orders.customer_id
  right join items on items.id = orders.id;
-- #endregion

-- #region: full join
-- input:
SELECT * FROM customers
FULL JOIN orders ON customers.customer_id = orders.customer_id
FULL JOIN items ON items.id = orders.id;
-- output:
select *
from
  customers
  full join orders on customers.customer_id = orders.customer_id
  full join items on items.id = orders.id;
-- #endregion

-- #region: natural left outer join
-- input:
SELECT * FROM customers
NATURAL LEFT OUTER JOIN orders ON customers.customer_id = orders.customer_id
NATURAL LEFT OUTER JOIN items ON items.id = orders.id;
-- output:
select *
from
  customers
  natural left outer join orders on customers.customer_id = orders.customer_id
  natural left outer join items on items.id = orders.id;
-- #endregion

-- #region: simple insert into
-- input:
INSERT INTO Customers (ID, MoneyBalance, Address, City) VALUES (12,-123.4, 'Skagen 2111','Stv');
-- output:
insert into
  customers (id, moneybalance, address, city)
values
  (12, -123.4, 'Skagen 2111', 'Stv');
-- #endregion

-- #region: simple update
-- input:
UPDATE Customers SET ContactName='Alfred Schmidt', City='Hamburg' WHERE CustomerName='Alfreds Futterkiste';
-- output:
update customers
set
  contactname = 'Alfred Schmidt',
  city = 'Hamburg'
where customername = 'Alfreds Futterkiste';
-- #endregion

-- #region: update from subquery
-- input:
UPDATE customers SET total_orders = order_summary.total  FROM ( SELECT * FROM bank) AS order_summary
-- output:
update customers
set
  total_orders = order_summary.total
from
  (
    select
      *
    from
      bank
  ) as order_summary
-- #endregion

-- #region: multiple ctes
-- input:
WITH
cte_1 AS (
  SELECT a FROM b WHERE c = 1
),
cte_2 AS (
  SELECT c FROM d WHERE e = 2
),
final AS (
  SELECT * FROM cte_1 LEFT JOIN cte_2 ON b = d
)
SELECT * FROM final;
-- output:
with
  cte_1 as (
    select
      a
    from
      b
    where
      c = 1
  ),
  cte_2 as (
    select
      c
    from
      d
    where
      e = 2
  ),
  final as (
    select
      *
    from
      cte_1
      left join cte_2 on b = d
  )
select *
from final;
-- #endregion
