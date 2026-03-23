import type {QueryArg, QueryExecutor, RunResult, SqlFragment, SqlQuery} from './types.js';

const emptyFragment: SqlFragment = {sql: '', args: []};

export class BoundQuery<TRow extends Record<string, unknown>> implements PromiseLike<readonly TRow[]> {
  readonly query: SqlQuery;
  readonly #executor: QueryExecutor;

  constructor(executor: QueryExecutor, query: SqlQuery) {
    this.#executor = executor;
    this.query = query;
  }

  all(): Promise<readonly TRow[]> {
    return this.#executor.all<TRow>(this.query);
  }

  first(): Promise<TRow | null> {
    return this.#executor.first<TRow>(this.query);
  }

  run(): Promise<RunResult> {
    return this.#executor.run(this.query);
  }

  then<TResult1 = readonly TRow[], TResult2 = never>(
    onfulfilled?: ((value: readonly TRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.all().then(onfulfilled, onrejected);
  }
}

export interface BoundSqlTag {
  <TRow extends Record<string, unknown> = Record<string, unknown>>(
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

export function bindSql(executor: QueryExecutor): BoundSqlTag {
  return <TRow extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ) => new BoundQuery<TRow>(executor, sql(strings, ...values));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
