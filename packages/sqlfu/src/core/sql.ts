import type {AsyncExecutor, QueryArg, QueryResult, ResultRow, SqlFragment, SqlQuery} from './types.js';

const emptyFragment: SqlFragment = {sql: '', args: []};

export class BoundQuery<TRow extends ResultRow> implements PromiseLike<readonly TRow[]> {
  readonly query: SqlQuery;
  readonly #executor: AsyncExecutor;

  constructor(executor: AsyncExecutor, query: SqlQuery) {
    this.#executor = executor;
    this.query = query;
  }

  all(): Promise<readonly TRow[]> {
    return this.#executor.query<TRow>(this.query).then((result) => result.rows);
  }

  first(): Promise<TRow | null> {
    return this.#executor.query<TRow>(this.query).then((result) => result.rows[0] ?? null);
  }

  run(): Promise<QueryResult<TRow>> {
    return this.#executor.query<TRow>(this.query);
  }

  then<TResult1 = readonly TRow[], TResult2 = never>(
    onfulfilled?: ((value: readonly TRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.all().then(onfulfilled, onrejected);
  }
}

export interface BoundSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): BoundQuery<TRow>;
}

export type SqlValue = QueryArg | SqlFragment;

export function isSqlFragment(value: unknown): value is SqlFragment {
  return Boolean(
    value && typeof value === 'object' && 'sql' in value && 'args' in value && Array.isArray((value as SqlFragment).args),
  );
}

export function sql(strings: TemplateStringsArray, ...values: readonly SqlValue[]): SqlQuery {
  let text = '';
  const args: QueryArg[] = [];

  for (const [index, chunk] of strings.entries()) {
    text += chunk;

    if (index >= values.length) {
      continue;
    }

    const value = values[index];
    if (isSqlFragment(value)) {
      text += value.sql;
      args.push(...value.args);
      continue;
    }

    text += '?';
    args.push(value);
  }

  return {sql: collapseWhitespace(text), args};
}

export function raw(value: string): SqlFragment {
  return {sql: value, args: []};
}

export function join(values: readonly SqlValue[], separator = ', '): SqlFragment {
  if (values.length === 0) {
    return emptyFragment;
  }

  let text = '';
  const args: QueryArg[] = [];

  values.forEach((value, index) => {
    if (index > 0) {
      text += separator;
    }

    if (isSqlFragment(value)) {
      text += value.sql;
      args.push(...value.args);
      return;
    }

    text += '?';
    args.push(value);
  });

  return {sql: text, args};
}

export function bindSql(executor: AsyncExecutor): BoundSqlTag {
  return <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ) => new BoundQuery<TRow>(executor, sql(strings, ...values));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
