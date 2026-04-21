#!/usr/bin/env tsx
/**
 * Compare two `npm pack --dry-run --json` outputs and emit a markdown report.
 *
 * Usage: tsx scripts/compare-package-size.ts --base main.json --head pr.json
 *
 * Consumed by `.github/workflows/pr-package-size.yml`, but also runnable
 * locally for spot-checks:
 *
 *   (cd packages/sqlfu && npm pack --dry-run --json) > head.json
 *   # switch to main, rebuild, pack again into base.json
 *   tsx scripts/compare-package-size.ts --base base.json --head head.json
 */

import {readFileSync} from 'node:fs';

type PackFile = {path: string; size: number};
type PackResult = {
  name: string;
  version: string;
  size: number;
  unpackedSize: number;
  entryCount: number;
  files: PackFile[];
};

const WARN_THRESHOLD_PCT = 10;

function parsePackJson(path: string): PackResult {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as PackResult[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Expected non-empty array in ${path}`);
  }
  return raw[0];
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function deltaPct(base: number, head: number): {pct: number; label: string} {
  if (base === 0) {
    if (head === 0) return {pct: 0, label: '0'};
    return {pct: Infinity, label: 'new'};
  }
  const pct = ((head - base) / base) * 100;
  const sign = pct > 0 ? '+' : '';
  const rounded = Math.abs(pct) < 0.05 ? '0' : `${sign}${pct.toFixed(1)}%`;
  return {pct, label: rounded};
}

function deltaCount(base: number, head: number): string {
  const diff = head - base;
  if (diff === 0) return '0';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

type Row = {label: string; base: number; head: number; format: 'bytes' | 'count'};

function renderRow(row: Row): {line: string; pct: number} {
  const baseStr = row.format === 'bytes' ? humanBytes(row.base) : String(row.base);
  const headStr = row.format === 'bytes' ? humanBytes(row.head) : String(row.head);
  const delta = row.format === 'bytes' ? deltaPct(row.base, row.head) : {pct: 0, label: deltaCount(row.base, row.head)};
  return {
    line: `| ${row.label} | ${baseStr} | ${headStr} | ${delta.label} |`,
    pct: delta.pct,
  };
}

/**
 * Group vendor bundle `.js` files into per-subdirectory totals, e.g. `vendor/typesql/*.js`.
 * Files sitting directly under `dist/vendor/` (no subdir) report under their own path.
 */
function vendorBundleTotals(files: PackFile[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const f of files) {
    if (!f.path.startsWith('dist/vendor/')) continue;
    if (!f.path.endsWith('.js')) continue;
    // parts = ['dist', 'vendor', <subdir-or-file>, ...]
    const parts = f.path.split('/');
    const rest = parts.slice(2);
    const key = rest.length === 1 ? `vendor/${rest[0]}` : `vendor/${rest[0]}/*.js`;
    totals.set(key, (totals.get(key) || 0) + f.size);
  }
  return totals;
}

function renderReport(base: PackResult, head: PackResult): string {
  const headerRows: Row[] = [
    {label: 'packed', base: base.size, head: head.size, format: 'bytes'},
    {label: 'unpacked', base: base.unpackedSize, head: head.unpackedSize, format: 'bytes'},
    {label: 'files', base: base.entryCount, head: head.entryCount, format: 'count'},
  ];

  const headerLines: string[] = [];
  let maxPct = 0;
  headerLines.push('|  | main | this PR | Δ |');
  headerLines.push('| - | - | - | - |');
  for (const row of headerRows) {
    const rendered = renderRow(row);
    headerLines.push(rendered.line);
    if (Number.isFinite(rendered.pct) && rendered.pct > maxPct) maxPct = rendered.pct;
  }

  const baseBundles = vendorBundleTotals(base.files);
  const headBundles = vendorBundleTotals(head.files);
  const allKeys = new Set([...baseBundles.keys(), ...headBundles.keys()]);
  const sortedKeys = [...allKeys].sort();

  const bundleLines: string[] = [];
  if (sortedKeys.length > 0) {
    bundleLines.push('');
    bundleLines.push('### `dist/vendor/*.js` bundles');
    bundleLines.push('');
    bundleLines.push('|  | main | this PR | Δ |');
    bundleLines.push('| - | - | - | - |');
    for (const key of sortedKeys) {
      const baseSize = baseBundles.get(key) || 0;
      const headSize = headBundles.get(key) || 0;
      const rendered = renderRow({label: `\`${key}\``, base: baseSize, head: headSize, format: 'bytes'});
      bundleLines.push(rendered.line);
      if (Number.isFinite(rendered.pct) && rendered.pct > maxPct) maxPct = rendered.pct;
    }
  }

  const header = ['## Package size', ''];
  if (maxPct >= WARN_THRESHOLD_PCT) {
    header.push(
      `> ⚠️ **Package size bump ≥${WARN_THRESHOLD_PCT}%** — if this is intentional, note it in the relevant task file so a future reviewer knows it was deliberate.`,
      '',
    );
  }

  const footer = [
    '',
    `_Measured with \`npm pack --dry-run --json\` on \`${base.name}\` (${base.version} on main vs ${head.version} on this PR)._`,
  ];

  return [...header, ...headerLines, ...bundleLines, ...footer].join('\n') + '\n';
}

function parseArgs(argv: string[]): {base: string; head: string} {
  const args = {base: '', head: ''};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') args.base = argv[++i];
    else if (a === '--head') args.head = argv[++i];
  }
  if (!args.base || !args.head) {
    throw new Error('Usage: compare-package-size.ts --base <main.json> --head <pr.json>');
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const base = parsePackJson(args.base);
const head = parsePackJson(args.head);
process.stdout.write(renderReport(base, head));
