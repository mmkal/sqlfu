import {Component, Suspense, useCallback, useRef, useState, useSyncExternalStore} from 'react';
import type {MouseEvent, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {RouterClient} from '@orpc/server';
import {createTanstackQueryUtils} from '@orpc/tanstack-query';
import * as reactGrid from '@silevis/reactgrid';
import Form from '@rjsf/core';
import type {RJSFSchema} from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import {duration} from 'itty-time';
import {toast} from 'react-hot-toast';
import useLocalStorageState from 'use-local-storage-state';
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';

import {queryNickname} from 'sqlfu';
import type {QueryArg, QueryCatalogEntry} from 'sqlfu';
import {formatSqlFileContents} from 'sqlfu/analyze';
import type {
  QueryExecutionResponse,
  SchemaAuthorityMigration,
  SchemaAuthoritiesResponse,
  SchemaCheckResponse,
  SqlEditorDiagnostic,
  SqlRunnerResponse,
  StudioRelation,
  TableRowsResponse,
} from './shared.js';
import {columnWidthAlgorithm} from './column-width.js';
import type {UiRouter} from 'sqlfu/ui/browser';
import {SqlCodeMirror, TextCodeMirror, TextDiffCodeMirror, type CodeMirrorAction} from './sql-codemirror.js';
import {RelationQueryPanel} from './relation-query-panel.js';
import {DEFAULT_LIMIT} from './relation-query-builder.js';
import {buildRelationSubviewSql, quoteSqlIdentifier} from './relation-subview-sql.js';
import * as Popover from '@radix-ui/react-popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog.js';
import {AppToaster} from './components/ui/toaster.js';
import {resolveApiOrigin, resolveApiRpcUrl} from './runtime.js';
import {checkServerVersion, classifyStartupError, type StartupFailure} from './startup-error.js';
import {DEMO_URL, HOSTED_URL, createDemoClient, isDemoMode} from './demo/index.js';
import {initThemeOnLoad, useThemePreference} from './theme.js';
import './styles.css';

initThemeOnLoad();

/**
 * Session-scoped counterpart to `useLocalStorageState` — the library doesn't
 * expose a backend switch, so this is a small hand-roll. Values live in
 * `sessionStorage` (cleared on tab close) and are written through the setter
 * synchronously, no effect needed. Not a drop-in for every localStorage use —
 * no cross-tab sync, no `isPersistent` / `removeItem` affordances — but fine
 * for scratch drafts where cross-tab sync is actively undesirable.
 */
function useSessionStorageState<T>(key: string, defaultValue: T): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });
  const set = (next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(key, JSON.stringify(resolved));
        } catch {}
      }
      return resolved;
    });
  };
  return [value, set];
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
  mutationCache: new MutationCache({
    onError: (error) => {
      toast.error(String(error));
    },
  }),
});
const demoMode = isDemoMode();
const orpcClient: RouterClient<UiRouter> = demoMode
  ? createDemoClient({
      // Invalidate only the schema-derived query namespaces. An unfiltered
      // `queryClient.invalidateQueries()` would also hit ad-hoc useQuery calls
      // whose queryFn itself calls `sql.run` (e.g. the Relation view's live
      // query) — each refetch would re-trigger execAdHocSql → onSchemaChange
      // → invalidate → refetch → … feedback loop, freezing the browser.
      onSchemaChange: () => {
        void queryClient.invalidateQueries({queryKey: orpc.schema.key()});
        void queryClient.invalidateQueries({queryKey: orpc.catalog.key()});
        void queryClient.invalidateQueries({queryKey: orpc.table.key()});
      },
    })
  : createORPCClient(
      new RPCLink({
        url: resolveApiRpcUrl(),
      }),
    );
const orpc = createTanstackQueryUtils(orpcClient);
const mobileSidebarMediaQuery = '(max-width: 720px)';

type ConfirmationRequest = {
  title: string;
  body: string;
  bodyType?: 'markdown' | 'sql' | 'typescript';
  editable?: boolean;
};

type ConfirmationDialogState = {
  open: boolean;
  params: ConfirmationRequest | null;
  draftBody: string;
};

type ConfirmationDialogResult = {
  confirmed: boolean;
  body?: string;
};

function createConfirmationDialogStore() {
  let snapshot: ConfirmationDialogState = {
    open: false,
    params: null,
    draftBody: '',
  };
  let pendingResolve: ((result: ConfirmationDialogResult) => void) | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setSnapshot = (next: ConfirmationDialogState) => {
    snapshot = next;
    emit();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    async confirm(params: ConfirmationRequest) {
      if (pendingResolve) {
        pendingResolve({confirmed: false});
      }
      setSnapshot({
        open: true,
        params,
        draftBody: params.body,
      });
      return await new Promise<ConfirmationDialogResult>((resolve) => {
        pendingResolve = resolve;
      });
    },
    setDraftBody(body: string) {
      setSnapshot({
        ...snapshot,
        draftBody: body,
      });
    },
    close(result: ConfirmationDialogResult) {
      pendingResolve?.(result);
      pendingResolve = null;
      setSnapshot({
        open: false,
        params: null,
        draftBody: '',
      });
    },
  };
}

const confirmationDialogStore = createConfirmationDialogStore();

type StartupErrorBoundaryState = {
  error: unknown;
};

