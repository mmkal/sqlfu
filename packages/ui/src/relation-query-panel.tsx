import {useEffect, useState} from 'react';
import useLocalStorageState from 'use-local-storage-state';
import {useQuery} from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';

import type {StudioRelation} from './shared.js';
import {
  FILTER_OPERATORS,
  buildRelationQuery,
  defaultRelationQueryState,
  isDefaultRelationQueryState,
  operatorTakesValue,
  type FilterOperator,
  type RelationQueryFilter,
  type RelationQuerySort,
  type RelationQueryState,
} from './relation-query-builder.js';
import {SqlCodeMirror} from './sql-codemirror.js';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000];

export type RelationQuerySqlResult = {
  rows?: Record<string, unknown>[];
  mode?: string;
};

export type RelationRowEditing = {
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
};

export type RelationQueryPanelProps = {
  relation: StudioRelation;
  runSql: (input: {sql: string}) => Promise<RelationQuerySqlResult>;
  rowEditing?: RelationRowEditing;
  renderDefaultDataTable: (input: {toolbar: React.ReactNode}) => React.ReactNode;
  renderSqlDataTable: (input: {
    rows: Record<string, unknown>[];
    columns: string[];
    storageKey: string;
    toolbar: React.ReactNode;
  }) => React.ReactNode;
};

export function RelationQueryPanel(input: RelationQueryPanelProps) {
  const {relation} = input;
  const allColumns = relation.columns.map((c) => c.name);

  const [state, setState] = useLocalStorageState<RelationQueryState>(
    `sqlfu-ui/relation-query/${relation.name}`,
    {defaultValue: defaultRelationQueryState({tableName: relation.name, allColumns})},
  );
  const [customSql, setCustomSql] = useLocalStorageState<string | null>(
    `sqlfu-ui/relation-query-custom/${relation.name}`,
    {defaultValue: null},
  );

  const safeState = reconcileState(state, relation.name, allColumns);
  const generatedSql = buildRelationQuery(safeState);
  const effectiveSql = customSql ?? generatedSql;
  const isStructured = customSql === null;
  const isDefault = isStructured && isDefaultRelationQueryState(safeState);
  const activeFilterCount = safeState.filters.length;
  const hiddenCount = safeState.hiddenColumns.length;
  const visibleColumnCount = allColumns.length - hiddenCount;

  const limitMissing = !hasLimitClause(effectiveSql);
  const runQuery = useQuery({
    queryKey: ['relation-query', relation.name, effectiveSql],
    queryFn: () => input.runSql({sql: effectiveSql}),
    enabled: !isDefault && !limitMissing,
    placeholderData: (previous) => previous,
  });

  const mutate = (updater: (previous: RelationQueryState) => RelationQueryState) => {
    if (!isStructured) setCustomSql(null);
    setState((previous) => updater(reconcileState(previous, relation.name, allColumns)));
  };

  const handleSortToggle = (column: string) => {
    mutate((s) => ({...s, sorts: toggleSort(s.sorts, column)}));
  };
  const handleSortClear = () => mutate((s) => ({...s, sorts: []}));

  const handleFilterApply = (filter: RelationQueryFilter) => {
    mutate((s) => {
      const index = s.filters.findIndex((f) => f.column === filter.column);
      return {
        ...s,
        filters: index >= 0 ? s.filters.map((f, i) => (i === index ? filter : f)) : [...s.filters, filter],
      };
    });
  };
  const handleFilterRemove = (column: string) => {
    mutate((s) => ({...s, filters: s.filters.filter((f) => f.column !== column)}));
  };
  const handleFilterClearAll = () => mutate((s) => ({...s, filters: []}));

  const handleColumnToggle = (column: string) => {
    mutate((s) => {
      const hidden = new Set(s.hiddenColumns);
      if (hidden.has(column)) hidden.delete(column);
      else hidden.add(column);
      return {...s, hiddenColumns: allColumns.filter((c) => hidden.has(c))};
    });
  };
  const handleColumnsShowAll = () => mutate((s) => ({...s, hiddenColumns: []}));

  const handleLimitChange = (value: number) => mutate((s) => ({...s, limit: Math.max(1, value), offset: 0}));
  const handlePrev = () => mutate((s) => ({...s, offset: Math.max(0, s.offset - s.limit)}));
  const handleNext = () => mutate((s) => ({...s, offset: s.offset + s.limit}));
  const handleReset = () => {
    setState(defaultRelationQueryState({tableName: relation.name, allColumns}));
    setCustomSql(null);
  };
  const handleSqlApply = (value: string) => {
    setCustomSql(value === generatedSql ? null : value);
  };

  const toolbar = (
    <RelationToolbar
      relation={relation}
      allColumns={allColumns}
      state={safeState}
      isStructured={isStructured}
      isDefault={isDefault}
      activeFilterCount={activeFilterCount}
      visibleColumnCount={visibleColumnCount}
      effectiveSql={effectiveSql}
      generatedSql={generatedSql}
      rowEditing={input.rowEditing}
      onSortToggle={handleSortToggle}
      onSortClear={handleSortClear}
      onFilterApply={handleFilterApply}
      onFilterRemove={handleFilterRemove}
      onFilterClearAll={handleFilterClearAll}
      onColumnToggle={handleColumnToggle}
      onColumnsShowAll={handleColumnsShowAll}
      onSqlApply={handleSqlApply}
      onPrev={handlePrev}
      onNext={handleNext}
      onLimitChange={handleLimitChange}
      onReset={handleReset}
    />
  );

  const rows = extractRows(runQuery.data);
  const columns = extractColumns(runQuery.data, safeState);
  const storageKey = `relation-query/${relation.name}`;

  return (
    <div className="rqp">
      {isDefault ? (
        input.renderDefaultDataTable({toolbar})
      ) : runQuery.error ? (
        <>
          <div className="data-toolbar">{toolbar}</div>
          <div className="error-view">{String((runQuery.error as Error).message ?? runQuery.error)}</div>
        </>
      ) : runQuery.isFetching && rows.length === 0 ? (
        <>
          <div className="data-toolbar">{toolbar}</div>
          <p className="muted">Loading…</p>
        </>
      ) : (
        input.renderSqlDataTable({rows, columns, storageKey, toolbar})
      )}
    </div>
  );
}

