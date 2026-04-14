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
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';

import {migrationNickname} from 'sqlfu/naming';
import type {QueryCatalog, QueryCatalogEntry} from 'sqlfu/experimental';
import type {
  QueryFileMutationResponse,
  QueryExecutionResponse,
  SaveSqlResponse,
  SchemaCheckResponse,
  SqlAnalysisResponse,
  SqlEditorDiagnostic,
  SqlRunnerResponse,
  StudioRelation,
  StudioSchemaResponse,
  TableRowsResponse,
} from './shared.js';
import {SqlCodeMirror} from './sql-codemirror.js';

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
  const schemaCheckQuery = useSuspenseQuery({
    queryKey: ['schema-check'],
    queryFn: () => fetchJson<SchemaCheckResponse>('/api/schema/check'),
  });

  const selectedTable = selectTable(route, schemaQuery.data.relations);
  const selectedQuery = selectQuery(route, catalogQuery.data.queries);

  return (
    <Shell>
      <aside className="sidebar">
        <div className="sidebar-block">
          <h1>sqlfu/ui</h1>
          <p className="lede">{schemaQuery.data.projectRoot}</p>
        </div>

        <nav className="sidebar-block">
          <div className="section-title">Tools</div>
          <a className={route.kind === 'schema' ? 'nav-link active' : 'nav-link'} href="#schema">
            Schema
          </a>
          <a className={route.kind === 'sql' ? 'nav-link active' : 'nav-link'} href="#sql">
            SQL runner
          </a>
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
        {route.kind === 'schema' ? (
          <SchemaPanel
            projectRoot={schemaQuery.data.projectRoot}
            check={schemaCheckQuery.data}
          />
        ) : route.kind === 'sql' ? (
          <SqlRunnerPanel relations={schemaQuery.data.relations} />
        ) : route.kind === 'query' && selectedQuery ? (
          <QueryPanel entry={selectedQuery} relations={schemaQuery.data.relations} />
        ) : selectedTable ? (
          <TablePanel relation={selectedTable} page={route.kind === 'table' ? route.page : 0} />
        ) : (
          <EmptyState />
        )}
      </main>
    </Shell>
  );
}

