import {Suspense, useRef, useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import * as reactGrid from '@silevis/reactgrid';
import Form from '@rjsf/core';
import type {RJSFSchema} from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import {duration} from 'itty-time';
import useLocalStorageState from 'use-local-storage-state';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';

import {queryNickname} from 'sqlfu/naming';
import type {QueryCatalog, QueryCatalogEntry} from 'sqlfu/experimental';
import type {
  MigrationResultantSchemaResponse,
  QueryFileMutationResponse,
  QueryExecutionResponse,
  SaveSqlResponse,
  SchemaAuthorityMigration,
  SchemaAuthoritiesResponse,
  SchemaCheckResponse,
  SqlAnalysisResponse,
  SqlEditorDiagnostic,
  SqlRunnerResponse,
  StudioRelation,
  StudioSchemaResponse,
  TableRowsResponse,
} from './shared.js';
import {columnWidthAlgorithm} from './column-width.js';
import {SqlCodeMirror, TextCodeMirror, TextDiffCodeMirror} from './sql-codemirror.js';

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
  const schemaAuthoritiesQuery = useSuspenseQuery({
    queryKey: ['schema-authorities'],
    queryFn: () => fetchJson<SchemaAuthoritiesResponse>('/api/schema/authorities'),
  });

  const selectedTable = selectTable(route, schemaQuery.data.relations);
  const selectedQuery = selectQuery(route, catalogQuery.data.queries);

  return (
    <Shell>
      <aside className="sidebar">
        <div className="sidebar-block">
          <h1>sqlfu/ui</h1>
          <p className="lede">{schemaQuery.data.projectName}</p>
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
            projectName={schemaQuery.data.projectName}
            check={schemaCheckQuery.data}
            authorities={schemaAuthoritiesQuery.data}
          />
        ) : route.kind === 'sql' ? (
          <SqlRunnerPanel relations={schemaQuery.data.relations} />
        ) : route.kind === 'query' && selectedQuery ? (
          <QueryPanel entry={selectedQuery} relations={schemaQuery.data.relations} />
        ) : selectedTable ? (
          <TablePanel
            key={`${selectedTable.name}/${route.kind === 'table' ? route.page : 0}`}
            relation={selectedTable}
            page={route.kind === 'table' ? route.page : 0}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </Shell>
  );
}

