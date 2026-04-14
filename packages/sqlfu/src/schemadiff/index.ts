import {createDefaultSqlite3defConfig, diffBaselineSqlToDesiredSql} from './sqlite3def.js';

export async function diffSchemaSql(input: {
  projectRoot: string;
  baselineSql: string;
  desiredSql: string;
  allowDestructive: boolean;
}): Promise<string[]> {
  return diffBaselineSqlToDesiredSql(projectConfigForRoot(input.projectRoot), {
    baselineSql: input.baselineSql,
    desiredSql: input.desiredSql,
    allowDestructive: input.allowDestructive,
  });
}

function projectConfigForRoot(projectRoot: string) {
  return {
    ...createDefaultSqlite3defConfig('project'),
    projectRoot,
  };
}
