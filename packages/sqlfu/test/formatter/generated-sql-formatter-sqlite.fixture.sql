-- default config: {"dialect":"sqlite"}

-- #region: sql-formatter / test / behavesLikeDb2Formatter: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE t ALTER COLUMN foo SET DATA TYPE VARCHAR;
         ALTER TABLE t ALTER COLUMN foo SET NOT NULL;
-- output:
ALTER TABLE t ALTER COLUMN foo
SET
  DATA TYPE VARCHAR;

ALTER TABLE t ALTER COLUMN foo
SET
  NOT NULL;
-- #endregion

-- #region: sql-formatter / test / behavesLikeDb2Formatter: formats only minus-minus as a line comment
-- input:

      SELECT col FROM
      -- This is a comment
      MyTable;
    
-- output:
SELECT
  col
FROM
  -- This is a comment
  MyTable;
-- #endregion

-- #region: sql-formatter / test / behavesLikeDb2Formatter: supports @, #, $ characters anywhere inside identifiers
-- input:
SELECT @foo, #bar, $zap, fo@o, ba#2, za$3
-- error:
-- Error: Parse error: Unexpected "#bar, $zap" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeDb2Formatter: supports @, #, $ characters in named parameters
-- input:
SELECT :foo@bar, :foo#bar, :foo$bar, :@zip, :#zap, :$zop
-- error:
-- Error: Parse error: Unexpected "#bar, :foo" at line 1 column 22.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeDb2Formatter: supports strings with G, GX, BX, UX prefixes
-- input:
SELECT G'blah blah', GX'01AC', BX'0101', UX'CCF239' FROM foo
-- output:
SELECT
  G 'blah blah',
  GX '01AC',
  BX '0101',
  UX 'CCF239'
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / behavesLikeDb2Formatter: supports WITH isolation level modifiers for UPDATE statement
-- input:
UPDATE foo SET x = 10 WITH CS
-- output:
UPDATE foo
SET
  x = 10
WITH
  CS
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: allows $ character as part of identifiers
-- input:
SELECT $foo, some$$ident
-- error:
-- Error: Parse error: Unexpected "$$ident" at line 1 column 18.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: does not wrap CHARACTER SET to multiple lines
-- input:
ALTER TABLE t MODIFY col1 VARCHAR(50) CHARACTER SET greek
-- output:
ALTER TABLE t MODIFY col1 VARCHAR(50) CHARACTER
SET
  greek
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports @@ system variables
-- input:
SELECT @@GLOBAL.time, @@SYSTEM.date, @@hour FROM foo;
-- error:
-- Error: Parse error: Unexpected "@@GLOBAL.t" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports @`name` variables
-- input:
SELECT @`baz zaz` FROM tbl;
-- error:
-- Error: Parse error: Unexpected "@`baz zaz`" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports @variables
-- input:
SELECT @foo, @some_long.var$with$special.chars
-- output:
SELECT
  @foo,
  @some_long.var $with $special.chars
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports *.* syntax in GRANT statement
-- input:
GRANT ALL ON *.* TO user2;
-- error:
-- Error: Parse error at token: . at line 1 column 15
-- Unexpected PROPERTY_ACCESS_OPERATOR token: {"type":"PROPERTY_ACCESS_OPERATOR","raw":".","text":".","start":14}. Instead, I was expecting to see one of the following:
-- 
-- A ASTERISK token based on:
--     asterisk$subexpression$1 →  ● %ASTERISK
--     asterisk →  ● asterisk$subexpression$1
--     free_form_sql$subexpression$1 →  ● asterisk
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A DELIMITER token based on:
--     statement$subexpression$1 →  ● %DELIMITER
--     statement → expressions_or_clauses ● statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A EOF token based on:
--     statement$subexpression$1 →  ● %EOF
--     statement → expressions_or_clauses ● statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A LINE_COMMENT token based on:
--     comment →  ● %LINE_COMMENT
--     asteriskless_free_form_sql$subexpression$1 →  ● comment
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A BLOCK_COMMENT token based on:
--     comment →  ● %BLOCK_COMMENT
--     asteriskless_free_form_sql$subexpression$1 →  ● comment
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A DISABLE_COMMENT token based on:
--     comment →  ● %DISABLE_COMMENT
--     asteriskless_free_form_sql$subexpression$1 →  ● comment
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A LIMIT token based on:
--     limit_clause →  ● %LIMIT _ expression_chain_ limit_clause$ebnf$1
--     clause$subexpression$1 →  ● limit_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_SELECT token based on:
--     select_clause →  ● %RESERVED_SELECT select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_SELECT token based on:
--     select_clause →  ● %RESERVED_SELECT
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_CLAUSE token based on:
--     other_clause →  ● %RESERVED_CLAUSE other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_SET_OPERATION token based on:
--     set_operation →  ● %RESERVED_SET_OPERATION set_operation$ebnf$1
--     clause$subexpression$1 →  ● set_operation
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A AND token based on:
--     logic_operator$subexpression$1 →  ● %AND
--     logic_operator →  ● logic_operator$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● logic_operator
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A OR token based on:
--     logic_operator$subexpression$1 →  ● %OR
--     logic_operator →  ● logic_operator$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● logic_operator
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A XOR token based on:
--     logic_operator$subexpression$1 →  ● %XOR
--     logic_operator →  ● logic_operator$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● logic_operator
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A COMMA token based on:
--     comma$subexpression$1 →  ● %COMMA
--     comma →  ● comma$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● comma
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A WHEN token based on:
--     other_keyword$subexpression$1 →  ● %WHEN
--     other_keyword →  ● other_keyword$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● other_keyword
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A THEN token based on:
--     other_keyword$subexpression$1 →  ● %THEN
--     other_keyword →  ● other_keyword$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● other_keyword
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ELSE token based on:
--     other_keyword$subexpression$1 →  ● %ELSE
--     other_keyword →  ● other_keyword$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● other_keyword
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A END token based on:
--     other_keyword$subexpression$1 →  ● %END
--     other_keyword →  ● other_keyword$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● other_keyword
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A BETWEEN token based on:
--     between_predicate →  ● %BETWEEN _ andless_expression_chain _ %AND _ andless_expression
--     asteriskless_andless_expression$subexpression$1 →  ● between_predicate
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A CASE token based on:
--     case_expression →  ● %CASE _ case_expression$ebnf$1 case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_IDENTIFIER token based on:
--     array_subscript →  ● %ARRAY_IDENTIFIER _ square_brackets
--     atomic_expression$subexpression$1 →  ● array_subscript
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_KEYWORD token based on:
--     array_subscript →  ● %ARRAY_KEYWORD _ square_brackets
--     atomic_expression$subexpression$1 →  ● array_subscript
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_FUNCTION_NAME token based on:
--     function_call →  ● %RESERVED_FUNCTION_NAME _ parenthesis
--     atomic_expression$subexpression$1 →  ● function_call
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A "(" based on:
--     parenthesis →  ● "(" expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A "{" based on:
--     curly_braces →  ● "{" curly_braces$ebnf$1 "}"
--     atomic_expression$subexpression$1 →  ● curly_braces
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A "[" based on:
--     square_brackets →  ● "[" square_brackets$ebnf$1 "]"
--     atomic_expression$subexpression$1 →  ● square_brackets
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_PARAMETERIZED_DATA_TYPE token based on:
--     data_type →  ● %RESERVED_PARAMETERIZED_DATA_TYPE _ parenthesis
--     atomic_expression$subexpression$1 →  ● data_type
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A OPERATOR token based on:
--     operator$subexpression$1 →  ● %OPERATOR
--     operator →  ● operator$subexpression$1
--     atomic_expression$subexpression$1 →  ● operator
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     atomic_expression$subexpression$1 →  ● identifier
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %QUOTED_IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     atomic_expression$subexpression$1 →  ● identifier
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A VARIABLE token based on:
--     identifier$subexpression$1 →  ● %VARIABLE
--     identifier →  ● identifier$subexpression$1
--     atomic_expression$subexpression$1 →  ● identifier
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NAMED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NAMED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %QUOTED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NUMBERED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NUMBERED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A POSITIONAL_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %POSITIONAL_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A CUSTOM_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %CUSTOM_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NUMBER token based on:
--     literal$subexpression$1 →  ● %NUMBER
--     literal →  ● literal$subexpression$1
--     atomic_expression$subexpression$1 →  ● literal
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A STRING token based on:
--     literal$subexpression$1 →  ● %STRING
--     literal →  ● literal$subexpression$1
--     atomic_expression$subexpression$1 →  ● literal
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_DATA_TYPE token based on:
--     data_type$subexpression$1 →  ● %RESERVED_DATA_TYPE
--     data_type →  ● data_type$subexpression$1
--     atomic_expression$subexpression$1 →  ● data_type
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_DATA_TYPE_PHRASE token based on:
--     data_type$subexpression$1 →  ● %RESERVED_DATA_TYPE_PHRASE
--     data_type →  ● data_type$subexpression$1
--     atomic_expression$subexpression$1 →  ● data_type
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_KEYWORD token based on:
--     keyword$subexpression$1 →  ● %RESERVED_KEYWORD
--     keyword →  ● keyword$subexpression$1
--     atomic_expression$subexpression$1 →  ● keyword
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_KEYWORD_PHRASE token based on:
--     keyword$subexpression$1 →  ● %RESERVED_KEYWORD_PHRASE
--     keyword →  ● keyword$subexpression$1
--     atomic_expression$subexpression$1 →  ● keyword
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_JOIN token based on:
--     keyword$subexpression$1 →  ● %RESERVED_JOIN
--     keyword →  ● keyword$subexpression$1
--     atomic_expression$subexpression$1 →  ● keyword
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports identifiers that start with numbers
-- input:
SELECT 4four, 12345e, 12e45, $567 FROM tbl
-- error:
-- Error: Parse error: Unexpected "4four, 123" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports INSERT ... ON DUPLICATE KEY UPDATE
-- input:
INSERT INTO customer VALUES ('John','Doe') ON DUPLICATE KEY UPDATE fname='Untitled';
-- output:
INSERT INTO
  customer
VALUES
  ('John', 'Doe') ON DUPLICATE KEY
UPDATE fname = 'Untitled';
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports INSERT ... ON DUPLICATE KEY UPDATE + VALUES() function
-- input:
INSERT INTO customer VALUES ('John','Doe') ON DUPLICATE KEY UPDATE col=VALUES(col2);
-- output:
INSERT INTO
  customer
VALUES
  ('John', 'Doe') ON DUPLICATE KEY
UPDATE col =
VALUES
  (col2);
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports REPLACE INTO syntax
-- input:
REPLACE INTO tbl VALUES (1,'Leopard'),(2,'Dog');
-- output:
REPLACE INTO
  tbl
VALUES
  (1, 'Leopard'),
  (2, 'Dog');
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports setting variables: @`var` :=
-- input:
SET @`foo` := (SELECT * FROM tbl);
-- error:
-- Error: Parse error: Unexpected "@`foo` := " at line 1 column 5.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports setting variables: @var :=
-- input:
SET @foo := 10;
-- error:
-- Error: Parse error: Unexpected ":= 10;" at line 1 column 10.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: supports unicode identifiers that start with numbers
-- input:
SELECT 1ä FROM tbl
-- error:
-- Error: Parse error: Unexpected "1ä FROM tb" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikeMariaDbFormatter: uppercases only reserved keywords
-- config: {"keywordCase":"upper","dataTypeCase":"upper"}
-- input:
create table account (id int comment 'the most important column');
        select * from mysql.user;
        insert into user (id, name) values (1, 'Blah');
-- output:
CREATE TABLE account (id INT comment 'the most important column');

SELECT
  *
FROM
  mysql.user;

INSERT INTO
  user (id, name)
VALUES
  (1, 'Blah');
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: allows $ character as part of identifiers
-- input:
SELECT foo$, some$$ident
-- error:
-- Error: Parse error: Unexpected "$, some$$i" at line 1 column 11.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: allows TYPE to be used as an identifier
-- input:
SELECT type, modified_at FROM items;
-- output:
SELECT
  type,
  modified_at
FROM
  items;
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: does not recognize common fields names as keywords
-- config: {"keywordCase":"upper"}
-- input:
SELECT id, type, name, location, label, password FROM release;
-- output:
SELECT
  id,
  type,
  name,
  location,
  label,
  password
FROM
  RELEASE;
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE t ALTER COLUMN foo SET DATA TYPE VARCHAR;
         ALTER TABLE t ALTER COLUMN foo SET DEFAULT 5;
         ALTER TABLE t ALTER COLUMN foo DROP DEFAULT;
         ALTER TABLE t ALTER COLUMN foo SET NOT NULL;
         ALTER TABLE t ALTER COLUMN foo DROP NOT NULL;
-- output:
ALTER TABLE t ALTER COLUMN foo
SET
  DATA TYPE VARCHAR;

ALTER TABLE t ALTER COLUMN foo
SET
  DEFAULT 5;

ALTER TABLE t ALTER COLUMN foo
DROP DEFAULT;

ALTER TABLE t ALTER COLUMN foo
SET
  NOT NULL;

ALTER TABLE t ALTER COLUMN foo
DROP NOT NULL;
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: formats DEFAULT VALUES clause
-- config: {"keywordCase":"upper"}
-- input:
INSERT INTO items default values RETURNING id;
-- output:
INSERT INTO
  items DEFAULT
VALUES
RETURNING
  id;
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: formats SELECT DISTINCT ON () syntax
-- input:
SELECT DISTINCT ON (c1, c2) c1, c2 FROM tbl;
-- output:
SELECT DISTINCT
  ON (c1, c2) c1,
  c2
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: formats TIMESTAMP WITH TIMEZONE as data type
-- config: {"dataTypeCase":"upper"}
-- input:
create table time_table (id int primary key, created_at timestamp with time zone);
-- output:
create table time_table (
  id INT primary key,
  created_at timestamp
  with
    time zone
);
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: formats type-cast operator without spaces
-- input:
SELECT 2 :: numeric AS foo;
-- error:
-- Error: Parse error: Unexpected ":: numeric" at line 1 column 10.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: treats TEXT as data-type (not as plain keyword)
-- config: {"dataTypeCase":"upper"}
-- input:
CREATE TABLE foo (items text);
-- output:
CREATE TABLE foo (items TEXT);
-- #endregion

-- #region: sql-formatter / test / behavesLikePostgresqlFormatter: treats TEXT as data-type (not as plain keyword)
-- config: {"keywordCase":"upper"}
-- input:
CREATE TABLE foo (text VARCHAR(100));
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: allows keywords as column names in tbl.col syntax
-- input:
SELECT mytable.update, mytable.select FROM mytable WHERE mytable.from > 10;
-- output:
SELECT
  mytable.update,
  mytable.select
FROM
  mytable
WHERE
  mytable.from > 10;
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: breaks long parenthesized lists to multiple lines
-- input:

      INSERT INTO some_table (id_product, id_shop, id_currency, id_country, id_registration) (
      SELECT COALESCE(dq.id_discounter_shopping = 2, dq.value, dq.value / 100),
      COALESCE (dq.id_discounter_shopping = 2, 'amount', 'percentage') FROM foo);
    
-- output:
INSERT INTO
  some_table (
    id_product,
    id_shop,
    id_currency,
    id_country,
    id_registration
  ) (
    SELECT
      COALESCE(
        dq.id_discounter_shopping = 2,
        dq.value,
        dq.value / 100
      ),
      COALESCE(
        dq.id_discounter_shopping = 2,
        'amount',
        'percentage'
      )
    FROM
      foo
  );
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats complex SELECT
-- input:
SELECT DISTINCT name, ROUND(age/7) field1, 18 + 20 AS field2, 'some string' FROM foo;
-- output:
SELECT DISTINCT
  name,
  ROUND(age / 7) field1,
  18 + 20 AS field2,
  'some string'
FROM
  foo;
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats long double parenthized queries to multiple lines
-- input:
((foo = '0123456789-0123456789-0123456789-0123456789'))
-- output:
(
  (
    foo = '0123456789-0123456789-0123456789-0123456789'
  )
)
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats open paren after comma
-- input:
INSERT INTO TestIds (id) VALUES (4),(5), (6),(7),(9),(10),(11);
-- output:
INSERT INTO
  TestIds (id)
VALUES
  (4),
  (5),
  (6),
  (7),
  (9),
  (10),
  (11);
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats ORDER BY
-- input:

      SELECT * FROM foo ORDER BY col1 ASC, col2 DESC;
    
-- output:
SELECT
  *
FROM
  foo
ORDER BY
  col1 ASC,
  col2 DESC;
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats SELECT query with SELECT query inside it
-- input:
SELECT *, SUM(*) AS total FROM (SELECT * FROM Posts WHERE age > 10) WHERE a > b
-- output:
SELECT
  *,
  SUM(*) AS total
FROM
  (
    SELECT
      *
    FROM
      Posts
    WHERE
      age > 10
  )
WHERE
  a > b
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats SELECT with asterisks
-- input:
SELECT tbl.*, count(*), col1 * col2 FROM tbl;
-- output:
SELECT
  tbl.*,
  count(*),
  col1 * col2
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats SELECT with complex WHERE
-- input:

      SELECT * FROM foo WHERE Column1 = 'testing'
      AND ( (Column2 = Column3 OR Column4 >= ABS(5)) );
    
-- output:
SELECT
  *
FROM
  foo
WHERE
  Column1 = 'testing'
  AND (
    (
      Column2 = Column3
      OR Column4 >= ABS(5)
    )
  );
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats SELECT with top level reserved words
-- input:

      SELECT * FROM foo WHERE name = 'John' GROUP BY some_column
      HAVING column > 10 ORDER BY other_column;
    
-- output:
SELECT
  *
FROM
  foo
WHERE
  name = 'John'
GROUP BY
  some_column
HAVING
  column > 10
ORDER BY
  other_column;
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats short double parenthized queries to one line
-- input:
((foo = 'bar'))
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: formats top-level and newline multi-word reserved words with inconsistent spacing
-- input:
SELECT * FROM foo LEFT 	   
 JOIN mycol ORDER 
 BY blah
-- output:
SELECT
  *
FROM
  foo
  LEFT JOIN mycol
ORDER BY
  blah
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: keeps short parenthesized list with nested parenthesis on single line
-- input:
SELECT (a + b * (c - SIN(1)));
-- output:
SELECT
  (a + b * (c - SIN(1)));
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: supports unicode letters in identifiers
-- input:
SELECT 结合使用, тест FROM töörõõm;
-- output:
SELECT
  结合使用,
  тест
FROM
  töörõõm;
-- #endregion

-- #region: sql-formatter / test / behavesLikeSqlFormatter: supports unicode numbers in identifiers
-- input:
SELECT my၁၂၃ FROM tbl༡༢༣;
-- output:
SELECT
  my၁၂၃
FROM
  tbl༡༢༣;
-- #endregion

-- #region: sql-formatter / test / bigquery.test: does not support lowercasing of STRUCT
-- config: {"keywordCase":"lower"}
-- input:
SELECT STRUCT<Nr INT64, myName STRING>(1,"foo");
-- output:
select
  STRUCT < Nr INT64,
  myName STRING > (1, "foo");
-- #endregion

