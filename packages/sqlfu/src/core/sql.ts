import type {
  AsyncExecutor,
  AsyncSqlTag,
  QueryArg,
  QueryResult,
  ResultRow,
  SqlFragment,
  SqlQuery,
  SqlValue,
  SyncExecutor,
  SyncSqlTag,
} from './types.js';

const emptyFragment: SqlFragment = {sql: '', args: []};

export class AsyncBoundQuery<TRow extends ResultRow> implements PromiseLike<QueryResult<TRow>> {
  readonly query: SqlQuery;
  readonly #executor: AsyncExecutor;

  constructor(executor: AsyncExecutor, query: SqlQuery) {
    this.#executor = executor;
    this.query = query;
  }

  then<TResult1 = QueryResult<TRow>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<TRow>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      return Promise.resolve(this.#executor.query<TRow>(this.query)).then(onfulfilled, onrejected);
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<QueryResult<TRow> | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<QueryResult<TRow>> {
    return Promise.resolve(this.then((value) => value)).finally(onfinally ?? undefined);
  }
}

export class SyncBoundQuery<TRow extends ResultRow> implements PromiseLike<QueryResult<TRow>> {
  readonly query: SqlQuery;
  readonly #executor: SyncExecutor;

  constructor(executor: SyncExecutor, query: SqlQuery) {
    this.#executor = executor;
    this.query = query;
  }

  then<TResult1 = QueryResult<TRow>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<TRow>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      return Promise.resolve(this.#executor.query<TRow>(this.query)).then(onfulfilled, onrejected);
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<QueryResult<TRow> | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<QueryResult<TRow>> {
    return Promise.resolve(this.then((value) => value)).finally(onfinally ?? undefined);
  }
}

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

export function bindSyncSql(executor: SyncExecutor): SyncSqlTag {
  const boundSql = <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ) => new SyncBoundQuery<TRow>(executor, sql(strings, ...values));

  boundSql.exec = <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ) => executor.query<TRow>(sql(strings, ...values));

  return boundSql;
}

export function bindAsyncSql(executor: AsyncExecutor): AsyncSqlTag {
  const boundSql = <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ) => new AsyncBoundQuery<TRow>(executor, sql(strings, ...values));

  boundSql.exec = <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ) => executor.query<TRow>(sql(strings, ...values));

  return boundSql;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