function RelationToolbar(input: {
  relation: StudioRelation;
  allColumns: string[];
  state: RelationQueryState;
  isStructured: boolean;
  isDefault: boolean;
  activeFilterCount: number;
  visibleColumnCount: number;
  effectiveSql: string;
  generatedSql: string;
  rowEditing: RelationRowEditing | undefined;
  onSortToggle: (column: string) => void;
  onSortClear: () => void;
  onFilterApply: (filter: RelationQueryFilter) => void;
  onFilterRemove: (column: string) => void;
  onFilterClearAll: () => void;
  onColumnToggle: (column: string) => void;
  onColumnsShowAll: () => void;
  onSqlApply: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onLimitChange: (value: number) => void;
  onReset: () => void;
}) {
  const sortLabel = (() => {
    if (input.state.sorts.length === 0) return null;
    const head = input.state.sorts[0]!;
    const extra = input.state.sorts.length - 1;
    return extra > 0 ? `${head.column} ${head.direction} +${extra}` : `${head.column} ${head.direction}`;
  })();
  const dirty = input.rowEditing?.dirty ?? false;
  return (
    <div className="rqp-toolbar" role="toolbar" aria-label="Relation query toolbar">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`rqp-pill-button${input.activeFilterCount > 0 ? ' is-active' : ''}`}
            aria-label={input.activeFilterCount > 0 ? `Filter — ${input.activeFilterCount} active` : 'Filter'}
            disabled={!input.isStructured}
          >
            <span className="rqp-pill-icon" aria-hidden="true">
              ⚡
            </span>
            <span>Filter</span>
            {input.activeFilterCount > 0 ? <span className="rqp-pill-badge">{input.activeFilterCount}</span> : null}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="rqp-popover" align="start" sideOffset={6}>
            <FilterManager
              allColumns={input.allColumns}
              filters={input.state.filters}
              onApply={input.onFilterApply}
              onRemove={input.onFilterRemove}
              onClearAll={input.onFilterClearAll}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`rqp-pill-button${sortLabel ? ' is-active' : ''}`}
            aria-label={sortLabel ? `Sort — ${sortLabel}` : 'Sort'}
            disabled={!input.isStructured}
          >
            <span className="rqp-pill-icon" aria-hidden="true">
              ⇅
            </span>
            <span>{sortLabel ?? 'Sort'}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="rqp-popover" align="start" sideOffset={6}>
            <SortManager
              allColumns={input.allColumns}
              sorts={input.state.sorts}
              onToggle={input.onSortToggle}
              onClear={input.onSortClear}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`rqp-pill-button${input.state.hiddenColumns.length > 0 ? ' is-active' : ''}`}
            aria-label={`Columns — ${input.visibleColumnCount} of ${input.allColumns.length} visible`}
            disabled={!input.isStructured}
          >
            <span className="rqp-pill-icon" aria-hidden="true">
              👁
            </span>
            <span>
              Columns {input.visibleColumnCount}/{input.allColumns.length}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="rqp-popover" align="start" sideOffset={6}>
            <ColumnsManager
              allColumns={input.allColumns}
              hiddenColumns={input.state.hiddenColumns}
              onToggle={input.onColumnToggle}
              onShowAll={input.onColumnsShowAll}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <span className="rqp-toolbar-divider" aria-hidden="true" />

      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`rqp-pill-button${!input.isDefault ? ' is-active' : ''}`}
            aria-label="Query SQL"
          >
            <span className="rqp-pill-icon" aria-hidden="true">
              ⟨⟩
            </span>
            <span>Query</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="rqp-popover rqp-popover-wide" align="start" sideOffset={6}>
            <QueryPopoverBody
              relation={input.relation}
              committedSql={input.effectiveSql}
              generatedSql={input.generatedSql}
              onApply={input.onSqlApply}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <span className="rqp-toolbar-divider" aria-hidden="true" />

      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="rqp-pill-button"
            aria-label="Table definition"
            disabled={!input.relation.sql}
          >
            <span className="rqp-pill-icon" aria-hidden="true">
              📐
            </span>
            <span>Definition</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="rqp-popover rqp-popover-wide" align="start" sideOffset={6}>
            <SqlCodeMirror
              value={input.relation.sql ?? ''}
              ariaLabel="Relation definition editor"
              relations={[input.relation]}
              onChange={() => {}}
              readOnly
              height="12rem"
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <span className="rqp-toolbar-spacer" />

      {input.rowEditing?.editable && dirty ? (
        <>
          <button
            type="button"
            className="rqp-pill-button primary"
            onClick={input.rowEditing.onSave}
            disabled={input.rowEditing.saving}
            aria-label="Save changes"
          >
            {input.rowEditing.saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            className="rqp-pill-button"
            onClick={input.rowEditing.onDiscard}
            disabled={input.rowEditing.saving}
            aria-label="Discard changes"
          >
            Discard
          </button>
          <span className="rqp-toolbar-divider" aria-hidden="true" />
        </>
      ) : null}

      <button
        type="button"
        className="rqp-icon-button"
        aria-label="Previous page"
        disabled={input.state.offset === 0}
        onClick={input.onPrev}
      >
        ←
      </button>
      <button
        type="button"
        className="rqp-icon-button"
        aria-label="Next page"
        onClick={input.onNext}
      >
        →
      </button>
      <PerPageMenu value={input.state.limit} onChange={input.onLimitChange} />
      <button
        type="button"
        className="rqp-pill-button"
        aria-label="Reset query to default"
        disabled={input.isDefault}
        onClick={input.onReset}
      >
        Reset
      </button>
    </div>
  );
}

