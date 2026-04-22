import type {
  AsyncClient,
  AsyncSqlTag,
  QueryArg,
  ResultRow,
  RunResult,
  SqlFragment,
  SqlQuery,
  SqlRowsPromise,
  SqlValue,
  SyncClient,
  SyncSqlTag,
} from './types.js';

const emptyFragment: SqlFragment = {sql: '', args: []};

export class AsyncBoundRows<TRow extends ResultRow> implements SqlRowsPromise<TRow> {
  query: SqlQuery;
  #client: AsyncClient;

  constructor(client: AsyncClient, query: SqlQuery) {
    this.#client = client;
    this.query = query;
  }

  then<TResult1 = TRow[], TResult2 = never>(
    onfulfilled?: ((value: TRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      return Promise.resolve(this.#client.all<TRow>(this.query)).then(onfulfilled, onrejected);
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TRow[] | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<TRow[]> {
    return Promise.resolve(this.then((value) => value)).finally(onfinally ?? undefined);
  }
}

export class SyncBoundRows<TRow extends ResultRow> implements SqlRowsPromise<TRow> {
  query: SqlQuery;
  #client: SyncClient;

  constructor(client: SyncClient, query: SqlQuery) {
    this.#client = client;
    this.query = query;
  }

  then<TResult1 = TRow[], TResult2 = never>(
    onfulfilled?: ((value: TRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      return Promise.resolve(this.#client.all<TRow>(this.query)).then(onfulfilled, onrejected);
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TRow[] | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<TRow[]> {
    return Promise.resolve(this.then((value) => value)).finally(onfinally ?? undefined);
  }
}

export function isSqlFragment(value: unknown): value is SqlFragment {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'sql' in value &&
    'args' in value &&
    Array.isArray((value as SqlFragment).args),
  );
}

export function sql(strings: TemplateStringsArray, ...values: SqlValue[]): SqlQuery {
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

export function join(values: SqlValue[], separator = ', '): SqlFragment {
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

export function bindSyncSql(client: SyncClient): SyncSqlTag {
  const boundSql = <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ) => new SyncBoundRows<TRow>(client, sql(strings, ...values));

  boundSql.all = <TRow extends ResultRow = ResultRow>(strings: TemplateStringsArray, ...values: SqlValue[]) =>
    client.all<TRow>(sql(strings, ...values));

  boundSql.run = (strings: TemplateStringsArray, ...values: SqlValue[]): RunResult =>
    client.run(sql(strings, ...values));

  return boundSql;
}

export function bindAsyncSql(client: AsyncClient): AsyncSqlTag {
  const boundSql = <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ) => new AsyncBoundRows<TRow>(client, sql(strings, ...values));

  boundSql.all = <TRow extends ResultRow = ResultRow>(strings: TemplateStringsArray, ...values: SqlValue[]) =>
    client.all<TRow>(sql(strings, ...values));

  boundSql.run = (strings: TemplateStringsArray, ...values: SqlValue[]): Promise<RunResult> =>
    client.run(sql(strings, ...values));

  return boundSql;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