-- #region: sql-formatter / test / bigquery.test: PIVOT operator
-- input:
SELECT * FROM Produce PIVOT(sales FOR quarter IN (Q1, Q2, Q3, Q4));
-- output:
SELECT
  *
FROM
  Produce PIVOT (sales FOR quarter IN (Q1, Q2, Q3, Q4));
-- #endregion

-- #region: sql-formatter / test / bigquery.test: STRUCT and ARRAY type case is affected by dataTypeCase option
-- config: {"dataTypeCase":"upper"}
-- input:
SELECT array<struct<y int64, z string>>[(1, "foo")]
-- output:
SELECT
  ARRAY < struct < y int64,
  z string >> [(1, "foo")]
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports @@variables
-- input:
SELECT @@error.message, @@time_zone
-- error:
-- Error: Parse error: Unexpected "@@error.me" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports array subscript operator
-- input:

      SELECT item_array[OFFSET(1)] AS item_offset,
      item_array[ORDINAL(1)] AS item_ordinal,
      item_array[SAFE_OFFSET(6)] AS item_safe_offset,
      item_array[SAFE_ORDINAL(6)] AS item_safe_ordinal
      FROM Items;
    
-- output:
SELECT
  item_array [OFFSET(1)] AS item_offset,
  item_array [ORDINAL(1)] AS item_ordinal,
  item_array [SAFE_OFFSET(6)] AS item_safe_offset,
  item_array [SAFE_ORDINAL(6)] AS item_safe_ordinal
FROM
  Items;
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports dashes inside identifiers
-- input:
SELECT alpha-foo, where-long-identifier
FROM beta
-- output:
SELECT
  alpha - foo,
where
  - long - identifier
FROM
  beta
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports named arguments
-- input:

      SELECT MAKE_INTERVAL(1, day=>2, minute => 3)
      
-- output:
SELECT
  MAKE_INTERVAL (1, day = > 2, minute = > 3)
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports parametric ARRAY
-- input:
SELECT ARRAY<FLOAT>[1]
-- output:
SELECT
  ARRAY < FLOAT > [1]
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports parametric STRUCT
-- input:
SELECT STRUCT<ARRAY<INT64>>([])
-- output:
SELECT
  STRUCT < ARRAY < INT64 >> ([])
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports parametric STRUCT with named fields
-- input:
SELECT STRUCT<y INT64, z STRING>(1,"foo"), STRUCT<arr ARRAY<INT64>>([1,2,3]);
-- output:
SELECT
  STRUCT < y INT64,
  z STRING > (1, "foo"),
  STRUCT < arr ARRAY < INT64 >> ([1,2,3]);
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports QUALIFY clause
-- input:

        SELECT
          item,
          RANK() OVER (PARTITION BY category ORDER BY purchases DESC) AS rank
        FROM Produce
        WHERE Produce.category = 'vegetable'
        QUALIFY rank <= 3
      
-- output:
SELECT
  item,
  RANK() OVER (
    PARTITION BY
      category
    ORDER BY
      purchases DESC
  ) AS rank
FROM
  Produce
