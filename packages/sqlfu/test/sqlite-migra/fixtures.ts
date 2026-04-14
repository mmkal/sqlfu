import fs from 'node:fs/promises';
import path from 'node:path';

export async function getSqliteMigraFixtures(fixturesRoot: string) {
  const fixtureNames = (await fs.readdir(fixturesRoot)).sort();

  return Promise.all(
    fixtureNames.map(async (name) => {
      const fixtureRoot = path.join(fixturesRoot, name);
      const [fromSql, toSql, expectedSql] = await Promise.all([
        fs.readFile(path.join(fixtureRoot, 'a.sql'), 'utf8'),
        fs.readFile(path.join(fixtureRoot, 'b.sql'), 'utf8'),
        fs.readFile(path.join(fixtureRoot, 'expected.sql'), 'utf8'),
      ]);

      return {
        name,
        fromSql,
        toSql,
        expectedLines: expectedSql
          .trim()
          .split('\n')
          .map((line) => line.trimEnd())
          .filter(Boolean),
      };
    }),
  );
}
