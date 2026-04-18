import type {SqlfuHost} from '../core/host.js';
import {diffBaselineSqlToDesiredSql} from './sqlite/index.js';

export async function diffSchemaSql(host: SqlfuHost, input: {
  baselineSql: string;
  desiredSql: string;
  allowDestructive: boolean;
}): Promise<string[]> {
  return diffBaselineSqlToDesiredSql(host, {
    baselineSql: input.baselineSql,
    desiredSql: input.desiredSql,
    allowDestructive: input.allowDestructive,
  });
}
