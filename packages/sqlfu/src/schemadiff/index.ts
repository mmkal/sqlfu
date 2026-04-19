/*
 * sqlfu schema diff entrypoint.
 *
 * The sqlfu schemadiff engine is inspired by @pgkit/schemainspect and @pgkit/migra
 * (https://github.com/mmkal/pgkit), which are themselves TypeScript ports of djrobstep's
 * Python `schemainspect` and `migra` (https://github.com/djrobstep/schemainspect and
 * https://github.com/djrobstep/migra). The SQLite implementation under ./sqlite is sqlfu-specific
 * and does not copy code from those projects. See ./CLAUDE.md for the broader inspiration notes.
 */
import type {SqlfuHost} from '../core/host.js';
import {diffBaselineSqlToDesiredSql} from './sqlite/index.js';

export async function diffSchemaSql(
  host: SqlfuHost,
  input: {
    baselineSql: string;
    desiredSql: string;
    allowDestructive: boolean;
  },
): Promise<string[]> {
  return diffBaselineSqlToDesiredSql(host, {
    baselineSql: input.baselineSql,
    desiredSql: input.desiredSql,
    allowDestructive: input.allowDestructive,
  });
}
