import {useState} from 'react';
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
  const limitError = !hasLimitClause(effectiveSql)
    ? 'Your query must end with a `limit` clause. Remove manual edits or use the SQL Runner for unbounded queries.'
    : null;
  const simpleShapeMatch = isSimpleSelectFromTable(effectiveSql, relation.name);
  const activeFilterCount = safeState.filters.length;
  const hiddenCount = safeState.hiddenColumns.length;
  const visibleColumnCount = allColumns.length - hiddenCount;

  const runQuery = useQuery({
    queryKey: ['relation-query', relation.name, effectiveSql],
    queryFn: () => input.runSql({sql: effectiveSql}),
    enabled: !isDefault && !limitError,
    placeholderData: (previous) => previous,
  });

  const mutate = (updater: (previous: RelationQueryState) => RelationQueryState) => {
    if (!isStructured) setCustomSql(null);
    setState((previous) => updater(reconcileState(previous, relation.name, allColumns)));
  };

  const handleSortToggle = (column: string) => {
    mutate((s) => {
      const current = s.sort?.column === column ? s.sort.direction : null;
      const next = current === null ? 'asc' : current === 'asc' ? 'desc' : null;
      return {...s, sort: next === null ? null : {column, direction: next}};
    });
  };
  const handleSortClear = () => mutate((s) => ({...s, sort: null}));

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
  const handleSqlChange = (value: string) => {
    if (value === generatedSql) {
      setCustomSql(null);
      return;
    }
    setCustomSql(value);
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
      limitError={limitError}
      simpleShapeMatch={simpleShapeMatch}
      rowEditing={input.rowEditing}
      onSortToggle={handleSortToggle}
      onSortClear={handleSortClear}
      onFilterApply={handleFilterApply}
      onFilterRemove={handleFilterRemove}
      onFilterClearAll={handleFilterClearAll}
      onColumnToggle={handleColumnToggle}
      onColumnsShowAll={handleColumnsShowAll}
      onSqlChange={handleSqlChange}
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

      <div className="rqp-footer">
        <span className="rqp-footer-summary">
          {isDefault ? 'Showing default rows' : `Rows ${safeState.offset + 1}–${safeState.offset + safeState.limit}`}
        </span>
        <div className="rqp-footer-pager">
          <button
            type="button"
            className="rqp-icon-button"
            aria-label="Previous page"
            disabled={safeState.offset === 0}
            onClick={handlePrev}
          >
            ←
          </button>
          <button type="button" className="rqp-icon-button" aria-label="Next page" onClick={handleNext}>
            →
          </button>
          <PerPageMenu value={safeState.limit} onChange={handleLimitChange} />
          {!isDefault ? (
            <button type="button" className="rqp-pill-button" aria-label="Reset query to default" onClick={handleReset}>
              Reset
            </button>
          ) : null}
        </div>
      </div>
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
  limitError: string | null;
  simpleShapeMatch: boolean;
  rowEditing: RelationRowEditing | undefined;
  onSortToggle: (column: string) => void;
  onSortClear: () => void;
  onFilterApply: (filter: RelationQueryFilter) => void;
  onFilterRemove: (column: string) => void;
  onFilterClearAll: () => void;
  onColumnToggle: (column: string) => void;
  onColumnsShowAll: () => void;
  onSqlChange: (value: string) => void;
}) {
  const sortLabel = input.state.sort ? `${input.state.sort.column} ${input.state.sort.direction}` : null;
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
              sort={input.state.sort}
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
            <div className="rqp-query-body">
              <SqlCodeMirror
                value={input.effectiveSql}
                ariaLabel="Relation query editor"
                relations={[input.relation]}
                onChange={input.onSqlChange}
                height="7rem"
              />
              <div className="rqp-query-message" aria-live="polite">
                {input.limitError ? (
                  <div className="error-view rqp-query-message-inner">{input.limitError}</div>
                ) : !input.isStructured && !input.simpleShapeMatch ? (
                  <div className="info-callout rqp-query-message-inner">
                    Your query is no longer a simple <code>select … from {input.relation.name}</code>. Consider opening
                    it in the <a href="#sql">full SQL Runner</a> for more control.
                  </div>
                ) : null}
              </div>
            </div>
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

      {input.rowEditing?.editable && dirty ? (
        <>
          <span className="rqp-toolbar-spacer" />
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
        </>
      ) : null}
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
  sort: RelationQueryState['sort'];
  onToggle: (column: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="rqp-popover-body" role="dialog" aria-label="Sort">
      <div className="rqp-sort-list">
        {input.allColumns.map((column) => {
          const direction = input.sort?.column === column ? input.sort.direction : null;
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
              <span className="rqp-sort-direction" aria-hidden="true">
                {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
              </span>
            </button>
          );
        })}
      </div>
      {input.sort ? (
        <button type="button" className="rqp-link-button" onClick={input.onClear}>
          Clear sort
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

function reconcileState(state: RelationQueryState, tableName: string, allColumns: string[]): RelationQueryState {
  const columnSet = new Set(allColumns);
  return {
    ...state,
    tableName,
    allColumns,
    hiddenColumns: state.hiddenColumns.filter((c) => columnSet.has(c)),
    filters: state.filters.filter((f) => columnSet.has(f.column)),
    sort: state.sort && columnSet.has(state.sort.column) ? state.sort : null,
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