function SchemaPanel(input: {
  projectName: string;
  check: SchemaCheckResponse;
  authorities: SchemaAuthoritiesResponse;
}) {
  const [commandErrors, setCommandErrors] = useLocalStorageState<Record<string, string>>(
    `sqlfu-ui/schema-command-errors/${input.projectName}`,
    {
      defaultValue: {},
    },
  );
  const [desiredSchemaDraft, setDesiredSchemaDraft] = useLocalStorageState(
    `sqlfu-ui/schema-desired/${input.projectName}`,
    {
      defaultValue: input.authorities.desiredSchemaSql,
    },
  );
  const runCommandMutation = useMutation({
    mutationFn: (body: {command: string}) =>
      postJson<{ok: true}>('/api/schema/command', body),
    onMutate: (variables) => {
      setCommandErrors((current) => {
        const next = {...(current ?? {})};
        delete next[variables.command];
        return next;
      });
    },
    onSuccess: async () => {
      setCommandErrors({});
      await Promise.all([
        queryClient.refetchQueries({queryKey: ['schema']}),
        queryClient.refetchQueries({queryKey: ['schema-check']}),
        queryClient.refetchQueries({queryKey: ['schema-authorities']}),
      ]);
    },
    onError: (error, variables) => {
      setCommandErrors((current) => ({
        ...(current ?? {}),
        [variables.command]: error instanceof Error ? error.message : String(error),
      }));
    },
  });
  const saveDesiredSchemaMutation = useMutation({
    mutationFn: (body: {sql: string}) =>
      fetchJson<{ok: true}>('/api/schema/definitions', {
        method: 'PUT',
        body,
      }),
    onSuccess: async (_, variables) => {
      setDesiredSchemaDraft(normalizeSqlDraft(variables.sql));
      await Promise.all([
        queryClient.refetchQueries({queryKey: ['schema-check']}),
        queryClient.refetchQueries({queryKey: ['schema-authorities']}),
      ]);
    },
  });
  const desiredSchemaSql = desiredSchemaDraft ?? input.authorities.desiredSchemaSql;
  const desiredSchemaDirty = normalizeSqlDraft(desiredSchemaSql) !== normalizeSqlDraft(input.authorities.desiredSchemaSql);
  const handleSchemaCommand = (command: string) => {
    if (!window.confirm(`Run ${command}?`)) {
      return;
    }
    runCommandMutation.mutate({command});
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>Schema</h2>
          <p className="muted">{input.projectName}</p>
        </div>
      </header>

      <div className="stack schema-cards">
        {input.check.cards.map((card) => (
          <section key={card.key} className={`card schema-card ${card.ok ? 'ok compact' : 'warn'}`}>
            <div className="card-title-row schema-card-title-row">
              <h3 className="card-title">{card.ok ? card.okTitle : card.title}</h3>
              {card.ok ? <span className="muted schema-card-explainer">{card.explainer}</span> : null}
            </div>
            {!card.ok ? <p>{card.summary}</p> : null}
            {!card.ok && card.recommendation ? <p className="muted">{card.recommendation}</p> : null}
            {!card.ok && card.commands && card.commands.length > 0 ? (
              <div className="actions">
                {card.commands.map((command) => (
                  <div key={command} className="schema-command">
                    <button
                      className="button"
                      type="button"
                      aria-label={command}
                      onClick={() => {
                        handleSchemaCommand(command);
                      }}
                    >
                      {command}
                    </button>
                    {commandErrors?.[command] ? (
                      <span className="schema-command-error">{commandErrors[command]}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <div className="authorities-grid">
        <details open className="card authority-card authority-desired">
          <summary className="authority-card-summary" role="button">
            <span className="card-title">Desired Schema</span>
            <span className="accordion-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="authority-card-body">
            <div className="card-title-row authority-card-toolbar">
              <div />
              {desiredSchemaDirty ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Save Desired Schema"
                  onClick={() => saveDesiredSchemaMutation.mutate({sql: desiredSchemaSql})}
                >
                  💾
                </button>
              ) : null}
            </div>
            <SqlCodeMirror
              value={desiredSchemaSql}
              ariaLabel="Desired Schema editor"
              relations={[]}
              onChange={setDesiredSchemaDraft}
            />
          </div>
        </details>

        <details open className="card authority-card authority-migrations">
          <summary className="authority-card-summary" role="button">
            <span className="card-title">Migrations</span>
            <span className="accordion-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="authority-card-body">
            {input.authorities.migrations.length === 0 ? (
              <p className="muted">No migrations.</p>
            ) : (
              <div className="stack">
                {input.authorities.migrations.map((migration) => (
                  <details key={migration.id} className="migration-item">
                    <summary role="button" className="migration-summary">
                      <span>{migration.name}</span>
                      <span className="migration-summary-right">
                        <span className={`pill ${migration.applied ? 'pill-ok' : ''}`}>
                          {migration.applied ? 'Applied' : 'Pending'}
                        </span>
                        <span className="accordion-chevron" aria-hidden="true">
                          ▾
                        </span>
                      </span>
                    </summary>
                    <MigrationDetail
                      migration={migration}
                      source="migrations"
                      storageKey={`schema/migrations/${migration.id}`}
                    />
                  </details>
                ))}
              </div>
            )}
          </div>
        </details>

        <details open className="card authority-card authority-history">
          <summary className="authority-card-summary" role="button">
            <span className="card-title">Migration History</span>
            <span className="accordion-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="authority-card-body">
            {input.authorities.migrationHistory.length === 0 ? (
              <p className="muted">No applied migrations.</p>
            ) : (
              <div className="stack">
                {input.authorities.migrationHistory.map((migration) => (
                  <details key={migration.id} className="migration-item">
                    <summary role="button" className="migration-summary">
                      <span>{migration.name}</span>
                      <span className="migration-summary-right">
                        <span className="muted">{formatAppliedAgo(migration.appliedAt)}</span>
                        {migration.integrity !== 'ok' ? <span className="pill pill-warn">⚠</span> : null}
                        <span className="accordion-chevron" aria-hidden="true">
                          ▾
                        </span>
                      </span>
                    </summary>
                    <MigrationDetail
                      migration={migration}
                      source="history"
                      storageKey={`schema/history/${migration.id}`}
                    />
                  </details>
                ))}
              </div>
            )}
          </div>
        </details>

        <details open className="card authority-card authority-live">
          <summary className="authority-card-summary" role="button">
            <span className="card-title">Live Schema</span>
            <span className="accordion-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="authority-card-body">
            <SqlCodeMirror
              value={input.authorities.liveSchemaSql}
              ariaLabel="Live Schema editor"
              relations={[]}
              onChange={() => {}}
              readOnly
            />
          </div>
        </details>
      </div>
    </section>
  );
}

function MigrationDetail(input: {
  migration: SchemaAuthorityMigration;
  source: 'migrations' | 'history';
  storageKey: string;
}) {
  const [activeTab, setActiveTab] = useLocalStorageState<'content' | 'metadata' | 'schema'>(
    `sqlfu-ui/migration-detail-tab/${input.storageKey}`,
    {
      defaultValue: 'content',
    },
  );
  const resultantSchemaQuery = useQuery({
    queryKey: ['migration-resultant-schema', input.source, input.migration.id],
    queryFn: () =>
      fetchJson<MigrationResultantSchemaResponse>(
        `/api/schema/authorities/resultant-schema?source=${encodeURIComponent(input.source)}&id=${encodeURIComponent(input.migration.id)}`,
      ),
    enabled: activeTab === 'schema',
  });
  const metadata = [
    `name: ${toYamlScalar(input.migration.name)}`,
    `filename: ${toYamlScalar(input.migration.fileName)}`,
    `applied_at: ${toYamlScalar(input.migration.appliedAt)}`,
    ...(input.migration.appliedAt ? [`integrity: ${toYamlScalar(input.migration.integrity ?? 'checksum mismatch')}`] : []),
  ].join('\n');

  return (
    <div className="migration-detail">
      <div className="migration-detail-tabs" role="tablist" aria-label="Migration detail tabs">
        <button
          className={activeTab === 'content' ? 'migration-detail-tab active' : 'migration-detail-tab'}
          type="button"
          role="tab"
          aria-selected={activeTab === 'content'}
          onClick={() => setActiveTab('content')}
        >
          Content
        </button>
        <button
          className={activeTab === 'metadata' ? 'migration-detail-tab active' : 'migration-detail-tab'}
          type="button"
          role="tab"
          aria-selected={activeTab === 'metadata'}
          onClick={() => setActiveTab('metadata')}
        >
          Metadata
        </button>
        <button
          className={activeTab === 'schema' ? 'migration-detail-tab active' : 'migration-detail-tab'}
          type="button"
          role="tab"
          aria-selected={activeTab === 'schema'}
          onClick={() => setActiveTab('schema')}
        >
          Resultant Schema
        </button>
      </div>

      {activeTab === 'content' ? (
        <SqlCodeMirror
          value={input.migration.content}
          ariaLabel="Migration content"
          relations={[]}
          onChange={() => {}}
          readOnly
        />
      ) : null}
      {activeTab === 'metadata' ? (
        <TextCodeMirror
          value={metadata}
          ariaLabel="Migration metadata"
          readOnly
          height="10rem"
          language="yaml"
        />
      ) : null}
      {activeTab === 'schema' ? (
        resultantSchemaQuery.data ? (
          <SqlCodeMirror
            value={resultantSchemaQuery.data.sql}
            ariaLabel="Migration resultant schema"
            relations={[]}
            onChange={() => {}}
            readOnly
          />
        ) : (
          <TextCodeMirror
            value={resultantSchemaQuery.isLoading ? 'Loading resultant schema…' : String(resultantSchemaQuery.error ?? '')}
            ariaLabel="Migration resultant schema"
            readOnly
            height="10rem"
          />
        )
      ) : null}
    </div>
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
  const [draftRows, setDraftRows] = useLocalStorageState<readonly Record<string, unknown>[]>(
    `sqlfu-ui/table-draft/${input.relation.name}/${input.page}`,
    {
      defaultValue: rowsQuery.data.rows,
    },
  );
  const saveRowsMutation = useMutation({
    mutationFn: (body: {
      originalRows: readonly Record<string, unknown>[];
      rows: readonly Record<string, unknown>[];
      rowKeys: TableRowsResponse['rowKeys'];
    }) =>
      fetchJson<TableRowsResponse>(`/api/table/${encodeURIComponent(input.relation.name)}?page=${input.page}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (response) => {
      setDraftRows(response.rows);
      queryClient.setQueryData(['table', input.relation.name, input.page], response);
    },
  });
  const displayedRows = normalizeStoredTableDraft(
    draftRows,
    rowsQuery.data.rows,
    rowsQuery.data.columns,
  );
  const rowsDirty = JSON.stringify(displayedRows) !== JSON.stringify(rowsQuery.data.rows);
  const handleDiscardRows = () => {
    setDraftRows(rowsQuery.data.rows);
  };
  const handleSaveRows = () => {
    saveRowsMutation.mutate({
      originalRows: rowsQuery.data.rows,
      rows: displayedRows,
      rowKeys: rowsQuery.data.rowKeys,
    });
  };

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

      <section className="card">
        <div className="card-title-row">
          <div className="card-title">Data</div>
          <div className="pill-row">
            <span className="pill">Page {input.page + 1}</span>
            {rowsQuery.data.editable && rowsDirty ? (
              <>
                <button
                  className="button primary"
                  type="button"
                  aria-label="Save changes"
                  disabled={saveRowsMutation.isPending}
                  onClick={handleSaveRows}
                >
                  {saveRowsMutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  className="button"
                  type="button"
                  aria-label="Discard changes"
                  disabled={saveRowsMutation.isPending}
                  onClick={handleDiscardRows}
                >
                  Discard changes
                </button>
              </>
            ) : null}
          </div>
        </div>
        <DataTable
          storageKey={`relation/${input.relation.name}`}
          columns={rowsQuery.data.columns}
          originalRows={rowsQuery.data.rows}
          rows={displayedRows}
          editable={rowsQuery.data.editable}
          editableColumns={Object.fromEntries(input.relation.columns.map((column) => [column.name, !column.primaryKey]))}
          onRowsChange={setDraftRows}
          showSelectedCellDetail
        />
        <div className="pager">
          <a className={input.page === 0 ? 'button disabled' : 'button'} href={`#table/${encodeURIComponent(input.relation.name)}/${Math.max(0, input.page - 1)}`}>
            Previous
          </a>
          <a className="button" href={`#table/${encodeURIComponent(input.relation.name)}/${input.page + 1}`}>
            Next
          </a>
        </div>
      </section>

      {input.relation.sql ? (
        <details className="card relation-details">
          <summary className="authority-card-summary" role="button">
            <span className="card-title relation-details-title">Definition</span>
            <span className="accordion-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="authority-card-body">
            <SqlCodeMirror
              value={input.relation.sql}
              ariaLabel="Relation definition editor"
              relations={[input.relation]}
              onChange={() => {}}
              readOnly
            />
          </div>
        </details>
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
    const suggestedName = slugifyPromptName(queryNickname(draft.sql));
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
      paramsSchema={entry.kind === 'query' ? buildExecutionSchema(entry) : undefined}
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
        entry.kind === 'query' ? (
          <>
            <span className="pill">{entry.queryType.toLowerCase()}</span>
            <span className="pill">{entry.resultMode}</span>
            <span className="pill">{entry.sqlFile}</span>
          </>
        ) : (
          <>
            <span className="pill">invalid sql</span>
            <span className="pill">{entry.sqlFile}</span>
          </>
        )
      }
      onRun={(formData) =>
        mutation.mutate({
          data: isRecord(formData) && isRecord(formData.data) ? formData.data : undefined,
          params: isRecord(formData) && isRecord(formData.params) ? formData.params : undefined,
        })}
      running={mutation.isPending || renameMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
      executionError={
        mutation.error
        ?? renameMutation.error
        ?? updateMutation.error
        ?? deleteMutation.error
        ?? (entry.kind === 'error' && !sqlEditMode ? new Error(`Query error\n${entry.error.name}\n\n${entry.error.description}`) : undefined)
      }
      executionResult={mutation.data}
      emptyMessage={entry.kind === 'query' ? 'Submit form data to execute the query.' : 'Edit the SQL to repair this saved query.'}
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
  return <DataTable storageKey="execution-result" columns={columns} rows={rows} />;
}

function DataTable(input: {
  storageKey: string;
  columns: readonly string[];
  originalRows?: readonly Record<string, unknown>[];
  rows: readonly Record<string, unknown>[];
  editable?: boolean;
  editableColumns?: Readonly<Record<string, boolean>>;
  onRowsChange?: (rows: readonly Record<string, unknown>[]) => void;
  showSelectedCellDetail?: boolean;
}) {
  if (input.rows.length === 0) {
    return <p className="muted">No rows.</p>;
  }

  const {ref: containerRef, width: containerWidth} = useElementWidth<HTMLDivElement>();
  const [columnWidthOverrides, setColumnWidthOverrides] = useLocalStorageState<Record<string, number>>(
    `sqlfu-ui/column-widths/${input.storageKey}`,
    {
      defaultValue: {},
    },
  );
  const [selectedCell, setSelectedCell] = useLocalStorageState<{rowId: number; columnId: string} | null>(
    `sqlfu-ui/selected-cell/${input.storageKey}`,
    {
      defaultValue: null,
    },
  );
  const [selectedCellMode, setSelectedCellMode] = useLocalStorageState<'diff' | 'original' | 'draft'>(
    `sqlfu-ui/selected-cell-mode/${input.storageKey}`,
    {
      defaultValue: 'diff',
    },
  );
  const computedColumnWidths = columnWidthAlgorithm({
    availableWidth: Math.max(0, containerWidth - 64),
    columns: input.columns.map((column) => ({
      key: column,
      header: column,
      cells: input.rows.map((row) => formatCellText(row[column])),
    })),
  });
  const gridColumns: reactGrid.Column[] = [
    {columnId: '__row__', width: 64, reorderable: false, resizable: false},
    ...computedColumnWidths.map((column) => ({
      columnId: column.key,
      width: columnWidthOverrides?.[column.key] ?? column.width,
      reorderable: false,
      resizable: true,
    })),
  ];
  const gridRows: reactGrid.Row<reactGrid.DefaultCellTypes>[] = [
    {
      rowId: 'header',
      cells: [
        {type: 'header', text: '#'},
        ...input.columns.map((column) => ({
          type: 'header' as const,
          text: column,
        })),
      ],
    },
    ...input.rows.map((row, rowIndex) => ({
      rowId: rowIndex,
      cells: [
        {type: 'header' as const, text: String(rowIndex + 1)},
        ...input.columns.map((column) =>
          toGridCell(
            row[column],
            Boolean(input.editable) && input.editableColumns?.[column] !== false,
            isSameValue(row[column], input.originalRows?.[rowIndex]?.[column]) ? undefined : 'dirty-cell',
          )),
      ],
    })),
  ];
  const selectedOriginalValue = selectedCell && typeof selectedCell.rowId === 'number' && typeof selectedCell.columnId === 'string'
    ? formatCellText(input.originalRows?.[selectedCell.rowId]?.[selectedCell.columnId])
    : '';
  const selectedDraftValue = selectedCell && typeof selectedCell.rowId === 'number' && typeof selectedCell.columnId === 'string'
    ? formatCellText(input.rows[selectedCell.rowId]?.[selectedCell.columnId])
    : '';
  const selectedCellDirty = selectedOriginalValue !== selectedDraftValue;

  return (
    <div className="stack">
      <div className="table-scroll" ref={containerRef}>
        <reactGrid.ReactGrid
          key={JSON.stringify(input.rows)}
          columns={gridColumns}
          rows={gridRows}
          stickyTopRows={1}
          stickyLeftColumns={1}
          enableRangeSelection
          enableColumnSelection
          enableRowSelection
          onColumnResized={(columnId, width) => {
            if (typeof columnId !== 'string') {
              return;
            }
            setColumnWidthOverrides((current) => ({
              ...(current ?? {}),
              [columnId]: width,
            }));
          }}
          onFocusLocationChanged={(location) => {
            if (typeof location.rowId !== 'number' || typeof location.columnId !== 'string') {
              return;
            }
            setSelectedCell({
              rowId: location.rowId,
              columnId: location.columnId,
            });
            setSelectedCellMode('diff');
          }}
          onCellsChanged={input.editable ? (changes) => {
            const nextRows = input.rows.map((row) => ({...row}));
            for (const change of changes) {
              if (typeof change.rowId !== 'number' || typeof change.columnId !== 'string') {
                continue;
              }
              const nextRow = nextRows[change.rowId];
              if (!nextRow) {
                continue;
              }
              if (input.editableColumns?.[change.columnId] === false) {
                continue;
              }
              nextRow[change.columnId] = readGridCellValue(change.newCell);
            }
            input.onRowsChange?.(nextRows);
          } : undefined}
        />
      </div>

      {input.showSelectedCellDetail && selectedCell && typeof selectedCell.rowId === 'number' && typeof selectedCell.columnId === 'string' ? (
        <section className="selected-cell-panel">
          <div className="card-title-row">
            <div className="card-title">Cell</div>
            <div className="pill-row">
              <span className="pill">Row {selectedCell.rowId + 1}</span>
              <span className="pill">{selectedCell.columnId}</span>
            </div>
          </div>
          {selectedCellDirty ? (
            <div className="stack">
              <div className="cell-panel-tabs" role="tablist" aria-label="Cell versions">
                <button
                  className={selectedCellMode === 'diff' ? 'cell-panel-tab active' : 'cell-panel-tab'}
                  type="button"
                  role="tab"
                  aria-selected={selectedCellMode === 'diff'}
                  onClick={() => setSelectedCellMode('diff')}
                >
                  Diff
                </button>
                <button
                  className={selectedCellMode === 'original' ? 'cell-panel-tab active' : 'cell-panel-tab'}
                  type="button"
                  role="tab"
                  aria-selected={selectedCellMode === 'original'}
                  onClick={() => setSelectedCellMode('original')}
                >
                  Original
                </button>
                <button
                  className={selectedCellMode === 'draft' ? 'cell-panel-tab active' : 'cell-panel-tab'}
                  type="button"
                  role="tab"
                  aria-selected={selectedCellMode === 'draft'}
                  onClick={() => setSelectedCellMode('draft')}
                >
                  Draft
                </button>
              </div>

              {selectedCellMode === 'original' ? (
                <TextCodeMirror
                  value={selectedOriginalValue}
                  ariaLabel="Original cell value"
                  readOnly
                  height="12rem"
                />
              ) : null}
              {selectedCellMode === 'draft' ? (
                <TextCodeMirror
                  value={selectedDraftValue}
                  ariaLabel="Draft cell value"
                  readOnly
                  height="12rem"
                />
              ) : null}
              {selectedCellMode === 'diff' ? (
                <TextDiffCodeMirror
                  original={selectedOriginalValue}
                  draft={selectedDraftValue}
                  ariaLabel="Diff cell value"
                />
              ) : null}
            </div>
          ) : (
            <TextCodeMirror
              value={selectedDraftValue}
              ariaLabel="Cell value"
              readOnly
              height="12rem"
            />
          )}
        </section>
      ) : null}
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

function toGridCell(value: unknown, editable: boolean, className?: string): reactGrid.DefaultCellTypes {
  if (typeof value === 'number') {
    return {type: 'number', value, nonEditable: !editable, className};
  }

  if (typeof value === 'boolean') {
    return {type: 'checkbox', checked: value, nonEditable: !editable, className};
  }

  if (value == null) {
    return {type: 'text', text: '', nonEditable: !editable, className};
  }

  if (typeof value === 'object') {
    return {type: 'text', text: JSON.stringify(value), nonEditable: true, className};
  }

  return {type: 'text', text: String(value), nonEditable: !editable, className};
}

function readGridCellValue(cell: reactGrid.Cell) {
  if (cell.type === 'number') {
    return (cell as reactGrid.NumberCell).value;
  }
  if (cell.type === 'checkbox') {
    return (cell as reactGrid.CheckboxCell).checked;
  }
  if (cell.type === 'text') {
    return (cell as reactGrid.TextCell).text;
  }
  return undefined;
}

function formatCellText(value: unknown) {
  if (value == null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function toYamlScalar(value: string | null) {
  if (value == null) {
    return 'null';
  }

  return value;
}

function formatAppliedAgo(appliedAt: string | null) {
  if (!appliedAt) {
    return 'unknown';
  }

  const appliedAtMs = new Date(appliedAt).getTime();
  if (!Number.isFinite(appliedAtMs)) {
    return 'unknown';
  }

  const elapsedMs = Math.max(0, Date.now() - appliedAtMs);
  return `${String(duration(elapsedMs)).split(',')[0]} ago`;
}

function isSameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeStoredTableDraft(
  draftRows: readonly Record<string, unknown>[] | undefined,
  fetchedRows: readonly Record<string, unknown>[],
  columns: readonly string[],
) {
  if (!draftRows) {
    return fetchedRows;
  }

  if (draftRows.length !== fetchedRows.length) {
    return fetchedRows;
  }

  const expectedColumnKeys = [...columns].sort();
  for (const row of draftRows) {
    const rowKeys = Object.keys(row).sort();
    if (JSON.stringify(rowKeys) !== JSON.stringify(expectedColumnKeys)) {
      return fetchedRows;
    }
  }

  return draftRows;
}

function useElementWidth<TElement extends HTMLElement>() {
  const storeRef = useRef<{
    element: TElement | null;
    width: number;
    observer: ResizeObserver | null;
    listeners: Set<() => void>;
  }>({
    element: null,
    width: 0,
    observer: null,
    listeners: new Set(),
  });

  const subscribe = (listener: () => void) => {
    storeRef.current.listeners.add(listener);
    return () => {
      storeRef.current.listeners.delete(listener);
    };
  };
  const getSnapshot = () => storeRef.current.width;
  const width = useSyncExternalStore(subscribe, getSnapshot, () => 0);

  return {
    width,
    ref: (element: TElement | null) => {
      const store = storeRef.current;
      if (store.element === element) {
        return;
      }

      store.observer?.disconnect();
      store.element = element;
      store.width = element?.clientWidth ?? 0;
      for (const listener of store.listeners) {
        listener();
      }

      if (!element || typeof ResizeObserver === 'undefined') {
        store.observer = null;
        return;
      }

      store.observer = new ResizeObserver((entries) => {
        const nextWidth = Math.floor(entries[0]?.contentRect.width ?? element.clientWidth);
        if (nextWidth === store.width) {
          return;
        }
        store.width = nextWidth;
        for (const listener of store.listeners) {
          listener();
        }
      });
      store.observer.observe(element);
    },
  };
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

function normalizeSqlDraft(value: string) {
  return value.trimEnd();
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
