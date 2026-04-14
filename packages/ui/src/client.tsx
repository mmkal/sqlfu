import {Suspense, useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import Form from '@rjsf/core';
import type {RJSFSchema} from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import useLocalStorageState from 'use-local-storage-state';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';

import type {QueryCatalog, QueryCatalogEntry} from 'sqlfu/experimental';
import type {
  QueryExecutionResponse,
  SaveSqlResponse,
  SqlRunnerResponse,
  StudioRelation,
  StudioSchemaResponse,
  TableRowsResponse,
} from './shared.js';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<Shell loading />}>
        <Studio />
      </Suspense>
    </QueryClientProvider>
  );
}

function Studio() {
  const route = useHashRoute();
  const schemaQuery = useSuspenseQuery({
    queryKey: ['schema'],
    queryFn: () => fetchJson<StudioSchemaResponse>('/api/schema'),
  });
  const catalogQuery = useSuspenseQuery({
    queryKey: ['catalog'],
    queryFn: () => fetchJson<QueryCatalog>('/api/catalog'),
  });

  const selectedTable = selectTable(route, schemaQuery.data.relations);
  const selectedQuery = selectQuery(route, catalogQuery.data.queries);

  return (
    <Shell>
      <aside className="sidebar">
        <div className="sidebar-block">
          <div className="eyebrow">Explorer</div>
          <h1>sqlfu/ui</h1>
          <p className="lede">SQLite browsing, ad hoc SQL, and generated query forms from the current `sqlfu` project.</p>
        </div>

        <nav className="sidebar-block">
          <div className="section-title">Tools</div>
          <a className={route.kind === 'sql' ? 'nav-link active' : 'nav-link'} href="#sql">
            SQL runner
          </a>
          {catalogQuery.data.queries.length > 0 ? (
            <a className={route.kind === 'query' ? 'nav-link active' : 'nav-link'} href={`#query/${selectedQuery?.id ?? catalogQuery.data.queries[0]!.id}`}>
              Generated queries
            </a>
          ) : null}
        </nav>

        <nav className="sidebar-block">
          <div className="section-title">Relations</div>
          {schemaQuery.data.relations.map((relation: StudioRelation) => (
            <a
              key={relation.name}
              className={selectedTable?.name === relation.name && route.kind !== 'query' && route.kind !== 'sql' ? 'nav-link active' : 'nav-link'}
              href={`#table/${encodeURIComponent(relation.name)}`}
            >
              <span>{relation.name}</span>
              <small>{relation.kind}</small>
            </a>
          ))}
        </nav>

        <nav className="sidebar-block">
          <div className="section-title">Queries</div>
          {catalogQuery.data.queries.map((query) => (
            <a
              key={query.id}
              className={selectedQuery?.id === query.id ? 'nav-link active' : 'nav-link'}
              href={`#query/${encodeURIComponent(query.id)}`}
            >
              <span>{query.id}</span>
              <small>{query.kind === 'query' ? query.queryType.toLowerCase() : 'error'}</small>
            </a>
          ))}
        </nav>
      </aside>

      <main className="main">
        {route.kind === 'sql' ? (
          <SqlRunnerPanel />
        ) : route.kind === 'query' && selectedQuery ? (
          <QueryPanel entry={selectedQuery} />
        ) : selectedTable ? (
          <TablePanel relation={selectedTable} page={route.kind === 'table' ? route.page : 0} />
        ) : (
          <EmptyState />
        )}
      </main>
    </Shell>
  );
}