function QueryPopoverBody(input: {
  relation: StudioRelation;
  committedSql: string;
  generatedSql: string;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(input.committedSql);
  useEffect(() => {
    setDraft(input.committedSql);
  }, [input.committedSql]);

  const limitMissing = !hasLimitClause(draft);
  const simpleShapeMatch = isSimpleSelectFromTable(draft, input.relation.name);
  const dirty = draft !== input.committedSql;
  const apply = () => {
    if (!limitMissing) input.onApply(draft);
  };
  return (
    <div className="rqp-query-body">
      <SqlCodeMirror
        value={draft}
        ariaLabel="Relation query editor"
        relations={[input.relation]}
        onChange={setDraft}
        onExecute={apply}
        height="7rem"
      />
      <div className="rqp-query-message" aria-live="polite">
        {limitMissing ? (
          <div className="error-view rqp-query-message-inner">
            Your query must end with a <code>limit</code> clause. Apply is disabled until a limit is present.
          </div>
        ) : !simpleShapeMatch ? (
          <div className="info-callout rqp-query-message-inner">
            Your query is no longer a simple <code>select … from {input.relation.name}</code>. Consider opening it in
            the <a href="#sql">full SQL Runner</a> for more control.
          </div>
        ) : null}
      </div>
      <div className="rqp-query-actions">
        <span className="rqp-query-hint">
          {dirty ? 'Unapplied changes.' : 'No changes.'} <span className="rqp-query-shortcut">⌘↵</span> to apply.
        </span>
        <button type="button" className="rqp-pill-button primary" onClick={apply} disabled={!dirty || limitMissing}>
          Apply
        </button>
      </div>
    </div>
  );
}

function FilterManager(input: {
  allColumns: string[];
  filters: RelationQueryFilter[];
  onApply: (filter: RelationQueryFilter) => void;
  onRemove: (column: string) => void;
  onClearAll: () => void;
}) {
  const [draftColumn, setDraftColumn] = useState<string>(input.allColumns[0] ?? '');
  const [draftOperator, setDraftOperator] = useState<FilterOperator>('=');
  const [draftValue, setDraftValue] = useState<string>('');
  const requiresValue = operatorTakesValue(draftOperator);
  const applyDraft = () => {
    if (!draftColumn) return;
    input.onApply(
      requiresValue
        ? {column: draftColumn, operator: draftOperator, value: draftValue}
        : {column: draftColumn, operator: draftOperator},
    );
    setDraftValue('');
  };
  return (
    <div className="rqp-popover-body" role="dialog" aria-label="Filters">
      {input.filters.length > 0 ? (
        <div className="rqp-filter-list">
          {input.filters.map((filter) => (
            <div key={filter.column} className="rqp-filter-row">
              <code className="rqp-filter-summary">
                <span className="rqp-filter-column">{filter.column}</span>
                <span className="rqp-filter-op">{filter.operator}</span>
                {operatorTakesValue(filter.operator) ? (
                  <span className="rqp-filter-value">{filter.value || '∅'}</span>
                ) : null}
              </code>
              <button
                type="button"
                className="rqp-icon-button small"
                aria-label={`Remove filter on ${filter.column}`}
                onClick={() => input.onRemove(filter.column)}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="rqp-link-button" onClick={input.onClearAll}>
            Clear all
          </button>
        </div>
      ) : (
        <p className="rqp-popover-empty">No filters applied.</p>
      )}
      <div className="rqp-divider" />
      <div className="rqp-filter-draft">
        <select
          aria-label="Filter column"
          value={draftColumn}
          onChange={(event) => setDraftColumn(event.currentTarget.value)}
        >
          {input.allColumns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter operator"
          value={draftOperator}
          onChange={(event) => setDraftOperator(event.currentTarget.value as FilterOperator)}
        >
          {FILTER_OPERATORS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        {requiresValue ? (
          <input
            type="text"
            aria-label="Filter value"
            value={draftValue}
            placeholder={draftOperator === 'in' ? '1, 2, 3' : draftOperator === 'like' ? '%search%' : 'value'}
            onChange={(event) => setDraftValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyDraft();
            }}
          />
        ) : null}
        <button type="button" className="rqp-pill-button primary" onClick={applyDraft}>
          Apply
        </button>
      </div>
    </div>
  );
}

function SortManager(input: {
  allColumns: string[];
  sorts: RelationQuerySort[];
  onToggle: (column: string) => void;
  onClear: () => void;
}) {
  const indexByColumn = new Map(input.sorts.map((s, i) => [s.column, i] as const));
  return (
    <div className="rqp-popover-body" role="dialog" aria-label="Sort">
      <p className="rqp-popover-hint">Click to cycle asc → desc → off. Order of clicks sets the sort precedence.</p>
      <div className="rqp-sort-list">
        {input.allColumns.map((column) => {
          const index = indexByColumn.get(column);
          const sort = index != null ? input.sorts[index] : undefined;
          const direction = sort?.direction ?? null;
          return (
            <button
              key={column}
              type="button"
              className={`rqp-sort-row${direction ? ' is-active' : ''}`}
              onClick={() => input.onToggle(column)}
              aria-pressed={direction !== null}
              aria-label={`Sort by ${column}${direction ? ` (${direction})` : ''}`}
            >
              <span className="rqp-sort-name">{column}</span>
              <span className="rqp-sort-meta">
                {index != null ? <span className="rqp-sort-position">{index + 1}</span> : null}
                <span className="rqp-sort-direction" aria-hidden="true">
                  {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {input.sorts.length > 0 ? (
        <button type="button" className="rqp-link-button" onClick={input.onClear}>
          Clear all
        </button>
      ) : null}
    </div>
  );
}

function ColumnsManager(input: {
  allColumns: string[];
  hiddenColumns: string[];
  onToggle: (column: string) => void;
  onShowAll: () => void;
}) {
  const hidden = new Set(input.hiddenColumns);
  return (
    <div className="rqp-popover-body" role="dialog" aria-label="Columns">
      <div className="rqp-column-list">
        {input.allColumns.map((column) => {
          const visible = !hidden.has(column);
          return (
            <label key={column} className={`rqp-column-row${visible ? '' : ' is-hidden'}`}>
              <input
                type="checkbox"
                checked={visible}
                aria-label={`${visible ? 'Hide' : 'Show'} ${column}`}
                onChange={() => input.onToggle(column)}
              />
              <span>{column}</span>
            </label>
          );
        })}
      </div>
      {input.hiddenColumns.length > 0 ? (
        <button type="button" className="rqp-link-button" onClick={input.onShowAll}>
          Show all
        </button>
      ) : null}
    </div>
  );
}

function PerPageMenu(input: {value: number; onChange: (value: number) => void}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="rqp-pill-button" aria-label={`${input.value} rows per page`}>
          {input.value}/page
          <span className="rqp-pill-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="rqp-popover rqp-popover-compact" align="end" sideOffset={6}>
          <div className="rqp-per-page-list">
            {PAGE_SIZE_OPTIONS.map((option) => (
              <Popover.Close asChild key={option}>
                <button
                  type="button"
                  className={`rqp-per-page-row${option === input.value ? ' is-active' : ''}`}
                  onClick={() => input.onChange(option)}
                >
                  {option}
                </button>
              </Popover.Close>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function toggleSort(sorts: RelationQuerySort[], column: string): RelationQuerySort[] {
  const index = sorts.findIndex((s) => s.column === column);
  if (index < 0) {
    return [...sorts, {column, direction: 'asc'}];
  }
  const current = sorts[index]!;
  if (current.direction === 'asc') {
    return sorts.map((s, i) => (i === index ? {...s, direction: 'desc'} : s));
  }
  return sorts.filter((_, i) => i !== index);
}

type LegacyState = Partial<RelationQueryState> & {sort?: RelationQuerySort | null};

function reconcileState(state: LegacyState, tableName: string, allColumns: string[]): RelationQueryState {
  const columnSet = new Set(allColumns);
  const base = defaultRelationQueryState({tableName, allColumns});
  // Tolerate old localStorage shape where `sort` was singular nullable.
  const sorts = state.sorts ?? (state.sort ? [state.sort] : base.sorts);
  return {
    ...base,
    ...state,
    tableName,
    allColumns,
    hiddenColumns: (state.hiddenColumns ?? []).filter((c) => columnSet.has(c)),
    filters: (state.filters ?? []).filter((f) => columnSet.has(f.column)),
    sorts: sorts.filter((s) => columnSet.has(s.column)),
    limit: typeof state.limit === 'number' ? state.limit : base.limit,
    offset: typeof state.offset === 'number' ? state.offset : base.offset,
  };
}

function hasLimitClause(sql: string): boolean {
  return /\blimit\s+\d+/i.test(sql);
}

function isSimpleSelectFromTable(sql: string, tableName: string): boolean {
  const pattern = new RegExp(`^\\s*select\\s+[\\s\\S]*?\\s+from\\s+"?${escapeRegex(tableName)}"?(\\s|;|$)`, 'i');
  return pattern.test(sql);
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRows(data: unknown): Record<string, unknown>[] {
  if (data && typeof data === 'object' && 'rows' in data && Array.isArray((data as {rows: unknown[]}).rows)) {
    return (data as {rows: Record<string, unknown>[]}).rows;
  }
  return [];
}

function extractColumns(data: unknown, state: RelationQueryState): string[] {
  const rows = extractRows(data);
  if (rows.length > 0) return Object.keys(rows[0]!);
  return state.allColumns.filter((c) => !state.hiddenColumns.includes(c));
}
