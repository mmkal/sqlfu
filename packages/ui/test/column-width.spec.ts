import {expect, test} from '@playwright/test';

import {columnWidthAlgorithm, type ColumnWidthInput} from '../src/column-width.js';

test('column width algorithm snapshot', async () => {
  const scenarios = [
    {
      title: 'variable content gets the spare width',
      availableWidth: 900,
      columns: [
        {
          key: 'applied_at',
          header: 'applied_at',
          cells: ['2026-04-14T21:38:35.004Z', '2026-04-14T21:38:35.004Z'],
        },
        {
          key: 'name',
          header: 'name',
          cells: ['create_table_posts', 'create_table_posts'],
        },
        {
          key: 'content',
          header: 'content',
          cells: [
            'create table posts (id integer primary key, slug text not null unique, title text not null, body text not null, published integer not null)',
            'create table a (b text)',
          ],
        },
      ],
    },
    {
      title: 'narrow viewport keeps minimum widths and relies on scrolling',
      availableWidth: 240,
      columns: [
        {
          key: 'slug',
          header: 'slug',
          cells: ['hello-world', 'draft-notes'],
        },
        {
          key: 'title',
          header: 'title',
          cells: ['Hello World', 'Draft Notes'],
        },
        {
          key: 'published',
          header: 'published',
          cells: ['1', '0'],
        },
      ],
    },
    {
      title: 'uniform columns share spare width evenly',
      availableWidth: 500,
      columns: [
        {
          key: 'id',
          header: 'id',
          cells: ['1', '2'],
        },
        {
          key: 'published',
          header: 'published',
          cells: ['0', '1'],
        },
      ],
    },
  ] satisfies Array<{
    title: string;
    availableWidth: number;
    columns: readonly ColumnWidthInput[];
  }>;

  const output = `${scenarios.map(formatScenarioSnapshot).join('\n\n')}\n`;
  expect(output).toMatchSnapshot('column-widths.txt');
});

function formatScenarioSnapshot(input: {title: string; availableWidth: number; columns: readonly ColumnWidthInput[]}) {
  const widths = columnWidthAlgorithm({
    availableWidth: input.availableWidth,
    columns: input.columns,
  });
  const rows = buildRows(input.columns);
  const markdownWidths = widths.map((column) => ({
    ...column,
    markdownWidth: Math.max(3, Math.floor(column.width / 8) + 2),
  }));

  return [
    input.title,
    `availableWidth=${input.availableWidth} totalWidth=${widths.reduce((total, column) => total + column.width, 0)}`,
    `widths=${markdownWidths.map((column) => `${column.key}:${column.width}`).join(', ')}`,
    ...formatMarkdownTable(
      rows,
      markdownWidths.map((column) => column.markdownWidth),
    ),
  ].join('\n');
}

function buildRows(columns: readonly ColumnWidthInput[]) {
  const rowCount = Math.max(columns[0]?.cells.length ?? 0, ...columns.map((column) => column.cells.length));
  return [
    columns.map((column) => column.header),
    ...Array.from({length: rowCount}, (_, rowIndex) => columns.map((column) => column.cells[rowIndex] ?? '')),
  ];
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return '…';
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function pad(value: string, width: number) {
  return width > 0 ? value.padEnd(width, ' ') : value;
}

function formatMarkdownTable(rows: readonly (readonly string[])[], widths: readonly number[]) {
  const [header = [], ...body] = rows;
  return [
    formatMarkdownRow(header, widths),
    `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`,
    ...body.map((row) => formatMarkdownRow(row, widths)),
  ];
}

function formatMarkdownRow(row: readonly string[], widths: readonly number[]) {
  return `|${widths.map((width, index) => formatMarkdownCell(row[index] ?? '', width)).join('|')}|`;
}

function formatMarkdownCell(value: string, width: number) {
  const content = pad(truncate(singleLine(value), width), width);
  return ` ${content} `;
}

function singleLine(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