function TablePanel(input: {
  relation: StudioRelation;
  page: number;
}) {
  const rowsQuery = useSuspenseQuery({
    queryKey: ['table', input.relation.name, input.page],
    queryFn: () => fetchJson<TableRowsResponse>(`/api/table/${encodeURIComponent(input.relation.name)}?page=${input.page}`),
  });

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <div className="eyebrow">{input.relation.kind}</div>
          <h2>{input.relation.name}</h2>
        </div>
        <div className="pill-row">
          <span className="pill">{input.relation.columns.length} columns</span>
          {typeof input.relation.rowCount === 'number' ? <span className="pill">{input.relation.rowCount} rows</span> : null}
        </div>
      </header>

      <div className="split-grid">
        <section className="card">
          <div className="card-title">Columns</div>
          <div className="column-list">
            {input.relation.columns.map((column) => (
              <div key={column.name} className="column-item">
                <strong>{column.name}</strong>
                <span>{column.type || 'untyped'}</span>
                <small>{column.primaryKey ? 'pk' : column.notNull ? 'not null' : 'nullable'}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-title">Sample rows</div>
          <DataTable columns={rowsQuery.data.columns} rows={rowsQuery.data.rows} />
          <div className="pager">
            <a className={input.page === 0 ? 'button disabled' : 'button'} href={`#table/${encodeURIComponent(input.relation.name)}/${Math.max(0, input.page - 1)}`}>
              Previous
            </a>
            <span>Page {input.page + 1}</span>
            <a className="button" href={`#table/${encodeURIComponent(input.relation.name)}/${input.page + 1}`}>
              Next
            </a>
          </div>
        </section>
      </div>

      {input.relation.sql ? (
        <section className="card">
          <div className="card-title">Definition</div>
          <pre className="code-block">{input.relation.sql}</pre>
        </section>
      ) : null}
    </section>
  );
}

function SqlRunnerPanel() {
  const [draft, setDraft] = useLocalStorageState<SqlRunnerDraft>('sqlfu-ui/sql-runner-draft', {
    defaultValue: {
      name: 'scratch-query',
      sql: `select name, type\nfrom sqlite_schema\nwhere name not like 'sqlite_%'\norder by type, name;`,
      params: {},
    },
  });
  const detectedParamsSchema = buildSqlRunnerParamsSchema(draft.sql);
  const runMutation = useMutation({
    mutationFn: (body: {sql: string; params?: unknown}) =>
      postJson<SqlRunnerResponse>('/api/sql', body),
  });
  const saveMutation = useMutation({
    mutationFn: (body: {name: string; sql: string}) =>
      postJson<SaveSqlResponse>('/api/sql/save', body),
  });

  return (
    <QueryWorkbench
      eyebrow="Tool"
      title="SQL runner"
      sql={draft.sql}
      editable
      queryName={draft.name}
      paramsSchema={detectedParamsSchema}
      paramsData={draft.params}
      onQueryNameChange={(name) => setDraft({...draft, name})}
      onSqlChange={(sql) => setDraft({...draft, sql})}
      onParamsChange={(params) => setDraft({...draft, params})}
      onRun={() => runMutation.mutate({sql: draft.sql, params: draft.params})}
      onSave={() => saveMutation.mutate({name: draft.name, sql: draft.sql})}
      running={runMutation.isPending || saveMutation.isPending}
      executionError={runMutation.error ?? saveMutation.error}
      executionResult={runMutation.data}
      successMessage={saveMutation.data ? `Saved as ${saveMutation.data.savedPath}` : undefined}
      emptyMessage="Submit SQL to inspect rows or metadata."
      runLabel="Run SQL"
      saveLabel="Save query"
    />
  );
}

function QueryPanel(input: {
  entry: QueryCatalogEntry;
}) {
  if (input.entry.kind === 'error') {
    return (
      <section className="panel">
        <header className="panel-header">
          <div>
            <div className="eyebrow">Generated query</div>
            <h2>{input.entry.id}</h2>
          </div>
        </header>
        <section className="card">
          <div className="card-title">Query error</div>
          <p>{input.entry.error.name}</p>
          <pre className="code-block">{input.entry.error.description}</pre>
        </section>
      </section>
    );
  }

  const mutation = useMutation({
    mutationFn: (body: {data?: unknown; params?: unknown}) =>
      postJson<QueryExecutionResponse>(`/api/query/${encodeURIComponent(input.entry.id)}`, body),
  });

  return (
    <QueryWorkbench
      eyebrow={input.entry.queryType.toLowerCase()}
      title={input.entry.id}
      sql={input.entry.sql}
      paramsSchema={buildExecutionSchema(input.entry)}
      paramsData={undefined}
      readonlyMeta={
        <>
          <span className="pill">{input.entry.resultMode}</span>
          <span className="pill">{input.entry.sqlFile}</span>
        </>
      }
      onRun={(formData) =>
        mutation.mutate({
          data: isRecord(formData) && isRecord(formData.data) ? formData.data : undefined,
          params: isRecord(formData) && isRecord(formData.params) ? formData.params : undefined,
        })}
      running={mutation.isPending}
      executionError={mutation.error}
      executionResult={mutation.data}
      emptyMessage="Submit form data to execute the query."
      runLabel="Run generated query"
    />
  );
}

function QueryWorkbench(input: {
  eyebrow: string;
  title: string;
  sql: string;
  editable?: boolean;
  queryName?: string;
  paramsSchema?: RJSFSchema;
  paramsData?: Record<string, unknown>;
  readonlyMeta?: ReactNode;
  onQueryNameChange?: (value: string) => void;
  onSqlChange?: (value: string) => void;
  onParamsChange?: (value: Record<string, unknown>) => void;
  onRun: (formData?: unknown) => void;
  onSave?: () => void;
  running: boolean;
  executionError: unknown;
  executionResult?: QueryExecutionResponse | SqlRunnerResponse;
  successMessage?: string;
  emptyMessage: string;
  runLabel: string;
  saveLabel?: string;
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <div className="eyebrow">{input.eyebrow}</div>
          <h2>{input.title}</h2>
        </div>
        {input.readonlyMeta ? <div className="pill-row">{input.readonlyMeta}</div> : null}
      </header>

      <div className="split-grid">
        <section className="card">
          <div className="card-title">SQL</div>
          {input.editable ? (
            <div className="stack">
              <label className="form-label">
                <span>Query name</span>
                <input
                  aria-label="Query name"
                  value={input.queryName ?? ''}
                  onChange={(event) => input.onQueryNameChange?.(event.currentTarget.value)}
                />
              </label>
              <label className="form-label">
                <span>SQL editor</span>
                <textarea
                  className="sql-editor"
                  aria-label="SQL editor"
                  value={input.sql}
                  onChange={(event) => input.onSqlChange?.(event.currentTarget.value)}
                />
              </label>
            </div>
          ) : (
            <pre className="code-block">{input.sql}</pre>
          )}
        </section>

        <section className="card">
          <div className="card-title">Run query</div>
          <div className="form-stack">
            {input.paramsSchema ? (
              <Form
                schema={input.paramsSchema}
                formData={input.paramsData}
                validator={validator}
                onChange={({formData}) => input.onParamsChange?.(isRecord(formData) ? formData : {})}
                onSubmit={({formData}) => input.onRun(formData)}
              >
                <div className="actions">
                  <button className="button primary" type="submit">
                    {input.runLabel}
                  </button>
                  {input.onSave ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() => input.onSave?.()}
                    >
                      {input.saveLabel}
                    </button>
                  ) : null}
                </div>
              </Form>
            ) : (
              <div className="actions">
                <button className="button primary" type="button" onClick={() => input.onRun(undefined)}>
                  {input.runLabel}
                </button>
                {input.onSave ? (
                  <button className="button" type="button" onClick={() => input.onSave?.()}>
                    {input.saveLabel}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-title">Result</div>
        {input.running ? <p>Running…</p> : null}
        {input.executionError ? <ErrorView error={input.executionError} /> : null}
        {input.successMessage ? <p>{input.successMessage}</p> : null}
        {input.executionResult ? <ExecutionResult result={input.executionResult} /> : <p className="muted">{input.emptyMessage}</p>}
      </section>
    </section>
  );
}

function ExecutionResult(input: {
  result: QueryExecutionResponse | SqlRunnerResponse;
}) {
  if (input.result.mode === 'metadata') {
    return <pre className="code-block">{JSON.stringify(input.result.metadata, null, 2)}</pre>;
  }

  const rows = input.result.rows ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return <DataTable columns={columns} rows={rows} />;
}

function DataTable(input: {
  columns: readonly string[];
  rows: readonly Record<string, unknown>[];
}) {
  if (input.rows.length === 0) {
    return <p className="muted">No rows.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {input.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {input.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {input.columns.map((column) => (
                <td key={column}>{renderCell(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="panel">
      <section className="card">
        <div className="card-title">No relations found</div>
        <p className="muted">Create `definitions.sql`, run migrations or sync, and add `.sql` files to start exploring.</p>
      </section>
    </section>
  );
}

function Shell(input: {
  children?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="app-shell">
      {input.loading ? (
        <main className="main">
          <section className="panel">
            <section className="card">
              <div className="card-title">Loading</div>
            </section>
          </section>
        </main>
      ) : (
        input.children
      )}
    </div>
  );
}

function ErrorView(input: {
  error: unknown;
}) {
  return <pre className="code-block error">{String(input.error)}</pre>;
}

function renderCell(value: unknown) {
  if (value == null) {
    return <span className="muted">null</span>;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function useHashRoute(): Route {
  const hash = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('hashchange', onStoreChange);
      return () => window.removeEventListener('hashchange', onStoreChange);
    },
    () => window.location.hash,
    () => '',
  );
  return parseHash(hash);
}

function parseHash(hash: string): Route {
  const value = hash.replace(/^#/, '');
  if (!value) {
    return {kind: 'home'};
  }

  const [kind, first, second] = value.split('/').map(decodeURIComponent);
  if (kind === 'sql') {
    return {kind: 'sql'};
  }
  if (kind === 'table' && first) {
    return {kind: 'table', name: first, page: Number(second ?? '0') || 0};
  }
  if (kind === 'query' && first) {
    return {kind: 'query', id: first};
  }
  return {kind: 'home'};
}

function selectTable(route: Route, relations: readonly StudioRelation[]) {
  if (route.kind === 'table') {
    return relations.find((relation) => relation.name === route.name) ?? relations[0];
  }
  return relations[0];
}

function selectQuery(route: Route, queries: readonly QueryCatalogEntry[]) {
  if (route.kind === 'query') {
    return queries.find((query) => query.id === route.id) ?? queries[0];
  }
  return queries[0];
}

function buildExecutionSchema(entry: Extract<QueryCatalogEntry, {kind: 'query'}>): RJSFSchema {
  const properties: Record<string, RJSFSchema> = {};
  const required: string[] = [];

  if (entry.dataSchema) {
    properties.data = entry.dataSchema as RJSFSchema;
    required.push('data');
  }
  if (entry.paramsSchema) {
    properties.params = entry.paramsSchema as RJSFSchema;
    required.push('params');
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function buildSqlRunnerParamsSchema(sql: string): RJSFSchema | undefined {
  const parameterNames = [...detectNamedParameters(sql)];
  if (parameterNames.length === 0) {
    return undefined;
  }

  return {
    type: 'object',
    properties: Object.fromEntries(parameterNames.map((name) => [name, {type: 'string', title: name}])),
    required: parameterNames,
    additionalProperties: false,
  };
}

function detectNamedParameters(sql: string) {
  const matches = sql.matchAll(/(^|[^\w])[:@$]([A-Za-z_][A-Za-z0-9_]*)/g);
  const names = new Set<string>();
  for (const match of matches) {
    names.add(match[2]!);
  }
  return names;
}

type SqlRunnerDraft = {
  readonly name: string;
  readonly sql: string;
  readonly params: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchJson<TValue>(url: string): Promise<TValue> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<TValue>;
}

async function postJson<TValue>(url: string, body: unknown): Promise<TValue> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<TValue>;
}

type Route =
  | {
    readonly kind: 'home';
  }
  | {
    readonly kind: 'sql';
  }
  | {
    readonly kind: 'table';
    readonly name: string;
    readonly page: number;
  }
  | {
    readonly kind: 'query';
    readonly id: string;
  };

createRoot(document.getElementById('root')!).render(<App />);