function createStartupBoundaryStore() {
  let resetKey = 0;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return resetKey;
    },
    reset() {
      resetKey += 1;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

const startupBoundaryStore = createStartupBoundaryStore();

class StartupErrorBoundary extends Component<{children: ReactNode}, StartupErrorBoundaryState> {
  state: StartupErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown) {
    return {error};
  }

  render() {
    if (this.state.error) {
      return <StartupFailureScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}

function App() {
  const startupBoundaryResetKey = useSyncExternalStore(
    startupBoundaryStore.subscribe,
    startupBoundaryStore.getSnapshot,
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StartupErrorBoundary key={startupBoundaryResetKey}>
        <Suspense fallback={<Shell loading />}>
          <Studio />
        </Suspense>
      </StartupErrorBoundary>
      <ConfirmationDialogHost />
      <AppToaster />
    </QueryClientProvider>
  );
}

async function invalidateSchemaContent() {
  await queryClient.invalidateQueries({queryKey: orpc.schema.key()});
}

function StartupFailureScreen(input: {error: unknown}) {
  if (demoMode) {
    return <DemoStartupFailureScreen error={input.error} />;
  }

  const apiOrigin = resolveApiOrigin();
  const apiHost = new URL(apiOrigin).host;
  const browserName = detectBrowserName();
  const startupError = classifyStartupError(input.error);
  const errorMessage = startupError.message;

  return (
    <main className="startup-shell">
      <TryDemoBanner />
      <section className="startup-card">
        <h1>
          <code>sqlfu</code>
        </h1>
        <p className="startup-lede">Connecting to the sqlfu backend on {apiHost}</p>

        <div className="startup-grid">
          <section className="startup-section">
            {startupError.kind === 'unreachable' ? (
              <>
                <h2>
                  <code>npx sqlfu</code>?
                </h2>
                <p>Make sure the local sqlfu backend is up and running.</p>
                <ol className="startup-steps">
                  <li>
                    Run <code>npx sqlfu</code>.
                  </li>
                </ol>
              </>
            ) : null}
            {startupError.kind === 'client-error' ? (
              <>
                <h2>Backend returned {startupError.status}</h2>
                <p>The sqlfu backend on {apiHost} responded with a client error.</p>
                <ol className="startup-steps">
                  <li>
                    Restart the local backend with the latest <code>sqlfu</code> version.
                  </li>
                  <li>Reload this page.</li>
                </ol>
              </>
            ) : null}
            {startupError.kind === 'server-error' ? (
              <>
                <h2>Backend returned {startupError.status}</h2>
                <p>The sqlfu backend on {apiHost} is reachable, but it crashed while handling the request.</p>
                <ol className="startup-steps">
                  <li>
                    Check the terminal where <code>npx sqlfu</code> is running.
                  </li>
                  <li>Fix the backend error, then reload this page.</li>
                </ol>
              </>
            ) : null}
            {startupError.kind === 'version-mismatch' ? (
              <>
                <h2>Please upgrade the local sqlfu server</h2>
                <p>{renderVersionMismatchLede(startupError)}</p>
                <ol className="startup-steps">
                  <li>
                    Stop the local backend (Ctrl+C in the terminal running <code>npx sqlfu</code>).
                  </li>
                  <li>
                    Run <code>npm install -g sqlfu@latest</code>, or start it with <code>npx sqlfu@latest</code> next
                    time.
                  </li>
                  <li>Reload this page.</li>
                </ol>
                <p>
                  Don&apos;t want to upgrade right now? Run <code>npx sqlfu --ui</code> instead of{' '}
                  <code>npx sqlfu</code> to serve a version-matched UI locally — that avoids this mismatch screen
                  entirely and lets you stay on your current sqlfu version.
                </p>
              </>
            ) : null}
            <div className="startup-actions">
              <button className="button primary" type="button" onClick={() => window.location.reload()}>
                Retry connection
              </button>
            </div>
            <p>
              Still stuck? Open an issue on{' '}
              <a
                className="startup-link"
                href="https://github.com/mmkal/sqlfu/issues/new"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              .
            </p>
          </section>

          <section className="startup-section">
            {startupError.kind === 'unreachable' && (browserName === 'Safari' || browserName === 'Brave') ? (
              <>
                <h2>Using Safari or Brave?</h2>
                <p>
                  Safari and Brave block localhost access more aggressively than Chrome. You may need to install a
                  certificate, then restart the local backend. Instructions
                </p>
                <ol className="startup-steps">
                  <li>
                    Run <code>brew install mkcert</code> or follow{' '}
                    <a
                      className="startup-link"
                      href="https://github.com/FiloSottile/mkcert"
                      target="_blank"
                      rel="noreferrer"
                    >
                      mkcert installation instructions
                    </a>
                    .
                  </li>
                  <li>
                    Run <code>mkcert -install</code>.
                  </li>
                  <li>Restart the local backend and reload the page.</li>
                </ol>
                {browserName === 'Brave' ? <p>On Brave you can also disable Brave Shields for this site.</p> : null}
              </>
            ) : null}
            {startupError.kind === 'unreachable' && browserName !== 'Safari' && browserName !== 'Brave' ? (
              <>
                <h2>Chrome Local Network Access</h2>
                <p>
                  Recent Chrome and Chromium updates may block local network access by default. Open site information in
                  the URL bar and make sure local network access is enabled for this site.
                </p>
                <ol className="startup-steps">
                  <li>Open site information in the URL bar.</li>
                  <li>Enable local network access for this site.</li>
                  <li>Reload the page.</li>
                </ol>
              </>
            ) : null}
            {startupError.kind === 'client-error' ? (
              <>
                <h2>Client request rejected</h2>
                <p>
                  The browser reached the local backend, but the backend rejected the request with HTTP{' '}
                  {startupError.status}.
                </p>
                <p>This usually means the local backend is out of date, or the local project is in a bad state.</p>
              </>
            ) : null}
            {startupError.kind === 'server-error' ? (
              <>
                <h2>Backend error</h2>
                <p>The browser reached the local backend, but it responded with HTTP {startupError.status}.</p>
                <p>
                  The detailed stack trace should be in the terminal where <code>npx sqlfu</code> is running.
                </p>
              </>
            ) : null}
            {startupError.kind === 'version-mismatch' ? (
              <>
                <h2>Why am I seeing this?</h2>
                <p>
                  The hosted UI on <code>sqlfu.dev/ui</code> tracks the latest sqlfu release. When your local backend
                  falls outside <code>{startupError.supportedRange}</code>, the RPC contracts do not line up and the UI
                  would otherwise surface cryptic 4xx or 5xx errors.
                </p>
                <p>Upgrading the local backend is the fix. Your project data is untouched.</p>
              </>
            ) : null}
          </section>
        </div>

        <details className="startup-error-details">
          <summary>Technical details</summary>
          <pre>{errorMessage}</pre>
        </details>
      </section>
    </main>
  );
}

function ConfirmationDialogHost() {
  const snapshot = useSyncExternalStore(confirmationDialogStore.subscribe, confirmationDialogStore.getSnapshot);
  const params = snapshot.params;

  return (
    <Dialog
      open={snapshot.open}
      onOpenChange={(open) => {
        if (!open && snapshot.open) {
          confirmationDialogStore.close({confirmed: false});
        }
      }}
    >
      <DialogContent className="confirmation-dialog-card">
        {params ? (
          <>
            <DialogHeader>
              <DialogTitle>{params.title}</DialogTitle>
              <DialogDescription>Review the server-provided body before continuing.</DialogDescription>
            </DialogHeader>
            {params.bodyType === 'sql' ? (
              <SqlCodeMirror
                value={snapshot.draftBody}
                ariaLabel="Confirmation body editor"
                relations={[]}
                readOnly={params.editable !== true}
                onChange={(value) => {
                  if (params.editable === true) {
                    confirmationDialogStore.setDraftBody(value);
                  }
                }}
              />
            ) : (
              <TextCodeMirror
                value={snapshot.draftBody}
                ariaLabel="Confirmation body editor"
                readOnly={params.editable !== true}
                height="18rem"
                language={
                  params.bodyType === 'markdown'
                    ? 'markdown'
                    : params.bodyType === 'typescript'
                      ? 'typescript'
                      : 'plain'
                }
                onChange={(value) => {
                  if (params.editable === true) {
                    confirmationDialogStore.setDraftBody(value);
                  }
                }}
              />
            )}
            <DialogFooter>
              <button
                className="button"
                type="button"
                onClick={() => confirmationDialogStore.close({confirmed: false})}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() =>
                  confirmationDialogStore.close({
                    confirmed: true,
                    body: snapshot.draftBody,
                  })
                }
              >
                Confirm
              </button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Studio() {
  const projectStatusQuery = useSuspenseQuery(orpc.project.status.queryOptions());

  const versionMismatch = checkServerVersion({serverVersion: projectStatusQuery.data.serverVersion});
  if (versionMismatch) {
    throw versionMismatch;
  }

  if (!projectStatusQuery.data.initialized) {
    return <ProjectInitScreen projectRoot={projectStatusQuery.data.projectRoot} />;
  }

  const route = useHashRoute();
  const schemaQuery = useSuspenseQuery(orpc.schema.get.queryOptions());
  const catalogQuery = useSuspenseQuery(orpc.catalog.queryOptions());
  const schemaCheckQuery = useSuspenseQuery(orpc.schema.check.queryOptions());
  const schemaAuthoritiesQuery = useSuspenseQuery(orpc.schema.authorities.get.queryOptions());

  const selectedTable = selectTable(route, schemaQuery.data.relations);
  const selectedQuery = selectQuery(route, catalogQuery.data.queries);
  const selectedTableSubviewSql =
    route.kind === 'table' && selectedTable?.name === route.name ? route.subviewSql : undefined;
  const isTableView =
    route.kind !== 'schema' && route.kind !== 'sql' && !(route.kind === 'query' && selectedQuery) && !!selectedTable;
  const sidebarToggleLabel = getSidebarToggleLabel({route, selectedTable, selectedQuery});
  const isMobileSidebarLayout = useMediaQuery(mobileSidebarMediaQuery);

  return (
    <Shell>
      <details className="sidebar-shell" open={!isMobileSidebarLayout}>
        <summary className="sidebar-toggle" aria-label="Toggle navigation">
          <span className="sidebar-toggle-icon" aria-hidden="true">
            <span />
          </span>
          <span className="sidebar-toggle-copy">
            <span className="sidebar-toggle-title">sqlfu/ui</span>
            <span className="sidebar-toggle-location">{sidebarToggleLabel}</span>
          </span>
        </summary>

        <aside className="sidebar">
          <div className="sidebar-block sidebar-header">
            <div className="sidebar-title">
              <h1>sqlfu/ui</h1>
              <p className="lede">{schemaQuery.data.projectName}</p>
            </div>
            <ThemeToggle />
          </div>

          <nav className="sidebar-block">
            <div className="section-title">Tools</div>
            <a
              className={route.kind === 'schema' ? 'nav-link active' : 'nav-link'}
              href="#schema"
              onClick={collapseSidebarAfterNavigation}
            >
              Schema
            </a>
            <a
              className={route.kind === 'sql' ? 'nav-link active' : 'nav-link'}
              href="#sql"
              onClick={collapseSidebarAfterNavigation}
            >
              SQL runner
            </a>
          </nav>

          <nav className="sidebar-block">
            <div className="section-title">Relations</div>
            {schemaQuery.data.relations.map((relation: StudioRelation) => (
              <a
                key={relation.name}
                className={
                  route.kind === 'table' && selectedTable?.name === relation.name ? 'nav-link active' : 'nav-link'
                }
                href={`#table/${encodeURIComponent(relation.name)}`}
                title={relation.name}
                onClick={collapseSidebarAfterNavigation}
              >
                <RelationKindIcon kind={relation.kind} />
                <span className="nav-link-label">{relation.name}</span>
                {typeof relation.rowCount === 'number' ? (
                  <span className="nav-link-count">{formatRowCount(relation.rowCount)}</span>
                ) : null}
              </a>
            ))}
          </nav>

          <nav className="sidebar-block">
            <div className="section-title">Queries</div>
            {catalogQuery.data.queries.map((query) => (
              <a
                key={query.id}
                className={route.kind === 'query' && selectedQuery?.id === query.id ? 'nav-link active' : 'nav-link'}
                href={`#query/${encodeURIComponent(query.id)}`}
                title={query.id}
                onClick={collapseSidebarAfterNavigation}
              >
                <QueryIcon />
                <span className="nav-link-label">{query.id}</span>
                {query.kind !== 'query' ? <small>error</small> : null}
              </a>
            ))}
          </nav>
        </aside>
      </details>

      <main className={isTableView ? 'main table-main' : 'main'}>
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
            key={selectedTable.name}
            relation={selectedTable}
            subviewSql={selectedTableSubviewSql}
            onSubViewSqlChange={(sql) => {
              window.location.hash = buildRelationSubviewHash(selectedTable.name, sql);
            }}
            onClearSubView={() => {
              window.location.hash = buildTableHash(selectedTable.name);
            }}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </Shell>
  );
}

function ProjectInitScreen(input: {projectRoot: string}) {
  const initializeMutation = useMutation({
    mutationFn: async (variables: {command: string}) => await runSchemaCommand(variables.command),
    onSuccess: async () => {
      await queryClient.refetchQueries({queryKey: orpc.project.status.key()});
      startupBoundaryStore.reset();
      await Promise.all([
        queryClient.prefetchQuery(orpc.schema.get.queryOptions()),
        queryClient.prefetchQuery(orpc.catalog.queryOptions()),
        queryClient.prefetchQuery(orpc.schema.check.queryOptions()),
        queryClient.prefetchQuery(orpc.schema.authorities.get.queryOptions()),
      ]);
    },
  });

  const handleInitialize = async () => {
    await initializeMutation.mutateAsync({command: 'sqlfu init'});
  };

  const displayProjectRoot = abbreviateHomeDirectory(input.projectRoot);

  return (
    <main className="startup-shell">
      <section className="startup-card project-init-card">
        <div className="eyebrow">Fresh directory</div>
        <h1>
          <code>sqlfu</code>
        </h1>
        <p className="startup-lede">This directory is ready to initialize.</p>

        <section className="startup-section startup-section-wide">
          <h2>Initialize sqlfu</h2>
          <p>
            Create your <code>sqlfu.config.ts</code> file pointing to your database, migrations and queries.
          </p>
          <p className="startup-path">
            <span className="startup-path-label">Project root</span> <code>{displayProjectRoot}</code>
          </p>
          <div className="startup-actions">
            <button
              className="button primary"
              type="button"
              onClick={() => void handleInitialize()}
              disabled={initializeMutation.isPending}
            >
              {initializeMutation.isPending ? 'Initializing…' : 'Initialize sqlfu project'}
            </button>
          </div>
          {initializeMutation.error ? <p className="error-text">{String(initializeMutation.error)}</p> : null}
        </section>
      </section>
    </main>
  );
}

function abbreviateHomeDirectory(path: string) {
  return path
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
}

function SchemaPanel(input: {projectName: string; check: SchemaCheckResponse; authorities: SchemaAuthoritiesResponse}) {
  const [commandErrors, setCommandErrors] = useSessionStorageState<Record<string, string>>(
    `sqlfu-ui/schema-command-errors/${input.projectName}`,
    {},
  );
  const [desiredSchemaDraft, setDesiredSchemaDraft] = useSessionStorageState<string>(
    `sqlfu-ui/schema-desired/${input.projectName}`,
    input.authorities.desiredSchemaSql,
  );
  const runCommandMutation = useMutation({
    mutationFn: async (variables: {command: string}) => await runSchemaCommand(variables.command),
    onMutate: (variables) => {
      setCommandErrors((current) => {
        const next = {...(current ?? {})};
        delete next[variables.command];
        return next;
      });
    },
    onSuccess: async () => {
      setCommandErrors({});
      await queryClient.refetchQueries({queryKey: orpc.schema.key()});
    },
    onError: (error, variables) => {
      setCommandErrors((current) => ({
        ...(current ?? {}),
        [variables.command]: String(error),
      }));
    },
  });
  const saveDesiredSchemaMutation = useMutation({
    ...orpc.schema.definitions.mutationOptions(),
    onSuccess: async (_, variables) => {
      setDesiredSchemaDraft(normalizeSqlDraft(variables.sql));
      await queryClient.refetchQueries({queryKey: orpc.schema.key()});
    },
  });
  const desiredSchemaSql = desiredSchemaDraft;
  const desiredSchemaFormat = formatDesiredSchemaDraft(desiredSchemaSql);
  const desiredSchemaAlreadyFormatted =
    desiredSchemaFormat.ok && normalizeSqlDraft(desiredSchemaFormat.sql) === normalizeSqlDraft(desiredSchemaSql);
  const canFormatDesiredSchema = desiredSchemaFormat.ok && !desiredSchemaAlreadyFormatted;
  const desiredSchemaDirty =
    normalizeSqlDraft(desiredSchemaSql) !== normalizeSqlDraft(input.authorities.desiredSchemaSql);
  const handleSchemaCommand = async (command: [string, ...string[]]) => {
    await runCommandMutation.mutateAsync({command: formatSchemaCommand(command)});
  };
  const handleFormatDesiredSchema = () => {
    if (desiredSchemaFormat.ok) {
      setDesiredSchemaDraft(desiredSchemaFormat.sql);
    }
  };

  // Surface a persistent indicator for the most-recently-run schema
  // command. Lives at the top of the panel (rather than inside a
  // recommendation row) because successful commands typically resolve
  // the recommendation that prompted them — the row vanishes on the
  // next refetch, taking any inline status with it. Both the indicator
  // and a real user benefit from a stable place to read "did my last
  // run succeed?" while the page re-renders around it.
  const lastCommand = runCommandMutation.variables?.command;
  const lastCommandStatus = lastCommand
    ? runCommandMutation.isPending
      ? 'running'
      : runCommandMutation.isSuccess
        ? 'success'
        : runCommandMutation.isError
          ? 'error'
          : null
    : null;

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>Schema</h2>
          <p className="muted">{input.projectName}</p>
        </div>
        {lastCommand && lastCommandStatus ? (
          <p className={`schema-command-status ${lastCommandStatus}`} role="status" aria-live="polite">
            {lastCommandStatus === 'running' ? `Running ${lastCommand}…` : null}
            {lastCommandStatus === 'success' ? (
              <>
                <span aria-hidden="true">✓</span> {lastCommand} succeeded
              </>
            ) : null}
            {lastCommandStatus === 'error' ? `${lastCommand} failed` : null}
          </p>
        ) : null}
      </header>

      <div className="stack schema-cards">
        {input.check.error ? (
          <section className="card schema-card warn compact">
            <div className="card-title-row schema-card-title-row">
              <h3 className="card-title">
                <span className="schema-card-status warn" aria-hidden="true">
                  ⚠
                </span>
                Schema Check Failed
              </h3>
            </div>
            <p>{input.check.error}</p>
          </section>
        ) : null}
        {input.check.cards.map((card) => (
          <section key={card.key} className={`card schema-card compact ${card.variant}`}>
            <div className="card-title-row schema-card-title-row">
              <h3 className="card-title">
                <span className={`schema-card-status ${card.variant}`} aria-hidden="true">
                  {getSchemaCardStatusIcon(card)}
                </span>
                {getSchemaCardLabel(card)}
              </h3>
              <span className="muted schema-card-explainer">{card.ok ? card.explainer : card.summary}</span>
            </div>
            {!card.ok && card.details.length > 0 ? (
              <div className="stack">
                {card.details.map((detail) => (
                  <p key={detail} className="muted">
                    {detail}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        ))}
        {input.check.recommendations.length > 0 ? (
          <section className="card schema-card recommendations compact">
            <div className="card-title-row schema-card-title-row">
              <h3 className="card-title">
                <span className="schema-card-status recommendations" aria-hidden="true">
                  🛠
                </span>
                Recommended actions
              </h3>
            </div>
            <div className="schema-recommendation-table">
              {input.check.recommendations.map((recommendation) => {
                const command = recommendation.command;
                return (
                  <div
                    key={`${recommendation.kind}/${command?.join(' ') ?? recommendation.label}`}
                    className="schema-recommendation-row"
                  >
                    <div className="schema-recommendation-command">
                      {command ? (
                        <button
                          className="button inline-command-button"
                          type="button"
                          aria-label={formatSchemaCommand(command)}
                          title={
                            desiredSchemaDirty
                              ? 'Save or discard Desired Schema edits before running this command'
                              : formatSchemaCommand(command)
                          }
                          disabled={desiredSchemaDirty || runCommandMutation.isPending}
                          onClick={() => {
                            void handleSchemaCommand(command);
                          }}
                        >
                          {formatSchemaCommand(command)}
                        </button>
                      ) : null}
                    </div>
                    <div className="schema-recommendation-content">
                      <p className="schema-recommendation">{renderSchemaRecommendationSummary(recommendation)}</p>
                      {command && commandErrors?.[formatSchemaCommand(command)] ? (
                        <div className="schema-command">
                          <span className="schema-command-error">{commandErrors[formatSchemaCommand(command)]}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
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
            <SqlCodeMirror
              value={desiredSchemaSql}
              ariaLabel="Desired Schema editor"
              relations={[]}
              onChange={setDesiredSchemaDraft}
              actions={[
                {
                  icon: '💅',
                  name: 'Format Desired Schema',
                  title: canFormatDesiredSchema
                    ? 'Format'
                    : desiredSchemaFormat.ok
                      ? 'Already formatted'
                      : 'Cannot format',
                  disabled: !canFormatDesiredSchema,
                  onAction: handleFormatDesiredSchema,
                },
                {
                  icon: '↩',
                  name: 'Discard Desired Schema edits',
                  title: 'Discard edits',
                  disabled: !desiredSchemaDirty || saveDesiredSchemaMutation.isPending,
                  onAction: () => setDesiredSchemaDraft(input.authorities.desiredSchemaSql),
                },
                {
                  icon: '💾',
                  name: 'Save Desired Schema',
                  title: 'Save',
                  disabled: !desiredSchemaDirty || saveDesiredSchemaMutation.isPending,
                  onAction: () => saveDesiredSchemaMutation.mutate({sql: desiredSchemaSql}),
                },
              ]}
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
                        <span className="muted">{formatAppliedAgo(migration.applied_at)}</span>
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
    ...orpc.schema.authorities.resultantSchema.queryOptions({
      input: {
        source: input.source,
        id: input.migration.id,
      },
    }),
    enabled: activeTab === 'schema',
  });
  const metadata = [
    `name: ${toYamlScalar(input.migration.name)}`,
    `filename: ${toYamlScalar(input.migration.fileName)}`,
    `applied_at: ${toYamlScalar(input.migration.applied_at)}`,
    ...(input.migration.applied_at
      ? [`integrity: ${toYamlScalar(input.migration.integrity ?? 'checksum mismatch')}`]
      : []),
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
        <TextCodeMirror value={metadata} ariaLabel="Migration metadata" readOnly height="10rem" language="yaml" />
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
            value={
              resultantSchemaQuery.isLoading ? 'Loading resultant schema…' : String(resultantSchemaQuery.error ?? '')
            }
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
  subviewSql?: string;
  onSubViewSqlChange: (sql: string) => void;
  onClearSubView?: () => void;
}) {
  const getRelationActions = (actionInput: {row: Record<string, unknown>; column: string}) =>
    buildRelationActions(input.relation, actionInput.row, actionInput.column);
  const tableListOptions = orpc.table.list.queryOptions({
    input: {
      relationName: input.relation.name,
      page: 0,
      pageSize: DEFAULT_LIMIT,
    },
  });
  const fallbackRows: TableRowsResponse = {
    relation: input.relation.name,
    page: 0,
    pageSize: DEFAULT_LIMIT,
    editable: false,
    rowKeys: [],
    rows: [],
    columns: input.relation.columns.map((column) => column.name),
  };
  // useQuery (not useSuspenseQuery): switching between tables shouldn't blank
  // the page on a Suspense fallback. Until rows arrive we render the new
  // relation's column headers with an empty body, which feels far snappier.
  const rowsResult = useQuery(tableListOptions);
  const rowsData = rowsResult.data ?? fallbackRows;
  // sessionStorage (not localStorage): unsaved table edits are per-tab scratch
  // work. Persisting across browser sessions surfaces stale drafts against
  // potentially-changed schema/data, which is more confusing than helpful.
  const [draftRows, setDraftRows] = useSessionStorageState<Record<string, unknown>[]>(
    `sqlfu-ui/table-draft/${input.relation.name}/0`,
    rowsData.rows,
  );
  const saveRowsMutation = useMutation({
    ...orpc.table.save.mutationOptions(),
    onSuccess: async (response) => {
      setDraftRows(response.rows);
      queryClient.setQueryData(tableListOptions.queryKey, response);
      await invalidateSchemaContent();
    },
  });
  const deleteRowMutation = useMutation({
    ...orpc.table.delete.mutationOptions(),
    onSuccess: async (response) => {
      setDraftRows(response.rows);
      queryClient.setQueryData(tableListOptions.queryKey, response);
      await invalidateSchemaContent();
    },
  });
  const emptyRowTemplate = Object.fromEntries(input.relation.columns.map((column) => [column.name, null]));
  const displayedRows = normalizeStoredTableDraft(draftRows, rowsData.rows, rowsData.columns);
  const displayedOriginalRows = [
    ...rowsData.rows,
    ...displayedRows.slice(rowsData.rows.length).map(() => ({...emptyRowTemplate})),
  ];
  const displayedRowKeys = [
    ...rowsData.rowKeys,
    ...displayedRows.slice(rowsData.rows.length).map((_, index) => ({
      kind: 'new' as const,
      value: `new-${input.relation.name}-0-${index}`,
    })),
  ];
  const rowsDirty = JSON.stringify(displayedRows) !== JSON.stringify(displayedOriginalRows);
  const tableMutationError = saveRowsMutation.error ?? deleteRowMutation.error;
  const handleDiscardRows = () => {
    setDraftRows(rowsData.rows);
  };
  const handleSaveRows = () => {
    saveRowsMutation.mutate({
      relationName: input.relation.name,
      page: 0,
      pageSize: rowsData.pageSize,
      originalRows: displayedOriginalRows.map((row) => ({...row})),
      rows: displayedRows.map((row) => ({...row})),
      rowKeys: displayedRowKeys,
    });
  };
  const handleDeleteRow = async (rowIndex: number) => {
    const rowKey = displayedRowKeys[rowIndex];
    const originalRow = displayedOriginalRows[rowIndex];
    if (!rowKey || !originalRow) {
      return;
    }
    if (rowKey.kind === 'new') {
      const row = displayedRows[rowIndex];
      const columnNames = input.relation.columns.map((column) => column.name);
      if (!row || isEmptyDraftRow(row, columnNames)) {
        setDraftRows(displayedRows.filter((_, index) => index !== rowIndex));
        return;
      }
      const result = await confirmationDialogStore.confirm({
        title: 'Discard unsaved row?',
        body: 'This row has values you have not saved yet. Discard them?',
        bodyType: 'markdown',
      });
      if (!result.confirmed) return;
      setDraftRows(displayedRows.filter((_, index) => index !== rowIndex));
      return;
    }
    const previewSql = buildDeleteRowPreviewSql(input.relation.name, rowKey);
    const result = await confirmationDialogStore.confirm({
      title: `Delete row from "${input.relation.name}"?`,
      body: previewSql,
      bodyType: 'sql',
    });
    if (!result.confirmed) return;
    deleteRowMutation.mutate({
      relationName: input.relation.name,
      page: 0,
      pageSize: rowsData.pageSize,
      rowKey,
      originalRow,
    });
  };

  return (
    <section className="panel table-panel">
      <section className="table-view">
        {tableMutationError ? <ErrorView error={tableMutationError} /> : null}
        <RelationQueryPanel
          relation={input.relation}
          subviewSql={input.subviewSql}
          onSubViewSqlChange={input.onSubViewSqlChange}
          onClearSubView={input.onClearSubView}
          runSql={(runInput) => orpcClient.sql.run(runInput)}
          rowEditing={
            input.subviewSql
              ? undefined
              : {
                  editable: rowsData.editable,
                  dirty: rowsDirty,
                  saving: saveRowsMutation.isPending,
                  onConfirmDiscard: async () => {
                    const result = await confirmationDialogStore.confirm({
                      title: 'Discard unsaved row edits?',
                      body: 'This query action switches the table into read-only SQL results. Discard the unsaved row edits and continue?',
                      bodyType: 'markdown',
                    });
                    return result.confirmed;
                  },
                  onSave: handleSaveRows,
                  onDiscard: handleDiscardRows,
                }
          }
          renderDefaultDataTable={({toolbar}) => (
            <DataTable
              storageKey={`relation/${input.relation.name}`}
              columns={rowsData.columns}
              rowKeys={displayedRowKeys}
              originalRows={displayedOriginalRows}
              rows={displayedRows}
              editable={rowsData.editable}
              editableColumns={Object.fromEntries(
                input.relation.columns.map((column) => [column.name, !column.primaryKey]),
              )}
              onRowsChange={setDraftRows}
              onAppendRow={() => setDraftRows([...displayedRows, {...emptyRowTemplate}])}
              onDeleteRow={handleDeleteRow}
              showSelectedCellDetail
              getRelationActions={getRelationActions}
              toolbar={toolbar}
            />
          )}
          renderSqlDataTable={(args) => (
            <DataTable
              storageKey={args.storageKey}
              columns={args.columns}
              rows={args.rows}
              showSelectedCellDetail
              getRelationActions={getRelationActions}
              toolbar={args.toolbar}
            />
          )}
        />
      </section>
    </section>
  );
}

function SqlRunnerPanel(input: {relations: StudioRelation[]}) {
  const [draft, setDraft] = useSessionStorageState<SqlRunnerDraft>('sqlfu-ui/sql-runner-draft', {
    sql: `select name, type\nfrom sqlite_schema\nwhere name not like 'sqlite_%'\norder by type, name;`,
    params: {},
  });
  const analysisQuery = useQuery({
    ...orpc.sql.analyze.queryOptions({
      input: {sql: draft.sql},
    }),
    placeholderData: (previousData) => previousData,
    enabled: draft.sql.trim().length > 0,
  });
  const detectedParamsSchema =
    (analysisQuery.data?.paramsSchema as RJSFSchema | undefined) ?? buildSqlRunnerParamsSchema(draft.sql);
  const sanitizedParams = sanitizeFormData(draft.params, detectedParamsSchema);
  const runMutation = useMutation({
    ...orpc.sql.run.mutationOptions(),
    onSuccess: async () => {
      await invalidateSchemaContent();
    },
  });
  const saveMutation = useMutation({
    ...orpc.sql.save.mutationOptions(),
  });
  const handleSave = async () => {
    const suggestedName = suggestSqlRunnerName(draft.sql);
    const providedName = window.prompt('Save query as', suggestedName);
    if (providedName == null) {
      return;
    }

    const name = slugifyPromptName(providedName);
    if (!name) {
      return;
    }

    const result = await saveMutation.mutateAsync({name, sql: draft.sql});
    await queryClient.fetchQuery(orpc.catalog.queryOptions());
    const queryId = result.savedPath
      .split('/')
      .pop()
      ?.replace(/\.sql$/, '');
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
      sqlEditorOnSave={() => handleSave()}
      sqlEditorActions={[
        {
          icon: '▶',
          name: 'Run SQL',
          disabled: runMutation.isPending || saveMutation.isPending,
          onAction: () => runMutation.mutate({sql: draft.sql, params: sanitizedParams}),
        },
        {
          icon: '💾',
          name: 'Save query',
          disabled: runMutation.isPending || saveMutation.isPending,
          onAction: handleSave,
        },
      ]}
      paramsSchema={omitSchemaTitle(detectedParamsSchema)}
      paramsData={sanitizedParams}
      onSqlChange={(sql) => setDraft({...draft, sql})}
      onParamsChange={(params) => setDraft({...draft, params: sanitizeFormData(params, detectedParamsSchema)})}
      onRun={() => runMutation.mutate({sql: draft.sql, params: sanitizedParams})}
      onSave={handleSave}
      showParamActions={false}
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

function QueryPanel(input: {entry: QueryCatalogEntry; relations: StudioRelation[]}) {
  const entry = input.entry;

  const mutation = useMutation({
    ...orpc.query.execute.mutationOptions(),
    onSuccess: async () => {
      await invalidateSchemaContent();
    },
  });
  const [renameDraft, setRenameDraft] = useSessionStorageState<string>(`sqlfu-ui/query-rename/${entry.id}`, entry.id);
  const [sqlDraft, setSqlDraft] = useSessionStorageState<string>(
    `sqlfu-ui/query-sql/${entry.id}`,
    entry.sqlFileContent,
  );
  const [renameMode, setRenameMode] = useLocalStorageState(`sqlfu-ui/query-rename-mode/${entry.id}`, {
    defaultValue: false,
  });
  const [sqlEditMode, setSqlEditMode] = useLocalStorageState(`sqlfu-ui/query-sql-edit-mode/${entry.id}`, {
    defaultValue: false,
  });
  const renameMutation = useMutation({
    ...orpc.query.rename.mutationOptions(),
  });
  const updateMutation = useMutation({
    ...orpc.query.update.mutationOptions(),
  });
  const deleteMutation = useMutation({
    ...orpc.query.delete.mutationOptions(),
  });
  const analysisQuery = useQuery({
    ...orpc.sql.analyze.queryOptions({
      input: {sql: sqlDraft},
    }),
    placeholderData: (previousData) => previousData,
    enabled: sqlEditMode && sqlDraft.trim().length > 0,
  });
  const handleRename = async () => {
    const result = await renameMutation.mutateAsync({queryId: entry.id, name: renameDraft});
    setRenameMode(false);
    await queryClient.fetchQuery(orpc.catalog.queryOptions());
    window.location.hash = `#query/${encodeURIComponent(result.id)}`;
  };
  const handleSqlSave = async () => {
    const result = await updateMutation.mutateAsync({queryId: entry.id, sql: sqlDraft});
    setSqlEditMode(false);
    await queryClient.fetchQuery(orpc.catalog.queryOptions());
    window.location.hash = `#query/${encodeURIComponent(result.id)}`;
  };
  const handleDelete = async () => {
    if (!window.confirm(`Delete query "${entry.id}"?`)) {
      return;
    }
    await deleteMutation.mutateAsync({queryId: entry.id});
    const catalog = await queryClient.fetchQuery(orpc.catalog.queryOptions());
    const nextQuery = catalog.queries.find((entry) => entry.kind === 'query');
    window.location.hash = nextQuery ? `#query/${encodeURIComponent(nextQuery.id)}` : '#sql';
  };

  return (
    <QueryWorkbench
      workbenchKey={entry.id}
      title={renameMode ? renameDraft : entry.id}
      titleEditor={
        renameMode ? (
          <div className="inline-editor">
            <input
              aria-label="Query title"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.currentTarget.value)}
            />
            <button className="button primary" type="button" aria-label="Confirm query rename" onClick={handleRename}>
              Save
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setRenameDraft(entry.id);
                setRenameMode(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : undefined
      }
      titleActions={
        !renameMode ? (
          <>
            <button className="icon-button" type="button" aria-label="Rename query" onClick={() => setRenameMode(true)}>
              ✎
            </button>
            <button className="icon-button danger" type="button" aria-label="Delete query" onClick={handleDelete}>
              🗑
            </button>
          </>
        ) : undefined
      }
      sql={sqlEditMode ? sqlDraft : entry.sqlFileContent}
      paramsSchema={entry.kind === 'query' ? buildExecutionSchema(entry) : undefined}
      paramsData={undefined}
      sqlEditorRelations={input.relations}
      sqlEditorDiagnostics={sqlEditMode ? analysisQuery.data?.diagnostics : undefined}
      sqlEditorLabel="Query SQL editor"
      sqlEditorActions={
        sqlEditMode
          ? [
              {
                icon: '💾',
                name: 'Confirm query SQL edit',
                title: 'Save query SQL edit',
                disabled: updateMutation.isPending,
                onAction: handleSqlSave,
              },
              {
                icon: '↩',
                name: 'Cancel query SQL edit',
                disabled: updateMutation.isPending,
                onAction: () => {
                  setSqlDraft(entry.sqlFileContent);
                  setSqlEditMode(false);
                },
              },
            ]
          : [
              {
                icon: '✎',
                name: 'Edit query SQL',
                onAction: () => setSqlEditMode(true),
              },
            ]
      }
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
          queryId: entry.id,
          data: isRecord(formData) && isRecord(formData.data) ? formData.data : undefined,
          params: isRecord(formData) && isRecord(formData.params) ? formData.params : undefined,
        })
      }
      running={mutation.isPending || renameMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
      executionError={
        mutation.error ??
        renameMutation.error ??
        updateMutation.error ??
        deleteMutation.error ??
        (entry.kind === 'error' && !sqlEditMode
          ? new Error(`Query error\n${entry.error.name}\n\n${entry.error.description}`)
          : undefined)
      }
      executionResult={mutation.data}
      emptyMessage={
        entry.kind === 'query' ? 'Submit form data to execute the query.' : 'Edit the SQL to repair this saved query.'
      }
      runLabel="Run query"
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
  sqlEditorRelations?: StudioRelation[];
  sqlEditorDiagnostics?: SqlEditorDiagnostic[];
  sqlEditorOnExecute?: (value: string) => void;
  sqlEditorOnSave?: (value: string) => void;
  sqlEditorActions?: CodeMirrorAction[];
  paramsSchema?: RJSFSchema;
  paramsData?: Record<string, unknown>;
  readonlyMeta?: ReactNode;
  sqlEditorLabel?: string;
  onSqlChange?: (value: string) => void;
  onParamsChange?: (value: Record<string, unknown>) => void;
  onRun: (formData?: unknown) => void;
  onSave?: () => void;
  showParamActions?: boolean;
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
  const showParamActions = input.showParamActions !== false;
  const showParamsCard = Boolean(input.paramsSchema) || showParamActions;

  return (
    <section className="panel">
      <header className="panel-header">
        <div>{input.titleEditor ?? <h2>{input.title}</h2>}</div>
        <div className="panel-header-actions">
          {input.readonlyMeta ? <div className="pill-row">{input.readonlyMeta}</div> : null}
          {input.titleActions ? <div className="pill-row">{input.titleActions}</div> : null}
        </div>
      </header>

      <div className={showParamsCard ? 'split-grid' : 'split-grid single'}>
        <section className="card">
          {input.sqlCardTitle ? (
            <div className="card-title-row">
              <div className="card-title">{input.sqlCardTitle}</div>
            </div>
          ) : null}
          {input.editable ? (
            <div className="form-label">
              <SqlCodeMirror
                value={input.sql}
                ariaLabel={input.sqlEditorLabel ?? 'SQL editor'}
                relations={input.sqlEditorRelations ?? []}
                diagnostics={input.sqlEditorDiagnostics}
                onExecute={input.sqlEditorOnExecute}
                onSave={input.sqlEditorOnSave}
                onChange={(value) => input.onSqlChange?.(value)}
                actions={input.sqlEditorActions}
              />
            </div>
          ) : (
            <SqlCodeMirror
              value={input.sql}
              ariaLabel={input.sqlEditorLabel ?? 'Saved query SQL'}
              relations={input.sqlEditorRelations ?? []}
              readOnly
              onChange={() => {}}
              actions={input.sqlEditorActions}
            />
          )}
        </section>

        {showParamsCard ? (
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
                  {showParamActions ? (
                    <div className="actions">
                      <button className="button primary" type="submit">
                        {input.runLabel}
                      </button>
                      {input.onSave ? (
                        <button className="button" type="button" onClick={() => input.onSave?.()}>
                          {input.saveLabel}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div />
                  )}
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
        ) : null}
      </div>

      <section className="card">
        <div className="card-title">Result</div>
        {input.running ? <p>Running…</p> : null}
        {input.executionError ? <ErrorView error={input.executionError} /> : null}
        {input.successMessage ? <p>{input.successMessage}</p> : null}
        {input.executionResult ? (
          <ExecutionResult storageKey={input.workbenchKey ?? input.title} result={input.executionResult} />
        ) : (
          <p className="muted">{input.emptyMessage}</p>
        )}
      </section>
    </section>
  );
}

function ExecutionResult(input: {storageKey: string; result: QueryExecutionResponse | SqlRunnerResponse}) {
  if (input.result.mode === 'metadata') {
    return <pre className="code-block">{JSON.stringify(input.result.metadata, null, 2)}</pre>;
  }

  const rows = input.result.rows ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return (
    <DataTable
      storageKey={`execution-result/${input.storageKey}`}
      columns={columns}
      rows={rows}
      showSelectedCellDetail
    />
  );
}

type RowActionCell = reactGrid.Cell & {
  type: 'rowAction';
  text: string;
  ariaLabel: string;
  onClick: () => void;
};

const rowActionCellTemplate: reactGrid.CellTemplate<RowActionCell> = {
  getCompatibleCell(uncertainCell) {
    const text = typeof uncertainCell.text === 'string' ? uncertainCell.text : '';
    return {
      ...uncertainCell,
      type: 'rowAction',
      text,
      value: Number.NaN,
      ariaLabel: typeof uncertainCell.ariaLabel === 'string' ? uncertainCell.ariaLabel : text,
      onClick: typeof uncertainCell.onClick === 'function' ? uncertainCell.onClick : () => {},
    };
  },
  isFocusable() {
    return false;
  },
  render(cell) {
    return (
      <button
        className="row-action-button"
        type="button"
        aria-label={cell.ariaLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cell.onClick();
        }}
      >
        {cell.text}
      </button>
    );
  },
};

type DataCellMeta = {
  draftText: string;
  originalText: string;
  label: string;
  dirty: boolean;
  relationActions?: DataCellRelationAction[];
};

type DataCellRelationAction = {
  label: string;
  heading: string;
  sql: string;
  href: string;
  params: QueryArg[];
};

type DataTextCell = reactGrid.TextCell & {meta?: DataCellMeta};
type DataNumberCell = reactGrid.NumberCell & {meta?: DataCellMeta};

class DataTextCellTemplate extends reactGrid.TextCellTemplate {
  getCompatibleCell(uncertainCell: reactGrid.Uncertain<DataTextCell>): reactGrid.Compatible<DataTextCell> {
    return {...super.getCompatibleCell(uncertainCell), meta: uncertainCell.meta};
  }
  update(
    cell: reactGrid.Compatible<DataTextCell>,
    cellToMerge: reactGrid.UncertainCompatible<DataTextCell>,
  ): reactGrid.Compatible<DataTextCell> {
    return {...super.update(cell, cellToMerge), meta: cell.meta};
  }
  render(cell: reactGrid.Compatible<DataTextCell>, isInEditMode: boolean, onCellChanged: any): any {
    const inner = super.render(cell, isInEditMode, onCellChanged);
    if (isInEditMode || !cell.meta) return inner;
    return (
      <span className="cell-content-wrap">
        {inner}
        <DataCellTriggers meta={cell.meta} />
      </span>
    );
  }
}

class DataNumberCellTemplate extends reactGrid.NumberCellTemplate {
  getCompatibleCell(uncertainCell: reactGrid.Uncertain<DataNumberCell>): reactGrid.Compatible<DataNumberCell> {
    return {...super.getCompatibleCell(uncertainCell), meta: uncertainCell.meta};
  }
  update(
    cell: reactGrid.Compatible<DataNumberCell>,
    cellToMerge: reactGrid.UncertainCompatible<DataNumberCell>,
  ): reactGrid.Compatible<DataNumberCell> {
    return {...super.update(cell, cellToMerge), meta: cell.meta};
  }
  render(cell: reactGrid.Compatible<DataNumberCell>, isInEditMode: boolean, onCellChanged: any): any {
    const inner = super.render(cell, isInEditMode, onCellChanged);
    if (isInEditMode || !cell.meta) return inner;
    return (
      <span className="cell-content-wrap">
        {inner}
        <DataCellTriggers meta={cell.meta} />
      </span>
    );
  }
}

const customCellTemplates = {
  rowAction: rowActionCellTemplate,
  text: new DataTextCellTemplate(),
  number: new DataNumberCellTemplate(),
};
const ROW_ACTION_COLUMN_WIDTH = 42;
const GRID_ROW_HEIGHT = 34;

function DataTable(input: {
  storageKey: string;
  columns: string[];
  rowKeys?: TableRowsResponse['rowKeys'];
  originalRows?: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  editable?: boolean;
  editableColumns?: Readonly<Record<string, boolean>>;
  onRowsChange?: (rows: Record<string, unknown>[]) => void;
  onAppendRow?: () => void;
  onDeleteRow?: (rowIndex: number) => void;
  showSelectedCellDetail?: boolean;
  getRelationActions?: (input: {
    row: Record<string, unknown>;
    rowIndex: number;
    column: string;
  }) => DataCellRelationAction[];
  toolbar?: ReactNode;
}) {
  if (input.rows.length === 0 && !(input.editable && input.onAppendRow)) {
    return (
      <>
        {input.toolbar ? <div className="data-toolbar">{input.toolbar}</div> : null}
        <p className="muted">No rows.</p>
      </>
    );
  }

  const {ref: containerRef, width: containerWidth} = useElementWidth<HTMLDivElement>();
  const [columnWidthOverrides, setColumnWidthOverrides] = useLocalStorageState<Record<string, number>>(
    `sqlfu-ui/column-widths/${input.storageKey}`,
    {
      defaultValue: {},
    },
  );
  const [selectedCell, setSelectedCell] = useState<{rowId: number; columnId: string} | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useLocalStorageState<number | null>(
    `sqlfu-ui/selected-row/${input.storageKey}`,
    {
      defaultValue: null,
    },
  );
  const pendingFocusRef = useRef<{rowId: number; columnId: string} | null>(null);
  const computedColumnWidths = columnWidthAlgorithm({
    availableWidth: Math.max(0, containerWidth - ROW_ACTION_COLUMN_WIDTH),
    columns: input.columns.map((column) => ({
      key: column,
      header: column,
      cells: input.rows.map((row) => formatCellText(row[column])),
    })),
  });
  const gridColumns: reactGrid.Column[] = [
    {columnId: '__row__', width: ROW_ACTION_COLUMN_WIDTH, reorderable: false, resizable: false},
    ...computedColumnWidths.map((column) => ({
      columnId: column.key,
      width: columnWidthOverrides?.[column.key] ?? column.width,
      reorderable: false,
      resizable: true,
    })),
  ];
  const gridRows: reactGrid.Row<reactGrid.DefaultCellTypes | RowActionCell>[] = [
    {
      rowId: 'header',
      height: GRID_ROW_HEIGHT,
      cells: [
        {type: 'header', text: ''},
        ...input.columns.map((column) => ({
          type: 'header' as const,
          text: column,
        })),
      ],
    },
    ...input.rows.map((row, rowIndex) => ({
      rowId: rowIndex,
      height: GRID_ROW_HEIGHT,
      cells: [
        {
          type: 'rowAction' as const,
          text: selectedRowIndex === rowIndex ? '🗑' : '',
          className: joinCellClassNames('row-action-cell', selectedRowIndex === rowIndex ? 'selected-row' : undefined),
          ariaLabel: selectedRowIndex === rowIndex ? `Delete row ${rowIndex + 1}` : `Select row ${rowIndex + 1}`,
          onClick: () => {
            if (selectedRowIndex === rowIndex) {
              // Unarm before firing so a cancelled confirmation leaves no stuck state.
              setSelectedRowIndex(null);
              input.onDeleteRow?.(rowIndex);
              return;
            }
            setSelectedRowIndex(rowIndex);
            setSelectedCell(null);
          },
        },
        ...input.columns.map((column) => {
          const draft = row[column];
          const original = input.originalRows?.[rowIndex]?.[column];
          const dirty = isDirtyDataCell(input.originalRows, rowIndex, column, draft);
          const meta: DataCellMeta | undefined = input.showSelectedCellDetail
            ? {
                draftText: formatCellText(draft),
                originalText: formatCellText(original),
                label: `Cell: ${column}, row ${rowIndex + 1}`,
                dirty,
                relationActions: input.getRelationActions?.({row, rowIndex, column}),
              }
            : undefined;
          return toGridCell(
            draft,
            isEditableDataCell(input, rowIndex, column),
            joinCellClassNames(
              selectedRowIndex === rowIndex ? 'selected-row' : undefined,
              dirty ? 'dirty-cell' : undefined,
              selectedCell?.rowId === rowIndex && selectedCell.columnId === column ? 'cell-expand-active' : undefined,
            ),
            meta,
          );
        }),
      ],
    })),
    ...(input.editable && input.onAppendRow
      ? [
          {
            rowId: '__append__',
            height: GRID_ROW_HEIGHT,
            cells: [
              {type: 'header' as const, text: '+'},
              ...input.columns.map(() => ({
                type: 'text' as const,
                text: '',
                nonEditable: true,
                className: 'append-row-cell',
              })),
            ],
          },
        ]
      : []),
  ];
  return (
    <div className="stack">
      {input.toolbar ? <div className="data-toolbar">{input.toolbar}</div> : null}
      <div className="table-scroll" ref={containerRef}>
        <reactGrid.ReactGrid
          customCellTemplates={customCellTemplates}
          columns={gridColumns}
          rows={gridRows}
          focusLocation={
            pendingFocusRef.current &&
            pendingFocusRef.current.rowId >= 0 &&
            pendingFocusRef.current.rowId < input.rows.length &&
            input.columns.includes(pendingFocusRef.current.columnId)
              ? pendingFocusRef.current
              : undefined
          }
          stickyTopRows={1}
          stickyLeftColumns={1}
          enableColumnResizeOnAllHeaders
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
            if (location.rowId === '__append__' && input.onAppendRow) {
              if (typeof location.columnId === 'string' && location.columnId !== '__row__') {
                pendingFocusRef.current = {
                  rowId: input.rows.length,
                  columnId: location.columnId,
                };
              }
              input.onAppendRow();
              return;
            }
            if (typeof location.rowId !== 'number' || typeof location.columnId !== 'string') {
              return;
            }
            setSelectedRowIndex(null);
            if (
              pendingFocusRef.current &&
              pendingFocusRef.current.rowId === location.rowId &&
              pendingFocusRef.current.columnId === location.columnId
            ) {
              pendingFocusRef.current = null;
            }
            setSelectedCell({
              rowId: location.rowId,
              columnId: location.columnId,
            });
          }}
          onCellsChanged={
            input.editable
              ? (changes) => {
                  const nextRows = input.rows.map((row) => ({...row}));
                  for (const change of changes) {
                    if (typeof change.rowId !== 'number' || typeof change.columnId !== 'string') {
                      continue;
                    }
                    const nextRow = nextRows[change.rowId];
                    if (!nextRow) {
                      continue;
                    }
                    if (!isEditableDataCell(input, change.rowId, change.columnId)) {
                      continue;
                    }
                    nextRow[change.columnId] = readGridCellValue(change.newCell);
                  }
                  input.onRowsChange?.(nextRows);
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function DataCellExpandTrigger(input: {meta: DataCellMeta}) {
  const [mode, setMode] = useState<'diff' | 'original' | 'draft'>('diff');
  const contentRef = useRef<HTMLDivElement>(null);
  const showDiffTabs = input.meta.dirty && input.meta.originalText !== 'null' && input.meta.originalText !== '';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="cell-expand-button"
          aria-label={input.meta.label}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CellExpandIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          tabIndex={-1}
          className="rqp-popover rqp-popover-wide"
          align="end"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDownCapture={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CellDetailPopoverBody
            label={input.meta.label}
            selectedOriginalValue={input.meta.originalText}
            selectedDraftValue={input.meta.draftText}
            showDiffTabs={showDiffTabs}
            selectedCellMode={mode}
            setSelectedCellMode={setMode}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DataCellTriggers(input: {meta: DataCellMeta}) {
  return (
    <>
      <DataCellExpandTrigger meta={input.meta} />
      {input.meta.relationActions?.length ? <DataCellRelationTrigger actions={input.meta.relationActions} /> : null}
    </>
  );
}

function DataCellRelationTrigger(input: {actions: DataCellRelationAction[]}) {
  const label = input.actions.length === 1 ? input.actions[0]!.label : `Open ${input.actions.length} related row views`;
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="cell-expand-button cell-relation-button"
          aria-label={label}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <RelationJumpIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          tabIndex={-1}
          className="rqp-popover rqp-popover-wide relation-preview-popover"
          align="end"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDownCapture={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="relation-preview-stack">
            {input.actions.map((action) => (
              <RelationPreviewAccordion key={`${action.heading}:${action.sql}`} action={action} />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RelationPreviewAccordion(input: {action: DataCellRelationAction}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="relation-preview-action" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="relation-preview-summary">
        <span className="relation-preview-summary-label">{input.action.heading}</span>
        <a
          className="relation-preview-open"
          href={input.action.href}
          aria-label={`Open ${input.action.heading} in sub view`}
          onClick={(event) => event.stopPropagation()}
        >
          <RelationJumpIcon />
          <span>Open in sub view</span>
        </a>
      </summary>
      {open ? <RelationPreviewPopoverBody action={input.action} /> : null}
    </details>
  );
}

function CellExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M3 6V3h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13 10v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 13H3v-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 3h3v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RelationJumpIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M5 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11 4 4 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RelationPreviewPopoverBody(input: {action: DataCellRelationAction}) {
  const query = useQuery({
    queryKey: ['relation-preview', input.action.sql, input.action.params.map(toQueryKeyParam)],
    queryFn: () =>
      orpcClient.sql.run({
        sql: input.action.sql,
        params: input.action.params,
      }),
  });
  const columns = query.data?.rows?.[0] ? Object.keys(query.data.rows[0]) : [];

  return (
    <div className="rqp-popover-body relation-preview-body" role="dialog" aria-label="Relation preview">
      <div className="card-title-row">
        <h2 className="card-title">{input.action.heading}</h2>
      </div>
      <code className="relation-preview-sql">{input.action.sql}</code>
      {query.error ? <ErrorView error={query.error} /> : null}
      {query.isLoading ? <p className="muted">Loading…</p> : null}
      {query.data?.rows?.length === 0 ? <p className="muted">No rows.</p> : null}
      {query.data?.rows?.length ? (
        <div className="relation-preview-table-wrap">
          <table className="relation-preview-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column) => (
                    <td key={column}>{renderCell(row[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function CellDetailPopoverBody(input: {
  label: string;
  selectedOriginalValue: string;
  selectedDraftValue: string;
  showDiffTabs: boolean;
  selectedCellMode: 'diff' | 'original' | 'draft';
  setSelectedCellMode: (mode: 'diff' | 'original' | 'draft') => void;
}) {
  return (
    <div className="rqp-popover-body" role="dialog" aria-label="Cell detail">
      <div className="card-title-row">
        <div className="card-title">{input.label}</div>
      </div>
      {input.showDiffTabs ? (
        <div className="stack">
          <div className="cell-panel-tabs" role="tablist" aria-label="Cell versions">
            <button
              className={input.selectedCellMode === 'diff' ? 'cell-panel-tab active' : 'cell-panel-tab'}
              type="button"
              role="tab"
              aria-selected={input.selectedCellMode === 'diff'}
              onClick={() => input.setSelectedCellMode('diff')}
            >
              Diff
            </button>
            <button
              className={input.selectedCellMode === 'original' ? 'cell-panel-tab active' : 'cell-panel-tab'}
              type="button"
              role="tab"
              aria-selected={input.selectedCellMode === 'original'}
              onClick={() => input.setSelectedCellMode('original')}
            >
              Original
            </button>
            <button
              className={input.selectedCellMode === 'draft' ? 'cell-panel-tab active' : 'cell-panel-tab'}
              type="button"
              role="tab"
              aria-selected={input.selectedCellMode === 'draft'}
              onClick={() => input.setSelectedCellMode('draft')}
            >
              Draft
            </button>
          </div>
          {input.selectedCellMode === 'original' ? (
            <TextCodeMirror
              value={input.selectedOriginalValue}
              ariaLabel="Original cell value"
              readOnly
              height="12rem"
            />
          ) : null}
          {input.selectedCellMode === 'draft' ? (
            <TextCodeMirror value={input.selectedDraftValue} ariaLabel="Draft cell value" readOnly height="12rem" />
          ) : null}
          {input.selectedCellMode === 'diff' ? (
            <TextDiffCodeMirror
              original={input.selectedOriginalValue}
              draft={input.selectedDraftValue}
              ariaLabel="Diff cell value"
            />
          ) : null}
        </div>
      ) : (
        <TextCodeMirror value={input.selectedDraftValue} ariaLabel="Cell value" readOnly height="12rem" />
      )}
    </div>
  );
}

function isDirtyDataCell(
  originalRows: Record<string, unknown>[] | undefined,
  rowIndex: number,
  columnId: string,
  value: unknown,
) {
  if (!originalRows) {
    return false;
  }

  return !isSameValue(value, originalRows[rowIndex]?.[columnId]);
}

function isEditableDataCell(
  input: {
    editable?: boolean;
    editableColumns?: Readonly<Record<string, boolean>>;
    rowKeys?: TableRowsResponse['rowKeys'];
  },
  rowIndex: number,
  columnId: string,
) {
  if (!input.editable) {
    return false;
  }
  if (input.rowKeys?.[rowIndex]?.kind === 'new') {
    return true;
  }
  return input.editableColumns?.[columnId] !== false;
}

function EmptyState() {
  return (
    <section className="panel">
      <section className="card">
        <div className="card-title">No relations found</div>
        <p className="muted">
          Create `definitions.sql`, run migrations or sync, and add `.sql` files to start exploring.
        </p>
      </section>
    </section>
  );
}

function Shell(input: {children?: ReactNode; loading?: boolean}) {
  if (input.loading) {
    return (
      <main className="startup-shell">
        <ModeBanner />
        <section className="startup-card">
          <div className="eyebrow">Starting up</div>
          <h1>
            <code>sqlfu</code>
          </h1>
          <p className="startup-lede">Loading…</p>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <ModeBanner />
      {input.children}
    </div>
  );
}

function ThemeToggle() {
  const {preference, cycle} = useThemePreference();
  const label =
    preference === 'light'
      ? 'Theme: light (click for dark)'
      : preference === 'dark'
        ? 'Theme: dark (click for system)'
        : 'Theme: system (click for dark)';
  const glyph = preference === 'light' ? '☼' : preference === 'dark' ? '☾' : '◐';
  return (
    <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} onClick={cycle}>
      <span aria-hidden>{glyph}</span>
    </button>
  );
}

function ModeBanner() {
  if (!demoMode) {
    return null;
  }
  return (
    <div className="mode-banner demo">
      <strong>Demo mode</strong>
      <span>In-browser SQLite. Nothing is saved. Refresh to reset.</span>
      <a className="mode-banner-link" href={HOSTED_URL}>
        Back to sqlfu.dev/ui
      </a>
    </div>
  );
}

function TryDemoBanner() {
  if (demoMode) {
    return null;
  }
  return (
    <div className="mode-banner">
      <span>Want to try sqlfu without installing it? Demo mode runs entirely in-browser on sqlite-wasm.</span>
      <a className="mode-banner-link" href={DEMO_URL}>
        Open the demo →
      </a>
    </div>
  );
}

function ErrorView(input: {error: unknown}) {
  return <pre className="code-block error">{String(input.error)}</pre>;
}

async function runSchemaCommand(command: string) {
  const events = await orpcClient.schema.command({command});
  for await (const event of events) {
    if (event.kind === 'needsConfirmation') {
      const result = await confirmationDialogStore.confirm(event.params);
      await orpcClient.schema.submitConfirmation({
        id: event.id,
        body: result.confirmed && result.body != null ? result.body : null,
      });
    }
  }
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

function buildRelationActions(relation: StudioRelation, row: Record<string, unknown>, column: string) {
  return [...buildForwardRelationActions(relation, row, column), ...buildReverseRelationActions(relation, row, column)];
}

function buildForwardRelationActions(
  relation: StudioRelation,
  row: Record<string, unknown>,
  column: string,
): DataCellRelationAction[] {
  const foreignKeys = relation.foreignKeys.filter(
    (candidate) =>
      candidate.columns.length === 1 && candidate.referencedColumns.length === 1 && candidate.columns[0] === column,
  );
  const value = row[column];
  const queryArg = toQueryArg(value);
  if (queryArg === undefined) {
    return [];
  }
  return foreignKeys.map((foreignKey) => {
    const referencedColumn = foreignKey.referencedColumns[0]!;
    const heading = `${foreignKey.referencedRelation} where ${referencedColumn} = ${formatCellText(value)}`;
    const subviewSql = buildRelationSubviewSql(foreignKey.referencedRelation, referencedColumn, queryArg);
    return {
      label: `Open ${foreignKey.referencedRelation} row for ${column} ${formatCellText(value)}`,
      heading,
      sql: `select * from ${quoteSqlIdentifier(foreignKey.referencedRelation)} where ${quoteSqlIdentifier(referencedColumn)} = ? limit 100`,
      href: buildRelationSubviewHash(foreignKey.referencedRelation, subviewSql),
      params: [queryArg],
    };
  });
}

function buildReverseRelationActions(
  relation: StudioRelation,
  row: Record<string, unknown>,
  column: string,
): DataCellRelationAction[] {
  const reverseRelations = relation.referencedBy.filter(
    (candidate) =>
      candidate.columns.length === 1 &&
      candidate.referencedColumns.length === 1 &&
      candidate.referencedColumns[0] === column,
  );
  const value = row[column];
  const queryArg = toQueryArg(value);
  if (queryArg === undefined) {
    return [];
  }
  return reverseRelations.map((reverse) => {
    const childColumn = reverse.columns[0]!;
    const heading = `${reverse.relation} where ${childColumn} = ${formatCellText(value)}`;
    const subviewSql = buildRelationSubviewSql(reverse.relation, childColumn, queryArg);
    return {
      label: `Open related ${reverse.relation} rows for ${column} ${formatCellText(value)}`,
      heading,
      sql: `select * from ${quoteSqlIdentifier(reverse.relation)} where ${quoteSqlIdentifier(childColumn)} = ? limit 100`,
      href: buildRelationSubviewHash(reverse.relation, subviewSql),
      params: [queryArg],
    };
  });
}

function buildRelationSubviewHash(relationName: string, sql: string) {
  return `${buildTableHash(relationName)}?sql=${encodeURIComponent(sql)}`;
}

function toQueryArg(value: unknown): QueryArg | undefined {
  if (value == null) return undefined;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return undefined;
}

function toQueryKeyParam(value: QueryArg) {
  if (typeof value === 'bigint') return `bigint:${String(value)}`;
  if (value instanceof Uint8Array) return `bytes:${Array.from(value).join(',')}`;
  return value;
}

function toGridCell(
  value: unknown,
  editable: boolean,
  className: string | undefined,
  meta: DataCellMeta | undefined,
): reactGrid.DefaultCellTypes {
  if (typeof value === 'number') {
    return {type: 'number', value, nonEditable: !editable, className, meta} as DataNumberCell;
  }

  if (typeof value === 'boolean') {
    return {type: 'checkbox', checked: value, nonEditable: !editable, className};
  }

  if (value == null) {
    return {type: 'text', text: '', nonEditable: !editable, className, meta} as DataTextCell;
  }

  if (typeof value === 'object') {
    return {type: 'text', text: JSON.stringify(value), nonEditable: true, className, meta} as DataTextCell;
  }

  return {type: 'text', text: String(value), nonEditable: !editable, className, meta} as DataTextCell;
}

function joinCellClassNames(...classNames: Array<string | undefined>) {
  const value = classNames.filter(Boolean).join(' ');
  return value || undefined;
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

function renderSchemaRecommendationSummary(recommendation: SchemaCheckResponse['recommendations'][number]): ReactNode {
  const nodes: ReactNode[] = [<span key="label">{formatSchemaRecommendationLabel(recommendation)}</span>];
  if (recommendation.rationale) {
    nodes.push(<span key="rationale"> ({recommendation.rationale})</span>);
  }
  return nodes;
}

function formatSchemaCommand(command: [string, ...string[]]) {
  return ['sqlfu', ...command].join(' ');
}

function formatSchemaRecommendationLabel(recommendation: SchemaCheckResponse['recommendations'][number]) {
  const label = recommendation.label.replace(/\.$/u, '');
  const target = recommendation.command?.at(1);
  return target ? `${label}. Target: ${target}.` : `${label}.`;
}

function getSchemaCardLabel(card: SchemaCheckResponse['cards'][number]) {
  return (card.ok ? card.okTitle : card.title).replace(/^[^\p{L}\p{N}]+\s*/u, '');
}

function getSchemaCardStatusIcon(card: SchemaCheckResponse['cards'][number]) {
  switch (card.variant) {
    case 'ok':
      return '✅';
    case 'info':
      return 'ℹ';
    case 'warn':
      return '⚠';
  }
}

function RelationKindIcon(input: {kind: 'table' | 'view'}) {
  // Tables are a 3×3 grid; views are an eye centered inside a rounded box (a derived view of a table).
  if (input.kind === 'view') {
    return (
      <svg className="nav-link-icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.5 8c1-2 5-2 6 0c-1 2-5 2-6 0z" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="nav-link-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="6" y1="6.5" x2="6" y2="13" stroke="currentColor" strokeWidth="1.2" />
      <line x1="10" y1="6.5" x2="10" y2="13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function QueryIcon() {
  return (
    <svg className="nav-link-icon" viewBox="0 0 16 16" aria-hidden="true">
      <ellipse cx="8" cy="4" rx="5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function getSidebarToggleLabel(input: {
  route: Route;
  selectedTable: StudioRelation | undefined;
  selectedQuery: QueryCatalogEntry | undefined;
}) {
  if (input.route.kind === 'sql') {
    return 'SQL runner';
  }
  if (input.route.kind === 'table') {
    return input.selectedTable ? input.selectedTable.name : input.route.name;
  }
  if (input.route.kind === 'query') {
    return input.selectedQuery ? input.selectedQuery.id : input.route.id;
  }
  return 'Schema';
}

function collapseSidebarAfterNavigation(event: MouseEvent<HTMLAnchorElement>) {
  if (window.matchMedia(mobileSidebarMediaQuery).matches) {
    event.currentTarget.closest('details.sidebar-shell')?.removeAttribute('open');
  }
}

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const queryList = window.matchMedia(query);
      queryList.addEventListener('change', onStoreChange);
      return () => queryList.removeEventListener('change', onStoreChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

const compactNumberFormatter = new Intl.NumberFormat('en', {notation: 'compact', maximumFractionDigits: 1});
function formatRowCount(count: number) {
  if (count < 1000) return String(count);
  return compactNumberFormatter.format(count);
}

function isSameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isEmptyDraftRow(row: Record<string, unknown>, columnNames: string[]): boolean {
  return columnNames.every((column) => {
    const value = row[column];
    return value === null || value === undefined || value === '';
  });
}

function buildDeleteRowPreviewSql(
  relationName: string,
  rowKey:
    | {kind: 'rowid'; value: number}
    | {kind: 'primaryKey'; values: Readonly<Record<string, unknown>>}
    | {kind: 'new'; value: string},
): string {
  const quoted = `"${relationName.replaceAll('"', '""')}"`;
  if (rowKey.kind === 'rowid') {
    return `delete from ${quoted}\nwhere rowid = ${rowKey.value};`;
  }
  if (rowKey.kind === 'primaryKey') {
    const conditions = Object.entries(rowKey.values).map(([column, value]) =>
      value == null
        ? `"${column.replaceAll('"', '""')}" is null`
        : `"${column.replaceAll('"', '""')}" = ${formatSqlLiteralPreview(value)}`,
    );
    return `delete from ${quoted}\nwhere ${conditions.join(' and ')};`;
  }
  return `-- unsaved row; nothing to delete`;
}

function formatSqlLiteralPreview(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeStoredTableDraft(
  draftRows: Record<string, unknown>[] | undefined,
  fetchedRows: Record<string, unknown>[],
  columns: string[],
) {
  if (!draftRows) {
    return fetchedRows;
  }

  if (draftRows.length < fetchedRows.length) {
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

  const subscribe = useCallback((listener: () => void) => {
    storeRef.current.listeners.add(listener);
    return () => {
      storeRef.current.listeners.delete(listener);
    };
  }, []);
  const getSnapshot = useCallback(() => storeRef.current.width, []);
  const width = useSyncExternalStore(subscribe, getSnapshot, () => 0);
  const ref = useCallback((element: TElement | null) => {
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
  }, []);

  return {
    width,
    ref,
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
    return {kind: 'schema'};
  }

  const [path, query = ''] = value.split('?');
  const [kind, first] = path.split('/').map(decodeURIComponent);
  if (kind === 'schema') {
    return {kind: 'schema'};
  }
  if (kind === 'sql') {
    return {kind: 'sql'};
  }
  if (kind === 'table' && first) {
    const params = new URLSearchParams(query);
    return {kind: 'table', name: first, subviewSql: params.get('sql') || undefined};
  }
  if (kind === 'query' && first) {
    return {kind: 'query', id: first};
  }
  return {kind: 'home'};
}

function buildTableHash(name: string) {
  return `#table/${encodeURIComponent(name)}`;
}

function selectTable(route: Route, relations: StudioRelation[]) {
  if (route.kind === 'table') {
    return relations.find((relation) => relation.name === route.name) ?? relations[0];
  }
  return relations[0];
}

function selectQuery(route: Route, queries: QueryCatalogEntry[]) {
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

  return Object.fromEntries(Object.entries(formData).filter(([key]) => key in schema.properties!));
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
  sql: string;
  params: Record<string, unknown>;
};

function slugifyPromptName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function suggestSqlRunnerName(sql: string) {
  const simpleFromMatch = /^\s*select\s+\*\s+from\s+([a-z_][a-z0-9_]*)\b/im.exec(sql);
  if (simpleFromMatch?.[1] && !simpleFromMatch[1].startsWith('sqlfu_')) {
    return slugifyPromptName(`from ${simpleFromMatch[1]}`);
  }
  return slugifyPromptName(queryNickname(sql));
}

function normalizeSqlDraft(value: string) {
  return value.trimEnd();
}

type DesiredSchemaFormatResult = {ok: true; sql: string} | {ok: false};

function formatDesiredSchemaDraft(sql: string): DesiredSchemaFormatResult {
  try {
    return {ok: true, sql: formatSqlFileContents(sql)};
  } catch {
    return {ok: false};
  }
}

function renderVersionMismatchLede(startupError: Extract<StartupFailure, {kind: 'version-mismatch'}>) {
  if (startupError.serverVersion) {
    return (
      <>
        Your local backend is running <code>sqlfu v{startupError.serverVersion}</code>, but this UI requires a version
        satisfying <code>{startupError.supportedRange}</code>.
      </>
    );
  }
  return (
    <>
      Your local backend does not satisfy <code>{startupError.supportedRange}</code> (it pre-dates the version-reporting
      RPC field). Upgrading will fix the mismatch.
    </>
  );
}

// demo-mode boot can fail for reasons that have nothing to do with the localhost
// backend (wasm init, missing browser apis, ios WebKit quirks). the generic
// StartupFailureScreen talks about `npx sqlfu` and mkcert, which is misleading
// here — so demo mode gets its own screen that surfaces the actual error.
function DemoStartupFailureScreen(input: {error: unknown}) {
  const message = String(input.error);
  const stack = input.error instanceof Error ? input.error.stack : undefined;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;

  return (
    <main className="startup-shell">
      <section className="startup-card">
        <h1>
          <code>sqlfu</code> demo didn&apos;t load
        </h1>
        <p className="startup-lede">
          The demo runs entirely in your browser on sqlite-wasm. Something went wrong during startup — see the error
          below.
        </p>

        <div className="startup-grid">
          <section className="startup-section">
            <h2>Error</h2>
            <pre className="startup-error-pre">{message}</pre>
            {stack ? (
              <details>
                <summary>Stack trace</summary>
                <pre className="startup-error-pre">{stack}</pre>
              </details>
            ) : null}
            <p>
              User agent: <code>{userAgent}</code>
            </p>
            <div className="startup-actions">
              <button className="button primary" type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </section>

          <section className="startup-section">
            <h2>What to try</h2>
            <ul className="startup-steps">
              <li>Reload the page.</li>
              <li>
                Open in a recent desktop Chrome, Firefox, Edge, or Safari — mobile browsers (especially iOS) may hit
                wasm limits the desktop demo doesn&apos;t.
              </li>
              <li>
                If it still fails, open an issue with the error above at{' '}
                <a
                  className="startup-link"
                  href="https://github.com/mmkal/sqlfu/issues/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/mmkal/sqlfu/issues
                </a>
                .
              </li>
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}

function detectBrowserName() {
  const userAgent = navigator.userAgent;
  if (/Brave/u.test(userAgent) || 'brave' in navigator) {
    return 'Brave';
  }
  if (
    /Safari\//u.test(userAgent) &&
    !/Chrome\//u.test(userAgent) &&
    !/Chromium/u.test(userAgent) &&
    !/Edg\//u.test(userAgent)
  ) {
    return 'Safari';
  }
  if (/Edg\//u.test(userAgent)) {
    return 'Edge';
  }
  if (/Chromium/u.test(userAgent)) {
    return 'Chromium';
  }
  if (/Chrome\//u.test(userAgent)) {
    return 'Chrome';
  }
  return 'browser';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type Route =
  | {
      kind: 'home';
    }
  | {
      kind: 'schema';
    }
  | {
      kind: 'sql';
    }
  | {
      kind: 'table';
      name: string;
      subviewSql?: string;
    }
  | {
      kind: 'query';
      id: string;
    };

createRoot(document.getElementById('root')!).render(<App />);
