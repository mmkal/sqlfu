import {createDefaultSqlite3defConfig, diffBaselineSqlToDesiredSql} from './sqlite3def.js';

export async function diffSchemaSql(input: {
  projectRoot: string;
  baselineSql: string;
  desiredSql: string;
}): Promise<string[]> {
  return diffBaselineSqlToDesiredSql(projectConfigForRoot(input.projectRoot), {
    baselineSql: input.baselineSql,
    desiredSql: input.desiredSql,
  });
}

function projectConfigForRoot(projectRoot: string) {
  return {
    ...createDefaultSqlite3defConfig('project'),
    projectRoot,
  };
}