function SchemaPanel(input: {
  projectRoot: string;
  check: SchemaCheckResponse;
}) {
  const runCommandMutation = useMutation({
    mutationFn: (body: {command: string}) =>
      postJson<{ok: true}>('/api/schema/command', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['schema-check']});
    },
  });

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>Schema</h2>
          <p className="muted">{input.projectRoot}</p>
        </div>
      </header>

      <div className="stack">
        {input.check.cards.map((card) => (
          <section key={card.key} className={`card schema-card ${card.ok ? 'ok' : 'warn'}`}>
            <div className="card-title">{card.ok ? card.okTitle : card.title}</div>
            {!card.ok ? <p>{card.summary}</p> : null}
            {!card.ok && card.recommendation ? <p className="muted">{card.recommendation}</p> : null}
            {!card.ok && card.commands && card.commands.length > 0 ? (
              <div className="actions">
                {card.commands.map((command) => (
                  <button
                    key={command}
                    className="button"
                    type="button"
                    aria-label={command}
                    onClick={() => {
                      if (!window.confirm(`Run ${command}?`)) {
                        return;
                      }
                      runCommandMutation.mutate({command});
                    }}
                  >
                    {command}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </section>
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

function SqlRunnerPanel(input: {
  relations: readonly StudioRelation[];
}) {
  const [draft, setDraft] = useLocalStorageState<SqlRunnerDraft>('sqlfu-ui/sql-runner-draft', {
    defaultValue: {
      sql: `select name, type\nfrom sqlite_schema\nwhere name not like 'sqlite_%'\norder by type, name;`,
      params: {},
    },
  });
  const analysisQuery = useQuery({
    queryKey: ['sql-analysis', draft.sql],
    queryFn: () => postJson<SqlAnalysisResponse>('/api/sql/analyze', {sql: draft.sql}),
    placeholderData: (previousData) => previousData,
    enabled: draft.sql.trim().length > 0,
  });
  const detectedParamsSchema = (analysisQuery.data?.paramsSchema as RJSFSchema | undefined) ?? buildSqlRunnerParamsSchema(draft.sql);
  const sanitizedParams = sanitizeFormData(draft.params, detectedParamsSchema);
  const runMutation = useMutation({
    mutationFn: (body: {sql: string; params?: unknown}) =>
      postJson<SqlRunnerResponse>('/api/sql', body),
  });
  const saveMutation = useMutation({
    mutationFn: (body: {name: string; sql: string}) =>
      postJson<SaveSqlResponse>('/api/sql/save', body),
  });
  const handleSave = async () => {
    const suggestedName = slugifyPromptName(migrationNickname(draft.sql));
    const providedName = window.prompt('Save query as', suggestedName);
    if (providedName == null) {
      return;
    }

    const name = slugifyPromptName(providedName);
    if (!name) {
      return;
    }

    const result = await saveMutation.mutateAsync({name, sql: draft.sql});
    await queryClient.fetchQuery({
      queryKey: ['catalog'],
      queryFn: () => fetchJson<QueryCatalog>('/api/catalog'),
    });
    const queryId = result.savedPath.split('/').pop()?.replace(/\.sql$/, '');
    if (!queryId) {
      throw new Error(`Could not derive query id from saved path: ${result.savedPath}`);
    }
    window.location.hash = `#query/${encodeURIComponent(queryId)}`;
  };

  return (
    <QueryWorkbench
      title="SQL runner"
      sql={draft.sql}
      editable
      workbenchKey={`sql:${draft.sql}`}
      sqlEditorRelations={input.relations}
      sqlEditorDiagnostics={analysisQuery.data?.diagnostics}
      sqlEditorOnExecute={() => runMutation.mutate({sql: draft.sql, params: sanitizedParams})}
      paramsSchema={omitSchemaTitle(detectedParamsSchema)}
      paramsData={sanitizedParams}
      onSqlChange={(sql) => setDraft({...draft, sql})}
      onParamsChange={(params) => setDraft({...draft, params: sanitizeFormData(params, detectedParamsSchema)})}
      onRun={() => runMutation.mutate({sql: draft.sql, params: sanitizedParams})}
      onSave={handleSave}
      running={runMutation.isPending || saveMutation.isPending}
      executionError={runMutation.error ?? saveMutation.error}
      executionResult={runMutation.data}
      successMessage={saveMutation.data ? `Saved as ${saveMutation.data.savedPath}` : undefined}
      emptyMessage="Submit SQL to inspect rows or metadata."
      runLabel="Run SQL"
      saveLabel="Save query"
      paramsCardTitle="Params"
    />
  );
}

function QueryPanel(input: {
  entry: QueryCatalogEntry;
  relations: readonly StudioRelation[];
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

  const entry = input.entry;

  const mutation = useMutation({
    mutationFn: (body: {data?: unknown; params?: unknown}) =>
      postJson<QueryExecutionResponse>(`/api/query/${encodeURIComponent(entry.id)}`, body),
  });
  const [renameDraft, setRenameDraft] = useLocalStorageState(`sqlfu-ui/query-rename/${entry.id}`, {
    defaultValue: entry.id,
  });
  const [sqlDraft, setSqlDraft] = useLocalStorageState(`sqlfu-ui/query-sql/${entry.id}`, {
    defaultValue: entry.sql,
  });
  const [renameMode, setRenameMode] = useLocalStorageState(`sqlfu-ui/query-rename-mode/${entry.id}`, {
    defaultValue: false,
  });
  const [sqlEditMode, setSqlEditMode] = useLocalStorageState(`sqlfu-ui/query-sql-edit-mode/${entry.id}`, {
    defaultValue: false,
  });
  const renameMutation = useMutation({
    mutationFn: (body: {name: string}) =>
      fetchJson<QueryFileMutationResponse>(`/api/query/${encodeURIComponent(entry.id)}`, {
        method: 'PATCH',
        body,
      }),
  });
  const updateMutation = useMutation({
    mutationFn: (body: {sql: string}) =>
      fetchJson<QueryFileMutationResponse>(`/api/query/${encodeURIComponent(entry.id)}`, {
        method: 'PUT',
        body,
      }),
  });
  const deleteMutation = useMutation({
    mutationFn: () =>
      fetchJson<QueryFileMutationResponse>(`/api/query/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      }),
  });
  const analysisQuery = useQuery({
    queryKey: ['query-sql-analysis', entry.id, sqlDraft],
    queryFn: () => postJson<SqlAnalysisResponse>('/api/sql/analyze', {sql: sqlDraft}),
    placeholderData: (previousData) => previousData,
    enabled: sqlEditMode && sqlDraft.trim().length > 0,
  });
  const handleRename = async () => {
    const result = await renameMutation.mutateAsync({name: renameDraft});
    setRenameMode(false);
    await queryClient.fetchQuery({
      queryKey: ['catalog'],
      queryFn: () => fetchJson<QueryCatalog>('/api/catalog'),
    });
    window.location.hash = `#query/${encodeURIComponent(result.id)}`;
  };
  const handleSqlSave = async () => {
    const result = await updateMutation.mutateAsync({sql: sqlDraft});
    setSqlEditMode(false);
    await queryClient.fetchQuery({
      queryKey: ['catalog'],
      queryFn: () => fetchJson<QueryCatalog>('/api/catalog'),
    });
    window.location.hash = `#query/${encodeURIComponent(result.id)}`;
  };
  const handleDelete = async () => {
    if (!window.confirm(`Delete query "${entry.id}"?`)) {
      return;
    }
    await deleteMutation.mutateAsync();
    const catalog = await queryClient.fetchQuery({
      queryKey: ['catalog'],
      queryFn: () => fetchJson<QueryCatalog>('/api/catalog'),
    });
    const nextQuery = catalog.queries.find((entry) => entry.kind === 'query');
    window.location.hash = nextQuery ? `#query/${encodeURIComponent(nextQuery.id)}` : '#sql';
  };

  return (
    <QueryWorkbench
      workbenchKey={entry.id}
      title={renameMode ? renameDraft : entry.id}
      titleEditor={renameMode ? (
        <div className="inline-editor">
          <input
            aria-label="Query title"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.currentTarget.value)}
          />
          <button className="button primary" type="button" aria-label="Confirm query rename" onClick={handleRename}>
            Save
          </button>
          <button className="button" type="button" onClick={() => {
            setRenameDraft(entry.id);
            setRenameMode(false);
          }}>
            Cancel
          </button>
        </div>
      ) : undefined}
      titleActions={!renameMode ? (
        <>
          <button className="icon-button" type="button" aria-label="Rename query" onClick={() => setRenameMode(true)}>
            ✎
          </button>
          <button className="icon-button danger" type="button" aria-label="Delete query" onClick={handleDelete}>
            🗑
          </button>
        </>
      ) : undefined}
      sql={sqlEditMode ? sqlDraft : entry.sql}
      paramsSchema={buildExecutionSchema(entry)}
      paramsData={undefined}
      sqlEditorRelations={input.relations}
      sqlEditorDiagnostics={sqlEditMode ? analysisQuery.data?.diagnostics : undefined}
      sqlReadonlyActions={!sqlEditMode ? (
        <button className="icon-button" type="button" aria-label="Edit query SQL" onClick={() => setSqlEditMode(true)}>
          ✎
        </button>
      ) : undefined}
      sqlEditorLabel="Query SQL editor"
      sqlEditorActions={sqlEditMode ? (
        <div className="actions">
          <button className="button primary" type="button" aria-label="Confirm query SQL edit" onClick={handleSqlSave}>
            Save
          </button>
          <button className="button" type="button" onClick={() => {
            setSqlDraft(entry.sql);
            setSqlEditMode(false);
          }}>
            Cancel
          </button>
        </div>
      ) : undefined}
      editable={sqlEditMode}
      onSqlChange={setSqlDraft}
      readonlyMeta={
        <>
          <span className="pill">{entry.queryType.toLowerCase()}</span>
          <span className="pill">{input.entry.resultMode}</span>
          <span className="pill">{entry.sqlFile}</span>
        </>
      }
      onRun={(formData) =>
        mutation.mutate({
          data: isRecord(formData) && isRecord(formData.data) ? formData.data : undefined,
          params: isRecord(formData) && isRecord(formData.params) ? formData.params : undefined,
        })}
      running={mutation.isPending || renameMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
      executionError={mutation.error ?? renameMutation.error ?? updateMutation.error ?? deleteMutation.error}
      executionResult={mutation.data}
      emptyMessage="Submit form data to execute the query."
      runLabel="Run generated query"
      paramsCardTitle="Params"
    />
  );
}

function QueryWorkbench(input: {
  workbenchKey?: string;
  title: string;
  titleEditor?: ReactNode;
  titleActions?: ReactNode;
  sql: string;
  editable?: boolean;
  sqlEditorRelations?: readonly StudioRelation[];
  sqlEditorDiagnostics?: readonly SqlEditorDiagnostic[];
  sqlEditorOnExecute?: (value: string) => void;
  paramsSchema?: RJSFSchema;
  paramsData?: Record<string, unknown>;
  readonlyMeta?: ReactNode;
  sqlReadonlyActions?: ReactNode;
  sqlEditorLabel?: string;
  sqlEditorActions?: ReactNode;
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
  sqlCardTitle?: string;
  paramsCardTitle?: string;
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          {input.titleEditor ?? <h2>{input.title}</h2>}
        </div>
        <div className="panel-header-actions">
          {input.readonlyMeta ? <div className="pill-row">{input.readonlyMeta}</div> : null}
          {input.titleActions ? <div className="pill-row">{input.titleActions}</div> : null}
        </div>
      </header>

      <div className="split-grid">
        <section className="card">
          {input.sqlCardTitle || input.sqlReadonlyActions ? (
            <div className="card-title-row">
              {input.sqlCardTitle ? <div className="card-title">{input.sqlCardTitle}</div> : <div />}
              {input.sqlReadonlyActions}
            </div>
          ) : null}
          {input.editable ? (
            <div className="stack">
              <label className="form-label">
                <SqlCodeMirror
                  value={input.sql}
                  ariaLabel={input.sqlEditorLabel ?? 'SQL editor'}
                  relations={input.sqlEditorRelations ?? []}
                  diagnostics={input.sqlEditorDiagnostics}
                  onExecute={input.sqlEditorOnExecute}
                  onChange={(value) => input.onSqlChange?.(value)}
                />
              </label>
              {input.sqlEditorActions}
            </div>
          ) : (
            <pre className="code-block">{input.sql}</pre>
          )}
        </section>

        <section className="card">
          <div className="card-title">{input.paramsCardTitle ?? 'Params'}</div>
          <div className="form-stack">
            {input.paramsSchema ? (
              <Form
                key={input.workbenchKey}
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
  if (kind === 'schema') {
    return {kind: 'schema'};
  }
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

function omitSchemaTitle(schema: RJSFSchema | undefined): RJSFSchema | undefined {
  if (!schema) {
    return undefined;
  }

  return {
    ...schema,
    title: undefined,
  };
}

function sanitizeFormData(
  formData: Record<string, unknown> | undefined,
  schema: RJSFSchema | undefined,
): Record<string, unknown> {
  if (!formData || !schema || !isRecord(schema.properties)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(formData).filter(([key]) => key in schema.properties!),
  );
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
  readonly sql: string;
  readonly params: Record<string, unknown>;
};

function slugifyPromptName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchJson<TValue>(
  url: string,
  input?: {
    method: string;
    body?: unknown;
  },
): Promise<TValue> {
  const response = await fetch(url, {
    method: input?.method,
    headers: input?.body === undefined ? undefined : {
      'content-type': 'application/json',
    },
    body: input?.body === undefined ? undefined : JSON.stringify(input.body),
  });
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
    readonly kind: 'schema';
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