WHERE
  Produce.category = 'vegetable' QUALIFY rank <= 3
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports strings with r, b and rb prefixes with triple-quoted strings
-- input:
SELECT R'''blah''', B'''sah''', rb"""hu"h""", br'''bulu bulu''', r"""haha""", BR'''la' la''' FROM foo
-- error:
-- Error: Parse error: Unexpected "", BR'''la" at line 1 column 76.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports strings with rb prefixes
-- input:
SELECT rb"huh", br'bulu bulu', BR'la la' FROM foo
-- output:
SELECT
  rb "huh",
  br 'bulu bulu',
  BR 'la la'
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports STRUCT types
-- input:
SELECT STRUCT("Alpha" as name, [23.4, 26.3, 26.4] as splits) FROM beta
-- output:
SELECT
  STRUCT ("Alpha" as name, [23.4, 26.3, 26.4] as splits)
FROM
  beta
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports trailing comma in SELECT clause
-- input:
SELECT foo, bar, FROM tbl;
-- output:
SELECT
  foo,
  bar,
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports triple-quoted strings
-- input:
SELECT '''hello 'my' world''', """hello "my" world""", """\"quoted\"""" FROM foo
-- error:
-- Error: Parse error: Unexpected "\"""" FROM" at line 1 column 67.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / bigquery.test: supports uppercasing of STRUCT
-- config: {"keywordCase":"upper"}
-- input:
select struct<Nr int64, myName string>(1,"foo");
-- output:
SELECT
  struct < Nr int64,
  myName string > (1, "foo");
-- #endregion

-- #region: sql-formatter / test / bigquery.test: TABLESAMPLE SYSTEM operator
-- input:
SELECT * FROM dataset.my_table TABLESAMPLE SYSTEM (10 PERCENT);
-- output:
SELECT
  *
FROM
  dataset.my_table TABLESAMPLE SYSTEM (10 PERCENT);
-- #endregion

-- #region: sql-formatter / test / bigquery.test: UNNEST operator
-- input:
SELECT * FROM UNNEST ([1, 2, 3]);
-- output:
SELECT
  *
FROM
  UNNEST ([1, 2, 3]);
-- #endregion

-- #region: sql-formatter / test / bigquery.test: UNPIVOT operator
-- input:
SELECT * FROM Produce UNPIVOT(sales FOR quarter IN (Q1, Q2, Q3, Q4));
-- output:
SELECT
  *
FROM
  Produce UNPIVOT (sales FOR quarter IN (Q1, Q2, Q3, Q4));
-- #endregion

-- #region: sql-formatter / test / clickhouse.test format case
-- input:

        CREATE TABLE table1(x Int32) ENGINE = MergeTree ORDER BY tuple()
        PARALLEL WITH
        CREATE TABLE table2(y String) ENGINE = MergeTree ORDER BY tuple();
      
-- output:
CREATE TABLE table1 (x Int32) ENGINE = MergeTree
ORDER BY
  tuple () PARALLEL
WITH
CREATE TABLE table2 (y String) ENGINE = MergeTree
ORDER BY
  tuple ();
-- #endregion

-- #region: sql-formatter / test / clickhouse.test format case
-- input:
DESC TABLE table1;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test format case
-- input:
DESCRIBE TABLE table1;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER QUOTA IF EXISTS qA FOR INTERVAL 15 month MAX queries = 123 TO CURRENT_USER;
-- input:
ALTER QUOTA IF EXISTS qA FOR INTERVAL 15 month MAX queries = 123 TO CURRENT_USER;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER QUOTA IF EXISTS qB FOR INTERVAL 30 minute MAX execution_time = 0.5, FOR INTERVAL 5 quarter MAX queries = 321, errors = 10 TO d
-- input:
ALTER QUOTA IF EXISTS qB RENAME TO qC NOT KEYED FOR INTERVAL 30 minute MAX execution_time = 0.5 FOR INTERVAL 5 quarter MAX queries = 321, errors = 10 TO default;
-- output:
ALTER QUOTA IF EXISTS qB
RENAME TO qC NOT KEYED FOR INTERVAL 30 minute MAX execution_time = 0.5 FOR INTERVAL 5 quarter MAX queries = 321,
errors = 10 TO default;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER ROW POLICY
-- input:
ALTER ROW POLICY IF EXISTS policy1 ON CLUSTER cluster_name1 ON database1.table1 RENAME TO new_name1;
-- output:
ALTER ROW POLICY IF EXISTS policy1 ON CLUSTER cluster_name1 ON database1.table1
RENAME TO new_name1;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER ROW POLICY with multiple policies
-- input:
ALTER ROW POLICY IF EXISTS policy1 ON CLUSTER cluster_name1 ON database1.table1 RENAME TO new_name1, policy2 ON CLUSTER cluster_name2 ON database2.table2 RENAME TO new_name2;
-- output:
ALTER ROW POLICY IF EXISTS policy1 ON CLUSTER cluster_name1 ON database1.table1
RENAME TO new_name1,
policy2 ON CLUSTER cluster_name2 ON database2.table2
RENAME TO new_name2;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE ... RENAME COLUMN statement
-- input:
ALTER TABLE supplier RENAME COLUMN supplier_id TO id;
-- output:
ALTER TABLE supplier
RENAME COLUMN supplier_id TO id;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE ADD CONSTRAINT
-- input:
ALTER TABLE t1 ADD CONSTRAINT IF NOT EXISTS c1 CHECK (a > 0);
-- output:
ALTER TABLE t1
ADD CONSTRAINT IF NOT EXISTS c1 CHECK (a > 0);
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE ADD INDEX
-- input:
ALTER TABLE db.table_name ADD INDEX my_index column1 TYPE minmax GRANULARITY 1 FIRST;
-- output:
ALTER TABLE db.table_name
ADD INDEX my_index column1 TYPE minmax GRANULARITY 1 FIRST;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE ADD INDEX
-- input:
ALTER TABLE db.table_name ON CLUSTER 'my_cluster' ADD INDEX IF NOT EXISTS my_index (column1 + column2) TYPE set(100) GRANULARITY 2 AFTER another_column;
-- output:
ALTER TABLE db.table_name ON CLUSTER 'my_cluster'
ADD INDEX IF NOT EXISTS my_index (column1 + column2) TYPE
set
  (100) GRANULARITY 2 AFTER another_column;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE ADD PROJECTION
-- input:
ALTER TABLE visits_order ADD PROJECTION user_name_projection (SELECT * ORDER BY user_name);
-- output:
ALTER TABLE visits_order
ADD PROJECTION user_name_projection (
  SELECT
    *
  ORDER BY
    user_name
);
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE ADD STATISTICS
-- input:
ALTER TABLE t1 ADD STATISTICS (c, d) TYPE TDigest, Uniq;
-- output:
ALTER TABLE t1
ADD STATISTICS (c, d) TYPE TDigest,
Uniq;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE APPLY DELETED MASK with ON CLUSTER and IN PARTITION
-- input:
ALTER TABLE visits ON CLUSTER prod APPLY DELETED MASK IN PARTITION '2025-01-01';
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE CLEAR INDEX
-- input:
ALTER TABLE db.table_name ON CLUSTER 'my_cluster' CLEAR INDEX IF EXISTS my_index IN PARTITION '202301';
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DELETE WHERE
-- input:
ALTER TABLE db.events ON CLUSTER prod DELETE WHERE timestamp < now() - INTERVAL 30 DAY;
-- output:
ALTER TABLE db.events ON CLUSTER prod DELETE
WHERE
  timestamp < now () - INTERVAL 30 DAY;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DROP COLUMN
-- input:
ALTER TABLE visits DROP COLUMN browser;
-- output:
ALTER TABLE visits
DROP COLUMN browser;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DROP CONSTRAINT
-- input:
ALTER TABLE t1 DROP CONSTRAINT IF EXISTS c1;
-- output:
ALTER TABLE t1
DROP CONSTRAINT IF EXISTS c1;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DROP DETACHED PARTITION
-- input:
ALTER TABLE mt DROP DETACHED PARTITION '2020-01-01';
-- output:
ALTER TABLE mt
DROP DETACHED PARTITION '2020-01-01';
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DROP DETACHED PARTITION ALL
-- input:
ALTER TABLE mt DROP DETACHED PARTITION ALL;
-- output:
ALTER TABLE mt
DROP DETACHED PARTITION ALL;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DROP INDEX
-- input:
ALTER TABLE db.table_name ON CLUSTER 'my_cluster' DROP INDEX IF EXISTS my_index;
-- output:
ALTER TABLE db.table_name ON CLUSTER 'my_cluster'
DROP INDEX IF EXISTS my_index;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DROP PART
-- input:
ALTER TABLE mt DROP PART 'all_4_4_0';
-- output:
ALTER TABLE mt
DROP PART 'all_4_4_0';
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE DROP PARTITION
-- input:
ALTER TABLE posts DROP PARTITION '2008';
-- output:
ALTER TABLE posts
DROP PARTITION '2008';
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MATERIALIZE INDEX
-- input:
ALTER TABLE db.table_name ON CLUSTER 'my_cluster' MATERIALIZE INDEX IF EXISTS my_index IN PARTITION '202301';
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MODIFY ORDER BY
-- input:
ALTER TABLE db.events ON CLUSTER prod MODIFY ORDER BY (user_id, timestamp);
-- output:
ALTER TABLE db.events ON CLUSTER prod MODIFY
ORDER BY
  (user_id, timestamp);
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MODIFY QUERY
-- input:
ALTER TABLE mv MODIFY QUERY SELECT a * 2 as a FROM src_table;
-- output:
ALTER TABLE mv MODIFY QUERY
SELECT
  a * 2 as a
FROM
  src_table;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MODIFY QUERY with GROUP BY
-- input:
ALTER TABLE mv MODIFY QUERY SELECT toStartOfDay(ts) ts, event_type, browser, count() events_cnt, sum(cost) cost FROM events GROUP BY ts, event_type, browser;
-- output:
ALTER TABLE mv MODIFY QUERY
SELECT
  toStartOfDay (ts) ts,
  event_type,
  browser,
  count() events_cnt,
  sum(cost) cost
FROM
  events
GROUP BY
  ts,
  event_type,
  browser;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MODIFY SAMPLE BY
-- input:
ALTER TABLE db.events ON CLUSTER prod MODIFY SAMPLE BY user_id;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MODIFY SETTING
-- input:
ALTER TABLE example_table MODIFY SETTING max_part_loading_threads=8, max_parts_in_total=50000;
-- output:
ALTER TABLE example_table MODIFY SETTING max_part_loading_threads = 8,
max_parts_in_total = 50000;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MODIFY STATISTICS
-- input:
ALTER TABLE t1 MODIFY STATISTICS c, d TYPE TDigest, Uniq;
-- output:
ALTER TABLE t1 MODIFY STATISTICS c,
d TYPE TDigest,
Uniq;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE MODIFY TTL
-- input:
ALTER TABLE t1 MODIFY TTL 1 year;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE REMOVE SAMPLE BY
-- input:
ALTER TABLE db.events ON CLUSTER prod REMOVE SAMPLE BY;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE REMOVE TTL
-- input:
ALTER TABLE t1 REMOVE TTL;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER TABLE RESET SETTING
-- input:
ALTER TABLE example_table RESET SETTING max_part_loading_threads;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ALTER USER IF EXISTS user1 RENAME TO user1_new, user2 RENAME TO user2_new DROP ALL SETTINGS
-- input:
ALTER USER IF EXISTS user1 RENAME TO user1_new, user2 RENAME TO user2_new DROP ALL SETTINGS;
-- output:
ALTER USER IF EXISTS user1
RENAME TO user1_new,
user2
RENAME TO user2_new
DROP ALL SETTINGS;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats ATTACH DATABASE with ON CLUSTER and SYNC
-- input:
ATTACH DATABASE IF NOT EXISTS test_db ON CLUSTER prod;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CHECK GRANT with column list
-- input:
CHECK GRANT SELECT(id, name) ON db.table
-- output:
CHECK GRANT
SELECT
  (id, name) ON db.table
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CHECK GRANT with multiple privileges
-- input:
CHECK GRANT SELECT, INSERT ON db.table
-- output:
CHECK GRANT
SELECT
,
  INSERT ON db.table
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CHECK GRANT with simple privilege
-- input:
CHECK GRANT SELECT ON db.table
-- output:
CHECK GRANT
SELECT
  ON db.table
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CHECK TABLE with PART
-- input:
CHECK TABLE t0 PART '201003_111_222_0'
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CHECK TABLE with PARTITION, FORMAT, and SETTINGS
-- input:
CHECK TABLE t0 PARTITION ID '201003' FORMAT PrettyCompactMonoBlock SETTINGS check_query_single_value_result = 0
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats complex refreshable materialized view with multiple clauses
-- input:
CREATE MATERIALIZED VIEW IF NOT EXISTS mv6 ON CLUSTER prod REFRESH EVERY 1 HOUR RANDOMIZE FOR 30 MINUTE DEPENDS ON table1 APPEND SETTINGS max_threads = 4 AS SELECT date, count() as cnt FROM events GROUP BY date COMMENT 'Hourly aggregation';
-- output:
CREATE MATERIALIZED VIEW IF NOT EXISTS mv6 ON CLUSTER prod REFRESH EVERY 1 HOUR RANDOMIZE FOR 30 MINUTE DEPENDS ON table1 APPEND SETTINGS max_threads = 4 AS
SELECT
  date,
  count() as cnt
FROM
  events
GROUP BY
  date COMMENT 'Hourly aggregation';
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE FUNCTION with extra syntax
-- input:
CREATE FUNCTION linear_equation AS (x, k, b) -> k*x + b;
-- output:
CREATE FUNCTION linear_equation AS (x, k, b) -> k * x + b;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE FUNCTION with simple function
-- input:
CREATE FUNCTION my_function AS (x) -> x + 1;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE MATERIALIZED VIEW with APPEND TO
-- input:
CREATE MATERIALIZED VIEW mv5 REFRESH EVERY 1 HOUR APPEND TO target_table AS SELECT * FROM source;
-- output:
CREATE MATERIALIZED VIEW mv5 REFRESH EVERY 1 HOUR APPEND TO target_table AS
SELECT
  *
FROM
  source;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE MATERIALIZED VIEW with DEPENDS ON
-- input:
CREATE MATERIALIZED VIEW mv4 REFRESH EVERY 1 HOUR DEPENDS ON table1, table2 AS SELECT * FROM combined;
-- output:
CREATE MATERIALIZED VIEW mv4 REFRESH EVERY 1 HOUR DEPENDS ON table1,
table2 AS
SELECT
  *
FROM
  combined;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE MATERIALIZED VIEW with RANDOMIZE FOR
-- input:
CREATE MATERIALIZED VIEW mv3 REFRESH EVERY 1 DAY RANDOMIZE FOR 2 HOUR AS SELECT * FROM logs;
-- output:
CREATE MATERIALIZED VIEW mv3 REFRESH EVERY 1 DAY RANDOMIZE FOR 2 HOUR AS
SELECT
  *
FROM
  logs;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE MATERIALIZED VIEW with REFRESH AFTER and OFFSET
-- input:
CREATE MATERIALIZED VIEW mv2 REFRESH AFTER 30 MINUTE OFFSET 5 MINUTE AS SELECT count() FROM events;
-- output:
CREATE MATERIALIZED VIEW mv2 REFRESH AFTER 30 MINUTE
OFFSET
  5 MINUTE AS
SELECT
  count()
FROM
  events;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE MATERIALIZED VIEW with REFRESH EVERY
-- input:
CREATE MATERIALIZED VIEW mv1 REFRESH EVERY 1 HOUR AS SELECT * FROM source_table;
-- output:
CREATE MATERIALIZED VIEW mv1 REFRESH EVERY 1 HOUR AS
SELECT
  *
FROM
  source_table;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats CREATE TABLE with PROJECTION
-- input:
CREATE TABLE visits (user_id UInt64, user_name String, pages_visited Nullable(Float64), user_agent String, PROJECTION projection_visits_by_user (SELECT user_agent, sum(pages_visited) GROUP BY user_id, user_agent)) ENGINE = MergeTree() ORDER BY user_agent;
-- output:
CREATE TABLE visits (
  user_id UInt64,
  user_name String,
  pages_visited Nullable (Float64),
  user_agent String,
  PROJECTION projection_visits_by_user (
    SELECT
      user_agent,
      sum(pages_visited)
    GROUP BY
      user_id,
      user_agent
  )
) ENGINE = MergeTree ()
ORDER BY
  user_agent;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DELETE FROM with ON CLUSTER and IN PARTITION
-- input:
DELETE FROM db.table ON CLUSTER foo IN PARTITION '2025-01-01' WHERE x = 1;
-- output:
DELETE FROM db.table ON CLUSTER foo IN PARTITION '2025-01-01'
WHERE
  x = 1;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DETACH DATABASE with ON CLUSTER and SYNC
-- input:
DETACH DATABASE test_db ON CLUSTER prod PERMANENTLY SYNC;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP DATABASE
-- input:
DROP DATABASE db;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP DATABASE IF EXISTS with ON CLUSTER and SYNC
-- input:
DROP DATABASE IF EXISTS db ON CLUSTER my_cluster SYNC;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP DICTIONARY with various options
-- input:
DROP DICTIONARY IF EXISTS mydb.my_dict SYNC;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP FUNCTION
-- input:
DROP FUNCTION IF EXISTS my_function ON CLUSTER my_cluster;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP multiple tables
-- input:
DROP TABLE mydb.tab1, mydb.tab2;
-- output:
DROP TABLE mydb.tab1,
mydb.tab2;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP NAMED COLLECTION
-- input:
DROP NAMED COLLECTION IF EXISTS my_collection ON CLUSTER my_cluster;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP POLICY short form
-- input:
DROP POLICY IF EXISTS policy1, policy2 ON db1.table1;
-- output:
DROP POLICY IF EXISTS policy1,
policy2 ON db1.table1;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP PROFILE short form
-- input:
DROP PROFILE IF EXISTS profile1;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP QUOTA
-- input:
DROP QUOTA IF EXISTS quota1, quota2 ON CLUSTER my_cluster;
-- output:
DROP QUOTA IF EXISTS quota1,
quota2 ON CLUSTER my_cluster;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP ROLE
-- input:
DROP ROLE IF EXISTS role1, role2 ON CLUSTER my_cluster;
-- output:
DROP ROLE IF EXISTS role1,
role2 ON CLUSTER my_cluster;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP ROW POLICY
-- input:
DROP ROW POLICY IF EXISTS policy1, policy2 ON db1.table1;
-- output:
DROP ROW POLICY IF EXISTS policy1,
policy2 ON db1.table1;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP SETTINGS PROFILE
-- input:
DROP SETTINGS PROFILE IF EXISTS profile1, profile2 ON CLUSTER my_cluster;
-- output:
DROP SETTINGS PROFILE IF EXISTS profile1,
profile2 ON CLUSTER my_cluster;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP TABLE IF EMPTY
-- input:
DROP TABLE IF EMPTY mydb.my_table;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP TEMPORARY TABLE
-- input:
DROP TEMPORARY TABLE temp_table;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP USER single and multiple
-- input:
DROP USER IF EXISTS user1, user2 ON CLUSTER my_cluster;
-- output:
DROP USER IF EXISTS user1,
user2 ON CLUSTER my_cluster;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats DROP VIEW with SYNC
-- input:
DROP VIEW IF EXISTS mydb.my_view ON CLUSTER my_cluster SYNC;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats EXCHANGE DICTIONARIES
-- input:
EXCHANGE DICTIONARIES dict1 AND dict2;
-- output:
EXCHANGE DICTIONARIES dict1
AND dict2;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats EXCHANGE DICTIONARIES with databases and cluster
-- input:
EXCHANGE DICTIONARIES db1.dict_A AND db2.dict_B ON CLUSTER prod;
-- output:
EXCHANGE DICTIONARIES db1.dict_A
AND db2.dict_B ON CLUSTER prod;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats EXCHANGE TABLES
-- input:
EXCHANGE TABLES table1 AND table2;
-- output:
EXCHANGE TABLES table1
AND table2;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats EXECUTE AS with SELECT
-- input:
EXECUTE AS james SELECT currentUser(), authenticatedUser();
-- output:
EXECUTE AS james
SELECT
  currentUser (),
  authenticatedUser ();
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats EXISTS TEMPORARY TABLE
-- input:
EXISTS TEMPORARY TABLE temp_data;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats EXISTS with FORMAT
-- input:
EXISTS TABLE events FORMAT TabSeparated;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats EXPLAIN SELECT with UNION ALL and ORDER BY
-- input:
EXPLAIN AST SELECT sum(number) FROM numbers(10) UNION ALL SELECT sum(number) FROM numbers(10) ORDER BY sum(number) ASC FORMAT TSV;
-- output:
EXPLAIN AST
SELECT
  sum(number)
FROM
  numbers (10)
UNION ALL
SELECT
  sum(number)
FROM
  numbers (10)
ORDER BY
  sum(number) ASC FORMAT TSV;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats GRANT ALTER MATERIALIZE STATISTICS
-- input:
GRANT ALTER MATERIALIZE STATISTICS on db.table TO john WITH GRANT OPTION
-- output:
GRANT ALTER MATERIALIZE STATISTICS on db.table TO john
WITH
  GRANT OPTION
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats GRANT CURRENT GRANTS
-- input:
GRANT CURRENT GRANTS(READ ON S3) TO alice
-- output:
GRANT CURRENT GRANTS (READ ON S3) TO alice
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats GRANT READ ON S3 with complex regex pattern
-- input:
GRANT READ ON S3('s3://mybucket/data/2024/.*\.parquet') TO analyst
-- output:
GRANT READ ON S3 ('s3://mybucket/data/2024/.*\.parquet') TO analyst
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats GRANT SELECT with column list
-- input:
GRANT SELECT(x,y) ON db.table TO john
-- output:
GRANT
SELECT
  (x, y) ON db.table TO john
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats GRANT SELECT with column list and WITH GRANT OPTION
-- input:
GRANT SELECT(x,y) ON db.table TO john WITH GRANT OPTION
-- output:
GRANT
SELECT
  (x, y) ON db.table TO john
WITH
  GRANT OPTION
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats INSERT INTO with asterisk
-- input:
INSERT INTO insert_select_testtable (*) VALUES (1, 'a', 1) ;
-- output:
INSERT INTO
  insert_select_testtable (*)
VALUES
  (1, 'a', 1);
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats INSERT INTO with DEFAULT
-- input:
INSERT INTO insert_select_testtable VALUES (1, DEFAULT, 1) ;
-- output:
INSERT INTO
  insert_select_testtable
VALUES
  (1, DEFAULT, 1);
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats INSERT INTO with EXCEPT modifier
-- input:
INSERT INTO insert_select_testtable (* EXCEPT(b)) VALUES (2, 2);
-- output:
INSERT INTO
  insert_select_testtable (
    *
    EXCEPT
    (b)
  )
VALUES
  (2, 2);
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats INSERT INTO with WITH clause after INSERT
-- input:
INSERT INTO x WITH y AS (SELECT * FROM numbers(10)) SELECT * FROM y;
-- output:
INSERT INTO
  x
WITH
  y AS (
    SELECT
      *
    FROM
      numbers (10)
  )
SELECT
  *
FROM
  y;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats KILL QUERY with ON CLUSTER and FORMAT
-- input:
KILL QUERY ON CLUSTER prod WHERE elapsed > 300 FORMAT JSON;
-- output:
KILL QUERY ON CLUSTER prod
WHERE
  elapsed > 300 FORMAT JSON;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats KILL QUERY with SYNC
-- input:
KILL QUERY WHERE user = 'john' SYNC;
-- output:
KILL QUERY
WHERE
  user = 'john' SYNC;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats KILL QUERY with TEST
-- input:
KILL QUERY WHERE query_duration_ms > 60000 TEST;
-- output:
KILL QUERY
WHERE
  query_duration_ms > 60000 TEST;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats MOVE QUOTA
-- input:
MOVE QUOTA user_quota TO replicated_storage;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats MOVE ROLE
-- input:
MOVE ROLE admin, developer TO local_directory;
-- output:
MOVE ROLE admin,
developer TO local_directory;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats MOVE USER
-- input:
MOVE USER john, alice TO disk_storage;
-- output:
MOVE USER john,
alice TO disk_storage;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats OPTIMIZE TABLE with FINAL
-- input:
OPTIMIZE TABLE my_table FINAL;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats OPTIMIZE TABLE with ON CLUSTER and DEDUPLICATE BY
-- input:
OPTIMIZE TABLE logs ON CLUSTER prod DEDUPLICATE BY user_id, timestamp;
-- output:
OPTIMIZE TABLE logs ON CLUSTER prod DEDUPLICATE BY user_id,
timestamp;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats OPTIMIZE TABLE with PARTITION and DEDUPLICATE
-- input:
OPTIMIZE TABLE events PARTITION 202501 DEDUPLICATE;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats RENAME TABLE
-- input:
RENAME DATABASE atomic_database1 TO atomic_database2 ON CLUSTER production;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats REPLACE TABLE with ENGINE, ORDER BY, and SELECT
-- input:
REPLACE TABLE myOldTable ENGINE = MergeTree() ORDER BY CounterID AS SELECT * FROM myOldTable WHERE CounterID <12345;
-- output:
REPLACE TABLE myOldTable ENGINE = MergeTree ()
ORDER BY
  CounterID AS
SELECT
  *
FROM
  myOldTable
WHERE
  CounterID < 12345;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats REVOKE SELECT with column list
-- input:
REVOKE SELECT(wage), SELECT(id) ON accounts.staff FROM mira;
-- output:
REVOKE
SELECT
  (wage),
SELECT
  (id) ON accounts.staff
FROM
  mira;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats REVOKE SELECT with wildcard
-- input:
REVOKE SELECT ON accounts.* FROM john;
-- output:
REVOKE
SELECT
  ON accounts.*
FROM
  john;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats REVOKE with ALL EXCEPT
-- input:
REVOKE ON CLUSTER foo ADMIN OPTION FOR role FROM john, matt ALL EXCEPT foo;
-- output:
REVOKE ON CLUSTER foo ADMIN OPTION FOR role
FROM
  john,
  matt ALL
EXCEPT
foo;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats REVOKE with ON CLUSTER and ADMIN OPTION
-- input:
REVOKE ON CLUSTER foo ADMIN OPTION FOR role FROM john;
-- output:
REVOKE ON CLUSTER foo ADMIN OPTION FOR role
FROM
  john;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats REVOKE with ON CLUSTER and ADMIN OPTION
-- input:
REVOKE ON CLUSTER foo role FROM john;
-- output:
REVOKE ON CLUSTER foo role
FROM
  john;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with COLUMNS and APPLY modifier
-- input:
SELECT COLUMNS('[jk]') APPLY(toString) APPLY(length) APPLY(max) FROM columns_transformers;
-- output:
SELECT
  COLUMNS ('[jk]') APPLY (toString) APPLY (length) APPLY (max)
FROM
  columns_transformers;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with COLUMNS arithmetic
-- input:
SELECT COLUMNS('a') + COLUMNS('c') FROM col_names
-- output:
SELECT
  COLUMNS ('a') + COLUMNS ('c')
FROM
  col_names
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with COLUMNS expression
-- input:
SELECT COLUMNS('a') FROM col_names
-- output:
SELECT
  COLUMNS ('a')
FROM
  col_names
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with multiple COLUMNS and functions
-- input:
SELECT COLUMNS('a'), COLUMNS('c'), toTypeName(COLUMNS('c')) FROM col_names
-- output:
SELECT
  COLUMNS ('a'),
  COLUMNS ('c'),
  toTypeName (COLUMNS ('c'))
FROM
  col_names
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with REPLACE, EXCEPT, and APPLY modifiers
-- input:
SELECT * REPLACE(i + 1 AS i) EXCEPT (j) APPLY(sum) from columns_transformers;
-- output:
SELECT
  * REPLACE(i + 1 AS i)
EXCEPT
(j) APPLY (sum)
from
  columns_transformers;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with SETTINGS clause
-- input:
SELECT * FROM some_table SETTINGS optimize_read_in_order=1, cast_keep_nullable=1;
-- output:
SELECT
  *
FROM
  some_table SETTINGS optimize_read_in_order = 1,
  cast_keep_nullable = 1;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with window function
-- input:
SELECT part_key, value, order, groupArray(value) OVER (PARTITION BY part_key) AS frame_values FROM wf_partition ORDER BY part_key ASC, value ASC;
-- output:
SELECT
  part_key,
  value,
  order,
  groupArray (value) OVER (
    PARTITION BY
      part_key
  ) AS frame_values
FROM
  wf_partition
ORDER BY
  part_key ASC,
  value ASC;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SELECT with window function and ROWS BETWEEN
-- input:
SELECT part_key, value, order, groupArray(value) OVER (PARTITION BY part_key ORDER BY order ASC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS frame_values FROM wf_frame ORDER BY part_key ASC, value ASC;
-- output:
SELECT
  part_key,
  value,
  order,
  groupArray (value) OVER (
    PARTITION BY
      part_key
    ORDER BY
      order ASC ROWS BETWEEN UNBOUNDED PRECEDING
      AND UNBOUNDED FOLLOWING
  ) AS frame_values
FROM
  wf_frame
ORDER BY
  part_key ASC,
  value ASC;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET DEFAULT ROLE ALL EXCEPT
-- input:
SET DEFAULT ROLE ALL EXCEPT guest TO john, alice;
-- output:
SET
  DEFAULT ROLE ALL
EXCEPT
guest TO john,
alice;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET DEFAULT ROLE ALL to CURRENT_USER
-- input:
SET DEFAULT ROLE ALL TO CURRENT_USER;
-- output:
SET
  DEFAULT ROLE ALL TO CURRENT_USER;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET DEFAULT ROLE NONE
-- input:
SET DEFAULT ROLE NONE TO john;
-- output:
SET
  DEFAULT ROLE NONE TO john;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET DEFAULT ROLE with multiple roles
-- input:
SET DEFAULT ROLE admin, developer TO john;
-- output:
SET
  DEFAULT ROLE admin,
  developer TO john;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET DEFAULT ROLE with single role to multiple users
-- input:
SET DEFAULT ROLE admin TO john, alice;
-- output:
SET
  DEFAULT ROLE admin TO john,
  alice;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET ROLE ALL
-- input:
SET ROLE ALL;
-- output:
SET
  ROLE ALL;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET ROLE ALL EXCEPT
-- input:
SET ROLE ALL EXCEPT guest, readonly;
-- output:
SET
  ROLE ALL
EXCEPT
guest,
readonly;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SET ROLE with multiple roles
-- input:
SET ROLE admin, developer, analyst;
-- output:
SET
  ROLE admin,
  developer,
  analyst;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SHOW CREATE TABLE with INTO OUTFILE and FORMAT
-- input:
SHOW CREATE TABLE db.table INTO OUTFILE 'file.txt' FORMAT CSV;
-- output:
SHOW
CREATE TABLE db.table INTO OUTFILE 'file.txt' FORMAT CSV;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats simple CHECK TABLE
-- input:
CHECK TABLE test_table;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats simple UNDROP TABLE
-- input:
UNDROP TABLE my_table;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM DROP DATABASE REPLICA
-- input:
SYSTEM DROP DATABASE REPLICA 'replica1' FROM DATABASE mydb;
-- output:
SYSTEM
DROP DATABASE REPLICA 'replica1'
FROM
  DATABASE mydb;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM DROP REPLICA from database
-- input:
SYSTEM DROP REPLICA 'replica1' FROM DATABASE mydb;
-- output:
SYSTEM
DROP REPLICA 'replica1'
FROM
  DATABASE mydb;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM DROP REPLICA from table
-- input:
SYSTEM DROP REPLICA 'replica1' FROM TABLE mydb.my_replicated_table;
-- output:
SYSTEM
DROP REPLICA 'replica1'
FROM
  TABLE mydb.my_replicated_table;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM DROP REPLICA from ZooKeeper path
-- input:
SYSTEM DROP REPLICA 'replica1' FROM ZKPATH '/clickhouse/tables/01/mydb/my_replicated_table';
-- output:
SYSTEM
DROP REPLICA 'replica1'
FROM
  ZKPATH '/clickhouse/tables/01/mydb/my_replicated_table';
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM DROP REPLICA on local server
-- input:
SYSTEM DROP REPLICA 'replica1';
-- output:
SYSTEM
DROP REPLICA 'replica1';
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM FLUSH DISTRIBUTED on cluster
-- input:
SYSTEM FLUSH DISTRIBUTED db.dist_table ON CLUSTER prod;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM REFRESH VIEW
-- input:
SYSTEM REFRESH VIEW db.mv_hourly;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM START REPLICATION QUEUES
-- input:
SYSTEM START REPLICATION QUEUES db.replicated_table;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM START TTL MERGES on table
-- input:
SYSTEM START TTL MERGES db.my_table;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM STOP FETCHES on replicated table
-- input:
SYSTEM STOP FETCHES ON CLUSTER prod db.replicated_table;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM STOP LISTEN with protocol
-- input:
SYSTEM STOP LISTEN ON CLUSTER prod TCP SECURE;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM STOP MERGES on cluster
-- input:
SYSTEM STOP MERGES ON CLUSTER prod;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM STOP VIEWS
-- input:
SYSTEM STOP VIEWS;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM UNFREEZE with backup name
-- input:
SYSTEM UNFREEZE WITH NAME backup_20250101;
-- output:
SYSTEM UNFREEZE
WITH
  NAME backup_20250101;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats SYSTEM WAIT LOADING PARTS
-- input:
SYSTEM WAIT LOADING PARTS db.events;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats TRUNCATE TABLE IF EXISTS with ON CLUSTER and SYNC
-- input:
TRUNCATE TABLE IF EXISTS db.table ON CLUSTER prod SYNC;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats UNDROP TABLE with database and ON CLUSTER
-- input:
UNDROP TABLE db.my_table ON CLUSTER production;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats UNDROP TABLE with UUID
-- input:
UNDROP TABLE my_table UUID '550e8400-e29b-41d4-a716-446655440000';
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats UPDATE with multiple SET assignments
-- input:
UPDATE wikistat SET hits = hits + 1, time = now() WHERE path = 'ClickHouse';
-- output:
UPDATE wikistat
SET
  hits = hits + 1,
  time = now ()
WHERE
  path = 'ClickHouse';
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats UPDATE with WHERE clause
-- input:
UPDATE hits SET Title = 'Updated Title' WHERE EventDate = today();
-- output:
UPDATE hits
SET
  Title = 'Updated Title'
WHERE
  EventDate = today ();
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: formats WITH clause before INSERT INTO
-- input:
WITH y AS (SELECT * FROM numbers(10)) INSERT INTO x SELECT * FROM y;
-- output:
WITH
  y AS (
    SELECT
      *
    FROM
      numbers (10)
  )
INSERT INTO
  x
SELECT
  *
FROM
  y;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: should support parameters
-- config: {"params":{"foo":"{'bar': 'baz'}"}}
-- input:
SELECT {foo:Map(String, String)};
-- error:
-- Error: Parse error: Unexpected "{foo:Map(S" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: should support parameters
-- config: {"params":{"foo":"'123'"}}
-- input:
SELECT {foo:Uint64};
-- error:
-- Error: Parse error: Unexpected "{foo:Uint6" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: supports map literals
-- input:
SELECT {'foo':1,'bar':10,'baz':2,'zap':8};
-- error:
-- Error: Parse error: Unexpected "{'foo':1,'" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: supports the lambda creation operator
-- input:
SELECT arrayMap(x->2*x, [1,2,3,4]) AS result;
-- output:
SELECT
  arrayMap (x -> 2 * x, [1,2,3,4]) AS result;
-- #endregion

-- #region: sql-formatter / test / clickhouse.test: supports the ternary operator
-- input:
SELECT foo?bar: baz;
-- error:
-- Error: Parse error: Unexpected ": baz;" at line 1 column 15.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / db2.test: supports non-standard FOR clause
-- input:
SELECT * FROM tbl FOR UPDATE OF other_tbl FOR RS USE AND KEEP EXCLUSIVE LOCKS
-- output:
SELECT
  *
FROM
  tbl FOR
UPDATE OF other_tbl FOR RS USE
AND KEEP EXCLUSIVE LOCKS
-- #endregion

-- #region: sql-formatter / test / duckdb.test: capitalizes IS NOT NULL
-- config: {"keywordCase":"upper"}
-- input:
SELECT 1 is not null;
-- output:
SELECT
  1 IS NOT NULL;
-- #endregion

-- #region: sql-formatter / test / duckdb.test: formats {} struct literal (identifier keys)
-- input:
SELECT {id:1,type:'Tarzan'} AS obj;
-- error:
-- Error: Parse error: Unexpected "{id:1,type" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / duckdb.test: formats {} struct literal (quoted identifier keys)
-- input:
SELECT {"id":1,"type":'Tarzan'} AS obj;
-- error:
-- Error: Parse error: Unexpected "{"id":1,"t" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / duckdb.test: formats {} struct literal (string keys)
-- input:
SELECT {'id':1,'type':'Tarzan'} AS obj;
-- error:
-- Error: Parse error: Unexpected "{'id':1,'t" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / duckdb.test: formats JSON data type
-- config: {"dataTypeCase":"upper"}
-- input:
CREATE TABLE foo (bar json, baz json);
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / duckdb.test: formats large struct and list literals
-- input:

      INSERT INTO heroes (KEY, VALUE) VALUES ('123', {'id': 1, 'type': 'Tarzan',
      'array': [123456789, 123456789, 123456789, 123456789, 123456789], 'hello': 'world'});
    
-- error:
-- Error: Parse error: Unexpected "{'id': 1, " at line 2 column 54.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / duckdb.test: formats percentage value in LIMIT clause
-- input:
SELECT * FROM foo LIMIT 10%;
-- output:
SELECT
  *
FROM
  foo
LIMIT
  10 %;
-- #endregion

-- #region: sql-formatter / test / duckdb.test: formats prefix aliases
-- input:
SELECT foo:10, bar:'hello';
-- error:
-- Error: Parse error: Unexpected ":10, bar:'" at line 1 column 11.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / duckdb.test: supports array slice operator
-- input:
SELECT foo[:5], bar[1:], baz[1:5], zap[:];
-- output:
SELECT
  foo [:5],
  bar [1:],
  baz [1:5],
  zap [:];
-- #endregion

-- #region: sql-formatter / test / features / alterTable: formats ALTER TABLE ... ADD COLUMN query
-- input:
ALTER TABLE supplier ADD COLUMN unit_price DECIMAL NOT NULL;
-- output:
ALTER TABLE supplier
ADD COLUMN unit_price DECIMAL NOT NULL;
-- #endregion

-- #region: sql-formatter / test / features / alterTable: formats ALTER TABLE ... DROP COLUMN query
-- input:
ALTER TABLE supplier DROP COLUMN unit_price;
-- output:
ALTER TABLE supplier
DROP COLUMN unit_price;
-- #endregion

-- #region: sql-formatter / test / features / alterTable: formats ALTER TABLE ... MODIFY statement
-- input:
ALTER TABLE supplier MODIFY supplier_id DECIMAL NULL;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / alterTable: formats ALTER TABLE ... RENAME TO statement
-- input:
ALTER TABLE supplier RENAME TO the_one_who_supplies;
-- output:
ALTER TABLE supplier
RENAME TO the_one_who_supplies;
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: changes case of array accessors when identifierCase option used
-- config: {"identifierCase":"upper"}
-- input:
SELECT arr[1];
-- output:
SELECT
  ARR [1];
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: changes case of array accessors when identifierCase option used
-- config: {"identifierCase":"lower"}
-- input:
SELECT NS.Arr[1];
-- output:
SELECT
  ns.arr [1];
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: formats array accessor with comment in-between
-- input:
SELECT arr /* comment */ [1];
-- output:
SELECT
  arr /* comment */ [1];
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: formats namespaced array accessor with comment in-between
-- input:
SELECT foo./* comment */arr[1];
-- output:
SELECT
  foo./* comment */ arr [1];
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: supports namespaced array identifiers
-- input:
SELECT foo.coalesce['blah'];
-- output:
SELECT
  foo.coalesce ['blah'];
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: supports square brackets for array indexing
-- input:
SELECT arr[1], order_lines[5].productId;
-- output:
SELECT
  arr [1],
  order_lines [5].productId;
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: supports square brackets for map lookup
-- input:
SELECT alpha['a'], beta['gamma'].zeta, yota['foo.bar-baz'];
-- output:
SELECT
  alpha ['a'],
  beta ['gamma'].zeta,
  yota ['foo.bar-baz'];
-- #endregion

-- #region: sql-formatter / test / features / arrayAndMapAccessors: supports square brackets for map lookup - uppercase
-- config: {"identifierCase":"upper"}
-- input:
SELECT Alpha['a'], Beta['gamma'].zeTa, yotA['foo.bar-baz'];
-- output:
SELECT
  ALPHA ['a'],
  BETA ['gamma'].ZETA,
  YOTA ['foo.bar-baz'];
-- #endregion

-- #region: sql-formatter / test / features / arrayLiterals: dataTypeCase option affects ARRAY type case
-- config: {"dataTypeCase":"upper"}
-- input:
CREATE TABLE foo ( items ArrAy )
-- output:
CREATE TABLE foo (items ARRAY)
-- #endregion

-- #region: sql-formatter / test / features / arrayLiterals: dataTypeCase option does NOT affect ARRAY[] literal case
-- config: {"dataTypeCase":"upper"}
-- input:
SELECT ArrAy[1, 2]
-- output:
SELECT
  ARRAY [1, 2]
-- #endregion

-- #region: sql-formatter / test / features / arrayLiterals: keywordCase option affects ARRAY[] literal case
-- config: {"keywordCase":"upper"}
-- input:
SELECT ArrAy[1, 2]
-- output:
SELECT
  ArrAy [1, 2]
-- #endregion

-- #region: sql-formatter / test / features / arrayLiterals: supports array literals
-- input:
SELECT [1, 2, 3] FROM ['come-on', 'seriously', 'this', 'is', 'a', 'very', 'very', 'long', 'array'];
-- output:
SELECT
  [1, 2, 3]
FROM
  ['come-on', 'seriously', 'this', 'is', 'a', 'very', 'very', 'long', 'array'];
-- #endregion

-- #region: sql-formatter / test / features / arrayLiterals: supports ARRAY[] literals
-- input:
SELECT ARRAY[1, 2, 3] FROM ARRAY['come-on', 'seriously', 'this', 'is', 'a', 'very', 'very', 'long', 'array'];
-- output:
SELECT
  ARRAY [1, 2, 3]
FROM
  ARRAY ['come-on', 'seriously', 'this', 'is', 'a', 'very', 'very', 'long', 'array'];
-- #endregion

-- #region: sql-formatter / test / features / between: formats BETWEEN _ AND _ on single line
-- input:
foo BETWEEN bar AND baz
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / between: formats BETWEEN with comments inside
-- input:
WHERE foo BETWEEN /*C1*/ t.bar /*C2*/ AND /*C3*/ t.baz
-- output:
WHERE
  foo BETWEEN /*C1*/ t.bar /*C2*/ AND /*C3*/ t.baz
-- #endregion

-- #region: sql-formatter / test / features / between: supports AND after BETWEEN
-- input:
SELECT foo BETWEEN 1 AND 2 AND x > 10
-- output:
SELECT
  foo BETWEEN 1 AND 2
  AND x > 10
-- #endregion

-- #region: sql-formatter / test / features / between: supports CASE inside BETWEEN
-- input:
foo BETWEEN CASE x WHEN 1 THEN 2 END AND 3
-- output:
foo BETWEEN CASE x
  WHEN 1 THEN 2
END AND 3
-- #endregion

-- #region: sql-formatter / test / features / between: supports complex expressions inside BETWEEN
-- input:
foo BETWEEN 1+2 AND 3+4
-- output:
foo BETWEEN 1 + 2 AND 3  + 4
-- #endregion

-- #region: sql-formatter / test / features / between: supports qualified.names as BETWEEN expression values
-- input:
foo BETWEEN t.bar AND t.baz
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / case: formats between inside case expression
-- input:

    SELECT CASE WHEN x1 BETWEEN 1 AND 12 THEN '' END c1;
  
-- output:
SELECT
  CASE
    WHEN x1 BETWEEN 1 AND 12  THEN ''
  END c1;
-- #endregion

-- #region: sql-formatter / test / features / case: formats CASE ... WHEN inside SELECT
-- input:
SELECT foo, bar, CASE baz WHEN 'one' THEN 1 WHEN 'two' THEN 2 ELSE 3 END FROM tbl;
-- output:
SELECT
  foo,
  bar,
  CASE baz
    WHEN 'one' THEN 1
    WHEN 'two' THEN 2
    ELSE 3
  END
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / features / case: formats CASE ... WHEN with a blank expression
-- input:
CASE WHEN opt = 'foo' THEN 1 WHEN opt = 'bar' THEN 2 WHEN opt = 'baz' THEN 3 ELSE 4 END;
-- output:
CASE
  WHEN opt = 'foo' THEN 1
  WHEN opt = 'bar' THEN 2
  WHEN opt = 'baz' THEN 3
  ELSE 4
END;
-- #endregion

-- #region: sql-formatter / test / features / case: formats CASE ... WHEN with an expression
-- input:
CASE trim(sqrt(2)) WHEN 'one' THEN 1 WHEN 'two' THEN 2 WHEN 'three' THEN 3 ELSE 4 END;
-- output:
CASE trim(sqrt(2))
  WHEN 'one' THEN 1
  WHEN 'two' THEN 2
  WHEN 'three' THEN 3
  ELSE 4
END;
-- #endregion

-- #region: sql-formatter / test / features / case: formats CASE with comments
-- input:

      SELECT CASE /*c1*/ foo /*c2*/
      WHEN /*c3*/ 1 /*c4*/ THEN /*c5*/ 2 /*c6*/
      ELSE /*c7*/ 3 /*c8*/
      END;
    
-- output:
SELECT
  CASE /*c1*/ foo /*c2*/
    WHEN /*c3*/ 1 /*c4*/ THEN /*c5*/ 2 /*c6*/
    ELSE /*c7*/ 3 /*c8*/
  END;
-- #endregion

-- #region: sql-formatter / test / features / case: formats CASE with comments inside sub-expressions
-- input:

      SELECT CASE foo + /*c1*/ bar
      WHEN 1 /*c2*/ + 1 THEN 2 /*c2*/ * 2
      ELSE 3 - /*c3*/ 3
      END;
    
-- output:
SELECT
  CASE foo + /*c1*/ bar
    WHEN 1 /*c2*/ + 1 THEN 2 /*c2*/ * 2
    ELSE 3 - /*c3*/ 3
  END;
-- #endregion

-- #region: sql-formatter / test / features / case: formats CASE with identStyle:tabularLeft
-- config: {"indentStyle":"tabularLeft"}
-- input:
SELECT CASE foo WHEN 1 THEN bar ELSE baz END;
-- output:
SELECT    CASE foo
                    WHEN 1 THEN bar
                    ELSE baz
          END;
-- #endregion

-- #region: sql-formatter / test / features / case: formats CASE with identStyle:tabularRight
-- config: {"indentStyle":"tabularRight"}
-- input:
SELECT CASE foo WHEN 1 THEN bar ELSE baz END;
-- output:
   SELECT CASE foo
                    WHEN 1 THEN bar
                    ELSE baz
          END;
-- #endregion

-- #region: sql-formatter / test / features / case: formats nested case expressions
-- input:

      SELECT
        CASE
          CASE foo WHEN 1 THEN 11 ELSE 22 END
          WHEN 11 THEN 110
          WHEN 22 THEN 220
          ELSE 123
        END
      FROM
        tbl;
    
-- output:
SELECT
  CASE CASE foo
      WHEN 1 THEN 11
      ELSE 22
    END
    WHEN 11 THEN 110
    WHEN 22 THEN 220
    ELSE 123
  END
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / features / case: handles edge case of ending inline block with END
-- input:
select sum(case a when foo then bar end) from quaz
-- output:
select
  sum(
    case a
      when foo then bar
    end
  )
from
  quaz
-- #endregion

-- #region: sql-formatter / test / features / case: ignores words CASE and END inside other strings
-- input:
SELECT CASEDATE, ENDDATE FROM table1;
-- output:
SELECT
  CASEDATE,
  ENDDATE
FROM
  table1;
-- #endregion

-- #region: sql-formatter / test / features / case: properly converts to uppercase in case statements
-- config: {"keywordCase":"upper","functionCase":"upper"}
-- input:
case trim(sqrt(my_field)) when 'one' then 1 when 'two' then 2 when 'three' then 3 else 4 end;
-- output:
CASE TRIM(SQRT(my_field))
  WHEN 'one' THEN 1
  WHEN 'two' THEN 2
  WHEN 'three' THEN 3
  ELSE 4
END;
-- #endregion

-- #region: sql-formatter / test / features / case: recognizes lowercase CASE ... END
-- input:
case when opt = 'foo' then 1 else 2 end;
-- output:
case
  when opt = 'foo' then 1
  else 2
end;
-- #endregion

-- #region: sql-formatter / test / features / commentOn: formats COMMENT ON ...
-- input:
COMMENT ON COLUMN my_table.ssn IS 'Social Security Number';
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / commentOn: formats COMMENT ON ...
-- input:
COMMENT ON TABLE my_table IS 'This is an awesome table.';
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / comments: does not detect unclosed comment as a comment
-- input:

      SELECT count(*)
      /*SomeComment
    
-- output:
SELECT
  count(*) / * SomeComment
-- #endregion

-- #region: sql-formatter / test / features / comments: formats comments between function name and parenthesis
-- input:

      SELECT count /* comment */ (*);
    
-- output:
SELECT
  count/* comment */ (*);
-- #endregion

-- #region: sql-formatter / test / features / comments: formats comments between qualified.names (after dot)
-- input:

      SELECT foo. /* com1 */ bar, foo. /* com2 */ *;
    
-- output:
SELECT
  foo./* com1 */ bar,
  foo./* com2 */ *;
-- #endregion

-- #region: sql-formatter / test / features / comments: formats comments between qualified.names (before dot)
-- input:

      SELECT foo/* com1 */.bar, count()/* com2 */.bar, foo.bar/* com3 */.baz, (1, 2) /* com4 */.foo;
    
-- output:
SELECT
  foo /* com1 */.bar,
  count() /* com2 */.bar,
  foo.bar /* com3 */.baz,
  (1, 2) /* com4 */.foo;
-- #endregion

-- #region: sql-formatter / test / features / comments: formats first block comment in a file
-- input:
/*comment1*/
/*comment2*/

-- output:
/*comment1*/
/*comment2*/
-- #endregion

-- #region: sql-formatter / test / features / comments: formats first line comment in a file
-- input:
-- comment1
-- comment2

-- output:
-- comment1
-- comment2
-- #endregion

-- #region: sql-formatter / test / features / comments: formats line comments followed by close-paren
-- input:
SELECT ( a --comment
 )
-- output:
SELECT
  (
    a --comment
  )
-- #endregion

-- #region: sql-formatter / test / features / comments: formats line comments followed by comma
-- input:
SELECT a --comment
, b
-- output:
SELECT
  a --comment
,
  b
-- #endregion

-- #region: sql-formatter / test / features / comments: formats line comments followed by open-paren
-- input:
SELECT a --comment
()
-- output:
SELECT
  a --comment
  ()
-- #endregion

-- #region: sql-formatter / test / features / comments: formats line comments followed by semicolon
-- input:

      SELECT a FROM b --comment
      ;
    
-- output:
SELECT
  a
FROM
  b --comment
;
-- #endregion

-- #region: sql-formatter / test / features / comments: formats SELECT query with different comments
-- input:
SELECT
/*
 * This is a block comment
 */
* FROM
-- This is another comment
MyTable -- One final comment
WHERE 1 = 2;
-- output:
SELECT
  /*
   * This is a block comment
   */
  *
FROM
  -- This is another comment
  MyTable -- One final comment
WHERE
  1 = 2;
-- #endregion

-- #region: sql-formatter / test / features / comments: formats tricky line comments
-- input:
SELECT a--comment, here
FROM b--comment
-- output:
SELECT
  a --comment, here
FROM
  b --comment
-- #endregion

-- #region: sql-formatter / test / features / comments: indents multiline block comment that is not a doc-comment
-- input:
SELECT 1
/*
comment line
*/
-- output:
SELECT
  1
  /*
  comment line
  */
-- #endregion

-- #region: sql-formatter / test / features / comments: preserves single-line comments at the end of lines
-- input:

        SELECT
          a, --comment1
          b --comment2
        FROM --comment3
          my_table;
      
-- output:
SELECT
  a, --comment1
  b --comment2
FROM --comment3
  my_table;
-- #endregion

-- #region: sql-formatter / test / features / comments: preserves single-line comments on separate lines
-- input:

        SELECT
          --comment1
          a,
          --comment2
          b
        FROM
          --comment3
          my_table;
      
-- output:
SELECT
  --comment1
  a,
  --comment2
  b
FROM
  --comment3
  my_table;
-- #endregion

-- #region: sql-formatter / test / features / comments: recognizes line-comments with Windows line-endings (converts them to UNIX)
-- input:
SELECT * FROM
-- line comment 1
MyTable -- line comment 2

-- output:
SELECT
  *
FROM
  -- line comment 1
  MyTable -- line comment 2
-- #endregion

-- #region: sql-formatter / test / features / comments: supports // line comment
-- input:
SELECT alpha // commment
FROM beta
-- output:
SELECT
  alpha / / commment
FROM
  beta
-- #endregion

-- #region: sql-formatter / test / features / comments: supports # line comment
-- input:
SELECT alpha # commment
FROM beta
-- error:
-- Error: Parse error: Unexpected "# commment" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / comments: supports nested block comments
-- input:
SELECT alpha /* /* commment */ */ FROM beta
-- output:
SELECT
  alpha /* /* commment */ * /
FROM
  beta
-- #endregion

-- #region: sql-formatter / test / features / createTable: correctly indents CREATE TABLE in tabular style
-- config: {"indentStyle":"tabularLeft"}
-- input:
CREATE TABLE foo (
          id INT PRIMARY KEY NOT NULL,
          fname VARCHAR NOT NULL
        );
-- output:
CREATE    TABLE foo (
          id INT PRIMARY KEY NOT NULL,
          fname VARCHAR NOT NULL
          );
-- #endregion

-- #region: sql-formatter / test / features / createTable: formats long CREATE TABLE
-- input:
CREATE TABLE tbl (a INT PRIMARY KEY, b TEXT, c INT NOT NULL, doggie INT NOT NULL);
-- output:
CREATE TABLE tbl (
  a INT PRIMARY KEY,
  b TEXT,
  c INT NOT NULL,
  doggie INT NOT NULL
);
-- #endregion

-- #region: sql-formatter / test / features / createTable: formats short CREATE OR REPLACE TABLE
-- input:
CREATE OR REPLACE TABLE tbl (a INT PRIMARY KEY, b TEXT);
-- output:
CREATE
OR REPLACE TABLE tbl (a INT PRIMARY KEY, b TEXT);
-- #endregion

-- #region: sql-formatter / test / features / createTable: formats short CREATE TABLE
-- input:
CREATE TABLE tbl (a INT PRIMARY KEY, b TEXT);
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / createTable: formats short CREATE TABLE IF NOT EXISTS
-- input:
CREATE TABLE IF NOT EXISTS tbl (a INT PRIMARY KEY, b TEXT);
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / createTable: formats short CREATE TABLE with column comments
-- input:
CREATE TABLE tbl (a INT COMMENT 'Hello world!', b TEXT COMMENT 'Here we are!');
-- output:
CREATE TABLE tbl (
  a INT COMMENT 'Hello world!',
  b TEXT COMMENT 'Here we are!'
);
-- #endregion

-- #region: sql-formatter / test / features / createTable: formats short CREATE TABLE with comment
-- input:
CREATE TABLE tbl (a INT, b TEXT) COMMENT = 'Hello, world!';
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / createView: formats CREATE MATERIALIZED VIEW
-- input:
CREATE MATERIALIZED VIEW mat_view AS SELECT 42;
-- output:
CREATE MATERIALIZED VIEW mat_view AS
SELECT
  42;
-- #endregion

-- #region: sql-formatter / test / features / createView: formats CREATE OR REPLACE VIEW
-- input:
CREATE OR REPLACE VIEW v1 AS SELECT 42;
-- output:
CREATE
OR REPLACE VIEW v1 AS
SELECT
  42;
-- #endregion

-- #region: sql-formatter / test / features / createView: formats CREATE VIEW
-- input:
CREATE VIEW my_view AS SELECT id, fname, lname FROM tbl;
-- output:
CREATE VIEW my_view AS
SELECT
  id,
  fname,
  lname
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / features / createView: formats CREATE VIEW with columns
-- input:
CREATE VIEW my_view (id, fname, lname) AS SELECT * FROM tbl;
-- output:
CREATE VIEW my_view (id, fname, lname) AS
SELECT
  *
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / features / createView: formats short CREATE VIEW IF NOT EXISTS
-- input:
CREATE VIEW IF NOT EXISTS my_view AS SELECT 42;
-- output:
CREATE VIEW IF NOT EXISTS my_view AS
SELECT
  42;
-- #endregion

-- #region: sql-formatter / test / features / deleteFrom: formats DELETE FROM statement
-- input:
DELETE FROM Customers WHERE CustomerName='Alfred' AND Phone=5002132;
-- output:
DELETE FROM Customers
WHERE
  CustomerName = 'Alfred'
  AND Phone = 5002132;
-- #endregion

-- #region: sql-formatter / test / features / deleteFrom: formats DELETE statement (without FROM)
-- input:
DELETE Customers WHERE CustomerName='Alfred';
-- output:
DELETE Customers
WHERE
  CustomerName = 'Alfred';
-- #endregion

-- #region: sql-formatter / test / features / disableComment: does not format text after /* sql-formatter-disable */ until end of file
-- input:
SELECT foo FROM bar;
/* sql-formatter-disable */
SELECT foo FROM bar;

SELECT foo FROM bar;
-- output:
SELECT
  foo
FROM
  bar;

/* sql-formatter-disable */
SELECT foo FROM bar;

SELECT foo FROM bar;
-- #endregion

-- #region: sql-formatter / test / features / disableComment: does not format text between /* sql-formatter-disable */ and /* sql-formatter-enable */
-- input:
SELECT foo FROM bar;
/* sql-formatter-disable */
SELECT foo FROM bar;
/* sql-formatter-enable */
SELECT foo FROM bar;
-- output:
SELECT
  foo
FROM
  bar;

/* sql-formatter-disable */
SELECT foo FROM bar;
/* sql-formatter-enable */
SELECT
  foo
FROM
  bar;
-- #endregion

-- #region: sql-formatter / test / features / disableComment: does not parse code between disable/enable comments
-- input:
SELECT /*sql-formatter-disable*/ ?!{}[] /*sql-formatter-enable*/ FROM bar;
-- output:
SELECT
  /*sql-formatter-disable*/ ?!{}[] /*sql-formatter-enable*/
FROM
  bar;
-- #endregion

-- #region: sql-formatter / test / features / disableComment: preserves indentation between /* sql-formatter-disable */ and /* sql-formatter-enable */
-- input:
/* sql-formatter-disable */
SELECT
  foo
    FROM
      bar;
/* sql-formatter-enable */
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / dropTable: formats DROP TABLE IF EXISTS statement
-- input:
DROP TABLE IF EXISTS admin_role;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / dropTable: formats DROP TABLE statement
-- input:
DROP TABLE admin_role;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: detects consecutive U&"" identifiers as separate ones
-- input:
U&"foo"U&"bar"
-- output:
U & "foo" U & "bar"
-- #endregion

-- #region: sql-formatter / test / features / identifiers: does not support escaping double-quote by doubling it
-- input:
"foo "" JOIN bar"
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: does not support escaping double-quote with a backslash
-- input:
"foo \" JOIN bar"
-- error:
-- Error: Parse error: Unexpected """ at line 1 column 17.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / identifiers: does not supports escaping in U&"" strings with a backslash
-- input:
U&"foo \" JOIN bar"
-- error:
-- Error: Parse error: Unexpected """ at line 1 column 19.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / identifiers: no space around dot between two [bracket-quoted identifiers]
-- input:
SELECT [my table].[col name];
-- output:
SELECT
  [my table].[col name];
-- #endregion

-- #region: sql-formatter / test / features / identifiers: no space around dot between two backtick-quoted identifiers
-- input:
SELECT `my table`.`col name`;
-- output:
SELECT
  `my table`.`col name`;
-- #endregion

-- #region: sql-formatter / test / features / identifiers: no space around dot between two double-quoted identifiers
-- input:
SELECT "my table"."col name";
-- output:
SELECT
  "my table"."col name";
-- #endregion

-- #region: sql-formatter / test / features / identifiers: no space around dot between unicode double-quoted identifiers
-- input:
SELECT U&"my table".U&"col name";
-- output:
SELECT
  U & "my table".U & "col name";
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports [bracket-quoted identifiers]
-- input:
[foo JOIN bar]
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports [bracket-quoted identifiers]
-- input:
SELECT [where] FROM [update]
-- output:
SELECT
  [where]
FROM
  [update]
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports backtick-quoted identifiers
-- input:
`foo JOIN bar`
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports backtick-quoted identifiers
-- input:
SELECT `where` FROM `update`
-- output:
SELECT
  `where`
FROM
  `update`
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports double-quoted identifiers
-- input:
"foo JOIN bar"
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports double-quoted identifiers
-- input:
SELECT "where" FROM "update"
-- output:
SELECT
  "where"
FROM
  "update"
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports escaping backtick by doubling it
-- input:
`foo `` JOIN bar`
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports escaping close-bracket by doubling it
-- input:
[foo ]] JOIN bar]
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports escaping double-quote by doubling it
-- input:
"foo""bar"
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports escaping in U&"" strings by repeated quote
-- input:
U&"foo "" JOIN bar"
-- output:
U & "foo "" JOIN bar"
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports unicode double-quoted identifiers
-- input:
SELECT U&"where" FROM U&"update"
-- output:
SELECT
  U & "where"
FROM
  U & "update"
-- #endregion

-- #region: sql-formatter / test / features / identifiers: supports unicode double-quoted identifiers
-- input:
U&"foo JOIN bar"
-- output:
U & "foo JOIN bar"
-- #endregion

-- #region: sql-formatter / test / features / insertInto: formats INSERT without INTO
-- input:
INSERT Customers (ID, MoneyBalance, Address, City) VALUES (12,-123.4, 'Skagen 2111','Stv');
-- output:
INSERT Customers (ID, MoneyBalance, Address, City)
VALUES
  (12, -123.4, 'Skagen 2111', 'Stv');
-- #endregion

-- #region: sql-formatter / test / features / insertInto: formats simple INSERT INTO
-- input:
INSERT INTO Customers (ID, MoneyBalance, Address, City) VALUES (12,-123.4, 'Skagen 2111','Stv');
-- output:
INSERT INTO
  Customers (ID, MoneyBalance, Address, City)
VALUES
  (12, -123.4, 'Skagen 2111', 'Stv');
-- #endregion

-- #region: sql-formatter / test / features / isDistinctFrom: formats IS [NOT] DISTINCT FROM operator
-- input:
SELECT x IS DISTINCT FROM y, x IS NOT DISTINCT FROM y
-- output:
SELECT
  x IS DISTINCT
FROM
  y,
  x IS NOT DISTINCT
FROM
  y
-- #endregion

-- #region: sql-formatter / test / features / join: properly uppercases JOIN ... ON
-- config: {"keywordCase":"upper"}
-- input:
select * from customers join foo on foo.id = customers.id;
-- output:
SELECT
  *
FROM
  customers
  JOIN foo ON foo.id = customers.id;
-- #endregion

-- #region: sql-formatter / test / features / join: properly uppercases JOIN ... USING
-- config: {"keywordCase":"upper"}
-- input:
select * from customers join foo using (id);
-- output:
SELECT
  *
FROM
  customers
  JOIN foo USING (id);
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats FETCH FIRST
-- input:
SELECT * FROM tbl FETCH FIRST 10 ROWS ONLY;
-- output:
SELECT
  *
FROM
  tbl FETCH FIRST 10 ROWS ONLY;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats FETCH NEXT
-- input:
SELECT * FROM tbl FETCH NEXT 1 ROW ONLY;
-- output:
SELECT
  *
FROM
  tbl FETCH NEXT 1 ROW ONLY;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats LIMIT in tabular style
-- config: {"indentStyle":"tabularLeft"}
-- input:
SELECT * FROM tbl LIMIT 5, 6;
-- output:
SELECT    *
FROM      tbl
LIMIT     5, 6;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats LIMIT of single value and OFFSET
-- input:
SELECT * FROM tbl LIMIT 5 OFFSET 8;
-- output:
SELECT
  *
FROM
  tbl
LIMIT
  5
OFFSET
  8;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats LIMIT with comments
-- input:
SELECT * FROM tbl LIMIT --comment
 5,--comment
6;
-- output:
SELECT
  *
FROM
  tbl
LIMIT --comment
  5, --comment
  6;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats LIMIT with complex expressions
-- input:
SELECT * FROM tbl LIMIT abs(-5) - 1, (2 + 3) * 5;
-- output:
SELECT
  *
FROM
  tbl
LIMIT
  abs(-5) - 1, (2 + 3) * 5;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats LIMIT with two comma-separated values on single line
-- input:
SELECT * FROM tbl LIMIT 5, 10;
-- output:
SELECT
  *
FROM
  tbl
LIMIT
  5, 10;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats OFFSET ... FETCH FIRST
-- input:
SELECT * FROM tbl OFFSET 250 ROWS FETCH FIRST 5 ROWS ONLY;
-- output:
SELECT
  *
FROM
  tbl
OFFSET
  250 ROWS FETCH FIRST 5 ROWS ONLY;
-- #endregion

-- #region: sql-formatter / test / features / limiting: formats OFFSET ... FETCH FIRST
-- input:
SELECT * FROM tbl OFFSET 250 ROWS FETCH NEXT 5 ROWS ONLY;
-- output:
SELECT
  *
FROM
  tbl
OFFSET
  250 ROWS FETCH NEXT 5 ROWS ONLY;
-- #endregion

-- #region: sql-formatter / test / features / mergeInto: formats MERGE INTO
-- input:
MERGE INTO DetailedInventory AS t
      USING Inventory AS i
      ON t.product = i.product
      WHEN MATCHED THEN
        UPDATE SET quantity = t.quantity + i.quantity
      WHEN NOT MATCHED THEN
        INSERT (product, quantity) VALUES ('Horse saddle', 12);
-- output:
MERGE INTO DetailedInventory AS t USING Inventory AS i ON t.product = i.product WHEN MATCHED THEN
UPDATE
SET
  quantity = t.quantity + i.quantity WHEN NOT MATCHED THEN INSERT (product, quantity)
VALUES
  ('Horse saddle', 12);
-- #endregion

-- #region: sql-formatter / test / features / numbers: correctly handles floats as single tokens
-- input:
SELECT 1e-9 AS a, 1.5e+10 AS b, 3.5E12 AS c, 3.5e12 AS d;
-- output:
SELECT
  1e-9 AS a,
  1.5e+10 AS b,
  3.5E12 AS c,
  3.5e12 AS d;
-- #endregion

-- #region: sql-formatter / test / features / numbers: correctly handles floats with trailing point
-- input:
SELECT 1000. AS a;
-- output:
SELECT
  1000. AS a;
-- #endregion

-- #region: sql-formatter / test / features / numbers: correctly handles floats with trailing point
-- input:
SELECT a, b / 1000. AS a_s, 100. * b / SUM(a_s);
-- output:
SELECT
  a,
  b / 1000. AS a_s,
  100. * b / SUM(a_s);
-- #endregion

-- #region: sql-formatter / test / features / numbers: supports decimal numbers
-- input:
SELECT 42, -35.04, 105., 2.53E+3, 1.085E-5;
-- output:
SELECT
  42,
  -35.04,
  105.,
  2.53E+3,
  1.085E-5;
-- #endregion

-- #region: sql-formatter / test / features / numbers: supports decimal values without leading digits
-- input:
SELECT .456 AS foo;
-- output:
SELECT
  .456 AS foo;
-- #endregion

-- #region: sql-formatter / test / features / numbers: supports hex and binary numbers
-- input:
SELECT 0xAE, 0x10F, 0b1010001;
-- output:
SELECT
  0xAE,
  0x10F,
  0b1010001;
-- #endregion

-- #region: sql-formatter / test / features / numbers: supports underscore separators in numeric literals
-- input:
SELECT 1_000_000, 3.14_159, 0x1A_2B_3C, 0b1010_0001, 1.5e+1_0;
-- error:
-- Error: Parse error: Unexpected "1_000_000," at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / onConflict: supports INSERT .. ON CONFLICT syntax
-- input:
INSERT INTO tbl VALUES (1,'Blah') ON CONFLICT DO NOTHING;
-- output:
INSERT INTO
  tbl
VALUES
  (1, 'Blah')
ON CONFLICT DO NOTHING;
-- #endregion

-- #region: sql-formatter / test / features / operators: supports ANY set-operator
-- input:
foo = ANY (1, 2, 3)
-- output:
foo = ANY(1, 2, 3)
-- #endregion

-- #region: sql-formatter / test / features / operators: supports set operators
-- input:
EXISTS bar
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / operators: supports set operators
-- input:
foo ALL bar
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / operators: supports set operators
-- input:
foo IN (1, 2, 3)
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / operators: supports set operators
-- input:
foo IS NULL
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / operators: supports set operators
-- input:
foo LIKE 'hello%'
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / operators: supports set operators
-- input:
foo NOT IN (1, 2, 3)
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / operators: supports set operators
-- input:
UNIQUE foo
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / returning: places RETURNING to new line
-- input:
INSERT INTO users (firstname, lastname) VALUES ('Joe', 'Cool') RETURNING id, firstname;
-- output:
INSERT INTO
  users (firstname, lastname)
VALUES
  ('Joe', 'Cool')
RETURNING
  id,
  firstname;
-- #endregion

-- #region: sql-formatter / test / features / schema: formats simple SET SCHEMA statements
-- input:
SET SCHEMA schema1;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive B'' strings as separate ones
-- input:
B'1001'B'0110'
-- output:
B '1001' B '0110'
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive B"" strings as separate ones
-- input:
B"1001"B"0110"
-- output:
B "1001" B "0110"
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive E'' strings as separate ones
-- input:
e'a ha'e'hm mm'
-- output:
e 'a ha' e 'hm mm'
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive N'' strings as separate ones
-- input:
N'foo'N'bar'
-- output:
N 'foo' N 'bar'
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive r'' strings as separate ones
-- input:
r'a ha'r'hm mm'
-- output:
r 'a ha' r 'hm mm'
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive r"" strings as separate ones
-- input:
r"a ha"r"hm mm"
-- output:
r "a ha" r "hm mm"
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive U&'' strings as separate ones
-- input:
U&'foo'U&'bar'
-- output:
U & 'foo' U & 'bar'
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive X'' strings as separate ones
-- input:
X'AE01'X'01F6'
-- output:
X'AE01' X'01F6'
-- #endregion

-- #region: sql-formatter / test / features / strings: detects consecutive X" strings as separate ones
-- input:
X"AE01"X"01F6"
-- output:
X "AE01" X "01F6"
-- #endregion

-- #region: sql-formatter / test / features / strings: does not support escaping single-quote by doubling it
-- input:
'foo '' JOIN bar'
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / strings: does not support escaping single-quote with a backslash
-- input:
'foo \' JOIN bar'
-- error:
-- Error: Parse error: Unexpected "'" at line 1 column 17.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports bit sequences
-- input:
b'01'
-- output:
b '01'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports bit sequences
-- input:
B'10110'
-- output:
B '10110'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports bit sequences
-- input:
SELECT b'0101' FROM foo
-- output:
SELECT
  b '0101'
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / features / strings: supports bit sequences (with double-qoutes)
-- input:
b"01"
-- output:
b "01"
-- #endregion

-- #region: sql-formatter / test / features / strings: supports bit sequences (with double-qoutes)
-- input:
B"10110"
-- output:
B "10110"
-- #endregion

-- #region: sql-formatter / test / features / strings: supports bit sequences (with double-qoutes)
-- input:
SELECT b"0101" FROM foo
-- output:
SELECT
  b "0101"
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / features / strings: supports dollar-quoted strings
-- input:
$$foo 
 bar$$
-- error:
-- Error: Parse error: Unexpected "$$foo 
--  ba" at line 1 column 1.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports dollar-quoted strings
-- input:
$$foo $ JOIN bar$$
-- error:
-- Error: Parse error: Unexpected "$$foo $ JO" at line 1 column 1.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports dollar-quoted strings
-- input:
$$foo JOIN bar$$
-- error:
-- Error: Parse error: Unexpected "$$foo JOIN" at line 1 column 1.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports dollar-quoted strings
-- input:
SELECT $$where$$ FROM $$update$$
-- error:
-- Error: Parse error: Unexpected "$$where$$ " at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports E'' strings with C-style escapes
-- input:
E'blah blah'
-- output:
E 'blah blah'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports E'' strings with C-style escapes
-- input:
E'blah''blah'
-- output:
E 'blah''blah'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports E'' strings with C-style escapes
-- input:
E'some \' FROM escapes'
-- error:
-- Error: Parse error: Unexpected "'" at line 1 column 23.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports E'' strings with C-style escapes
-- input:
SELECT E'blah' FROM foo
-- output:
SELECT
  E 'blah'
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / features / strings: supports escaping in N'' strings with a backslash
-- input:
N'foo \' JOIN bar'
-- error:
-- Error: Parse error: Unexpected "'" at line 1 column 18.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports escaping in N'' strings with repeated quote
-- input:
N'foo '' JOIN bar'
-- output:
N 'foo '' JOIN bar'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports escaping in U&'' strings with repeated quote
-- input:
U&'foo '' JOIN bar'
-- output:
U & 'foo '' JOIN bar'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports escaping single-quote by doubling it
-- input:
'foo''bar'
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / strings: supports escaping single-quote with a backslash and a repeated quote
-- input:
'foo \' JOIN ''bar'
-- error:
-- Error: Parse error: Unexpected "'" at line 1 column 19.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports hex byte sequences
-- input:
SELECT x'2B' FROM foo
-- output:
SELECT
  x'2B'
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / features / strings: supports hex byte sequences
-- input:
SELECT x"2B" FROM foo
-- output:
SELECT
  x "2B"
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / features / strings: supports hex byte sequences
-- input:
x'0E'
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / strings: supports hex byte sequences
-- input:
X'1F0A89C3'
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / strings: supports hex byte sequences
-- input:
x"0E"
-- output:
x "0E"
-- #endregion

-- #region: sql-formatter / test / features / strings: supports hex byte sequences
-- input:
X"1F0A89C3"
-- output:
X "1F0A89C3"
-- #endregion

-- #region: sql-formatter / test / features / strings: supports no escaping in raw strings
-- input:
SELECT r'some \',R'text' FROM foo
-- output:
SELECT
  r 'some \',
  R 'text'
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / features / strings: supports no escaping in raw strings (with double-quotes)
-- input:
SELECT r"some \", R"text" FROM foo
-- output:
SELECT
  r "some \",
  R "text"
FROM
  foo
-- #endregion

-- #region: sql-formatter / test / features / strings: supports single-quoted strings
-- input:
'foo JOIN bar'
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / strings: supports single-quoted strings
-- input:
SELECT 'where' FROM 'update'
-- output:
SELECT
  'where'
FROM
  'update'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports T-SQL unicode strings
-- input:
N'foo JOIN bar'
-- output:
N 'foo JOIN bar'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports T-SQL unicode strings
-- input:
SELECT N'where' FROM N'update'
-- output:
SELECT
  N 'where'
FROM
  N 'update'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports tagged dollar-quoted strings
-- input:
$xxx$foo $$ LEFT JOIN $yyy$ bar$xxx$
-- error:
-- Error: Parse error: Unexpected "$$ LEFT JO" at line 1 column 10.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / features / strings: supports unicode single-quoted strings
-- input:
SELECT U&'where' FROM U&'update'
-- output:
SELECT
  U & 'where'
FROM
  U & 'update'
-- #endregion

-- #region: sql-formatter / test / features / strings: supports unicode single-quoted strings
-- input:
U&'foo JOIN bar'
-- output:
U & 'foo JOIN bar'
-- #endregion

-- #region: sql-formatter / test / features / truncateTable: formats TRUNCATE statement (without TABLE)
-- input:
TRUNCATE Customers;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / truncateTable: formats TRUNCATE TABLE statement
-- input:
TRUNCATE TABLE Customers;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / features / update: formats simple UPDATE statement
-- input:
UPDATE Customers SET ContactName='Alfred Schmidt', City='Hamburg' WHERE CustomerName='Alfreds Futterkiste';
-- output:
UPDATE Customers
SET
  ContactName = 'Alfred Schmidt',
  City = 'Hamburg'
WHERE
  CustomerName = 'Alfreds Futterkiste';
-- #endregion

-- #region: sql-formatter / test / features / update: formats UPDATE statement with AS part
-- input:
UPDATE customers SET total_orders = order_summary.total  FROM ( SELECT * FROM bank) AS order_summary
-- output:
UPDATE customers
SET
  total_orders = order_summary.total
FROM
  (
    SELECT
      *
    FROM
      bank
  ) AS order_summary
-- #endregion

-- #region: sql-formatter / test / features / update: formats UPDATE statement with cursor position
-- input:
UPDATE Customers SET Name='John' WHERE CURRENT OF my_cursor;
-- output:
UPDATE Customers
SET
  Name = 'John'
WHERE
  CURRENT OF my_cursor;
-- #endregion

-- #region: sql-formatter / test / features / window: formats multiple WINDOW specifications
-- input:
SELECT * FROM table1 WINDOW w1 AS (PARTITION BY col1), w2 AS (PARTITION BY col1, col2);
-- output:
SELECT
  *
FROM
  table1
WINDOW
  w1 AS (
    PARTITION BY
      col1
  ),
  w2 AS (
    PARTITION BY
      col1,
      col2
  );
-- #endregion

-- #region: sql-formatter / test / features / window: formats WINDOW clause at top level
-- input:
SELECT *, ROW_NUMBER() OVER wnd AS next_value FROM tbl WINDOW wnd AS (PARTITION BY id ORDER BY time);
-- output:
SELECT
  *,
  ROW_NUMBER() OVER wnd AS next_value
FROM
  tbl
WINDOW
  wnd AS (
    PARTITION BY
      id
    ORDER BY
      time
  );
-- #endregion

-- #region: sql-formatter / test / features / windowFunctions: supports ROWS BETWEEN in window functions
-- input:

        SELECT
          RANK() OVER (
            PARTITION BY explosion
            ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
          ) AS amount
        FROM
          tbl
      
-- output:
SELECT
  RANK() OVER (
    PARTITION BY
      explosion
    ORDER BY
      day ROWS BETWEEN 6 PRECEDING
      AND CURRENT ROW
  ) AS amount
FROM
  tbl
-- #endregion

-- #region: sql-formatter / test / features / with: formats WITH clause with multiple Common Table Expressions (CTE)
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
WITH
  cte_1 AS (
    SELECT
      a
    FROM
      b
    WHERE
      c = 1
  ),
  cte_2 AS (
    SELECT
      c
    FROM
      d
    WHERE
      e = 2
  ),
  final AS (
    SELECT
      *
    FROM
      cte_1
      LEFT JOIN cte_2 ON b = d
  )
SELECT
  *
FROM
  final;
-- #endregion

-- #region: sql-formatter / test / features / with: formats WITH clause with parameterized CTE
-- input:

      WITH cte_1(id, parent_id) AS (
        SELECT id, parent_id
        FROM tab1
        WHERE parent_id IS NULL
      )
      SELECT id, parent_id FROM cte_1;
    
-- output:
WITH
  cte_1 (id, parent_id) AS (
    SELECT
      id,
      parent_id
    FROM
      tab1
    WHERE
      parent_id IS NULL
  )
SELECT
  id,
  parent_id
FROM
  cte_1;
-- #endregion

-- #region: sql-formatter / test / hive.test: formats INSERT INTO TABLE
-- input:
INSERT INTO TABLE Customers VALUES (12,-123.4, 'Skagen 2111','Stv');
-- output:
INSERT INTO
  TABLE Customers
VALUES
  (12, -123.4, 'Skagen 2111', 'Stv');
-- #endregion

-- #region: sql-formatter / test / hive.test: recognizes ${hivevar:name} substitution variables
-- input:
SELECT ${var1}, ${ var 2 } FROM ${hivevar:table_name} WHERE name = '${hivevar:name}';
-- error:
-- Error: Parse error: Unexpected "${var1}, $" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / hive.test: supports SORT BY, CLUSTER BY, DISTRIBUTE BY
-- input:
SELECT value, count DISTRIBUTE BY count CLUSTER BY value SORT BY value, count;
-- output:
SELECT
  value,
  count DISTRIBUTE BY count CLUSTER BY value SORT BY value,
  count;
-- #endregion

-- #region: sql-formatter / test / mariadb.test: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE t ALTER COLUMN foo SET DEFAULT 10;
         ALTER TABLE t ALTER COLUMN foo DROP DEFAULT;
-- output:
ALTER TABLE t ALTER COLUMN foo
SET
  DEFAULT 10;

ALTER TABLE t ALTER COLUMN foo
DROP DEFAULT;
-- #endregion

-- #region: sql-formatter / test / mariadb.test: supports @'name' variables
-- input:
SELECT @'bar ar', @'bar\'x', @'bar''y' FROM tbl;
-- error:
-- Error: Parse error: Unexpected "@'bar ar'," at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / mariadb.test: supports @"name" variables
-- input:
SELECT @"foo fo", @"foo\"x", @"foo""y" FROM tbl;
-- error:
-- Error: Parse error: Unexpected "@"foo fo"," at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / n1ql.test: formats explained DELETE query with USE KEYS
-- input:
EXPLAIN DELETE FROM tutorial t USE KEYS 'baldwin'
-- output:
EXPLAIN
DELETE FROM tutorial t USE KEYS 'baldwin'
-- #endregion

-- #region: sql-formatter / test / n1ql.test: formats INSERT with {} object literal
-- input:
INSERT INTO heroes (KEY, VALUE) VALUES ('123', {'id':1,'type':'Tarzan'});
-- error:
-- Error: Parse error: Unexpected "{'id':1,'t" at line 1 column 48.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / n1ql.test: formats SELECT query with NEST and USE KEYS
-- input:

      SELECT * FROM usr
      USE KEYS 'Elinor_33313792' NEST orders_with_users orders
      ON KEYS ARRAY s.order_id FOR s IN usr.shipped_order_history END;
    
-- output:
SELECT
  *
FROM
  usr USE KEYS 'Elinor_33313792' NEST orders_with_users orders ON KEYS ARRAY s.order_id FOR s IN usr.shipped_order_history END;
-- #endregion

-- #region: sql-formatter / test / n1ql.test: formats SELECT query with UNNEST top level reserver word
-- input:
SELECT * FROM tutorial UNNEST tutorial.children c;
-- output:
SELECT
  *
FROM
  tutorial UNNEST tutorial.children c;
-- #endregion

-- #region: sql-formatter / test / n1ql.test: formats UPDATE query with USE KEYS
-- input:
UPDATE tutorial USE KEYS 'baldwin' SET type = 'actor'
-- output:
UPDATE tutorial USE KEYS 'baldwin'
SET
  type = 'actor'
-- #endregion

-- #region: sql-formatter / test / options / dataTypeCase: converts data type keyword case to lowercase
-- config: {"dataTypeCase":"lower"}
-- input:
CREATE TABLE users ( user_id iNt PRIMARY KEY, total_earnings Decimal(5, 2) NOT NULL )
-- output:
CREATE TABLE users (
  user_id int PRIMARY KEY,
  total_earnings decimal(5, 2) NOT NULL
)
-- #endregion

-- #region: sql-formatter / test / options / dataTypeCase: converts data type keyword case to uppercase
-- config: {"dataTypeCase":"upper"}
-- input:
CREATE TABLE users ( user_id iNt PRIMARY KEY, total_earnings Decimal(5, 2) NOT NULL )
-- output:
CREATE TABLE users (
  user_id INT PRIMARY KEY,
  total_earnings DECIMAL(5, 2) NOT NULL
)
-- #endregion

-- #region: sql-formatter / test / options / dataTypeCase: preserves data type keyword case by default
-- input:
CREATE TABLE users ( user_id iNt PRIMARY KEY, total_earnings Decimal(5, 2) NOT NULL )
-- output:
CREATE TABLE users (
  user_id iNt PRIMARY KEY,
  total_earnings Decimal(5, 2) NOT NULL
)
-- #endregion

-- #region: sql-formatter / test / options / expressionWidth: breaks paranthesized expressions to multiple lines when they exceed expressionWidth
-- config: {"expressionWidth":40}
-- input:
SELECT product.price + (product.original_price * product.sales_tax) AS total FROM product;
-- output:
SELECT
  product.price + (
    product.original_price * product.sales_tax
  ) AS total
FROM
  product;
-- #endregion

-- #region: sql-formatter / test / options / expressionWidth: calculates parenthesized expression length (also considering spaces)
-- config: {"expressionWidth":10,"denseOperators":true}
-- input:
SELECT (price * tax) AS total FROM table_name WHERE (amount > 25);
-- output:
SELECT
  (price*tax) AS total
FROM
  table_name
WHERE
  (amount>25);
-- #endregion

-- #region: sql-formatter / test / options / expressionWidth: formats inline when length of substituted parameters < expressionWidth
-- config: {"expressionWidth":11,"paramTypes":{"positional":true},"params":["10","20","30"]}
-- input:
SELECT (?, ?, ?) AS total;
-- output:
SELECT
  (10, 20, 30) AS total;
-- #endregion

-- #region: sql-formatter / test / options / expressionWidth: formats NOT-inline when length of substituted parameters > expressionWidth
-- config: {"expressionWidth":11,"paramTypes":{"positional":true},"params":["100","200","300"]}
-- input:
SELECT (?, ?, ?) AS total;
-- output:
SELECT
  (
    100,
    200,
    300
  ) AS total;
-- #endregion

-- #region: sql-formatter / test / options / expressionWidth: keeps paranthesized expressions on single lines when they do not exceed expressionWidth
-- config: {"expressionWidth":50}
-- input:
SELECT product.price + (product.original_price * product.sales_tax) AS total FROM product;
-- output:
SELECT
  product.price + (product.original_price * product.sales_tax) AS total
FROM
  product;
-- #endregion

-- #region: sql-formatter / test / options / expressionWidth: throws error when expressionWidth is zero
-- config: {"expressionWidth":0}
-- input:
SELECT *
-- error:
-- Error: expressionWidth config must be positive number. Received 0 instead.
-- #endregion

-- #region: sql-formatter / test / options / functionCase: converts function names to lowercase
-- config: {"functionCase":"lower"}
-- input:
SELECT MiN(price) AS min_price, Cast(item_code AS INT) FROM products
-- output:
SELECT
  min(price) AS min_price,
  cast(item_code AS INT)
FROM
  products
-- #endregion

-- #region: sql-formatter / test / options / functionCase: converts function names to uppercase
-- config: {"functionCase":"upper"}
-- input:
SELECT MiN(price) AS min_price, Cast(item_code AS INT) FROM products
-- output:
SELECT
  MIN(price) AS min_price,
  CAST(item_code AS INT)
FROM
  products
-- #endregion

-- #region: sql-formatter / test / options / functionCase: preserves function name case by default
-- input:
SELECT MiN(price) AS min_price, Cast(item_code AS INT) FROM products
-- output:
SELECT
  MiN(price) AS min_price,
  Cast(item_code AS INT)
FROM
  products
-- #endregion

-- #region: sql-formatter / test / options / identifierCase: converts identifiers to lowercase
-- config: {"identifierCase":"lower"}
-- input:
select Abc, 'mytext' as MyText from tBl1 left join Tbl2 where colA > 1 and colB = 3
-- output:
select
  abc,
  'mytext' as mytext
from
  tbl1
  left join tbl2
where
  cola > 1
  and colb = 3
-- #endregion

-- #region: sql-formatter / test / options / identifierCase: converts identifiers to uppercase
-- config: {"identifierCase":"upper"}
-- input:
select Abc, 'mytext' as MyText from tBl1 left join Tbl2 where colA > 1 and colB = 3
-- output:
select
  ABC,
  'mytext' as MYTEXT
from
  TBL1
  left join TBL2
where
  COLA > 1
  and COLB = 3
-- #endregion

-- #region: sql-formatter / test / options / identifierCase: converts multi-part identifiers to uppercase
-- config: {"identifierCase":"upper"}
-- input:
select Abc from Part1.Part2.Part3
-- output:
select
  ABC
from
  PART1.PART2.PART3
-- #endregion

-- #region: sql-formatter / test / options / identifierCase: does not uppercase quoted identifiers
-- config: {"identifierCase":"upper"}
-- input:
select "abc" as foo
-- output:
select
  "abc" as FOO
-- #endregion

-- #region: sql-formatter / test / options / identifierCase: function names are not effected by identifierCase option
-- config: {"identifierCase":"upper"}
-- input:
select count(*) from tbl
-- output:
select
  count(*)
from
  TBL
-- #endregion

-- #region: sql-formatter / test / options / identifierCase: preserves identifier case by default
-- input:
select Abc, 'mytext' as MyText from tBl1 left join Tbl2 where colA > 1 and colB = 3
-- output:
select
  Abc,
  'mytext' as MyText
from
  tBl1
  left join Tbl2
where
  colA > 1
  and colB = 3
-- #endregion

-- #region: sql-formatter / test / options / indentStyle: correctly indents set operations inside subqueries
-- config: {"indentStyle":"tabularLeft"}
-- input:
SELECT * FROM (
            SELECT * FROM a
            UNION ALL
            SELECT * FROM b) AS tbl;
-- output:
SELECT    *
FROM      (
          SELECT    *
          FROM      a
          UNION ALL
          SELECT    *
          FROM      b
          ) AS tbl;
-- #endregion

-- #region: sql-formatter / test / options / indentStyle: does not indent semicolon when newlineBeforeSemicolon:true used
-- config: {"indentStyle":"tabularLeft","newlineBeforeSemicolon":true}
-- input:
SELECT firstname, lastname, age FROM customers;
-- output:
SELECT    firstname,
          lastname,
          age
FROM      customers
;
-- #endregion

-- #region: sql-formatter / test / options / indentStyle: formats BETWEEN..AND
-- config: {"indentStyle":"tabularLeft"}
-- input:
SELECT * FROM tbl WHERE id BETWEEN 1 AND 5000;
-- output:
SELECT    *
FROM      tbl
WHERE     id BETWEEN 1 AND 5000;
-- #endregion

-- #region: sql-formatter / test / options / indentStyle: formats BETWEEN..AND
-- config: {"indentStyle":"tabularRight"}
-- input:
SELECT * FROM tbl WHERE id BETWEEN 1 AND 5000;
-- output:
   SELECT *
     FROM tbl
    WHERE id BETWEEN 1 AND 5000;
-- #endregion

-- #region: sql-formatter / test / options / indentStyle: handles long keywords
-- config: {"indentStyle":"tabularLeft"}
-- input:
SELECT *
FROM a
UNION ALL
SELECT *
FROM b
LEFT OUTER JOIN c;
-- output:
SELECT    *
FROM      a
UNION ALL
SELECT    *
FROM      b
LEFT      OUTER JOIN c;
-- #endregion

-- #region: sql-formatter / test / options / indentStyle: handles long keywords
-- config: {"indentStyle":"tabularRight"}
-- input:
SELECT *
FROM a
UNION ALL
SELECT *
FROM b
LEFT OUTER JOIN c;
-- output:
   SELECT *
     FROM a
UNION ALL
   SELECT *
     FROM b
     LEFT OUTER JOIN c;
-- #endregion

-- #region: sql-formatter / test / options / indentStyle: handles multiple levels of nested queries
-- config: {"indentStyle":"tabularLeft"}
-- input:
SELECT age FROM (SELECT fname, lname, age FROM (SELECT fname, lname FROM persons) JOIN (SELECT age FROM ages)) as mytable;
-- output:
SELECT    age
FROM      (
          SELECT    fname,
                    lname,
                    age
          FROM      (
                    SELECT    fname,
                              lname
                    FROM      persons
                    )
          JOIN      (
                    SELECT    age
                    FROM      ages
                    )
          ) as mytable;
-- #endregion

-- #region: sql-formatter / test / options / keywordCase: converts keywords to lowercase
-- config: {"keywordCase":"lower"}
-- input:
select distinct * frOM foo left JOIN bar WHERe cola > 1 and colb = 3
-- output:
select distinct
  *
from
  foo
  left join bar
where
  cola > 1
  and colb = 3
-- #endregion

-- #region: sql-formatter / test / options / keywordCase: converts keywords to uppercase
-- config: {"keywordCase":"upper"}
-- input:
select distinct * frOM foo left JOIN mycol WHERe cola > 1 and colb = 3
-- output:
SELECT DISTINCT
  *
FROM
  foo
  LEFT JOIN mycol
WHERE
  cola > 1
  AND colb = 3
-- #endregion

-- #region: sql-formatter / test / options / keywordCase: does not uppercase keywords inside strings
-- config: {"keywordCase":"upper"}
-- input:
select 'distinct' as foo
-- output:
SELECT
  'distinct' AS foo
-- #endregion

-- #region: sql-formatter / test / options / keywordCase: formats multi-word reserved clauses into single line
-- config: {"keywordCase":"upper"}
-- input:
select * from mytable
      inner
      join
      mytable2 on mytable1.col1 = mytable2.col1
      where mytable2.col1 = 5
      group
      bY mytable1.col2
      order
      by
      mytable2.col3;
-- output:
SELECT
  *
FROM
  mytable
  INNER JOIN mytable2 ON mytable1.col1 = mytable2.col1
WHERE
  mytable2.col1 = 5
GROUP BY
  mytable1.col2
ORDER BY
  mytable2.col3;
-- #endregion

-- #region: sql-formatter / test / options / keywordCase: preserves keyword case by default
-- input:
select distinct * frOM foo left JOIN bar WHERe cola > 1 and colb = 3
-- output:
select distinct
  *
frOM
  foo
  left JOIN bar
WHERe
  cola > 1
  and colb = 3
-- #endregion

-- #region: sql-formatter / test / options / keywordCase: treats dot-seperated keywords as plain identifiers
-- config: {"keywordCase":"upper"}
-- input:
select table.and from set.select
-- output:
SELECT
  table.and
FROM
  set.select
-- #endregion

-- #region: sql-formatter / test / options / linesBetweenQueries: defaults to single empty line between queries
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
SELECT
  *
FROM
  foo;

SELECT
  *
FROM
  bar;
-- #endregion

-- #region: sql-formatter / test / options / linesBetweenQueries: supports more empty lines between queries
-- config: {"linesBetweenQueries":2}
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
SELECT
  *
FROM
  foo;


SELECT
  *
FROM
  bar;
-- #endregion

-- #region: sql-formatter / test / options / linesBetweenQueries: supports no empty lines between queries
-- config: {"linesBetweenQueries":0}
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
SELECT
  *
FROM
  foo;
SELECT
  *
FROM
  bar;
-- #endregion

-- #region: sql-formatter / test / options / logicalOperatorNewline: by default adds newline before logical operator
-- input:
SELECT a WHERE true AND false;
-- output:
SELECT
  a
WHERE
  true
  AND false;
-- #endregion

-- #region: sql-formatter / test / options / logicalOperatorNewline: supports newline after logical operator
-- config: {"logicalOperatorNewline":"after"}
-- input:
SELECT a WHERE true AND false;
-- output:
SELECT
  a
WHERE
  true AND
  false;
-- #endregion

-- #region: sql-formatter / test / options / newlineBeforeSemicolon: defaults to semicolon on end of last line
-- input:
SELECT a FROM b;
-- output:
SELECT
  a
FROM
  b;
-- #endregion

-- #region: sql-formatter / test / options / newlineBeforeSemicolon: does not add newline before lonely semicolon when newlineBeforeSemicolon:true
-- config: {"newlineBeforeSemicolon":true}
-- input:
;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / options / newlineBeforeSemicolon: does not introduce extra empty lines between semicolons when newlineBeforeSemicolon:true
-- config: {"newlineBeforeSemicolon":true}
-- input:
;;;
-- output:
;

;

;
-- #endregion

-- #region: sql-formatter / test / options / newlineBeforeSemicolon: formats lonely semicolon
-- input:
;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / options / newlineBeforeSemicolon: formats multiple lonely semicolons
-- input:
;;;
-- output:
;

;

;
-- #endregion

-- #region: sql-formatter / test / options / newlineBeforeSemicolon: places semicolon on the same line as a single-line clause
-- input:
SELECT a FROM;
-- output:
SELECT
  a
FROM;
-- #endregion

-- #region: sql-formatter / test / options / newlineBeforeSemicolon: supports semicolon on separate line
-- config: {"newlineBeforeSemicolon":true}
-- input:
SELECT a FROM b;
-- output:
SELECT
  a
FROM
  b
;
-- #endregion

-- #region: sql-formatter / test / options / param: leaves ? positional placeholders as is when no params config provided
-- input:
SELECT ?, ?, ?;
-- output:
SELECT
  ?,
  ?,
  ?;
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes :n placeholders
-- input:
SELECT :1, :2 FROM tbl
-- error:
-- Error: Parse error: Unexpected ":1, :2 FRO" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes :name placeholders
-- input:
SELECT :foo, :bar, :baz;
-- output:
SELECT
  :foo,
  :bar,
  :baz;
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes ? numbered placeholders
-- input:
SELECT ?1, ?25, ?2;
-- output:
SELECT
  ?1,
  ?25,
  ?2;
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes @"name" placeholders
-- input:
SELECT @"foo", @"foo bar";
-- error:
-- Error: Parse error: Unexpected "@"foo", @"" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes @[name] placeholders
-- input:
SELECT @[foo], @[foo bar];
-- error:
-- Error: Parse error: Unexpected "@[foo], @[" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes @`name` placeholders
-- input:
SELECT @`foo`, @`foo bar`;
-- error:
-- Error: Parse error: Unexpected "@`foo`, @`" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes @name placeholders
-- input:
SELECT @foo, @bar, @baz;
-- output:
SELECT
  @foo,
  @bar,
  @baz;
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes $"name" placeholders
-- input:
SELECT $"foo", $"foo bar";
-- error:
-- Error: Parse error: Unexpected "$"foo", $"" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes $n placeholders
-- input:
SELECT $1, $2 FROM tbl
-- error:
-- Error: Parse error: Unexpected "$1, $2 FRO" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: recognizes $name placeholders
-- input:
SELECT $foo, $bar, $baz;
-- output:
SELECT
  $foo,
  $bar,
  $baz;
-- #endregion

-- #region: sql-formatter / test / options / param: replaces :name placeholders with param values
-- config: {"params":{"name":"'John'","current_age":"10"}}
-- input:
WHERE name = :name AND age > :current_age;
-- output:
WHERE
  name = 'John'
  AND age > 10;
-- #endregion

-- #region: sql-formatter / test / options / param: replaces ? positional placeholders inside BETWEEN expression
-- config: {"params":["5","10"]}
-- input:
SELECT name WHERE age BETWEEN ? AND ?;
-- output:
SELECT
  name
WHERE
  age BETWEEN 5 AND 10;
-- #endregion

-- #region: sql-formatter / test / options / param: replaces ? positional placeholders with param values
-- config: {"params":["first","second","third"]}
-- input:
SELECT ?, ?, ?;
-- output:
SELECT
  first,
  second,
  third;
-- #endregion

-- #region: sql-formatter / test / options / param: replaces @"name" placeholders with param values
-- config: {"params":{"name":"'John'","current age":"10"}}
-- input:
WHERE name = @"name" AND age > @"current age";
-- error:
-- Error: Parse error: Unexpected "@"name" AN" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: replaces @[name] placeholders with param values
-- config: {"params":{"name":"'John'","current age":"10"}}
-- input:
WHERE name = @[name] AND age > @[current age];
-- error:
-- Error: Parse error: Unexpected "@[name] AN" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: replaces @`name` placeholders with param values
-- config: {"params":{"name":"'John'","current age":"10"}}
-- input:
WHERE name = @`name` AND age > @`current age`;
-- error:
-- Error: Parse error: Unexpected "@`name` AN" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: replaces @name placeholders with param values
-- config: {"params":{"name":"'John'","current_age":"10"}}
-- input:
WHERE name = @name AND age > @current_age;
-- output:
WHERE
  name = 'John'
  AND age > 10;
-- #endregion

-- #region: sql-formatter / test / options / param: replaces $"name" placeholders with param values
-- config: {"params":{"name":"'John'","current age":"10"}}
-- input:
WHERE name = $"name" AND age > $"current age";
-- error:
-- Error: Parse error: Unexpected "$"name" AN" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / options / param: replaces $name placeholders with param values
-- config: {"params":{"name":"'John'","current_age":"10"}}
-- input:
WHERE name = $name AND age > $current_age;
-- output:
WHERE
  name = 'John'
  AND age > 10;
-- #endregion

-- #region: sql-formatter / test / options / paramTypes: does not enter infinite loop when empty regex given
-- config: {"paramTypes":{"custom":[{"regex":""}]}}
-- input:
SELECT foo FROM bar
-- error:
-- Error: Empty regex given in custom paramTypes. That would result in matching infinite amount of parameters.
-- #endregion

-- #region: sql-formatter / test / options / paramTypes: replaces :name named placeholders with param values
-- config: {"paramTypes":{"named":[":"]},"params":{"a":"first","b":"second","c":"third"}}
-- input:
SELECT :a, :b, :c;
-- output:
SELECT
  first,
  second,
  third;
-- #endregion

-- #region: sql-formatter / test / options / paramTypes: replaces ? positional placeholders with param values
-- config: {"paramTypes":{"positional":true},"params":["first","second","third"]}
-- input:
SELECT ?, ?, ?;
-- output:
SELECT
  first,
  second,
  third;
-- #endregion

-- #region: sql-formatter / test / options / paramTypes: replaces %blah% numbered placeholders with param values
-- config: {"paramTypes":{"custom":[{"regex":"%[0-9]+%"}]},"params":{"%1%":"first","%2%":"second","%3%":"third"}}
-- input:
SELECT %1%, %2%, %3%;
-- output:
SELECT
  first,
  second,
  third;
-- #endregion

-- #region: sql-formatter / test / options / paramTypes: supports multiple custom param types
-- config: {"paramTypes":{"custom":[{"regex":"%[0-9]+%"},{"regex":"{[0-9]}"}]},"params":{"%1%":"first","{2}":"second"}}
-- input:
SELECT %1%, {2};
-- error:
-- SyntaxError: Invalid regular expression: /(?:{[0-9]})/uy: Lone quantifier brackets
-- #endregion

-- #region: sql-formatter / test / options / paramTypes: supports parameterizing schema.table.column syntax
-- config: {"paramTypes":{"custom":[{"regex":"{w+}"}]}}
-- input:
SELECT {schema}.{table}.{column} FROM {schema}.{table}
-- error:
-- SyntaxError: Invalid regular expression: /(?:{w+})/uy: Lone quantifier brackets
-- #endregion

-- #region: sql-formatter / test / options / tabWidth: indents with 2 spaces by default
-- input:
SELECT count(*),Column1 FROM Table1;
-- output:
SELECT
  count(*),
  Column1
FROM
  Table1;
-- #endregion

-- #region: sql-formatter / test / options / tabWidth: supports indenting with 4 spaces
-- config: {"tabWidth":4}
-- input:
SELECT count(*),Column1 FROM Table1;
-- output:
SELECT
    count(*),
    Column1
FROM
    Table1;
-- #endregion

-- #region: sql-formatter / test / options / useTabs: ignores tabWidth when useTabs is enabled
-- config: {"useTabs":true,"tabWidth":10}
-- input:
SELECT count(*),Column1 FROM Table1;
-- output:
SELECT
	count(*),
	Column1
FROM
	Table1;
-- #endregion

-- #region: sql-formatter / test / options / useTabs: supports indenting with tabs
-- config: {"useTabs":true}
-- input:
SELECT count(*),Column1 FROM Table1;
-- output:
SELECT
	count(*),
	Column1
FROM
	Table1;
-- #endregion

-- #region: sql-formatter / test / plsql.test: formats FOR UPDATE clause
-- input:

      SELECT * FROM tbl FOR UPDATE;
      SELECT * FROM tbl FOR UPDATE OF tbl.salary;
    
-- output:
SELECT
  *
FROM
  tbl FOR
UPDATE;

SELECT
  *
FROM
  tbl FOR
UPDATE OF tbl.salary;
-- #endregion

-- #region: sql-formatter / test / plsql.test: formats identifier with dblink
-- input:
SELECT * FROM database.table@dblink WHERE id = 1;
-- output:
SELECT
  *
FROM
  database.table @dblink
WHERE
  id = 1;
-- #endregion

-- #region: sql-formatter / test / plsql.test: formats Oracle recursive sub queries
-- input:

      WITH t1 AS (
        SELECT * FROM tbl
      ) SEARCH BREADTH FIRST BY id SET order1
      SELECT * FROM t1;
    
-- output:
WITH
  t1 AS (
    SELECT
      *
    FROM
      tbl
  ) SEARCH BREADTH FIRST BY id
SET
  order1
SELECT
  *
FROM
  t1;
-- #endregion

-- #region: sql-formatter / test / plsql.test: recognizes _, $, # as part of identifiers
-- input:
SELECT my_col$1#, col.a$, type#, procedure$, user# FROM tbl;
-- error:
-- Error: Parse error: Unexpected "$1#, col.a" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports &name substitution variables
-- input:
SELECT &name, &some$Special#Chars_, &hah123 FROM &&tbl
-- error:
-- Error: Parse error: Unexpected "#Chars_, &" at line 1 column 28.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports #, $ in named parameters
-- input:
SELECT :col$foo, :col#foo
-- error:
-- Error: Parse error: Unexpected "#foo" at line 1 column 22.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
nq'(test string ( ) 'foo' bar )'
-- output:
nq '(test string ( ) ' foo ' bar )'
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
NQ'[test string [ ] 'foo' bar ]'
-- output:
NQ '[test string [ ] ' foo ' bar ]'
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
nQ'{test string { } 'foo' bar }'
-- output:
nQ '{test string { } ' foo ' bar }'
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
Nq'%test string % % 'foo' bar %'
-- output:
Nq '%test string % % ' foo ' bar %'
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
q'<test string < > 'foo' bar >'
-- output:
q '<test string < > ' foo ' bar >'
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
q'$test string $'$''
-- error:
-- Error: Parse error: Unexpected "$''" at line 1 column 18.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
Q'Stest string S'S''
-- output:
Q 'Stest string S' S ''
-- #endregion

-- #region: sql-formatter / test / plsql.test: supports Q custom delimiter strings
-- input:
Q'Xtest string X X 'foo' bar X'
-- output:
Q 'Xtest string X X ' foo ' bar X'
-- #endregion

-- #region: sql-formatter / test / postgresql.test: formats empty SELECT
-- input:
SELECT;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / postgresql.test: formats FOR UPDATE clause
-- input:

        SELECT * FROM tbl FOR UPDATE;
        SELECT * FROM tbl FOR UPDATE OF tbl.salary;
      
-- output:
SELECT
  *
FROM
  tbl FOR
UPDATE;

SELECT
  *
FROM
  tbl FOR
UPDATE OF tbl.salary;
-- #endregion

-- #region: sql-formatter / test / postgresql.test: formats JSON and JSONB data types
-- config: {"dataTypeCase":"upper"}
-- input:
CREATE TABLE foo (bar json, baz jsonb);
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / postgresql.test: formats keywords in COMMENT ON
-- config: {"keywordCase":"upper"}
-- input:
comment on table foo is 'Hello my table';
-- output:
comment ON TABLE foo IS 'Hello my table';
-- #endregion

-- #region: sql-formatter / test / postgresql.test: formats TIMESTAMP WITH TIME ZONE syntax
-- config: {"dataTypeCase":"upper"}
-- input:
create table time_table (id int,
          created_at timestamp without time zone,
          deleted_at time with time zone,
          modified_at timestamp(0) with time zone);
-- output:
create table time_table (
  id INT,
  created_at timestamp without time zone,
  deleted_at time
  with
    time zone,
    modified_at timestamp (0)
  with
    time zone
);
-- #endregion

-- #region: sql-formatter / test / postgresql.test: supports OPERATOR() syntax
-- input:
SELECT foo operator ( !== ) bar;
-- output:
SELECT
  foo operator (!= =) bar;
-- #endregion

-- #region: sql-formatter / test / postgresql.test: supports OPERATOR() syntax
-- input:
SELECT foo OPERATOR(public.===) bar;
-- error:
-- Error: Parse error at token: == at line 1 column 28
-- Unexpected OPERATOR token: {"type":"OPERATOR","raw":"==","text":"==","start":27}. Instead, I was expecting to see one of the following:
-- 
-- A LINE_COMMENT token based on:
--     comment →  ● %LINE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A BLOCK_COMMENT token based on:
--     comment →  ● %BLOCK_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A DISABLE_COMMENT token based on:
--     comment →  ● %DISABLE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_IDENTIFIER token based on:
--     array_subscript →  ● %ARRAY_IDENTIFIER _ square_brackets
--     property_access$subexpression$1 →  ● array_subscript
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_KEYWORD token based on:
--     array_subscript →  ● %ARRAY_KEYWORD _ square_brackets
--     property_access$subexpression$1 →  ● array_subscript
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ASTERISK token based on:
--     all_columns_asterisk →  ● %ASTERISK
--     property_access$subexpression$1 →  ● all_columns_asterisk
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %QUOTED_IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A VARIABLE token based on:
--     identifier$subexpression$1 →  ● %VARIABLE
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NAMED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NAMED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %QUOTED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NUMBERED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NUMBERED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A POSITIONAL_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %POSITIONAL_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A CUSTOM_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %CUSTOM_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     parenthesis → "(" ● expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     select_clause$subexpression$1$ebnf$2 → select_clause$subexpression$1$ebnf$2 ● free_form_sql
--     select_clause$subexpression$1 → asteriskless_free_form_sql ● select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- #endregion

-- #region: sql-formatter / test / postgresql.test: supports OR REPLACE in CREATE FUNCTION
-- input:
CREATE OR REPLACE FUNCTION foo ();
-- output:
CREATE
OR REPLACE FUNCTION foo ();
-- #endregion

-- #region: sql-formatter / test / postgresql.test: supports OR REPLACE in CREATE PROCEDURE
-- input:
CREATE OR REPLACE PROCEDURE foo () LANGUAGE sql AS $$ BEGIN END $$;
-- error:
-- Error: Parse error: Unexpected "$$ BEGIN E" at line 1 column 52.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / postgresql.test: supports UUID type and functions
-- config: {"dataTypeCase":"upper","functionCase":"lower"}
-- input:
CREATE TABLE foo (id uuid DEFAULT Gen_Random_Uuid());
-- output:
CREATE TABLE foo (id uuid DEFAULT Gen_Random_Uuid ());
-- #endregion

-- #region: sql-formatter / test / redshift.test: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE t ALTER COLUMN foo TYPE VARCHAR;
         ALTER TABLE t ALTER COLUMN foo ENCODE my_encoding;
-- output:
ALTER TABLE t ALTER COLUMN foo TYPE VARCHAR;

ALTER TABLE t ALTER COLUMN foo ENCODE my_encoding;
-- #endregion

-- #region: sql-formatter / test / redshift.test: formats COPY
-- input:

        COPY schema.table
        FROM 's3://bucket/file.csv'
        IAM_ROLE 'arn:aws:iam::123456789:role/rolename'
        FORMAT AS CSV DELIMITER ',' QUOTE '"'
        REGION AS 'us-east-1'
      
-- output:
COPY schema.table
FROM
  's3://bucket/file.csv' IAM_ROLE 'arn:aws:iam::123456789:role/rolename' FORMAT AS CSV DELIMITER ',' QUOTE '"' REGION AS 'us-east-1'
-- #endregion

-- #region: sql-formatter / test / redshift.test: formats DISTKEY and SORTKEY after CREATE TABLE
-- input:
CREATE TABLE items (a INT PRIMARY KEY, b TEXT, c INT NOT NULL, d INT NOT NULL, e INT NOT NULL) DISTKEY(created_at) SORTKEY(created_at);
-- output:
CREATE TABLE items (
  a INT PRIMARY KEY,
  b TEXT,
  c INT NOT NULL,
  d INT NOT NULL,
  e INT NOT NULL
) DISTKEY (created_at) SORTKEY (created_at);
-- #endregion

-- #region: sql-formatter / test / redshift.test: formats LIMIT
-- input:
SELECT col1 FROM tbl ORDER BY col2 DESC LIMIT 10;
-- output:
SELECT
  col1
FROM
  tbl
ORDER BY
  col2 DESC
LIMIT
  10;
-- #endregion

-- #region: sql-formatter / test / redshift.test: formats temp table name starting with #
-- input:
CREATE TABLE #tablename AS tbl;
-- error:
-- Error: Parse error: Unexpected "#tablename" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / redshift.test: supports QUALIFY clause
-- input:
SELECT * FROM tbl QUALIFY ROW_NUMBER() OVER my_window = 1
-- output:
SELECT
  *
FROM
  tbl QUALIFY ROW_NUMBER() OVER my_window = 1
-- #endregion

-- #region: sql-formatter / test / singlestoredb.test: formats '::' path-operator without spaces
-- input:
SELECT * FROM foo WHERE json_foo::bar = 'foobar'
-- error:
-- Error: Parse error: Unexpected "::bar = 'f" at line 1 column 33.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / singlestoredb.test: formats '::%' conversion path-operator without spaces
-- input:
SELECT * FROM foo WHERE json_foo::%bar = 'foobar'
-- error:
-- Error: Parse error: Unexpected "::%bar = '" at line 1 column 33.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / singlestoredb.test: formats '::$' conversion path-operator without spaces
-- input:
SELECT * FROM foo WHERE json_foo::$bar = 'foobar'
-- error:
-- Error: Parse error: Unexpected "::$bar = '" at line 1 column 33.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / snowflake.test: allows $ character as part of unquoted identifiers
-- input:
SELECT foo$
-- error:
-- Error: Parse error: Unexpected "$" at line 1 column 11.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / snowflake.test: allows TYPE to be used as an identifier
-- input:
SELECT CASE WHEN type = 'upgrade' THEN amount ELSE 0 END FROM items;
-- output:
SELECT
  CASE
    WHEN type = 'upgrade' THEN amount
    ELSE 0
  END
FROM
  items;
-- #endregion

-- #region: sql-formatter / test / snowflake.test: detects data types
-- config: {"dataTypeCase":"upper"}
-- input:
CREATE TABLE tbl (first_column double Precision, second_column numBer (38, 0), third String);
-- output:
CREATE TABLE tbl (
  first_column double Precision,
  second_column numBer (38, 0),
  third String
);
-- #endregion

-- #region: sql-formatter / test / snowflake.test: formats ':' path-operator followed by dots without spaces
-- input:
SELECT foo : bar . baz
-- error:
-- Error: Parse error: Unexpected ": bar . ba" at line 1 column 12.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / snowflake.test: formats ':' path-operator when followed by reserved keyword
-- input:
SELECT foo : from
-- error:
-- Error: Parse error: Unexpected ": from" at line 1 column 12.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / snowflake.test: formats ':' path-operator without spaces
-- input:
SELECT foo : bar
-- error:
-- Error: Parse error: Unexpected ": bar" at line 1 column 12.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / snowflake.test: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE t ALTER COLUMN foo SET DATA TYPE VARCHAR;
         ALTER TABLE t ALTER COLUMN foo SET DEFAULT 5;
         ALTER TABLE t ALTER COLUMN foo DROP DEFAULT;
         ALTER TABLE t ALTER COLUMN foo SET NOT NULL;
         ALTER TABLE t ALTER COLUMN foo DROP NOT NULL;
         ALTER TABLE t ALTER COLUMN foo COMMENT 'blah';
         ALTER TABLE t ALTER COLUMN foo UNSET COMMENT;
         ALTER TABLE t ALTER COLUMN foo SET MASKING POLICY polis;
         ALTER TABLE t ALTER COLUMN foo UNSET MASKING POLICY;
         ALTER TABLE t ALTER COLUMN foo SET TAG tname = 10;
         ALTER TABLE t ALTER COLUMN foo UNSET TAG tname;
-- output:
ALTER TABLE t ALTER COLUMN foo
SET
  DATA TYPE VARCHAR;

ALTER TABLE t ALTER COLUMN foo
SET
  DEFAULT 5;

ALTER TABLE t ALTER COLUMN foo
DROP DEFAULT;

ALTER TABLE t ALTER COLUMN foo
SET
  NOT NULL;

ALTER TABLE t ALTER COLUMN foo
DROP NOT NULL;

ALTER TABLE t ALTER COLUMN foo COMMENT 'blah';

ALTER TABLE t ALTER COLUMN foo UNSET COMMENT;

ALTER TABLE t ALTER COLUMN foo
SET
  MASKING POLICY polis;

ALTER TABLE t ALTER COLUMN foo UNSET MASKING POLICY;

ALTER TABLE t ALTER COLUMN foo
SET
  TAG tname = 10;

ALTER TABLE t ALTER COLUMN foo UNSET TAG tname;
-- #endregion

-- #region: sql-formatter / test / snowflake.test: supports $$-quoted strings
-- input:
SELECT $$foo' JOIN"$bar$$, $$foo$$$$bar$$
-- error:
-- Error: Parse error: Unexpected "$$foo' JOI" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / snowflake.test: supports IDENTIFIER() syntax
-- input:
CREATE TABLE identifier($foo);
-- output:
CREATE TABLE identifier ($foo);
-- #endregion

-- #region: sql-formatter / test / snowflake.test: supports lambda expressions
-- input:
SELECT FILTER(my_arr, a -> a:value >= 50);
-- output:
SELECT
  FILTER (my_arr, a -> a :value >= 50);
-- #endregion

-- #region: sql-formatter / test / spark.test: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE StudentInfo ALTER COLUMN FirstName COMMENT "new comment";
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / spark.test: formats basic WINDOW clause
-- input:
SELECT * FROM tbl WINDOW win1, WINDOW win2, WINDOW win3;
-- output:
SELECT
  *
FROM
  tbl
WINDOW
  win1,
WINDOW
  win2,
WINDOW
  win3;
-- #endregion

-- #region: sql-formatter / test / spark.test: formats window function and end as inline
-- input:
SELECT window(time, '1 hour').start AS window_start, window(time, '1 hour').end AS window_end FROM tbl;
-- output:
SELECT
window
  (time, '1 hour').start AS window_start,
window
  (time, '1 hour').end AS window_end
FROM
  tbl;
-- #endregion

-- #region: sql-formatter / test / spark.test: recognizes ${name} substitution variables
-- input:
SELECT ${var1}, ${ var 2 } FROM ${table_name} WHERE name = '${name}';
-- error:
-- Error: Parse error: Unexpected "${var1}, $" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / spark.test: supports identifiers that start with numbers
-- input:
SELECT 4four, 12345e FROM 5tbl
-- error:
-- Error: Parse error: Unexpected "4four, 123" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / sql.test: crashes when encountering unsupported curly braces
-- input:
SELECT
  {foo};
-- error:
-- Error: Parse error: Unexpected "{foo};" at line 2 column 3.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / sql.test: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE t ALTER COLUMN foo SET DEFAULT 5;
         ALTER TABLE t ALTER COLUMN foo DROP DEFAULT;
         ALTER TABLE t ALTER COLUMN foo DROP SCOPE CASCADE;
         ALTER TABLE t ALTER COLUMN foo RESTART WITH 10;
-- output:
ALTER TABLE t ALTER COLUMN foo
SET
  DEFAULT 5;

ALTER TABLE t ALTER COLUMN foo
DROP DEFAULT;

ALTER TABLE t ALTER COLUMN foo
DROP SCOPE CASCADE;

ALTER TABLE t ALTER COLUMN foo RESTART
WITH
  10;
-- #endregion

-- #region: sql-formatter / test / sql.test: throws error when encountering characters or operators it does not recognize
-- input:
SELECT @name, :bar FROM foo;
-- output:
SELECT
  @name,
  :bar
FROM
  foo;
-- #endregion

-- #region: sql-formatter / test / sql.test: treats ASC and DESC as reserved keywords
-- config: {"keywordCase":"upper"}
-- input:
SELECT foo FROM bar ORDER BY foo asc, zap desc
-- output:
SELECT
  foo
FROM
  bar
ORDER BY
  foo ASC,
  zap DESC
-- #endregion

-- #region: sql-formatter / test / sqlFormatter.test: throws error suggesting a use of a more specific dialect
-- input:
SELECT «weird-stuff»
-- error:
-- Error: Parse error: Unexpected "«weird-stu" at line 1 column 8.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / sqlFormatter.test: throws error when encountering incorrect SQL grammar
-- input:
SELECT foo.+;
-- error:
-- Error: Parse error at token: + at line 1 column 12
-- Unexpected OPERATOR token: {"type":"OPERATOR","raw":"+","text":"+","start":11}. Instead, I was expecting to see one of the following:
-- 
-- A LINE_COMMENT token based on:
--     comment →  ● %LINE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A BLOCK_COMMENT token based on:
--     comment →  ● %BLOCK_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A DISABLE_COMMENT token based on:
--     comment →  ● %DISABLE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_IDENTIFIER token based on:
--     array_subscript →  ● %ARRAY_IDENTIFIER _ square_brackets
--     property_access$subexpression$1 →  ● array_subscript
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_KEYWORD token based on:
--     array_subscript →  ● %ARRAY_KEYWORD _ square_brackets
--     property_access$subexpression$1 →  ● array_subscript
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ASTERISK token based on:
--     all_columns_asterisk →  ● %ASTERISK
--     property_access$subexpression$1 →  ● all_columns_asterisk
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %QUOTED_IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A VARIABLE token based on:
--     identifier$subexpression$1 →  ● %VARIABLE
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NAMED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NAMED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %QUOTED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NUMBERED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NUMBERED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A POSITIONAL_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %POSITIONAL_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A CUSTOM_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %CUSTOM_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     select_clause$subexpression$1 →  ● asteriskless_free_form_sql select_clause$subexpression$1$ebnf$2
--     select_clause → %RESERVED_SELECT ● select_clause$subexpression$1
--     clause$subexpression$1 →  ● select_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- #endregion

-- #region: sql-formatter / test / sqlite.test: supports ON CONFLICT .. DO UPDATE syntax
-- input:
INSERT INTO tbl VALUES (1,'Leopard') ON CONFLICT DO UPDATE SET foo=1;
-- output:
INSERT INTO
  tbl
VALUES
  (1, 'Leopard')
ON CONFLICT DO UPDATE
SET
  foo = 1;
-- #endregion

-- #region: sql-formatter / test / transactsql.test: allows @ and # at the start of identifiers
-- input:
SELECT @bar, #baz, @@some, ##flam FROM tbl;
-- error:
-- Error: Parse error: Unexpected "#baz, @@so" at line 1 column 14.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / transactsql.test: allows the use of the ODBC date format
-- input:
WITH [sales_query] AS (SELECT [customerId] FROM [segments].dbo.[sales] WHERE [salesdate] > {d'2024-01-01'})
-- error:
-- Error: Parse error: Unexpected "{d'2024-01" at line 1 column 92.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / transactsql.test: does not detect CHAR() as function
-- config: {"functionCase":"upper"}
-- input:
CREATE TABLE foo (name char(65));
-- output:
CREATE TABLE foo (name CHAR(65));
-- #endregion

-- #region: sql-formatter / test / transactsql.test: does not recognize ODBC keywords as reserved keywords
-- config: {"keywordCase":"upper"}
-- input:
SELECT Value, Zone
-- output:
SELECT
  Value,
  Zone
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats .. shorthand for database.schema.table
-- input:
SELECT x FROM db..tbl
-- error:
-- Error: Parse error at token: . at line 1 column 18
-- Unexpected PROPERTY_ACCESS_OPERATOR token: {"type":"PROPERTY_ACCESS_OPERATOR","raw":".","text":".","start":17}. Instead, I was expecting to see one of the following:
-- 
-- A LINE_COMMENT token based on:
--     comment →  ● %LINE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A BLOCK_COMMENT token based on:
--     comment →  ● %BLOCK_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A DISABLE_COMMENT token based on:
--     comment →  ● %DISABLE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR ● _ property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_IDENTIFIER token based on:
--     array_subscript →  ● %ARRAY_IDENTIFIER _ square_brackets
--     property_access$subexpression$1 →  ● array_subscript
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_KEYWORD token based on:
--     array_subscript →  ● %ARRAY_KEYWORD _ square_brackets
--     property_access$subexpression$1 →  ● array_subscript
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ASTERISK token based on:
--     all_columns_asterisk →  ● %ASTERISK
--     property_access$subexpression$1 →  ● all_columns_asterisk
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %QUOTED_IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A VARIABLE token based on:
--     identifier$subexpression$1 →  ● %VARIABLE
--     identifier →  ● identifier$subexpression$1
--     property_access$subexpression$1 →  ● identifier
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NAMED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NAMED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %QUOTED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NUMBERED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NUMBERED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A POSITIONAL_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %POSITIONAL_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A CUSTOM_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %CUSTOM_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     property_access$subexpression$1 →  ● parameter
--     property_access → atomic_expression _ %PROPERTY_ACCESS_OPERATOR _ ● property_access$subexpression$1
--     atomic_expression$subexpression$1 →  ● property_access
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     other_clause$ebnf$1 → other_clause$ebnf$1 ● free_form_sql
--     other_clause → %RESERVED_CLAUSE ● other_clause$ebnf$1
--     clause$subexpression$1 →  ● other_clause
--     clause →  ● clause$subexpression$1
--     expressions_or_clauses$ebnf$2 → expressions_or_clauses$ebnf$2 ● clause
--     expressions_or_clauses → expressions_or_clauses$ebnf$1 ● expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats ALTER TABLE ... ALTER COLUMN
-- input:
ALTER TABLE t ALTER COLUMN foo INT NOT NULL DEFAULT 5;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats GO CREATE OR ALTER PROCEDURE
-- input:
GO CREATE OR ALTER PROCEDURE p
-- output:
GO CREATE
OR ALTER PROCEDURE p
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats GO on a separate line
-- input:
CREATE VIEW foo AS SELECT * FROM tbl GO CREATE INDEX bar
-- output:
CREATE VIEW foo AS
SELECT
  *
FROM
  tbl GO CREATE INDEX bar
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats goto labels
-- input:
InfiniLoop:
      SELECT 'Hello.';
      GOTO InfiniLoop;
-- error:
-- Error: Parse error: Unexpected ":
--       SE" at line 1 column 11.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats scope resolution operator without spaces
-- input:
SELECT hierarchyid :: GetRoot();
-- error:
-- Error: Parse error: Unexpected ":: GetRoot" at line 1 column 20.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats SELECT ... FOR BROWSE
-- input:
SELECT col FOR BROWSE
-- output:
SELECT
  col FOR BROWSE
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats SELECT ... FOR JSON
-- input:
SELECT col FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
-- output:
SELECT
  col FOR JSON PATH,
  WITHOUT_ARRAY_WRAPPER
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats SELECT ... FOR XML
-- input:
SELECT col FOR XML PATH('Employee'), ROOT('Employees')
-- output:
SELECT
  col FOR XML PATH ('Employee'),
  ROOT ('Employees')
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats SELECT ... INTO clause
-- input:
SELECT col INTO #temp FROM tbl
-- error:
-- Error: Parse error: Unexpected "#temp FROM" at line 1 column 17.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / transactsql.test: formats SELECT ... OPTION ()
-- input:
SELECT col OPTION (MAXRECURSION 5)
-- output:
SELECT
  col OPTION (MAXRECURSION 5)
-- #endregion

-- #region: sql-formatter / test / transactsql.test: recognizes @, $, # as part of identifiers
-- input:
SELECT from@bar, where#to, join$me FROM tbl;
-- error:
-- Error: Parse error: Unexpected "#to, join$" at line 1 column 23.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / transactsql.test: supports ALTER PROCEDURE
-- input:
GO ALTER PROCEDURE foo AS SELECT 1; GO
-- output:
GO ALTER PROCEDURE foo AS
SELECT
  1;

GO
-- #endregion

-- #region: sql-formatter / test / transactsql.test: supports special $ACTION keyword
-- input:
MERGE INTO tbl OUTPUT $action AS act;
-- output: <unchanged>
-- #endregion

-- #region: sql-formatter / test / trino.test: formats row PATTERN()s
-- input:

      SELECT * FROM orders MATCH_RECOGNIZE(
        PARTITION BY custkey
        ORDER BY orderdate
        MEASURES
                  A.totalprice AS starting_price,
                  LAST(B.totalprice) AS bottom_price,
                  LAST(U.totalprice) AS top_price
        ONE ROW PER MATCH
        AFTER MATCH SKIP PAST LAST ROW
        PATTERN ((A | B){5} {- C+ D+ -} E+)
        SUBSET U = (C, D)
        DEFINE
                  B AS totalprice < PREV(totalprice),
                  C AS totalprice > PREV(totalprice) AND totalprice <= A.totalprice,
                  D AS totalprice > PREV(totalprice)
        )
    
-- error:
-- Error: Parse error: Unexpected "{5} {- C+ " at line 11 column 25.
-- SQL dialect used: "sqlite".
-- #endregion

-- #region: sql-formatter / test / trino.test: formats SET SESSION
-- input:
SET SESSION foo = 444;
-- output:
SET
  SESSION foo = 444;
-- #endregion

-- #region: sql-formatter / test / trino.test: formats TIMESTAMP WITH TIME ZONE syntax
-- input:

        CREATE TABLE time_table (id INT,
          created_at TIMESTAMP WITH TIME ZONE,
          deleted_at TIME WITH TIME ZONE,
          modified_at TIMESTAMP(0) WITH TIME ZONE);
-- output:
CREATE TABLE time_table (
  id INT,
  created_at TIMESTAMP
  WITH
    TIME ZONE,
    deleted_at TIME
  WITH
    TIME ZONE,
    modified_at TIMESTAMP (0)
  WITH
    TIME ZONE
);
-- #endregion
